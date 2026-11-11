import { expect, test, type Page } from "@playwright/test";
import type {
  Application,
  DocumentRecord,
  Opportunity,
  Organisation,
} from "../../src/types";

const orgId = "ef20fb82-040f-43b5-98a0-8d7f696c8253";
const user = {
  id: "4b35c69b-c76b-474b-8934-1bb579910338",
  email: "member@example.invalid",
};
const opportunityId = "7f5f772d-06a7-4bc0-aa54-8053a8d40d4d";
const applicationId = "2b6f37cf-d158-4bb2-a5fd-bdb5af8e110f";
const fingerprint = "c".repeat(64);
const sources = [
  { title: "Funder listing", uri: "https://example.invalid/grants/community" },
];
const organisation: Organisation = {
  id: orgId,
  name: "Synthetic Community",
  abn: null,
  type: "",
  state: "VIC",
  description: "Community activities",
  focus_areas: ["Community"],
  profile: { name: "Synthetic Community" },
  notification_frequency: "never",
  verification_status: "approved",
  inbox_alias: "synthetic-inbox",
};
const opportunity: Opportunity = {
  id: opportunityId,
  org_id: orgId,
  title: "Synthetic Community Opportunity",
  funder: "Synthetic Funder",
  amount_min: null,
  amount_max: 5000,
  opens_on: "2027-01-01",
  closes_at: "2027-03-31T06:00:00Z",
  source_url: "",
  guidelines_text:
    "Current guidelines describing community projects and the application process.",
  summary: "A synthetic opportunity used only in local tests.",
  location: "VIC",
  focus_areas: ["Community"],
  match_score: null,
  requirements: [],
  status: "open",
  provenance: { method: "user_import", source_verified: false },
};
const application: Application = {
  id: applicationId,
  org_id: orgId,
  opportunity_id: opportunityId,
  title: "A synthetic community project",
  status: "draft",
  draft: { application_text: "Original manual draft" },
  project_details: {
    summary: "A community lunch for local neighbours.",
    application_questions: "Describe the project in no more than 200 words.",
    budget_notes: "Requested grant: $2,000.",
  },
  requested_amount: 2000,
  created_at: "2026-11-01T00:00:00Z",
};

async function mockGrantWorkspace(
  page: Page,
  changes: {
    grants?: Opportunity[];
    documents?: DocumentRecord[];
    application?: Application;
  } = {},
) {
  const state = {
    grants: structuredClone(changes.grants ?? [opportunity]),
    documents: structuredClone(changes.documents ?? []),
    application: structuredClone(changes.application ?? application),
    ai: [] as Record<string, unknown>[],
    updates: [] as { table: string; patch: Record<string, unknown> }[],
    reads: 0,
    signOuts: [] as unknown[],
  };
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const configured=true;
const user=${JSON.stringify(user)};let callback;let signedIn=true;
window.__changeGrantUser=next=>{signedIn=!!next;callback?.(next?'SIGNED_IN':'SIGNED_OUT',next?{user:next,access_token:'synthetic-access'}:null)};
export const supabase={auth:{getSession:async()=>({data:{session:signedIn?{user,access_token:'synthetic-access'}:null},error:null}),onAuthStateChange:cb=>{callback=cb;return {data:{subscription:{unsubscribe(){if(callback===cb)callback=null}}}}},signOut:async options=>{await fetch('/test-grant-signout',{method:'POST',body:JSON.stringify(options)});window.__changeGrantUser(null);return {error:null}}},from:table=>({select:()=>({order:async()=>(await fetch('/test-grant-organizations')).json(),eq:async(field,id)=>(await fetch('/test-grant-records?table='+table+'&org='+id)).json()}),update:patch=>({eq:(field,id)=>({eq:async()=>(await fetch('/test-grant-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table,id,patch})})).json()})})})};`,
    }),
  );
  await page.route("**/test-grant-organizations", (route) =>
    route.fulfill({ json: { data: [organisation], error: null } }),
  );
  await page.route("**/test-grant-records*", (route) => {
    state.reads++;
    const table = new URL(route.request().url()).searchParams.get("table");
    return route.fulfill({
      json: {
        data:
          table === "opportunities"
            ? state.grants
            : table === "documents"
              ? state.documents
              : table === "applications"
                ? [state.application]
                : [],
        error: null,
      },
    });
  });
  await page.route("**/test-grant-update", (route) => {
    const body = route.request().postDataJSON();
    state.updates.push({ table: body.table, patch: body.patch });
    if (body.table === "applications")
      state.application = { ...state.application, ...body.patch };
    if (body.table === "opportunities")
      state.grants = state.grants.map((grant) =>
        grant.id === body.id ? { ...grant, ...body.patch } : grant,
      );
    return route.fulfill({ json: { error: null } });
  });
  await page.route("**/test-grant-signout", (route) => {
    state.signOuts.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });
  return state;
}

async function openApplication(page: Page) {
  await page.goto(`/?view=applications&org=${orgId}`);
  await page.locator(".application-row").click();
}

test("source badges distinguish uploaded details, added links and grounded citations", async ({
  page,
}) => {
  const linked = {
    ...opportunity,
    id: "013580fc-d5bb-44c5-96af-8942b97e2080",
    title: "Link supplied manually",
    source_url: sources[0].uri,
  };
  const grounded = {
    ...opportunity,
    id: "59f46a3c-af60-465f-a5c9-d4a4261167d3",
    title: "Grounded listing",
    source_url: sources[0].uri,
    provenance: { method: "google_search_grounding", sources },
  };
  await mockGrantWorkspace(page, { grants: [opportunity, linked, grounded] });
  await page.goto(`/?view=opportunities&org=${orgId}`);
  await expect(
    page.locator(".grant-card").filter({ hasText: opportunity.title }),
  ).toContainText("Uploaded details · source unverified");
  await expect(
    page.locator(".grant-card").filter({ hasText: linked.title }),
  ).toContainText("Source link added · check details");
  await expect(
    page.locator(".grant-card").filter({ hasText: grounded.title }),
  ).toContainText("Web source found · check eligibility");
  await expect(page.locator("body")).not.toContainText(
    "Source found · review fit",
  );
  await page.getByRole("button", { name: "Add a grant", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Grant guidelines");
  await expect(page.getByRole("dialog")).not.toContainText(
    "upload it as Program guidelines",
  );
});

test("explicit insurance ineligibility blocks the AI button even with an empty imported requirements list", async ({
  page,
}) => {
  const state = await mockGrantWorkspace(page, {
    grants: [
      {
        ...opportunity,
        guidelines_text:
          "Applications without current insurance are ineligible.",
        requirements: [],
      },
    ],
  });
  await page.route("**/api/ai", (route) => {
    state.ai.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });
  await openApplication(page);
  await expect(
    page.getByRole("button", { name: "Prepare draft with AI", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("dialog")).toContainText(
    "Upload a current insurance document",
  );
  await page
    .getByRole("textbox", { name: "Current program guidelines", exact: true })
    .fill("Insurance is optional and is not required for this opportunity.");
  await expect(
    page.getByRole("button", { name: "Prepare draft with AI", exact: true }),
  ).toBeEnabled();
  expect(state.ai).toEqual([]);
});

for (const referenceMode of ["reference", "no-reference"] as const) {
  test(`manual external applications need submission confirmation and ${referenceMode}`, async ({
    page,
  }) => {
    const state = await mockGrantWorkspace(page, {
      application: { ...application, draft: {} },
    });
    await openApplication(page);
    await page
      .getByRole("combobox", { name: "Application status", exact: true })
      .selectOption("submitted");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Confirm that you completed",
    );
    expect(state.updates).toHaveLength(0);
    await page
      .getByRole("checkbox", {
        name: "I submitted this application to the funder.",
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("submission reference");
    expect(state.updates).toHaveLength(0);
    if (referenceMode === "reference")
      await page
        .getByRole("textbox", {
          name: "Funder’s submission reference",
          exact: true,
        })
        .fill("SYNTHETIC-REF-123");
    else
      await page
        .getByRole("checkbox", {
          name: "The funder did not provide a submission reference.",
          exact: true,
        })
        .check();
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect.poll(() => state.application.status).toBe("submitted");
    expect(state.application.draft).toEqual({});
    expect(
      state.application.project_details.submission_confirmation,
    ).toMatchObject({
      confirmed: true,
      reference_unavailable: referenceMode === "no-reference",
    });
  });
}

test("discovery uses two immutable requests and loads records only after extraction completes", async ({
  page,
}) => {
  const state = await mockGrantWorkspace(page);
  const searchDraft = {
    summary: "Current funder listings with cited sources.",
    sources,
  };
  const issuedAt = Date.now();
  let releaseFinal!: () => void;
  const finalHeld = new Promise<void>((resolve) => {
    releaseFinal = resolve;
  });
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    expect(route.request().headers().authorization).toBe(
      "Bearer synthetic-access",
    );
    if (body.discoveryStage === "search")
      return route.fulfill({
        json: {
          searchDraft,
          sourceFingerprint: fingerprint,
          stageIssuedAt: issuedAt,
        },
      });
    await finalHeld;
    return route.fulfill({
      json: { opportunities: [], sources, message: "No current grants found." },
    });
  });
  await page.goto(`/?view=opportunities&org=${orgId}`);
  await expect(page.locator(".grant-card")).toHaveCount(1);
  const baselineReads = state.reads;
  await page
    .getByRole("button", { name: "Find grants with AI", exact: true })
    .click();
  await expect.poll(() => state.ai.length).toBe(2);
  expect(state.reads).toBe(baselineReads);
  expect(state.ai.map((body) => body.discoveryStage)).toEqual([
    "search",
    "extract",
  ]);
  for (const body of state.ai)
    expect(body).toMatchObject({
      action: "discover",
      orgId,
      text: "",
      documentIds: [],
    });
  expect(state.ai[1]).toMatchObject({
    searchDraft,
    sourceFingerprint: fingerprint,
    stageIssuedAt: issuedAt,
  });
  releaseFinal();
  await expect.poll(() => state.reads).toBe(baselineReads + 6);
  await expect(
    page.getByRole("button", { name: "Find grants with AI", exact: true }),
  ).toBeEnabled();
});

test("failed draft generation preserves the manual draft and inputs, then retry restarts preflight", async ({
  page,
}) => {
  const state = await mockGrantWorkspace(page);
  const requirements = { documents: [], information: [] };
  const issuedAt = Date.now();
  let failGenerate = true;
  let releaseGenerate!: () => void;
  let holdGenerate = new Promise<void>((resolve) => {
    releaseGenerate = resolve;
  });
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    if (body.draftStage === "preflight")
      return route.fulfill({
        json: {
          draftRequirements: requirements,
          sourceFingerprint: fingerprint,
          stageIssuedAt: issuedAt,
        },
      });
    await holdGenerate;
    if (failGenerate)
      return route.fulfill({
        status: 503,
        json: {
          error: "Unavailable",
          code: "SG_AI_UNAVAILABLE",
          reference: "0ab600ee-ec49-41e1-9706-f691e55bcd2b",
        },
      });
    state.application.draft = {
      application_text: "Final generated draft for review.",
    };
    return route.fulfill({ json: { draft: state.application.draft } });
  });
  await openApplication(page);
  const baselineReads = state.reads;
  await page
    .getByRole("textbox", { name: "Tell us about your project", exact: true })
    .fill("User-entered project information to preserve.");
  await page
    .getByRole("button", { name: "Prepare draft with AI", exact: true })
    .click();
  await expect.poll(() => state.ai.length).toBe(2);
  expect(state.reads).toBe(baselineReads);
  await expect(
    page.getByRole("textbox", { name: "Your application draft", exact: true }),
  ).toHaveValue(/Original manual draft/);
  releaseGenerate();
  await expect(page.getByRole("alert")).toContainText("SG_AI_UNAVAILABLE");
  await expect(
    page.getByRole("textbox", {
      name: "Tell us about your project",
      exact: true,
    }),
  ).toHaveValue("User-entered project information to preserve.");
  expect(state.reads).toBe(baselineReads);
  failGenerate = false;
  holdGenerate = Promise.resolve();
  await page
    .getByRole("button", { name: "Prepare draft with AI", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Your application draft", exact: true }),
  ).toHaveValue(/Final generated draft for review\./);
  expect(state.ai.map((body) => body.draftStage)).toEqual([
    "preflight",
    "generate",
    "preflight",
    "generate",
  ]);
  for (const body of state.ai)
    expect(body).toMatchObject({
      action: "draft",
      orgId,
      opportunityId,
      applicationId,
      text: "",
      documentIds: [],
    });
  expect(state.ai[1]).toMatchObject({
    draftRequirements: requirements,
    sourceFingerprint: fingerprint,
    stageIssuedAt: issuedAt,
  });
  await expect.poll(() => state.reads).toBe(baselineReads + 6);
});

test("grant selection is in the URL, follows browser history and survives a sign-in request", async ({
  page,
}) => {
  const state = await mockGrantWorkspace(page);
  let authRequest: Record<string, unknown> | undefined;
  await page.route("**/api/auth-email", (route) => {
    authRequest = route.request().postDataJSON();
    return route.fulfill({
      status: 202,
      json: { message: "If this address can sign in, an email will arrive." },
    });
  });
  await page.goto(`/?view=opportunities&org=${orgId}`);
  await page
    .getByRole("button", { name: "Explore this grant", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`grant=${opportunityId}`));
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  expect(new URL(page.url()).searchParams.has("grant")).toBe(false);
  await page
    .getByRole("button", { name: "Explore this grant", exact: true })
    .click();
  // End the local session while the modal is open, as a session-expiry or sign-out event would.
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .evaluate((element: HTMLButtonElement) => element.click());
  await expect(
    page.getByRole("heading", {
      name: "Let’s get you settled in.",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.signOuts).toEqual([{ scope: "local" }]);
  await page
    .getByRole("textbox", { name: "Your email address", exact: true })
    .fill(user.email);
  await page
    .getByRole("button", { name: "Email me a sign-in link", exact: true })
    .click();
  await expect
    .poll(() => authRequest?.next)
    .toBe(`/?view=opportunities&org=${orgId}&grant=${opportunityId}`);
  expect(page.url()).not.toContain("synthetic-access");
});

test("an invalid discovery receipt is rejected without extracting or refreshing partial results", async ({
  page,
}) => {
  const state = await mockGrantWorkspace(page);
  await page.route("**/api/ai", (route) => {
    state.ai.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        searchDraft: { summary: "A search result", sources },
        sourceFingerprint: fingerprint,
      },
    });
  });
  await page.goto(`/?view=opportunities&org=${orgId}`);
  await expect(page.locator(".grant-card")).toHaveCount(1);
  const baselineReads = state.reads;
  await page
    .getByRole("button", { name: "Find grants with AI", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("SG_AI_RESPONSE");
  expect(state.ai).toHaveLength(1);
  expect(state.reads).toBe(baselineReads);
});

test("a changed signed-in user stops discovery before the next stage", async ({
  page,
}) => {
  const state = await mockGrantWorkspace(page);
  let releaseSearch!: () => void;
  const hold = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  await page.route("**/api/ai", async (route) => {
    state.ai.push(route.request().postDataJSON());
    await hold;
    return route.fulfill({
      json: {
        searchDraft: { summary: "A search result", sources },
        sourceFingerprint: fingerprint,
        stageIssuedAt: Date.now(),
      },
    });
  });
  await page.goto(`/?view=opportunities&org=${orgId}`);
  await expect(page.locator(".grant-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Find grants with AI", exact: true })
    .click();
  await expect.poll(() => state.ai.length).toBe(1);
  await page.evaluate(() =>
    (
      window as unknown as {
        __changeGrantUser: (next: { id: string; email: string }) => void;
      }
    ).__changeGrantUser({
      id: "20f30e02-0b12-40f0-8c71-de2083f5127c",
      email: "other@example.invalid",
    }),
  );
  releaseSearch();
  await expect(
    page.getByRole("button", { name: "Find grants with AI", exact: true }),
  ).toBeEnabled();
  expect(state.ai).toHaveLength(1);
});
