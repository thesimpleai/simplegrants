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
    signedIn?: boolean;
  } = {},
) {
  const state = {
    grants: structuredClone(changes.grants ?? [opportunity]),
    documents: structuredClone(changes.documents ?? []),
    application: structuredClone(changes.application ?? application),
    ai: [] as Record<string, unknown>[],
    updates: [] as {
      table: string;
      patch: Record<string, unknown>;
      orgId: string;
    }[],
    reads: 0,
    signOuts: [] as unknown[],
    rejectDocumentExpiry: false,
  };
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const configured=true;
const user=${JSON.stringify(user)};let callback;let signedIn=${changes.signedIn ?? true} || sessionStorage.getItem('test-grant-signed-in')==='true';
window.__changeGrantUser=next=>{signedIn=!!next;callback?.(next?'SIGNED_IN':'SIGNED_OUT',next?{user:next,access_token:'synthetic-access'}:null)};
export const supabase={auth:{getSession:async()=>({data:{session:signedIn?{user,access_token:'synthetic-access'}:null},error:null}),verifyOtp:async input=>{const result=await(await fetch('/test-grant-verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).json();if(result.data.session)sessionStorage.setItem('test-grant-signed-in','true');return result;},onAuthStateChange:cb=>{callback=cb;return {data:{subscription:{unsubscribe(){if(callback===cb)callback=null}}}}},signOut:async options=>{await fetch('/test-grant-signout',{method:'POST',body:JSON.stringify(options)});window.__changeGrantUser(null);return {error:null}}},from:table=>({select:()=>({order:async()=>(await fetch('/test-grant-organizations')).json(),eq:async(field,id)=>(await fetch('/test-grant-records?table='+table+'&org='+id)).json()}),update:patch=>({eq:(field,id)=>({eq:(scope,orgId)=>{const send=async()=>(await fetch('/test-grant-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table,id,orgId,patch})})).json();return {then:(resolve,reject)=>send().then(resolve,reject),select:()=>({maybeSingle:send})};}})})})};`,
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
    if (body.table === "documents" && state.rejectDocumentExpiry)
      return route.fulfill({ json: { data: null, error: null } });
    state.updates.push({
      table: body.table,
      patch: body.patch,
      orgId: body.orgId,
    });
    if (body.table === "applications")
      state.application = { ...state.application, ...body.patch };
    if (body.table === "opportunities")
      state.grants = state.grants.map((grant) =>
        grant.id === body.id ? { ...grant, ...body.patch } : grant,
      );
    if (body.table === "documents")
      state.documents = state.documents.map((doc) =>
        doc.id === body.id ? { ...doc, ...body.patch } : doc,
      );
    return route.fulfill({
      json: { data: { id: body.id, ...body.patch }, error: null },
    });
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
  await page.getByRole("button", { name: "Project", exact: true }).click();
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
});

test("search timeout offers a relevant retry or guidelines alternative", async ({
  page,
}) => {
  await mockGrantWorkspace(page);
  await page.route("**/api/ai", (route) =>
    route.fulfill({
      status: 504,
      json: {
        code: "SG_AI_TIMEOUT",
        reference: opportunityId,
        error: "Synthetic timeout",
      },
    }),
  );
  await page.goto(`/?view=opportunities&org=${orgId}`);
  await expect(page.locator(".grant-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Find grants with AI", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "grant search took too long",
  );
  await expect(page.getByRole("alert")).toContainText("official guidelines");
  await expect(page.getByRole("alert")).not.toContainText("fewer documents");
  await expect(page.locator(".grant-card")).toHaveCount(1);
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
    .getByText("Funder guidelines and questions", { exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Current program guidelines", exact: true })
    .fill("Insurance is optional and is not required for this opportunity.");
  await expect(
    page.getByRole("button", { name: "Prepare draft with AI", exact: true }),
  ).toBeEnabled();
  expect(state.ai).toEqual([]);
});

test("insurance with unknown or expired dates stays blocked until a current expiry is saved", async ({
  page,
}) => {
  const state = await mockGrantWorkspace(page, {
    grants: [
      {
        ...opportunity,
        guidelines_text:
          "Applicants must hold current public liability insurance.",
      },
    ],
    documents: [
      {
        id: "e919d8f1-65c5-4ae2-a4be-29873c0e5782",
        org_id: orgId,
        name: "Insurance.pdf",
        category: "insurance",
        mime_type: "application/pdf",
        storage_path: `${orgId}/insurance.pdf`,
        size_bytes: 200,
        verified: false,
        created_at: "2026-11-01T00:00:00Z",
        expires_on: null,
      },
    ],
  });
  await openApplication(page);
  await expect(
    page.getByRole("button", { name: "Prepare draft with AI", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("dialog")).toContainText(
    "Record a current expiry date",
  );
  for (const expiry of ["2000-01-01", "2099-11-13"]) {
    await page.goto(`/?view=organisation&org=${orgId}`);
    await page
      .getByRole("button", {
        name: "Edit expiry for Insurance.pdf",
        exact: true,
      })
      .click();
    await page.getByLabel("Expiry date", { exact: true }).fill(expiry);
    await page
      .getByRole("button", { name: "Save expiry", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(state.documents[0].expires_on).toBe(expiry);
    const row = page
      .locator(".document-row")
      .filter({ hasText: "Insurance.pdf" });
    if (expiry.startsWith("2000")) await expect(row).toContainText("Expired");
    else await expect(row).not.toContainText("Expired");
    await openApplication(page);
    const prepare = page.getByRole("button", {
      name: "Prepare draft with AI",
      exact: true,
    });
    if (expiry.startsWith("2000")) await expect(prepare).toBeDisabled();
    else await expect(prepare).toBeEnabled();
  }
  expect(state.ai).toEqual([]);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.goto(
    `/?view=opportunities&org=${orgId}&opportunity=${opportunityId}`,
  );
  await expect(page.getByRole("dialog")).toContainText(opportunity.title);
});

test("a refused expiry update keeps the editor open and mandatory insurance blocked", async ({
  page,
}) => {
  const state = await mockGrantWorkspace(page, {
    grants: [
      {
        ...opportunity,
        guidelines_text:
          "Applicants must hold current public liability insurance.",
      },
    ],
    documents: [
      {
        id: "e919d8f1-65c5-4ae2-a4be-29873c0e5782",
        org_id: orgId,
        name: "Insurance.pdf",
        category: "insurance",
        mime_type: "application/pdf",
        storage_path: `${orgId}/insurance.pdf`,
        size_bytes: 200,
        verified: false,
        created_at: "2026-11-01T00:00:00Z",
        expires_on: null,
      },
    ],
  });
  state.rejectDocumentExpiry = true;
  await page.goto(`/?view=organisation&org=${orgId}`);
  await page
    .getByRole("button", { name: "Edit expiry for Insurance.pdf", exact: true })
    .click();
  await page.getByLabel("Expiry date", { exact: true }).fill("2099-11-13");
  await page.getByRole("button", { name: "Save expiry", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "could not be saved",
  );
  expect(state.documents[0].expires_on).toBeNull();
  await openApplication(page);
  await expect(
    page.getByRole("button", { name: "Prepare draft with AI", exact: true }),
  ).toBeDisabled();
});

for (const referenceMode of ["reference", "no-reference"] as const) {
  test(`manual external applications need submission confirmation and ${referenceMode}`, async ({
    page,
  }) => {
    const state = await mockGrantWorkspace(page, {
      application: { ...application, draft: {} },
    });
    await openApplication(page);
    await page.getByRole("button", { name: "Submission", exact: true }).click();
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

test("discovery checks the shortlist before extracting and refreshing saved results", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-23T01:30:00Z"));
  const state = await mockGrantWorkspace(page);
  const title = "New opportunity from the verified shortlist";
  const searchDraft = {
    phase: "search",
    summary: "Leads from the local, sector and foundation searches.",
    sources: [
      {
        title: "Preliminary funding listing",
        uri: "https://directory.example.invalid/community",
      },
    ],
    completed_lanes: 3,
    failed_lanes: 0,
  };
  const issuedAt = Date.now();
  const verifiedDraft = {
    ...searchDraft,
    phase: "verified",
    summary: "The current round is listed in the funder's own guidelines.",
    sources,
  };
  const verifiedReceipt = {
    searchDraft: verifiedDraft,
    sourceFingerprint: "d".repeat(64),
    stageIssuedAt: issuedAt + 1,
  };
  let releaseVerification!: () => void;
  const verificationHeld = new Promise<void>((resolve) => {
    releaseVerification = resolve;
  });
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
    if (body.discoveryStage === "verify") {
      await verificationHeld;
      return route.fulfill({ json: verifiedReceipt });
    }
    expect(body.discoveryStage).toBe("extract");
    await finalHeld;
    state.grants.push({
      ...opportunity,
      id: "95a2a900-d546-4c83-8f56-4e78b3b0367b",
      title,
      source_url: sources[0].uri,
      closes_at: null,
      provenance: {
        method: "google_search_grounding",
        sources,
        round_status: "upcoming",
        closing_date: "2027-03-31",
        deadline_note: "The funder lists the date without a closing time.",
      },
    });
    return route.fulfill({
      json: { opportunities: state.grants.slice(1), sources },
    });
  });
  await page.goto(`/?view=opportunities&org=${orgId}`);
  await expect(page.locator(".grant-card")).toHaveCount(1);
  const baselineReads = state.reads;
  await page
    .getByRole("button", { name: "Find grants with AI", exact: true })
    .click();
  await expect.poll(() => state.ai.length).toBe(2);
  expect(state.ai[1]).toMatchObject({
    discoveryStage: "verify",
    searchDraft,
    sourceFingerprint: fingerprint,
    stageIssuedAt: issuedAt,
  });
  expect(state.reads).toBe(baselineReads);
  await expect(page.locator(".grant-card")).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText(
    "Checking funder listings",
  );
  releaseVerification();
  await expect.poll(() => state.ai.length).toBe(3);
  expect(state.reads).toBe(baselineReads);
  await expect(page.getByRole("status")).toContainText("Saving opportunities");
  expect(state.ai.map((body) => body.discoveryStage)).toEqual([
    "search",
    "verify",
    "extract",
  ]);
  for (const body of state.ai)
    expect(body).toMatchObject({
      action: "discover",
      orgId,
      text: "",
      documentIds: [],
    });
  expect(state.ai[2]).toMatchObject(verifiedReceipt);
  releaseFinal();
  await expect.poll(() => state.reads).toBe(baselineReads + 6);
  const card = page.getByRole("article").filter({ hasText: title });
  await expect(card).toContainText("Upcoming");
  await expect(card).toContainText("Opens 1 Jan 2027");
  await expect(
    page.getByRole("button", { name: "Find grants with AI", exact: true }),
  ).toBeEnabled();
  await card.getByRole("button", { name: title, exact: true }).click();
  const details = page.getByRole("dialog");
  await expect(details).toContainText("31 Mar 2027 (time to confirm)");
  await expect(details).toContainText(
    "The funder lists the date without a closing time.",
  );
});

test("discovery reports an empty checked shortlist without presenting the preliminary result", async ({
  page,
}) => {
  const state = await mockGrantWorkspace(page);
  const noResults = "No live rounds could be confirmed from funder listings.";
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    if (body.discoveryStage === "extract")
      return route.fulfill({
        json: { opportunities: [], sources: [], message: noResults },
      });
    const verified = body.discoveryStage === "verify";
    return route.fulfill({
      json: {
        searchDraft: {
          phase: verified ? "verified" : "search",
          summary: verified ? "NO_SOURCE_BACKED_ROUNDS" : "A preliminary lead",
          sources: verified ? [] : sources,
          completed_lanes: 3,
          failed_lanes: 0,
        },
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
  await expect(page.getByText(noResults)).toBeVisible();
  await expect(page.locator(".grant-card")).toHaveCount(1);
  expect(state.ai.at(-1)?.searchDraft).toMatchObject({
    phase: "verified",
    sources: [],
  });
});

test("retrying a discovery extraction failure reuses the verified shortlist", async ({
  page,
}) => {
  const state = await mockGrantWorkspace(page);
  const issuedAt = Date.now();
  const verified = {
    searchDraft: {
      phase: "verified",
      summary: "The funder's own page confirms the round is open.",
      sources,
      completed_lanes: 3,
      failed_lanes: 0,
    },
    sourceFingerprint: "d".repeat(64),
    stageIssuedAt: issuedAt + 1,
  };
  const completionNotice = "The checked opportunities are ready for review.";
  const title = "Opportunity saved on retry";
  let extractionAttempts = 0;
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    if (body.discoveryStage === "search")
      return route.fulfill({
        json: {
          searchDraft: {
            ...verified.searchDraft,
            phase: "search",
            summary: "A preliminary list of leads.",
          },
          sourceFingerprint: fingerprint,
          stageIssuedAt: issuedAt,
        },
      });
    if (body.discoveryStage === "verify")
      return route.fulfill({ json: verified });
    expect(body.discoveryStage).toBe("extract");
    if (++extractionAttempts === 1)
      return route.fulfill({
        status: 502,
        json: {
          error: "The model stopped at the response length limit.",
          code: "SG_AI_OUTPUT_LIMIT",
          reference: opportunityId,
        },
      });
    const next = {
      ...opportunity,
      id: "af83c85f-43b1-490f-b22d-223b38e05bec",
      title,
    };
    state.grants.push(next);
    return route.fulfill({
      json: { opportunities: [next], sources, message: completionNotice },
    });
  });
  await page.goto(`/?view=opportunities&org=${orgId}`);
  await expect(page.locator(".grant-card")).toHaveCount(1);
  const find = page.getByRole("button", {
    name: "Find grants with AI",
    exact: true,
  });
  await find.click();
  await expect(page.getByRole("alert")).toContainText("SG_AI_OUTPUT_LIMIT");
  await expect(page.locator(".grant-card")).toHaveCount(1);
  await find.click();
  await expect(page.getByText(completionNotice)).toBeVisible();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  expect(state.ai.map(({ discoveryStage }) => discoveryStage)).toEqual([
    "search",
    "verify",
    "extract",
    "extract",
  ]);
  expect(state.ai[2]).toMatchObject(verified);
  expect(state.ai[3]).toEqual(state.ai[2]);
});

test("a known Western Australian deadline stays open across Melbourne midnight", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-23T13:05:00Z"));
  await mockGrantWorkspace(page, {
    grants: [
      {
        ...opportunity,
        location: "Western Australia",
        opens_on: null,
        closes_at: "2026-11-23T23:00:00+08:00",
        provenance: { round_status: "open", closing_date: "2026-11-23" },
      },
    ],
  });
  await page.goto(`/?view=opportunities&org=${orgId}`);
  const card = page.getByRole("article").filter({ hasText: opportunity.title });
  await expect(card.getByText("Open", { exact: true })).toBeVisible();
});

test("selected budget evidence is saved and sent unchanged through both draft stages", async ({
  page,
}) => {
  const id = "6624fb62-1f03-4873-8ae0-b46b8a0a5dd2";
  const state = await mockGrantWorkspace(page, {
    documents: [
      {
        id,
        org_id: orgId,
        name: "Budget.xlsx",
        category: "financial_statement",
        storage_path: `${orgId}/Budget.xlsx`,
        mime_type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size_bytes: 500,
        verified: false,
        created_at: "2026-11-01T00:00:00Z",
      },
    ],
  });
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    if (body.draftStage === "preflight")
      return route.fulfill({
        json: {
          draftRequirements: { documents: [], information: [] },
          sourceFingerprint: fingerprint,
          stageIssuedAt: Date.now(),
        },
      });
    state.application.draft = {
      application_text:
        "Budget B2 is an unverified saved value; unavailable formula cells need review.",
      evidence_sources: [{ id, name: "Budget.xlsx" }],
    };
    return route.fulfill({ json: { draft: state.application.draft } });
  });
  await openApplication(page);
  await expect(
    page.getByText("No files selected for this draft", { exact: true }),
  ).toBeInViewport();
  await page.getByText("Review uploads", { exact: true }).click();
  const check = page.getByRole("checkbox", {
    name: "Use Budget.xlsx for this draft",
    exact: true,
  });
  await expect(check).not.toBeChecked();
  await check.check();
  await page
    .getByRole("button", { name: "Prepare draft with AI", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Your application draft", exact: true }),
  ).toHaveValue(/Budget B2/);
  expect(state.ai).toHaveLength(2);
  expect(state.ai.map((body) => body.documentIds)).toEqual([[id], [id]]);
  await expect(
    page.getByRole("listitem").filter({ hasText: "Budget.xlsx" }),
  ).toBeVisible();
  expect(state.application.project_details.source_document_ids).toEqual([id]);
  await openApplication(page);
  await page.getByText("Supporting documents", { exact: true }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "Use Budget.xlsx for this draft",
      exact: true,
    }),
  ).toBeChecked();
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
  await page
    .getByRole("button", { name: "Draft & review", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Your application draft", exact: true }),
  ).toHaveValue(/Original manual draft/);
  releaseGenerate();
  await expect(page.getByRole("alert")).toContainText("SG_AI_UNAVAILABLE");
  await page.getByRole("button", { name: "Project", exact: true }).click();
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

for (const key of ["grant", "opportunity"])
  test(`a full email confirmation preserves a ${key} destination in the second organisation`, async ({
    page,
  }) => {
    await mockGrantWorkspace(page, { signedIn: false });
    const otherOrganisation = {
      ...organisation,
      id: "c63be093-5414-4c8f-bf57-b73b634ee395",
      name: "Other Community",
    };
    await page.route("**/test-grant-organizations", (route) =>
      route.fulfill({
        json: { data: [otherOrganisation, organisation], error: null },
      }),
    );
    let next = "";
    await page.route("**/api/auth-email", (route) => {
      next = route.request().postDataJSON().next;
      return route.fulfill({ status: 202, json: { accepted: true } });
    });
    const verifications: unknown[] = [];
    await page.route("**/test-grant-verify", (route) => {
      verifications.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          data: { session: { user, access_token: "synthetic-access" } },
          error: null,
        },
      });
    });
    const destination = `/?view=opportunities&org=${orgId}&grant=${opportunityId}`;
    await page.goto(destination.replace("&grant=", `&${key}=`));
    await page
      .getByRole("textbox", { name: "Your email address", exact: true })
      .fill(user.email);
    await page
      .getByRole("button", { name: "Email me a sign-in link", exact: true })
      .click();
    await expect.poll(() => next).toBe(destination);
    const hash = "synthetic-email-confirmation-hash-123456789";
    await page.goto(
      `/auth/confirm#${new URLSearchParams({ token_hash: hash, next })}`,
    );
    await expect(page).toHaveURL(/\/auth\/confirm$/);
    expect(verifications).toEqual([]);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`grant=${opportunityId}$`));
    await expect(page.locator(".org-switch")).toContainText(organisation.name);
    await expect(page.getByRole("dialog")).toContainText(opportunity.title);
    expect(verifications).toEqual([{ token_hash: hash, type: "email" }]);
    await page.reload();
    await expect(page.getByRole("dialog")).toContainText(opportunity.title);
  });

for (const invalidStage of ["search", "verify"]) {
  test(`discovery rejects an invalid ${invalidStage} receipt without extracting or refreshing`, async ({
    page,
  }) => {
    const state = await mockGrantWorkspace(page);
    await page.route("**/api/ai", (route) => {
      const body = route.request().postDataJSON();
      state.ai.push(body);
      return route.fulfill({
        json: {
          searchDraft: {
            phase: body.discoveryStage === "search" ? "search" : "verified",
            summary: "A grounded listing.",
            sources,
            completed_lanes: 3,
            failed_lanes: 0,
          },
          sourceFingerprint: fingerprint,
          ...(body.discoveryStage !== invalidStage
            ? { stageIssuedAt: Date.now() }
            : {}),
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
    expect(state.ai.map(({ discoveryStage }) => discoveryStage)).toEqual(
      invalidStage === "search" ? ["search"] : ["search", "verify"],
    );
    expect(state.reads).toBe(baselineReads);
  });
}

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
        searchDraft: {
          phase: "search",
          summary: "A grounded listing.",
          sources,
          completed_lanes: 3,
          failed_lanes: 0,
        },
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
  await expect(page.locator(".grant-card")).toHaveCount(1);
  await expect(
    page
      .locator(".page-heading")
      .getByRole("button", { name: "Find grants with AI", exact: true }),
  ).toBeEnabled();
  expect(state.ai).toHaveLength(1);
});

test("background draft stages poll without repeating model requests", async ({
  page,
}) => {
  const state = await mockGrantWorkspace(page);
  const jobs = new Map<
    string,
    { body: Record<string, unknown>; polls: number }
  >();
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    expect(route.request().headers()["x-simple-grants-async"]).toBe("1");
    const jobId =
      body.draftStage === "preflight"
        ? "7b766b0e-4e32-4e3e-b0a5-75b1ee07b59e"
        : "7b766b0e-4e32-4e3e-b0a5-75b1ee07b59f";
    jobs.set(jobId, { body, polls: 0 });
    return route.fulfill({ status: 202, json: { orgId, jobId } });
  });
  await page.route("**/api/ai-jobs?*", (route) => {
    const jobId = new URL(route.request().url()).searchParams.get("jobId")!;
    const job = jobs.get(jobId)!;
    if (++job.polls === 1)
      return route.fulfill({
        status: 202,
        json: { orgId, jobId, pending: true },
      });
    if (job.body.draftStage === "preflight")
      return route.fulfill({
        json: {
          draftRequirements: { documents: [], information: [] },
          sourceFingerprint: fingerprint,
          stageIssuedAt: Date.now(),
        },
      });
    state.application.draft = {
      application_text: "Finished background draft for authorised review.",
    };
    return route.fulfill({ json: { draft: state.application.draft } });
  });
  await openApplication(page);
  await page
    .getByRole("button", { name: "Prepare draft with AI", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Your application draft", exact: true }),
  ).toHaveValue(/Finished background draft for authorised review\./, {
    timeout: 15000,
  });
  expect(state.ai.map((body) => body.draftStage)).toEqual([
    "preflight",
    "generate",
  ]);
  expect([...jobs.values()].map((job) => job.polls)).toEqual([2, 2]);
});

test("opening opportunities repairs an older source link without an AI request", async ({
  page,
}) => {
  const old =
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/legacy";
  const real = "https://www.opengardensvictoria.org.au/grants";
  const state = await mockGrantWorkspace(page, {
    grants: [
      {
        ...opportunity,
        source_url: old,
        provenance: {
          method: "google_search_grounding",
          sources: [{ uri: old }],
        },
      },
    ],
  });
  let repairs = 0;
  await page.route("**/api/repair-sources", (route) => {
    repairs++;
    expect(route.request().postDataJSON()).toEqual({ orgId });
    state.grants[0].source_url = real;
    state.grants[0].provenance.sources = [{ uri: real, grounding_uri: old }];
    return route.fulfill({
      json: { repaired: 1, unresolved: 0, hasMore: false },
    });
  });
  await page.goto(`/?view=opportunities&org=${orgId}`);
  await expect(
    page.getByText("1 saved source link refreshed.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".grant-card").first()).toContainText(
    "Web source found · check eligibility",
  );
  expect(repairs).toBe(1);
  expect(state.ai).toHaveLength(0);
});

test("mobile application review shows actionable gaps, keeps structured drafts and checks edited text with missing evidence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await mockGrantWorkspace(page, {
    application: { ...application, draft: {} },
  });
  const readiness = {
    score: 62,
    scoreLimit: 69,
    checks: [
      {
        key: "answers",
        label: "Question coverage",
        points: 15,
        maxPoints: 30,
        note: "The venue is missing.",
      },
      {
        key: "evidence",
        label: "Supporting evidence",
        points: 12,
        maxPoints: 25,
        note: "The brief supports the activity.",
      },
      {
        key: "criteria",
        label: "Funder criteria",
        points: 10,
        maxPoints: 20,
        note: "Local benefit needs detail.",
      },
      {
        key: "delivery",
        label: "Delivery and outcomes",
        points: 15,
        maxPoints: 15,
        note: "A delivery plan is available.",
      },
      {
        key: "budget",
        label: "Budget and resources",
        points: 10,
        maxPoints: 10,
        note: "The budget reconciles.",
      },
    ],
    suggestions: [
      {
        action: "Describe expected attendance.",
        why: "It helps establish the benefit.",
        priority: "recommended",
      },
      {
        action: "Name the project venue.",
        why: "The funder requires a local venue.",
        priority: "required",
      },
    ],
  };
  const generated = {
    sections: [
      {
        question: "Where will the lunch run?",
        answer: "The group will run a community lunch.",
        evidence: ["Approved lunch plan"],
        word_limit: 80,
      },
      ...["Who will attend?", "What will it cost?", "Who will deliver it?"].map(
        (question) => ({ question, answer: "", evidence: [], word_limit: 50 }),
      ),
    ],
    readiness,
    missing_information: ["Which venue will host the lunch?"],
  };
  const edited =
    "  We will hold the lunch in the community hall.\nThe venue is booked.  ";
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    expect(body.allowIncompleteDraft).toBe(true);
    if (body.draftStage === "preflight")
      return route.fulfill({
        json: {
          draftRequirements: { documents: [], information: [] },
          sourceFingerprint: fingerprint,
          stageIssuedAt: Date.now(),
        },
      });
    if (body.reviewExistingDraft) {
      expect(state.application.draft.application_text).toBe(edited);
      state.application.draft = {
        ...generated,
        sections: [
          {
            ...generated.sections[0],
            answer: edited.trim(),
            suggestion: {
              answer: "The lunch will be held at the booked community hall.",
              evidence: ["Hall booking record"],
            },
          },
          ...generated.sections.slice(1),
        ],
        application_text: edited,
        readiness: { ...readiness, score: 69 },
      };
    } else state.application.draft = structuredClone(generated);
    return route.fulfill({ json: { draft: state.application.draft } });
  });
  await openApplication(page);
  await expect(
    page.getByRole("textbox", { name: "Your application draft" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Prepare draft with AI", exact: true })
    .click();
  const assessment = page.getByRole("region", {
    name: "Draft readiness",
    exact: true,
  });
  await expect(assessment.getByLabel("62 out of 100")).toBeVisible();
  const first = page.getByRole("article", {
    name: "Where will the lunch run?",
  });
  await expect(
    first.getByText("The group will run a community lunch."),
  ).toBeInViewport();
  await expect(first.getByText("Approved lunch plan")).toBeVisible();
  await expect(assessment.getByText("Name the project venue.")).toBeHidden();
  await assessment
    .getByText("Readiness and suggestions", { exact: false })
    .first()
    .click();
  await expect(assessment.getByText("Name the project venue.")).toBeVisible();
  await expect(
    assessment.getByText("Describe expected attendance."),
  ).toBeVisible();
  await assessment.getByText("How the score is calculated").click();
  await expect(assessment).toContainText("capped at 69");
  await page.getByLabel("Choose a question").selectOption("3");
  const last = page.getByRole("article", { name: "Who will deliver it?" });
  await expect(last.getByText("Needs an answer")).toBeVisible();
  await expect(
    last.getByRole("button", { name: "Next question", exact: true }),
  ).toBeDisabled();
  await last.getByRole("button", { name: "Previous question" }).click();
  await expect(
    page.getByRole("article", { name: "What will it cost?" }),
  ).toBeVisible();
  await page.getByLabel("Choose a question").selectOption("0");
  await expect(first.getByText("Approved lunch plan")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Tell us about your project" }),
  ).toHaveCount(0);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download draft", exact: true }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = Buffer.concat(chunks).toString();
  expect(exported).toContain("Approved lunch plan");
  expect(exported).toContain(
    "Required before submission: Name the project venue.",
  );
  expect(exported).not.toContain("maxPoints");
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  await save.click();
  await expect(save).toBeEnabled();
  expect(state.application.draft).toEqual(generated);
  await assessment
    .getByRole("button", { name: "Update project inputs" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Name the project venue." }),
  ).toBeVisible();
  await page
    .getByText("Funder guidelines and questions", { exact: true })
    .click();
  await page
    .getByLabel("Current program guidelines")
    .fill("Applicants must provide current public liability insurance.");
  await expect(
    page.getByRole("button", { name: "Refresh draft and score" }),
  ).toBeDisabled();
  await save.click();
  await expect.poll(() => state.application.draft.readiness_stale).toBe(true);
  expect(state.application.draft.sections).toEqual(generated.sections);
  expect(state.application.draft).not.toHaveProperty("application_text");
  await page
    .getByRole("button", { name: "Draft & review", exact: true })
    .click();
  await expect(assessment.getByLabel("62 out of 100")).toHaveCount(0);
  await page.getByText("Edit draft text", { exact: true }).click();
  await page.getByLabel("Your application draft").fill(edited);
  await page
    .getByRole("button", { name: "Check edited draft", exact: true })
    .click();
  await expect(assessment.getByLabel("69 out of 100")).toBeVisible();
  const suggestion = first.getByRole("region", { name: "Suggested revision" });
  await expect(first.getByText(edited.trim())).toBeVisible();
  await expect(
    suggestion.getByText(
      "The lunch will be held at the booked community hall.",
    ),
  ).toBeVisible();
  await expect(suggestion.getByText("Hall booking record")).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await suggestion
    .getByRole("button", { name: "Copy suggested wording" })
    .click();
  await expect(suggestion.getByRole("status")).toHaveText("Revision copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "The lunch will be held at the booked community hall.",
  );
  const [afterReview] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download draft" }).click(),
  ]);
  const reviewedCopy: Buffer[] = [];
  for await (const chunk of (await afterReview.createReadStream())!)
    reviewedCopy.push(Buffer.from(chunk));
  expect(Buffer.concat(reviewedCopy).toString()).toContain(edited);
  expect(Buffer.concat(reviewedCopy).toString()).not.toContain(
    "The lunch will be held at the booked community hall.",
  );
  expect(state.ai.filter((body) => body.reviewExistingDraft)).toHaveLength(2);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".application-row").click();
  await expect(assessment.getByLabel("69 out of 100")).toBeVisible();
  await page.getByText("Edit draft text", { exact: true }).click();
  await expect(page.getByLabel("Your application draft")).toHaveValue(edited);
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});

const readingQuestion =
  "How will the project benefit people in your community?";
const readingParagraphs = [
  "Local residents have asked for a regular place to meet over a meal. The neighbourhood centre will host a monthly community lunch where residents can cook together, share recipes and meet people who live nearby.",
  "The centre will invite residents through its existing walking group and community noticeboard. Volunteers will welcome people arriving alone and offer a seat at a shared table.",
  "After each lunch, participants can suggest an activity for the next gathering. The coordinator will use these suggestions and a short attendance record to plan the following month.",
];
for (const width of [1280, 390]) {
  test(`application answers open in a readable workspace at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width > 600 ? 880 : 844 });
    await mockGrantWorkspace(page, {
      application: {
        ...application,
        title: "Neighbourhood community lunches",
        draft: {
          sections: [
            {
              question: readingQuestion,
              answer: readingParagraphs.join("\n\n"),
              needs_review: true,
              word_limit: 250,
              evidence: [
                "Neighbourhood centre project brief, community consultations",
              ],
            },
            {
              question: "Who will deliver the project?",
              answer: "The centre coordinator and community volunteers.",
              evidence: ["Project brief, delivery team"],
            },
            {
              question:
                "What will you do if only part of your request is funded?",
              answer:
                "We will schedule fewer lunches and keep the same number of volunteer places.",
              character_limit: 40,
              evidence: [],
            },
          ],
          evidence_sources: [],
        },
      },
    });
    await page.goto(`/?view=applications&org=${orgId}`);
    await page
      .getByRole("button", { name: /Neighbourhood community lunches/ })
      .click();
    const article = page.getByRole("article", { name: readingQuestion });
    const paragraphs = readingParagraphs.map((text) =>
      article.getByText(text, { exact: true }),
    );
    await expect(paragraphs[0]).toBeInViewport();
    await expect(article.getByText("Check details")).toBeVisible();
    const layout = await paragraphs[0].evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      const next = el.nextElementSibling!.getBoundingClientRect();
      const css = getComputedStyle(el);
      return {
        font: parseFloat(css.fontSize),
        line: parseFloat(css.lineHeight),
        width: bounds.width,
        paragraphGap: next.top - bounds.bottom,
      };
    });
    expect(layout.font).toBeGreaterThanOrEqual(16);
    expect(layout.line / layout.font).toBeGreaterThanOrEqual(1.5);
    expect(layout.width).toBeLessThan(760);
    expect(layout.paragraphGap).toBeGreaterThanOrEqual(12);
    await expect(page.getByRole("dialog")).toHaveJSProperty("scrollLeft", 0);
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`draft-reader-${width}.png`),
    });
    await article
      .getByRole("button", { name: "Continue to next question" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Who will deliver the project?" }),
    ).toBeFocused();
    if (width > 600)
      await page
        .getByRole("navigation", { name: "Application questions" })
        .getByRole("button", { name: /What will you do if/ })
        .click();
    else await page.getByLabel("Choose a question").selectOption("2");
    await expect(page.getByText("Over character limit")).toBeVisible();
    await expect(page.getByText("No uploaded files were used.")).toBeVisible();
    await page.getByRole("button", { name: "Review uploads" }).click();
    await expect(
      page.getByText("No files selected for this draft"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save and open document library" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Draft & review", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "What will you do if only part of your request is funded?",
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Neighbourhood community lunches/ }),
    ).toBeFocused();
  });
}

test("a research newsletter previews distinct grants and saves only the checked grant after a retry", async ({
  page,
}) => {
  const unselectedDocument: DocumentRecord = {
    id: "820ef820-975b-4651-a351-4e85d87e055f",
    org_id: orgId,
    name: "Different-round.pdf",
    category: "guidelines",
    storage_path: orgId + "/unrelated.pdf",
    mime_type: "application/pdf",
    size_bytes: 250,
    verified: false,
    created_at: "2026-10-01T00:00:00Z",
  };
  const state = await mockGrantWorkspace(page, {
    grants: [],
    documents: [unselectedDocument],
  });
  const text =
    "Hi team! Creek Council’s Pocket Parks Fund closes next March. After our call, I also wrote down the Library Friends Reading Grant. Regards, Jo";
  const candidate = {
    title: "Pocket Parks Fund",
    funder: "Creek Council",
    summary: "Support for small parks.",
    source_url: "https://example.invalid/grants/parks",
    guidelines_text: "",
    amount_min: null,
    amount_max: null,
    opens_on: null,
    closes_at: null,
    closing_date: "2027-03-08",
    location: "",
    focus_areas: [],
    requirements: [],
  };
  const candidates = [
    candidate,
    {
      ...candidate,
      title: "Library Friends Reading Grant",
      funder: "",
      summary: "",
      closing_date: null,
      source_url: "",
    },
  ];
  const receipt = {
    importCandidates: candidates,
    sourceFingerprint: fingerprint,
    stageIssuedAt: Date.now(),
  };
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    if (body.importStage === "preview")
      return route.fulfill({
        json: {
          ...receipt,
          importNotes: [
            "The newsletter does not give an official deadline for the reading grant.",
          ],
        },
      });
    if (state.ai.length === 2)
      return route.fulfill({
        status: 503,
        json: { error: "Saving is temporarily unavailable. Try again." },
      });
    state.grants = body.selectedIndexes.map((index: number) => ({
      ...opportunity,
      ...candidates[index],
    }));
    return route.fulfill({
      json: {
        opportunities: state.grants,
        importedCount: 1,
        duplicateCount: 0,
        message: "Added 1 opportunity.",
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?view=opportunities&org=${orgId}`);
  const open = page.getByRole("button", { name: "Import grants", exact: true });
  await open.click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Read with AI" }),
  ).toBeDisabled();
  await dialog.getByLabel("Report text").fill(text);
  await dialog.getByRole("button", { name: "Read with AI" }).click();
  await expect(dialog).toHaveAccessibleName("Review grant opportunities");
  await expect(dialog.getByText("Source link needed")).toBeVisible();
  await expect(
    dialog.getByText(/does not give an official deadline/),
  ).toBeVisible();
  await expect(
    dialog.getByText(/Closes 8 Mar 2027 · Time to confirm/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Source link in report" }),
  ).toHaveAttribute("href", candidate.source_url);
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  expect(state.ai).toHaveLength(1);
  expect(state.ai[0]).toMatchObject({
    action: "import-grant",
    importStage: "preview",
    text,
    documentIds: [],
  });
  expect(state.grants).toHaveLength(0);
  await expect(page.locator(".grant-card")).toHaveCount(0);
  const parks = dialog.getByRole("checkbox", { name: candidate.title });
  await parks.uncheck();
  await dialog.getByRole("checkbox", { name: candidates[1].title }).uncheck();
  await expect(
    dialog.getByRole("button", { name: "Save selected (0)" }),
  ).toBeDisabled();
  await parks.check();
  const save = dialog.getByRole("button", { name: "Save selected (1)" });
  await save.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Saving is temporarily unavailable",
  );
  await expect(parks).toBeChecked();
  await save.click();
  await expect(dialog).toHaveCount(0);
  expect(state.ai[1]).toMatchObject({
    action: "import-grant",
    importStage: "save",
    selectedIndexes: [0],
    ...receipt,
  });
  expect(state.ai[2]).toEqual(state.ai[1]);
  await expect(page.locator(".grant-card")).toHaveCount(1);
  await expect(page.locator(".grant-card")).toContainText(candidate.title);
  await expect(open).toBeFocused();
});

test("an empty import preview lets the reader revise the report or cancel without saving", async ({
  page,
}) => {
  const state = await mockGrantWorkspace(page, { grants: [] });
  await page.route("**/api/ai", (route) => {
    state.ai.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        importCandidates: [],
        sourceFingerprint: fingerprint,
        stageIssuedAt: Date.now(),
      },
    });
  });
  await page.goto(`/?view=opportunities&org=${orgId}`);
  await page
    .getByRole("button", { name: "Import grants", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByLabel("Report text");
  const read = dialog.getByRole("button", { name: "Read with AI" });
  await input.fill("x".repeat(40_001));
  await expect(dialog.getByRole("alert")).toContainText("40,000");
  await expect(read).toBeDisabled();
  const original =
    "Our newsletter this month is about plans to research local community funding.";
  await input.fill(original);
  await read.click();
  await expect(dialog.getByRole("status")).toContainText(
    "No grant opportunities found",
  );
  await expect(
    dialog.getByRole("button", { name: /Save selected/ }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Back to report" }).click();
  await expect(input).toHaveValue(original);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(state.ai.map((request) => request.importStage)).toEqual(["preview"]);
});
