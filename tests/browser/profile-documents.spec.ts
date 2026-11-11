import { expect, test, type Page } from "@playwright/test";
import type { DocumentRecord } from "../../src/types";

const orgId = "54ac553a-2aeb-4404-849c-8266b10f8383";
const secondOrgId = "d8eff44d-c280-4d64-9609-e87af481e154";
const user = {
  id: "e61706c9-aa69-45c3-9c7c-fe287d3d33d2",
  email: "member@example.invalid",
};
const fingerprint = "b".repeat(64);
const profileDraft = {
  name: "Draft Community",
  description: "Local community support",
  focus_areas: ["Community"],
};
const profileChecks = [
  {
    field: "name",
    issue: "Check the legal name against the registration",
    source: "registration.docx",
    suggestion: "Corrected Community",
  },
];
const finalResult = {
  profile: { ...profileDraft, name: "Corrected Community" },
  checks: profileChecks,
  evidence: [
    {
      field: "name",
      source: "registration.docx",
      quote: "Corrected Community",
    },
  ],
  sourceFingerprint: fingerprint,
};
const initialDocuments: DocumentRecord[] = [
  {
    id: "c686196c-c04d-49bf-b02e-9d01349ef769",
    org_id: orgId,
    name: "registration.docx",
    category: "registration",
    storage_path: `${orgId}/registration.docx`,
    mime_type:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size_bytes: 128,
    verified: false,
    created_at: "2026-11-01T00:00:00Z",
  },
  {
    id: "a67914b3-8e86-4e97-ae9a-ffbb6b201f50",
    org_id: orgId,
    name: "history.xlsx",
    category: "other",
    storage_path: `${orgId}/history.xlsx`,
    mime_type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size_bytes: 256,
    verified: false,
    created_at: "2026-11-01T00:00:00Z",
  },
];
function stageResult(body: Record<string, unknown>) {
  return body.profileStage === "extract"
    ? { profileDraft, sourceFingerprint: fingerprint }
    : body.profileStage === "verify"
      ? { profileDraft, profileChecks, sourceFingerprint: fingerprint }
      : finalResult;
}
async function prepareDocuments(
  page: Page,
  documents: DocumentRecord[] = initialDocuments,
) {
  const state = {
    documents: structuredClone(documents),
    uploads: [] as { path: string; mime: string; bytes: number }[],
    inserts: [] as Record<string, unknown>[],
    ai: [] as Record<string, unknown>[],
    recordRequests: 0,
    open: [] as { path: string; expires: number; options?: unknown }[],
    failUploadAt: 0,
  };
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const configured=true;
const user=${JSON.stringify(user)};let authCallback;
window.__changeDocumentUser=next=>authCallback?.(next?'SIGNED_IN':'SIGNED_OUT',next?{user:next,access_token:'test-access'}:null);
export const supabase={auth:{getSession:async()=>({data:{session:{user,access_token:'test-access'}},error:null}),onAuthStateChange:callback=>{authCallback=callback;return {data:{subscription:{unsubscribe(){if(authCallback===callback)authCallback=null}}}};}},
from:table=>({select:()=>({order:async()=>(await fetch('/test-document-organizations')).json(),eq:async(field,id)=>(await fetch('/test-document-records?table='+table+'&org='+id)).json()}),insert:async metadata=>(await fetch('/test-document-insert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(metadata)})).json()}),
storage:{from:bucket=>({upload:async(path,file,options)=>{const response=await fetch('/test-document-upload?path='+encodeURIComponent(path),{method:'POST',headers:{'Content-Type':options.contentType},body:file});return response.json();},remove:async()=>({error:null}),createSignedUrl:async(path,expires,options)=>(await fetch('/test-document-open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,expires,options})})).json()})}};`,
    }),
  );
  await page.route("**/test-document-organizations", (route) =>
    route.fulfill({
      json: {
        data: [orgId, secondOrgId].map((id, index) => ({
          id,
          name: index ? "Other Organisation" : "Test Community",
          abn: null,
          type: "Charity",
          state: "VIC",
          description: "Community support",
          focus_areas: ["Community"],
          profile: { name: "Test Community" },
          notification_frequency: "weekly",
          verification_status: "draft",
          inbox_alias: "test-inbox",
          created_at: "2026-01-01T00:00:00Z",
        })),
        error: null,
      },
    }),
  );
  await page.route("**/test-document-records*", (route) => {
    state.recordRequests++;
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
  await page.route("**/test-document-upload*", (route) => {
    state.uploads.push({
      path: new URL(route.request().url()).searchParams.get("path")!,
      mime: route.request().headers()["content-type"],
      bytes: route.request().postDataBuffer()?.length ?? 0,
    });
    return route.fulfill({
      status: state.failUploadAt === state.uploads.length ? 503 : 200,
      json: {
        error:
          state.failUploadAt === state.uploads.length
            ? { message: "The service is unavailable" }
            : null,
      },
    });
  });
  await page.route("**/test-document-insert", (route) => {
    const body = route.request().postDataJSON();
    state.inserts.push(body);
    state.documents.push({
      ...body,
      id: `00000000-0000-4000-8000-${String(state.inserts.length).padStart(12, "0")}`,
      created_at: "2026-11-01T00:00:00Z",
    });
    return route.fulfill({ json: { error: null } });
  });
  await page.route("**/test-document-open", (route) => {
    state.open.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        data: { signedUrl: "https://example.invalid/private-file" },
        error: null,
      },
    });
  });
  return state;
}
async function openProfile(
  page: Page,
  text = "Original history supplied by the user",
) {
  await page.goto("/?view=organisation");
  await page
    .getByRole("button", { name: "Update with AI", exact: true })
    .click();
  await page
    .getByRole("textbox", {
      name: "Paste your organisation’s history or information",
    })
    .fill(text);
}

test("profile review runs three distinct stages with unchanged original evidence and no intermediate approval", async ({
  page,
}) => {
  const state = await prepareDocuments(page);
  const releases: Record<string, () => void> = {};
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    await new Promise<void>((resolve) => {
      releases[body.profileStage] = resolve;
    });
    await route.fulfill({ json: stageResult(body) });
  });
  const text = "Our ORIGINAL history, including exact source wording.";
  await openProfile(page, text);
  const initialRecordRequests = state.recordRequests;
  await page
    .getByRole("button", { name: "Prepare my profile", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Step 1 of 3");
  await expect(
    page.getByRole("button", { name: "Approve and save" }),
  ).toHaveCount(0);
  await expect.poll(() => state.ai.length).toBe(1);
  releases.extract();
  await expect(page.getByRole("status")).toContainText("Step 2 of 3");
  await expect.poll(() => state.ai.length).toBe(2);
  await expect(
    page.getByRole("button", { name: "Approve and save" }),
  ).toHaveCount(0);
  releases.verify();
  await expect(page.getByRole("status")).toContainText("Step 3 of 3");
  await expect.poll(() => state.ai.length).toBe(3);
  await expect(
    page.getByRole("button", { name: "Approve and save" }),
  ).toHaveCount(0);
  releases.correct();
  await expect(page.getByRole("dialog")).toHaveAccessibleName(
    "Review your organisation details",
  );
  await expect(
    page.getByRole("textbox", { name: "Organisation name", exact: true }),
  ).toHaveValue("Corrected Community");
  await expect(
    page.getByRole("button", { name: "Approve and save" }),
  ).toBeDisabled();
  expect(
    state.ai.map((body) => ({
      orgId: body.orgId,
      text: body.text,
      documentIds: body.documentIds,
    })),
  ).toEqual(
    Array.from({ length: 3 }, () => ({
      orgId,
      text,
      documentIds: initialDocuments.map((doc) => doc.id),
    })),
  );
  expect(state.ai.map((body) => body.profileStage)).toEqual([
    "extract",
    "verify",
    "correct",
  ]);
  expect(state.ai[1].profileDraft).toEqual(profileDraft);
  expect(state.ai[2].profileChecks).toEqual(profileChecks);
  expect(state.ai[1].sourceFingerprint).toBe(fingerprint);
  expect(state.ai[2].sourceFingerprint).toBe(fingerprint);
  expect(state.ai.every((body) => !("onProgress" in body))).toBe(true);
  expect(state.recordRequests).toBe(initialRecordRequests);
  expect(state.inserts).toHaveLength(0);
});

test("a non-JSON profile timeout retains saved documents, source selection and pasted history for retry", async ({
  page,
}) => {
  const state = await prepareDocuments(page);
  let first = true;
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    if (first) {
      first = false;
      return route.fulfill({
        status: 504,
        contentType: "text/html",
        body: "<h1>private-gateway-payload</h1>",
      });
    }
    return route.fulfill({ json: stageResult(body) });
  });
  const text = "Keep this exact history for the next attempt.";
  await openProfile(page, text);
  await page
    .getByRole("button", { name: "Prepare my profile", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("SG_AI_TIMEOUT");
  await expect(page.getByRole("alert")).toContainText(
    "uploaded documents are still saved",
  );
  await expect(page.getByRole("alert")).not.toContainText(
    "private-gateway-payload",
  );
  await expect(
    page.getByRole("textbox", {
      name: "Paste your organisation’s history or information",
    }),
  ).toHaveValue(text);
  await expect(
    page.getByRole("checkbox", { name: "registration.docx" }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Prepare my profile", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Prepare my profile", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName(
    "Review your organisation details",
  );
  expect(state.ai).toHaveLength(4);
  expect(
    state.ai.every(
      (body) =>
        body.text === text &&
        body.orgId === orgId &&
        JSON.stringify(body.documentIds) ===
          JSON.stringify(initialDocuments.map((doc) => doc.id)),
    ),
  ).toBe(true);
  expect(state.uploads).toHaveLength(0);
  expect(state.documents).toHaveLength(2);
});

test("real DOCX and XLSX file inputs infer missing browser MIME and store canonical metadata", async ({
  page,
}) => {
  const state = await prepareDocuments(page, []);
  await page.goto("/?view=organisation");
  await expect(
    page.getByRole("button", { name: "Upload documents", exact: true }),
  ).toBeVisible();
  const input = page.locator("input[type=file]").first();
  await expect(input).toHaveAttribute("accept", /\.docx/);
  await expect(input).toHaveAttribute("accept", /\.xlsx/);
  await input.setInputFiles([
    {
      name: "new-registration.docx",
      mimeType: "",
      buffer: Buffer.from(
        "mock Office content; extraction is separately tested",
      ),
    },
    {
      name: "new-history.xlsx",
      mimeType: "",
      buffer: Buffer.from(
        "mock spreadsheet content; extraction is separately tested",
      ),
    },
  ]);
  await expect(
    page.locator(".document-row").filter({ hasText: "new-registration.docx" }),
  ).toBeVisible();
  await expect(
    page.locator(".document-row").filter({ hasText: "new-history.xlsx" }),
  ).toBeVisible();
  expect(state.uploads.map((upload) => upload.mime)).toEqual([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]);
  expect(state.inserts.map((document) => document.mime_type)).toEqual(
    state.uploads.map((upload) => upload.mime),
  );
});

test("the complete file batch is validated before any upload starts", async ({
  page,
}) => {
  const state = await prepareDocuments(page, []);
  await page.goto("/?view=organisation");
  await expect(
    page.getByRole("button", { name: "Upload documents", exact: true }),
  ).toBeVisible();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles([
      {
        name: "valid.docx",
        mimeType: "",
        buffer: Buffer.from("mock Office content"),
      },
      {
        name: "legacy.xls",
        mimeType: "application/vnd.ms-excel",
        buffer: Buffer.from("mock legacy Office content"),
      },
    ]);
  await expect(page.getByRole("alert")).toContainText(
    "save older or macro-enabled Word and Excel files as DOCX, XLSX or PDF",
  );
  expect(state.uploads).toHaveLength(0);
  expect(state.inserts).toHaveLength(0);
});

test("an interrupted batch refreshes files that were already saved", async ({
  page,
}) => {
  const state = await prepareDocuments(page, []);
  state.failUploadAt = 2;
  await page.goto("/?view=organisation");
  await expect(
    page.getByRole("button", { name: "Upload documents", exact: true }),
  ).toBeVisible();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles([
      {
        name: "saved.docx",
        mimeType: "",
        buffer: Buffer.from("mock first file"),
      },
      {
        name: "failed.xlsx",
        mimeType: "",
        buffer: Buffer.from("mock second file"),
      },
    ]);
  await expect(page.getByRole("alert")).toContainText("1 document was saved");
  await expect(
    page.locator(".document-row").filter({ hasText: "saved.docx" }),
  ).toBeVisible();
  await expect(
    page.locator(".document-row").filter({ hasText: "failed.xlsx" }),
  ).toHaveCount(0);
  expect(state.uploads).toHaveLength(2);
  expect(state.inserts).toHaveLength(1);
});

test("active text files download as attachments while PDF retains its view action", async ({
  page,
}) => {
  const html = {
    ...initialDocuments[0],
    name: "organisation.html",
    mime_type: "text/html",
    storage_path: `${orgId}/organisation.html`,
  };
  const pdf = {
    ...initialDocuments[1],
    name: "registration.pdf",
    mime_type: "application/pdf",
    storage_path: `${orgId}/registration.pdf`,
  };
  const state = await prepareDocuments(page, [html, pdf]);
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.goto("/?view=organisation");
  await page
    .getByRole("button", { name: "Download organisation.html", exact: true })
    .click();
  await expect.poll(() => state.open.length).toBe(1);
  expect(state.open[0].options).toEqual({ download: "organisation.html" });
  await page
    .getByRole("button", { name: "Open registration.pdf", exact: true })
    .click();
  await expect.poll(() => state.open.length).toBe(2);
  expect(state.open[1].options).toBeUndefined();
});

test("profile auto-selection stays within eight files and 15 MB", async ({
  page,
}) => {
  const documents = Array.from({ length: 10 }, (_, index) => ({
    ...initialDocuments[0],
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: `history-${index + 1}.docx`,
    size_bytes: 2 * 1024 * 1024,
  }));
  await prepareDocuments(page, documents);
  await openProfile(page);
  await expect(
    page.getByText("7 of 10 selected", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "history-8.docx", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "history-1.docx", exact: true })
    .uncheck();
  await expect(
    page.getByRole("checkbox", { name: "history-8.docx", exact: true }),
  ).toBeEnabled();
});

test("a late profile stage cannot continue under a different organisation", async ({
  page,
}) => {
  const state = await prepareDocuments(page);
  let release!: () => void;
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ json: stageResult(body) });
  });
  await openProfile(page);
  await page
    .getByRole("button", { name: "Prepare my profile", exact: true })
    .click();
  await expect.poll(() => state.ai.length).toBe(1);
  // Native history navigation models an organisation change while the request is in flight.
  await page.evaluate((id) => {
    window.history.pushState({}, "", `/?view=organisation&org=${id}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, secondOrgId);
  await page
    .locator(".org-switch")
    .evaluate((button) => (button as HTMLButtonElement).click());
  await page
    .getByRole("button", { name: "Other Organisation", exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator(".org-switch")).toContainText("Other Organisation");
  release();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.ai).toHaveLength(1);
  await expect(page.locator("body")).not.toContainText("Corrected Community");
});

for (const status of [200, 502]) {
  test(`a ${status} HTML response cannot be treated as a completed profile stage`, async ({
    page,
  }) => {
    const state = await prepareDocuments(page);
    await page.route("**/api/ai", (route) => {
      state.ai.push(route.request().postDataJSON());
      return route.fulfill({
        status,
        contentType: "text/html",
        body: "<html>private-response-payload</html>",
      });
    });
    await openProfile(page);
    await page
      .getByRole("button", { name: "Prepare my profile", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("SG_AI_RESPONSE");
    await expect(page.getByRole("alert")).toContainText(
      "uploaded documents are still saved",
    );
    await expect(page.getByRole("alert")).not.toContainText(
      "private-response-payload",
    );
    await expect(
      page.getByRole("button", { name: "Approve and save" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Prepare my profile", exact: true }),
    ).toBeEnabled();
    expect(state.ai).toHaveLength(1);
  });
}

for (const invalid of ["fingerprint", "checks"]) {
  test(`an invalid ${invalid} verification response cannot advance to correction or approval`, async ({
    page,
  }) => {
    const state = await prepareDocuments(page);
    await page.route("**/api/ai", (route) => {
      const body = route.request().postDataJSON();
      state.ai.push(body);
      return route.fulfill({
        json:
          body.profileStage === "extract"
            ? stageResult(body)
            : {
                profileDraft,
                profileChecks:
                  invalid === "checks"
                    ? [{ field: { unsafe: true }, issue: "Invalid" }]
                    : profileChecks,
                sourceFingerprint:
                  invalid === "fingerprint" ? "c".repeat(64) : fingerprint,
              },
      });
    });
    await openProfile(page);
    await page
      .getByRole("button", { name: "Prepare my profile", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("SG_AI_RESPONSE");
    await expect(
      page.getByRole("button", { name: "Approve and save" }),
    ).toHaveCount(0);
    expect(state.ai.map((body) => body.profileStage)).toEqual([
      "extract",
      "verify",
    ]);
    expect(state.uploads).toHaveLength(0);
  });
}

test("a safe backend AI support reference is visible without exposing its raw payload", async ({
  page,
}) => {
  await prepareDocuments(page);
  const reference = "bf71a813-cbe2-49ae-8784-43ce49f5f12c";
  await page.route("**/api/ai", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: "private-provider-payload",
        code: "SG_AI_SETUP",
        reference,
      },
    }),
  );
  await openProfile(page);
  await page
    .getByRole("button", { name: "Prepare my profile", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "not fully connected yet",
  );
  await expect(page.getByRole("alert")).toContainText(
    `${reference} (SG_AI_SETUP)`,
  );
  await expect(page.getByRole("alert")).not.toContainText(
    "private-provider-payload",
  );
  await expect(
    page.getByRole("button", { name: "Prepare my profile", exact: true }),
  ).toBeEnabled();
});
