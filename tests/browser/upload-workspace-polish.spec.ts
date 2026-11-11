import { expect, test, type Page } from "@playwright/test";
import type { DocumentRecord, Organisation } from "../../src/types";
const firstId = "d604582e-43d1-448a-8d9b-22f6db989f1e";
const secondId = "306f2bd8-5d18-4ff7-82c2-04c25a8b9784";
const firstUser = {
  id: "da444cb8-3a9e-4511-9383-999676e776f0",
  email: "member@example.invalid",
};
const secondUser = {
  id: "130f274e-5a40-45a2-bd92-6ff9776f7471",
  email: "other@example.invalid",
};
function org(id: string, name: string): Organisation {
  return {
    id,
    name,
    abn: null,
    type: "",
    state: "",
    description: "Community support",
    focus_areas: [],
    profile: { name },
    notification_frequency: "never",
    verification_status: "draft",
    inbox_alias: `test-${id.slice(0, 8)}`,
  };
}
async function mockWorkspace(page: Page, documents: DocumentRecord[] = []) {
  const state = {
    user: firstUser,
    project: "https://project-one.supabase.co",
    orgs: [org(firstId, "First Community"), org(secondId, "Second Community")],
    documents: structuredClone(documents),
    uploads: [] as { name: string; mime: string }[],
    inserted: [] as Record<string, unknown>[],
    failedNames: new Set<string>(),
    patches: [] as Record<string, unknown>[],
  };
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const configured=true;export const supabase={auth:{getSession:async()=>{const user=await(await fetch('/polish-user')).json();return {data:{session:{user,access_token:'test-access'}},error:null}},onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:table=>({select:()=>({order:async()=>(await fetch('/polish-orgs')).json(),eq:async(field,id)=>(await fetch('/polish-records?table='+table+'&org='+id)).json()}),insert:async data=>(await fetch('/polish-insert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).json(),update:data=>({eq:async(field,id)=>(await fetch('/polish-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,...data})})).json()})}),storage:{from:()=>({upload:async(path,file,options)=>(await fetch('/polish-upload?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':options.contentType},body:file})).json(),remove:async()=>({error:null})})}};`,
    }),
  );
  await page.route("**/src/lib/app-context.tsx*", async (route) => {
    const response = await route.fetch();
    return route.fulfill({
      response,
      body: (await response.text()).replaceAll(
        "import.meta.env.VITE_SUPABASE_URL",
        JSON.stringify(state.project),
      ),
    });
  });
  await page.route("**/polish-user", (route) =>
    route.fulfill({ json: state.user }),
  );
  await page.route("**/polish-orgs", (route) =>
    route.fulfill({ json: { data: state.orgs, error: null } }),
  );
  await page.route("**/polish-records*", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: {
        data:
          url.searchParams.get("table") === "documents"
            ? state.documents.filter(
                (doc) => doc.org_id === url.searchParams.get("org"),
              )
            : [],
        error: null,
      },
    });
  });
  await page.route("**/polish-upload*", (route) => {
    const name = new URL(route.request().url()).searchParams.get("name")!;
    state.uploads.push({
      name,
      mime: route.request().headers()["content-type"],
    });
    return route.fulfill({
      json: {
        error: state.failedNames.has(name)
          ? { message: "mime type is not supported" }
          : null,
      },
    });
  });
  await page.route("**/polish-insert", (route) => {
    const body = route.request().postDataJSON();
    state.inserted.push(body);
    state.documents.push({
      ...body,
      id: `00000000-0000-4000-8000-${String(state.inserted.length).padStart(12, "0")}`,
      created_at: "2026-01-01T00:00:00Z",
    });
    return route.fulfill({ json: { error: null } });
  });
  await page.route("**/polish-update", (route) => {
    const body = route.request().postDataJSON();
    state.patches.push(body);
    state.orgs = state.orgs.map((item) =>
      item.id === body.id ? { ...item, ...body } : item,
    );
    return route.fulfill({ json: { error: null } });
  });
  return state;
}
async function library(page: Page) {
  await page.goto("/?view=organisation");
  await expect(
    page.getByRole("button", { name: "Upload documents", exact: true }),
  ).toBeVisible();
  return page.locator("input[type=file]").first();
}

test("duplicate name, size and normalised MIME are skipped visibly while changed-size versions remain allowed", async ({
  page,
}) => {
  const existing: DocumentRecord = {
    id: "87803972-e455-425a-a711-7f3b4bce8258",
    org_id: firstId,
    name: "scan.png",
    category: "other",
    storage_path: `${firstId}/original-scan.png`,
    mime_type: "image/png",
    size_bytes: 4,
    verified: false,
    created_at: "2026-01-01T00:00:00Z",
  };
  const state = await mockWorkspace(page, [existing]);
  const input = await library(page);
  await input.setInputFiles([
    { name: "scan.png", mimeType: "image/x-png", buffer: Buffer.from("scan") },
    { name: "fresh.docx", mimeType: "", buffer: Buffer.from("fresh") },
    {
      name: "fresh.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from("fresh"),
    },
    { name: "scan.png", mimeType: "image/png", buffer: Buffer.from("larger") },
  ]);
  const report = page.getByRole("status", { name: "Upload results" });
  await expect(report).toContainText("Saved (2)");
  await expect(report).toContainText("Skipped (2)");
  await expect(report).toContainText("scan.png");
  await expect(report).toContainText("fresh.docx");
  await expect(report).toContainText(
    "Same name, size and type already in your library",
  );
  await expect(report).toContainText("already selected in this batch");
  expect(state.uploads.map((item) => item.name)).toEqual([
    "fresh.docx",
    "scan.png",
  ]);
  expect(state.documents).toHaveLength(3);
  expect(state.documents[0].storage_path).toBe(existing.storage_path);
  await input.setInputFiles({
    name: "fresh.docx",
    mimeType: "",
    buffer: Buffer.from("fresh"),
  });
  await expect(report).toContainText("Saved (0)");
  await expect(report).toContainText("Skipped (1)");
  expect(state.uploads).toHaveLength(2);
});

test("one failed file does not stop later files and the summary names saved and failed files", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  state.failedNames.add("failed.docx");
  const input = await library(page);
  await input.setInputFiles([
    { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("first") },
    { name: "failed.docx", mimeType: "", buffer: Buffer.from("second") },
    { name: "last.xlsx", mimeType: "", buffer: Buffer.from("third") },
  ]);
  const report = page.getByRole("alert", { name: "Upload results" });
  await expect(report).toContainText("Saved (2)");
  await expect(report).toContainText("Failed (1)");
  await expect(report).toContainText("first.txt");
  await expect(report).toContainText("last.xlsx");
  await expect(report).toContainText("failed.docx");
  await expect(report).toContainText("needs an update");
  expect(state.uploads.map((item) => item.name)).toEqual([
    "first.txt",
    "failed.docx",
    "last.xlsx",
  ]);
  expect(state.inserted.map((item) => item.name)).toEqual([
    "first.txt",
    "last.xlsx",
  ]);
  await expect(
    page.locator(".document-row").filter({ hasText: "last.xlsx" }),
  ).toBeVisible();
});

test("the organisation switcher closes on Escape or an outside click and steps have one numbering source", async ({
  page,
}) => {
  await mockWorkspace(page);
  await library(page);
  await page.locator(".org-switch").click();
  await expect(page.locator(".org-dropdown")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".org-dropdown")).toHaveCount(0);
  await expect(page.locator(".org-switch")).toBeFocused();
  await page.locator(".org-switch").click();
  await page
    .getByRole("heading", { name: "A home for your organisation." })
    .click();
  await expect(page.locator(".org-dropdown")).toHaveCount(0);
  await expect(page.locator(".simple-steps li")).toHaveText([
    "Read your source documents",
    "Check facts against the originals",
    "Correct differences for your review",
  ]);
  await expect(page.locator(".simple-steps li span")).toHaveCount(0);
});

test("last selected organisation is scoped to user and project while a valid URL org wins", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await library(page);
  await page.locator(".org-switch").click();
  await page
    .getByRole("button", { name: "Second Community", exact: true })
    .click();
  await expect(page.locator(".org-switch")).toContainText("Second Community");
  await page.goto("/");
  await expect(page.locator(".org-switch")).toContainText("Second Community");
  const keys = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) =>
      key.startsWith("simple-grants-last-org-v1:"),
    ),
  );
  expect(keys).toContain(
    `simple-grants-last-org-v1:project-one.supabase.co:${firstUser.id}`,
  );
  state.user = secondUser;
  await page.goto("/");
  await expect(page.locator(".org-switch")).toContainText("First Community");
  state.user = firstUser;
  state.project = "https://project-two.supabase.co";
  await page.goto("/");
  await expect(page.locator(".org-switch")).toContainText("First Community");
  state.project = "https://project-one.supabase.co";
  await page.goto("/");
  await expect(page.locator(".org-switch")).toContainText("Second Community");
  await page.goto(`/?view=organisation&org=${firstId}`);
  await expect(page.locator(".org-switch")).toContainText("First Community");
});

test("organisation changes clear the top search and reset page filters", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/?view=opportunities");
  const topSearch = page.getByRole("textbox", {
    name: "Find an opportunity",
    exact: true,
  });
  await topSearch.fill("a previous organisation’s search");
  await page.getByRole("button", { name: /^Saved\s+0$/ }).click();
  await page.getByRole("combobox", { name: "Sort by" }).selectOption("closing");
  await page.locator(".org-switch").click();
  await page
    .getByRole("button", { name: "Second Community", exact: true })
    .click();
  await expect(topSearch).toHaveValue("");
  await expect(
    page.getByRole("textbox", { name: "Search grant opportunities" }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: /^All opportunities\s+0$/ }),
  ).toHaveClass("active");
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue(
    "recommended",
  );
});

test("unknown organisation type is not displayed or restored as Charity during profile approval", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await library(page);
  await expect(
    page
      .getByText("Organisation type", { exact: true })
      .locator("..")
      .locator("dd"),
  ).toHaveText("Not provided");
  state.orgs[0].type = "Charity";
  await page.reload();
  await page
    .getByRole("button", { name: "Update with AI", exact: true })
    .click();
  await page
    .getByRole("textbox", {
      name: "Paste your organisation’s history or information",
    })
    .fill(
      "Facts about our community organisation, without evidence of a legal type.",
    );
  const fingerprint = "f".repeat(64);
  const draft = { name: "First Community", description: "Community support" };
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({
      json:
        body.profileStage === "extract"
          ? { profileDraft: draft, sourceFingerprint: fingerprint }
          : body.profileStage === "verify"
            ? {
                profileDraft: draft,
                profileChecks: [],
                sourceFingerprint: fingerprint,
              }
            : {
                profile: draft,
                checks: [],
                evidence: [],
                sourceFingerprint: fingerprint,
              },
    });
  });
  await page
    .getByRole("button", { name: "Prepare my profile", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Organisation type" }),
  ).toHaveValue("");
  await page
    .getByRole("checkbox", {
      name: "I have checked these details and approve them for use in grant applications.",
    })
    .check();
  await page.getByRole("button", { name: "Approve and save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.patches.at(-1)?.type).toBe("");
  await expect(
    page
      .getByText("Organisation type", { exact: true })
      .locator("..")
      .locator("dd"),
  ).toHaveText("Not provided");
});
