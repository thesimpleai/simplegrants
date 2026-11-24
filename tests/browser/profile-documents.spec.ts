import { expect, test, type Page } from "@playwright/test";
import type {
  SetupQuestionKey,
  SetupSuggestion,
} from "../../src/lib/setup-questionnaire";
import type { DocumentRecord, Organisation, Profile } from "../../src/types";

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
  changes: { profile?: Profile; approved?: boolean } = {},
) {
  const state = {
    documents: structuredClone(documents),
    organisations: [orgId, secondOrgId].map((id, index) => ({
      id,
      name: index ? "Other Organisation" : "Test Community",
      abn: null,
      type: "Charity",
      state: "VIC",
      description: "Community support",
      focus_areas: ["Community"],
      profile: changes.profile ?? { name: "Test Community" },
      notification_frequency: "weekly",
      verification_status: changes.approved ? "approved" : "draft",
      inbox_alias: "test-inbox",
      created_at: "2026-01-01T00:00:00Z",
    })) as Organisation[],
    updates: [] as Partial<Organisation>[],
    uploads: [] as { path: string; mime: string; bytes: number }[],
    inserts: [] as Record<string, unknown>[],
    ai: [] as Record<string, unknown>[],
    setupDrafts: new Map<
      string,
      { data: Record<string, unknown>; updatedAt: number }
    >(),
    setupDraftRequests: [] as { method: string; orgId: string; kind: string }[],
    recordRequests: 0,
    open: [] as { path: string; expires: number; options?: unknown }[],
    failUploadAt: 0,
    failUpdate: false,
    failSetupDraftDelete: false,
  };
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const configured=true;
const user=${JSON.stringify(user)};let authCallback;
window.__changeDocumentUser=next=>authCallback?.(next?'SIGNED_IN':'SIGNED_OUT',next?{user:next,access_token:'test-access'}:null);
export const supabase={auth:{getSession:async()=>({data:{session:{user,access_token:'test-access'}},error:null}),onAuthStateChange:callback=>{authCallback=callback;return {data:{subscription:{unsubscribe(){if(authCallback===callback)authCallback=null}}}};}},
from:table=>({select:()=>({order:async()=>(await fetch('/test-document-organizations')).json(),eq:async(field,id)=>(await fetch('/test-document-records?table='+table+'&org='+id)).json()}),insert:async metadata=>(await fetch('/test-document-insert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(metadata)})).json(),update:patch=>({eq:(field,id)=>({select:()=>({maybeSingle:async()=>(await fetch('/test-document-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,patch})})).json()})})})}),
storage:{from:bucket=>({upload:async(path,file,options)=>{const response=await fetch('/test-document-upload?path='+encodeURIComponent(path),{method:'POST',headers:{'Content-Type':options.contentType},body:file});return response.json();},remove:async()=>({error:null}),createSignedUrl:async(path,expires,options)=>(await fetch('/test-document-open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,expires,options})})).json()})}};`,
    }),
  );
  await page.route("**/test-document-organizations", (route) =>
    route.fulfill({
      json: {
        data: state.organisations,
        error: null,
      },
    }),
  );
  await page.route("**/test-document-update", (route) => {
    const { id, patch } = route.request().postDataJSON();
    state.updates.push(patch);
    if (state.failUpdate)
      return route.fulfill({ json: { data: null, error: null } });
    state.organisations = state.organisations.map((org) =>
      org.id === id ? { ...org, ...patch } : org,
    );
    return route.fulfill({
      json: {
        data: state.organisations.find((org) => org.id === id) ?? null,
        error: null,
      },
    });
  });
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
      id: `00000000-0000-4000-8000-${String(state.inserts.length).padStart(12, "0")}`,
      ...body,
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
  await page.route("**/api/setup-review-drafts?*", (route) => {
    const request = route.request();
    const { searchParams } = new URL(request.url());
    const target = searchParams.get("orgId");
    const kind = searchParams.get("kind");
    if (!target || (kind !== "profile" && kind !== "grant-setup"))
      return route.fulfill({
        status: 400,
        json: { error: "Invalid draft type" },
      });
    if (request.headers().authorization !== "Bearer test-access")
      return route.fulfill({
        status: 401,
        json: { error: "Sign in required" },
      });
    const key = `${target}:${kind}`;
    const method = request.method();
    state.setupDraftRequests.push({ method, orgId: target, kind });
    switch (method) {
      case "GET":
        return route.fulfill({
          json: { draft: state.setupDrafts.get(key) ?? null },
        });
      case "PUT": {
        const { data } = request.postDataJSON();
        const updatedAt = Date.now();
        state.setupDrafts.set(key, { data, updatedAt });
        return route.fulfill({ json: { updatedAt } });
      }
      case "DELETE":
        if (state.failSetupDraftDelete)
          return route.fulfill({
            status: 503,
            json: { error: "Draft storage unavailable" },
          });
        state.setupDrafts.delete(key);
        return route.fulfill({ json: { removed: true } });
      default:
        return route.fulfill({
          status: 405,
          json: { error: "Invalid method" },
        });
    }
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

test("grant setup accepts a website and manual answers without any uploads or AI calls", async ({
  page,
}) => {
  const state = await prepareDocuments(page, []);
  await page.route("**/api/ai", (route) => {
    state.ai.push(route.request().postDataJSON());
    return route.fulfill({
      status: 500,
      json: { error: "Manual setup should not request AI" },
    });
  });
  await page.goto("/?view=organisation");
  await page.getByRole("button", { name: "Set up for grants" }).click();
  const wizard = page.getByRole("dialog");
  for (const label of [
    "Upload ASIC or incorporation documents",
    "Upload ACNC registration",
    "Upload financial reports",
    "Upload insurance certificates",
    "Upload mission or strategy documents",
    "Upload organisation background",
  ])
    await expect(
      wizard.getByRole("button", { name: label, exact: true }),
    ).toBeEnabled();
  await expect(
    wizard.getByRole("button", { name: "Suggest answers" }),
  ).toBeDisabled();
  await expect(
    wizard.getByRole("textbox", { name: "Paste a public or redacted excerpt" }),
  ).toBeHidden();
  await wizard
    .getByRole("textbox", { name: "Organisation website", exact: true })
    .fill("example.org.au");
  await wizard.getByRole("button", { name: "Enter answers manually" }).click();
  await expect(wizard).toHaveAccessibleName("Review grant setup answers");
  const legalName = wizard.getByRole("textbox", {
    name: "What is your registered legal name?",
  });
  if (!(await legalName.isVisible()))
    await wizard
      .getByText("Legal identity and eligibility", { exact: true })
      .click();
  await legalName.fill("Creekside Community Association");
  await wizard
    .getByRole("checkbox", { name: /I’ve checked the answers/ })
    .check();
  await wizard.getByRole("button", { name: "Save reviewed answers" }).click();
  await expect(wizard).toHaveCount(0);
  expect(state.ai).toHaveLength(0);
  expect(state.uploads).toHaveLength(0);
  expect(state.organisations[0].profile.grant_setup).toMatchObject({
    answers: {
      website: { status: "confirmed", value: "https://example.org.au" },
      legal_name: {
        status: "confirmed",
        value: "Creekside Community Association",
      },
    },
  });
});

test("grant setup keeps private financial reports out of AI and asks before analysing an insurance upload", async ({
  page,
}) => {
  const privateReport = {
    ...initialDocuments[0],
    name: "full-financial-report.pdf",
    category: "financial_statement",
  };
  const state = await prepareDocuments(page, [privateReport]);
  await page.route("**/api/ai", (route) => {
    state.ai.push(route.request().postDataJSON());
    return route.fulfill({ json: { setupSuggestions: [] } });
  });
  await page.goto("/?view=organisation");
  await page.getByRole("button", { name: "Set up for grants" }).click();
  const wizard = page.getByRole("dialog");
  await expect(
    wizard.getByRole("checkbox", { name: privateReport.name, exact: true }),
  ).toHaveCount(0);
  const uploads = [
    {
      label: "Upload insurance certificates",
      name: "cover.pdf",
      category: "insurance",
      selected: false,
    },
    {
      label: "Upload financial reports",
      name: "annual-summary.pdf",
      category: "financial_summary",
      selected: true,
    },
  ];
  for (const upload of uploads) {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      wizard.getByRole("button", { name: upload.label, exact: true }).click(),
    ]);
    await chooser.setFiles({
      name: upload.name,
      mimeType: "application/pdf",
      buffer: Buffer.from("Fictional document bytes"),
    });
    const choice = wizard.getByRole("checkbox", {
      name: upload.name,
      exact: true,
    });
    await expect(choice).toBeVisible();
    if (upload.selected) await expect(choice).toBeChecked();
    else await expect(choice).not.toBeChecked();
    expect(
      state.documents.find(({ name }) => name === upload.name)?.category,
    ).toBe(upload.category);
  }
  const suggest = wizard.getByRole("button", {
    name: "Suggest answers",
    exact: true,
  });
  await suggest.click();
  await expect(wizard).toHaveAccessibleName("Review grant setup answers");
  expect(state.ai).toHaveLength(1);
  expect(state.ai[0]).toMatchObject({
    action: "setup-source",
    documentIds: [
      state.documents.find(({ name }) => name === uploads[1].name)?.id,
    ],
  });
  expect(state.ai[0].includeInsurance).toBeUndefined();

  await wizard.getByRole("button", { name: "Back to sources" }).click();
  await wizard
    .getByRole("checkbox", { name: uploads[0].name, exact: true })
    .check();
  await suggest.click();
  await expect(wizard).toHaveAccessibleName("Review grant setup answers");
  expect(state.ai).toHaveLength(2);
  expect(state.ai[1]).toMatchObject({
    action: "setup-source",
    documentIds: [
      state.documents.find(({ name }) => name === uploads[0].name)?.id,
    ],
    includeInsurance: true,
  });
});

test("grant setup retries only failed sources, keeps conflicting evidence and waits for an explicit choice", async ({
  page,
}) => {
  const state = await prepareDocuments(page);
  const first = {
    questionKey: "legal_name",
    value: "Creekside Network Inc",
    quote: "Registered name: Creekside Network Inc",
    sourceLabel: initialDocuments[0].name,
    documentId: initialDocuments[0].id,
    quoteVerified: true,
  };
  const second = {
    questionKey: "legal_name",
    value: "Creekside Community Association",
    quote: "Legal entity: Creekside Community Association",
    sourceLabel: initialDocuments[1].name,
    documentId: initialDocuments[1].id,
    quoteVerified: true,
  };
  let attempt = 0;
  await page.route("**/api/ai", async (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    if (body.action === "setup-conflicts") {
      return route.fulfill({
        json: {
          setupConflicts: [
            {
              questionKey: "legal_name",
              alternatives: [first, second],
              recommendedAlternative: 0,
              note: "Check the incorporation certificate against the annual report.",
            },
          ],
        },
      });
    }
    if (body.documentIds[0] === first.documentId)
      return route.fulfill({ json: { setupSuggestions: [first] } });
    if (attempt++ === 0)
      return route.fulfill({ status: 504, json: { code: "SG_AI_TIMEOUT" } });
    return route.fulfill({ json: { setupSuggestions: [second] } });
  });

  await page.goto("/?view=organisation");
  await page.getByRole("button", { name: "Set up for grants" }).click();
  await page.getByRole("checkbox", { name: first.sourceLabel }).check();
  await page.getByRole("checkbox", { name: second.sourceLabel }).check();
  await page.getByRole("button", { name: "Suggest answers" }).click();
  await expect(
    page.getByRole("dialog", { name: "Review grant setup answers" }),
  ).toBeVisible();
  await expect(
    page.getByText("Some sources still need attention"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to sources" }).click();
  await page.getByRole("button", { name: "Suggest answers" }).click();

  const review = page.getByRole("dialog", {
    name: "Review grant setup answers",
  });
  for (const result of [first, second]) {
    await expect(review.getByText(result.quote)).toBeHidden();
    await review
      .locator(".grant-setup-alternative")
      .filter({ hasText: result.value })
      .getByText("View source", { exact: true })
      .click();
  }
  await expect(review.getByText(first.quote)).toBeVisible();
  await expect(review.getByText(second.quote)).toBeVisible();
  await expect(
    review.getByRole("button", { name: "Show all questions" }),
  ).toBeVisible();
  await expect(
    review.getByRole("textbox", {
      name: "What is your registered legal name?",
    }),
  ).toHaveValue("");
  expect(
    state.ai.map(({ action, documentIds }) => [action, documentIds]),
  ).toEqual([
    ["setup-source", [first.documentId]],
    ["setup-source", [second.documentId]],
    ["setup-source", [second.documentId]],
    ["setup-conflicts", []],
  ]);
  expect(state.updates).toHaveLength(0);
  await review
    .getByRole("checkbox", { name: /I’ve checked the answers/ })
    .check();
  await review.getByRole("button", { name: "Save reviewed answers" }).click();
  await expect(review).toHaveCount(0);
  expect(state.organisations[0].profile.grant_setup).toMatchObject({
    unresolved: ["legal_name"],
    evidence: [first, second],
  });
  expect(
    (state.organisations[0].profile.grant_setup as { answers: object }).answers,
  ).not.toHaveProperty("legal_name");

  await page.getByRole("button", { name: "Set up for grants" }).click();
  await page.getByRole("button", { name: "Enter answers manually" }).click();
  await review
    .locator(".grant-setup-alternative")
    .filter({ hasText: first.value })
    .getByRole("button", { name: "Use this answer" })
    .click();
  await review
    .getByRole("checkbox", { name: /I’ve checked the answers/ })
    .check();
  await review.getByRole("button", { name: "Save reviewed answers" }).click();
  await expect(review).toHaveCount(0);
  expect(state.organisations[0].profile.grant_setup).toMatchObject({
    unresolved: [],
    answers: {
      legal_name: { status: "confirmed", value: first.value, sources: [first] },
    },
    evidence: [first, second],
  });
});

test("grant setup splits an over-limit excerpt check and retries only the failed comparison after reload", async ({
  page,
}) => {
  const state = await prepareDocuments(page);
  const sourceFindings = initialDocuments.map((document, index) =>
    [
      {
        questionKey: "legal_name",
        value: ["Creekside Network Inc", "Creekside Community Association"][
          index
        ],
      },
      {
        questionKey: "registration_number",
        value: ["A0123456", "A0765432"][index],
      },
    ].map(({ questionKey, value }) => ({
      questionKey,
      value,
      quote: `The record lists ${value}.`,
      sourceLabel: document.name,
      documentId: document.id,
      quoteVerified: true,
    })),
  );
  const comparisons: SetupQuestionKey[][] = [];
  let allowLegalNameCheck = false;
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    if (body.action === "setup-source") {
      const sourceIndex = initialDocuments.findIndex(
        ({ id }) => id === body.documentIds[0],
      );
      return route.fulfill({
        json: { setupSuggestions: sourceFindings[sourceIndex] },
      });
    }
    const batch = body.conflicts as {
      questionKey: SetupQuestionKey;
      candidates: Omit<SetupSuggestion, "questionKey">[];
    }[];
    const keys = batch.map(({ questionKey }) => questionKey);
    comparisons.push(keys);
    if (
      keys.length > 1 ||
      (!allowLegalNameCheck && keys.includes("legal_name"))
    )
      return route.fulfill({
        status: 502,
        json: {
          code: "SG_AI_OUTPUT_LIMIT",
          reference: "aaf9605a-3af1-4487-82e7-cd2467da21bd",
        },
      });
    return route.fulfill({
      json: {
        setupConflicts: batch.map(({ questionKey, candidates }) => ({
          questionKey,
          alternatives: candidates.map((candidate) => ({
            ...candidate,
            questionKey,
          })),
          recommendedAlternative: 0,
          note: "The first excerpt supports this value.",
        })),
      },
    });
  });

  const setup = page.getByRole("button", { name: "Set up for grants" });
  const review = page.getByRole("dialog", {
    name: "Review grant setup answers",
  });
  const legalName = review.getByRole("group", {
    name: "What is your registered legal name?",
    exact: true,
  });
  const registration = review.getByRole("group", {
    name: "What is your public incorporation or registration number?",
    exact: true,
  });
  const retry = review.getByRole("button", {
    name: "Retry excerpt check",
    exact: true,
  });
  await page.goto("/?view=organisation");
  await setup.click();
  for (const { name } of initialDocuments)
    await page.getByRole("checkbox", { name, exact: true }).check();
  await page.getByRole("button", { name: "Suggest answers" }).click();
  await expect(retry).toBeEnabled();
  await expect(review.getByText("Draft saved for later.")).toBeVisible();
  await expect(
    registration.getByText(/Suggested by the second review/),
  ).toBeVisible();
  await expect(
    legalName.getByText(/Suggested by the second review/),
  ).toHaveCount(0);
  await expect(legalName.getByRole("textbox")).toHaveValue("");
  const manualChoices = legalName.getByRole("button", {
    name: "Use this answer",
  });
  await expect(manualChoices).toHaveCount(2);
  await expect(manualChoices.first()).toBeEnabled();
  expect(comparisons).toEqual([
    ["legal_name", "registration_number"],
    ["legal_name"],
    ["registration_number"],
  ]);

  await page.reload();
  await setup.click();
  await expect(retry).toBeEnabled();
  await expect(
    registration.getByText(/Suggested by the second review/),
  ).toBeVisible();
  expect(comparisons).toHaveLength(3);
  allowLegalNameCheck = true;
  await retry.click();
  await expect(
    legalName.getByText(/Suggested by the second review/),
  ).toBeVisible();
  await expect(
    registration.getByText(/Suggested by the second review/),
  ).toBeVisible();
  await expect(retry).not.toBeVisible();
  expect(comparisons.slice(3)).toEqual([["legal_name"]]);
  expect(
    state.ai
      .filter(({ action }) => action === "setup-source")
      .map(({ documentIds }) => documentIds),
  ).toEqual(initialDocuments.map(({ id }) => [id]));
  expect(state.updates).toHaveLength(0);
});

for (const viewportWidth of [1280, 390]) {
  test(`grant setup draft answer is readable at ${viewportWidth}px`, async ({
    page,
  }) => {
    const description =
      "Creekside Community Hub runs weekly food relief and wellbeing workshops for local families. Trained volunteers also help older residents find services and stay socially connected.";
    const quote =
      "Creekside Community Hub runs weekly food relief and wellbeing workshops for local families.";
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    await prepareDocuments(page, initialDocuments, {
      profile: {
        name: "Creekside Community Hub",
        grant_setup: {
          version: 1,
          answers: { description: { status: "confirmed", value: description } },
          evidence: [
            {
              questionKey: "description",
              value: description,
              quote,
              sourceLabel: initialDocuments[0].name,
              documentId: initialDocuments[0].id,
              quoteVerified: true,
            },
          ],
        },
      },
    });
    await page.goto("/?view=organisation");
    await page.getByRole("button", { name: "Set up for grants" }).click();
    await page.getByRole("button", { name: "Enter answers manually" }).click();
    const review = page.getByRole("dialog", {
      name: "Review grant setup answers",
    });
    await review
      .locator("summary")
      .filter({ hasText: "Purpose and community" })
      .click();

    const question = "What does the organisation do?";
    const editor = review.getByRole("textbox", { name: question, exact: true });
    await expect(editor).toHaveValue(description);
    await review.getByText("View source", { exact: true }).click();
    const dimensions = await editor.evaluate((element) => {
      const fieldset = element.closest("fieldset")!;
      const quote = fieldset.querySelector("blockquote")!;
      const dialog = fieldset.closest('[role="dialog"]')!;
      const styles = getComputedStyle(fieldset);
      return {
        editorWidth: element.getBoundingClientRect().width,
        editorHeight: element.clientHeight,
        editorContentHeight: element.scrollHeight,
        fieldWidth:
          fieldset.clientWidth -
          parseFloat(styles.paddingLeft) -
          parseFloat(styles.paddingRight),
        fieldOverflows: fieldset.scrollWidth > fieldset.clientWidth + 1,
        dialogOverflows: dialog.scrollWidth > dialog.clientWidth + 1,
        editorPrecedesQuote:
          (element.compareDocumentPosition(quote) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
      };
    });
    expect(dimensions.editorWidth).toBeGreaterThanOrEqual(
      dimensions.fieldWidth - 4,
    );
    expect(dimensions.editorHeight).toBeGreaterThanOrEqual(120);
    expect(dimensions.editorContentHeight).toBeLessThanOrEqual(
      dimensions.editorHeight + 1,
    );
    expect(dimensions.fieldOverflows).toBe(false);
    expect(dimensions.dialogOverflows).toBe(false);
    expect(dimensions.editorPrecedesQuote).toBe(true);
  });
}

test("grant setup resumes a private draft across reloads and clears it only after reviewed answers are saved", async ({
  page,
}) => {
  const state = await prepareDocuments(page);
  const key = `${orgId}:grant-setup`;
  const source = initialDocuments[0];
  const extractedName = "Creekside Community Network Inc";
  const reviewedName = "Creekside Community Network Incorporated";
  const quote = `Registered name: ${extractedName}`;
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    return route.fulfill({
      json: {
        setupSuggestions: [
          {
            questionKey: "legal_name",
            value: extractedName,
            quote,
            sourceLabel: source.name,
            documentId: source.id,
            quoteVerified: true,
          },
        ],
      },
    });
  });
  const setup = page.getByRole("button", { name: "Set up for grants" });
  const review = page.getByRole("dialog", {
    name: "Review grant setup answers",
  });
  const legalName = review.getByRole("textbox", {
    name: "What is your registered legal name?",
  });
  const approval = review.getByRole("checkbox", {
    name: "I approve the core organisation profile for grant drafting.",
  });
  const confirmed = review.getByRole("checkbox", {
    name: /I’ve checked the answers/,
  });
  const save = review.getByRole("button", { name: "Save reviewed answers" });
  async function openLegalIdentity() {
    if (!(await legalName.isVisible()))
      await review
        .locator("summary")
        .filter({ hasText: "Legal identity and eligibility" })
        .click();
  }

  await page.goto("/?view=organisation");
  await setup.click();
  await page.getByRole("checkbox", { name: source.name, exact: true }).check();
  await page.getByRole("button", { name: "Suggest answers" }).click();
  await expect(review).toBeVisible();
  await expect(
    review.getByText("Draft saved for later.", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => state.setupDrafts.has(key)).toBe(true);
  expect(state.updates).toHaveLength(0);
  await review.getByRole("button", { name: "Close dialog" }).click();
  await expect(review).toHaveCount(0);

  await page.reload();
  await setup.click();
  await expect(review).toBeVisible();
  await openLegalIdentity();
  await expect(legalName).toHaveValue(extractedName);
  await expect(review.getByText(quote, { exact: true })).toBeAttached();
  await expect(confirmed).not.toBeChecked();
  expect(state.updates).toHaveLength(0);

  await legalName.fill(reviewedName);
  await approval.check();
  await confirmed.check();
  await review.getByRole("button", { name: "Save draft and close" }).click();
  await expect(review).toHaveCount(0);
  expect(state.setupDrafts.has(key)).toBe(true);
  expect(state.updates).toHaveLength(0);
  expect(state.organisations[0].verification_status).toBe("draft");

  await page.reload();
  await setup.click();
  await expect(review).toBeVisible();
  await openLegalIdentity();
  await expect(legalName).toHaveValue(reviewedName);
  await expect(save).toBeDisabled();
  await approval.check();
  await confirmed.check();
  await save.click();
  await expect(review).toHaveCount(0);
  await expect.poll(() => state.setupDrafts.has(key)).toBe(false);
  expect(state.updates).toHaveLength(1);
  expect(state.organisations[0]).toMatchObject({
    verification_status: "approved",
    profile: { legal_name: reviewedName },
  });
  expect(state.ai).toHaveLength(1);

  await page.reload();
  await setup.click();
  await expect(
    page.getByRole("dialog", { name: "Set up your organisation for grants" }),
  ).toBeVisible();
});

test("expanded details preserve approved values, require approval and survive a saved profile round trip", async ({
  page,
}) => {
  const state = await prepareDocuments(page, initialDocuments, {
    approved: true,
    profile: {
      name: "Test Community",
      description: "Community support",
      history: "Reviewed history",
      legacy_note: "Retain the existing value",
      source_evidence: [
        {
          field: "history",
          source: "previous-reviewed.pdf",
          quote: "Reviewed history",
        },
      ],
    },
  });
  const expanded = {
    ...finalResult.profile,
    mission: "Protect children through education",
    beneficiaries: ["Children", "Parents"],
    service_locations: ["Victoria"],
    history: "New source history",
    registration_date: "2026-06-19",
    certificate_issue_date: "2026-06-22",
    milestones: [
      { title: "Incorporated", date: "2026", source: "registration.docx" },
    ],
    activities: [
      {
        name: "Educational workshops",
        description: "Workshops described in the source",
        status: "current",
        source: "history.xlsx",
      },
    ],
    insurance_policies: [
      {
        insurer: "Synthetic Insurer",
        policy_type: "Public liability",
        policy_number: "SYNTHETIC-POLICY-1",
        coverage_amount: "$20 million",
        starts_on: "2026-07-01",
        expires_on: "2027-07-01",
        source: "redacted-policy.pdf",
      },
    ],
    other_facts: [
      {
        label: "Resource",
        value: "Educational materials",
        source: "history.xlsx",
      },
    ],
  };
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({
      json:
        body.profileStage === "correct"
          ? { ...finalResult, profile: expanded }
          : stageResult(body),
    });
  });
  await openProfile(page);
  await page
    .getByRole("button", { name: "Prepare my profile", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Organisation name", exact: true }),
  ).toHaveValue("Test Community");
  await expect(
    page.getByRole("textbox", { name: "What your organisation does" }),
  ).toHaveValue("Community support");
  await expect(
    page
      .getByText("Your previously approved value has been kept.", {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await page.getByText("Purpose, people and places", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Mission or purpose" }),
  ).toHaveValue(expanded.mission);
  await expect(
    page.getByRole("textbox", { name: "People and communities you support" }),
  ).toHaveValue("Children\nParents");
  await page.getByText("History and milestones", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Organisation history", exact: true }),
  ).toHaveValue("Reviewed history");
  await page
    .getByRole("textbox", { name: "Organisation history", exact: true })
    .fill("Reviewed history with a director’s update");
  await expect(
    page.getByRole("textbox", { name: "Milestone date or year" }),
  ).toHaveValue("2026");
  await page.getByText("Insurance policies", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Policy number", exact: true }),
  ).toHaveValue("SYNTHETIC-POLICY-1");
  await page
    .getByRole("button", { name: "Add insurance policy", exact: true })
    .click();
  const secondPolicy = page.getByRole("group", {
    name: "Policy 2",
    exact: true,
  });
  await secondPolicy
    .getByRole("textbox", { name: "Insurer", exact: true })
    .fill("Other Synthetic Insurer");
  await secondPolicy
    .getByRole("textbox", { name: "Policy type", exact: true })
    .fill("Professional indemnity");
  await secondPolicy
    .getByRole("textbox", { name: "Policy number", exact: true })
    .fill("SYNTHETIC-POLICY-2");
  await expect(
    page.getByRole("button", { name: "Approve and save", exact: true }),
  ).toBeDisabled();
  expect(state.updates).toHaveLength(0);
  await page
    .getByRole("checkbox", { name: /I checked these differences/ })
    .check();
  await page
    .getByRole("checkbox", { name: /I have checked these details and approve/ })
    .check();
  await page
    .getByRole("button", { name: "Approve and save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.updates).toHaveLength(1);
  expect(state.updates[0].profile).toMatchObject({
    mission: expanded.mission,
    history: "Reviewed history with a director’s update",
    legacy_note: "Retain the existing value",
    activities: expanded.activities,
    milestones: expanded.milestones,
    other_facts: expanded.other_facts,
    source_evidence: [
      {
        field: "history",
        source: "previous-reviewed.pdf",
        quote: "Reviewed history",
      },
      ...finalResult.evidence,
    ],
  });
  expect(state.updates[0].profile?.insurance_policies).toHaveLength(2);
  await page.reload();
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await page.getByText("Insurance policies", { exact: true }).click();
  await expect(
    page
      .getByRole("group", { name: "Policy 2", exact: true })
      .getByRole("textbox", { name: "Policy number", exact: true }),
  ).toHaveValue("SYNTHETIC-POLICY-2");
  await page.getByText("View source references", { exact: true }).click();
  await expect(page.locator(".evidence-list")).toContainText(
    "registration.docx",
  );
});

test("approved record collections retain reviewed facts and add newly documented activities and policies", async ({
  page,
}) => {
  const existingActivity = {
    name: "Parent support",
    description: "Reviewed activity description",
    status: "current" as const,
    source: "reviewed-activities.pdf",
  };
  const existingPolicy = {
    insurer: "Reviewed Insurer",
    policy_type: "Public liability",
    policy_number: "SYNTHETIC-EXISTING",
    coverage_amount: "$20 million",
    expires_on: "2027-12-31",
    source: "reviewed-policy.pdf",
  };
  const addedActivity = {
    name: "Software resources",
    description: "Newly documented software activity",
    status: "current" as const,
    source: "new-activities.pdf",
  };
  const addedPolicy = {
    insurer: "New Insurer",
    policy_type: "Professional indemnity",
    policy_number: "SYNTHETIC-NEW",
    expires_on: "2027-12-31",
    source: "new-policy.pdf",
  };
  const previousNote = {
    field: "service_locations",
    issue: "Confirm the original service area",
    source: "reviewed-activities.pdf",
  };
  const state = await prepareDocuments(page, initialDocuments, {
    approved: true,
    profile: {
      name: "Test Community",
      description: "Community support",
      beneficiaries: ["Children"],
      service_locations: ["VIC"],
      activities: [existingActivity],
      insurance_policies: [existingPolicy],
      review_notes: [previousNote],
    },
  });
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({
      json:
        body.profileStage === "correct"
          ? {
              ...finalResult,
              profile: {
                name: "Test Community",
                description: "Community support",
                focus_areas: ["Community", "Child safeguarding"],
                beneficiaries: ["children", "Parents"],
                service_locations: ["VIC", "NSW"],
                activities: [
                  {
                    ...existingActivity,
                    description: "Proposed replacement description",
                  },
                  addedActivity,
                ],
                insurance_policies: [
                  { ...existingPolicy, coverage_amount: "$10 million" },
                  addedPolicy,
                ],
              },
            }
          : stageResult(body),
    });
  });
  await openProfile(page);
  await page
    .getByRole("button", { name: "Prepare my profile", exact: true })
    .click();
  await page.getByText("Activities and programs", { exact: true }).click();
  await expect(
    page
      .getByRole("group", { name: "Activity 1", exact: true })
      .getByRole("textbox", { name: "Activity description", exact: true }),
  ).toHaveValue(existingActivity.description);
  await expect(
    page
      .getByRole("group", { name: "Activity 2", exact: true })
      .getByRole("textbox", { name: "Activity or program name", exact: true }),
  ).toHaveValue(addedActivity.name);
  await page.getByText("Insurance policies", { exact: true }).click();
  await expect(
    page
      .getByRole("group", { name: "Policy 1", exact: true })
      .getByRole("textbox", { name: "Coverage amount", exact: true }),
  ).toHaveValue(existingPolicy.coverage_amount);
  await expect(
    page
      .getByRole("group", { name: "Policy 2", exact: true })
      .getByRole("textbox", { name: "Policy number", exact: true }),
  ).toHaveValue(addedPolicy.policy_number);
  await page.getByText("Purpose, people and places", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "People and communities you support" }),
  ).toHaveValue("Children\nParents");
  await expect(
    page.getByRole("textbox", { name: "Service locations" }),
  ).toHaveValue("VIC\nNSW");
  await expect(
    page.getByRole("textbox", { name: "Areas of focus" }),
  ).toHaveValue("Community, Child safeguarding");
  await expect(page.locator(".review-differences")).toContainText(
    "Proposed replacement description",
  );
  await expect(page.locator(".review-differences")).toContainText(
    previousNote.issue,
  );
  await page
    .getByRole("checkbox", { name: /I checked these differences/ })
    .check();
  await page
    .getByRole("checkbox", { name: /I have checked these details and approve/ })
    .check();
  await page
    .getByRole("button", { name: "Approve and save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.updates[0].profile).toMatchObject({
    activities: [existingActivity, addedActivity],
    insurance_policies: [existingPolicy, addedPolicy],
    beneficiaries: ["Children", "Parents"],
    service_locations: ["VIC", "NSW"],
    focus_areas: ["Community", "Child safeguarding"],
  });
  expect(state.updates[0].profile?.review_notes).toContainEqual(previousNote);
  await page.reload();
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await page.getByText("Activities and programs", { exact: true }).click();
  await expect(
    page
      .getByRole("group", { name: "Activity 2", exact: true })
      .getByRole("textbox", { name: "Activity or program name", exact: true }),
  ).toHaveValue(addedActivity.name);
});

test("a zero-row save keeps the review form and entries until the profile is actually saved", async ({
  page,
}) => {
  const state = await prepareDocuments(page);
  state.failUpdate = true;
  await page.goto("/?view=organisation");
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await page
    .getByRole("textbox", { name: "What your organisation does" })
    .fill("Director reviewed change");
  await page
    .getByRole("checkbox", { name: /I have checked these details and approve/ })
    .check();
  await page
    .getByRole("button", { name: "Approve and save", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Your organisation details could not be saved. Your entries are still here.",
  );
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "What your organisation does" }),
  ).toHaveValue("Director reviewed change");
  expect(state.organisations[0].verification_status).toBe("draft");
  await expect(page.locator(".organisation-profile")).toContainText(
    "Needs your review",
  );
  await expect(page.locator("body")).not.toContainText(
    "Organisation details approved and saved.",
  );
  state.failUpdate = false;
  await page
    .getByRole("button", { name: "Approve and save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.updates).toHaveLength(2);
  expect(state.organisations[0].verification_status).toBe("approved");
  expect(state.organisations[0].description).toBe("Director reviewed change");
});

test("insurance evidence needs an explicit choice and financial reports stay outside onboarding selection", async ({
  page,
}) => {
  const insurance = {
    ...initialDocuments[0],
    id: "00000000-0000-4000-8000-000000000090",
    name: "redacted-policy.pdf",
    category: "insurance",
    mime_type: "application/pdf",
  };
  const financial = {
    ...insurance,
    id: "00000000-0000-4000-8000-000000000091",
    name: "private-financial.pdf",
    category: "financial_statement",
  };
  const state = await prepareDocuments(page, [
    ...initialDocuments,
    insurance,
    financial,
  ]);
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    return route.fulfill({ json: stageResult(body) });
  });
  await openProfile(page);
  await expect(
    page.getByRole("checkbox", { name: insurance.name, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: financial.name, exact: true }),
  ).toHaveCount(0);
  const consent = page.getByRole("checkbox", {
    name: /Show insurance documents/,
  });
  await consent.check();
  await expect(
    page.getByRole("checkbox", { name: insurance.name, exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", { name: insurance.name, exact: true })
    .check();
  await consent.uncheck();
  await consent.check();
  await expect(
    page.getByRole("checkbox", { name: insurance.name, exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", { name: insurance.name, exact: true })
    .check();
  await page
    .getByRole("button", { name: "Prepare my profile", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName(
    "Review your organisation details",
  );
  expect(state.ai.map((body) => body.documentIds)).toEqual(
    Array.from({ length: 3 }, () => [
      ...initialDocuments.map((document) => document.id),
      insurance.id,
    ]),
  );
});

test("profile review maps a source entity type to a single standard option", async ({
  page,
}) => {
  await prepareDocuments(page);
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({
      json:
        body.profileStage === "correct"
          ? {
              ...finalResult,
              profile: {
                ...finalResult.profile,
                type: "Incorporated Association",
              },
            }
          : stageResult(body),
    });
  });
  await openProfile(page);
  await page
    .getByRole("button", { name: "Prepare my profile", exact: true })
    .click();
  const select = page.getByRole("combobox", {
    name: "Organisation type",
    exact: true,
  });
  await expect(select).toHaveValue("Incorporated association");
  await expect(select.locator("option")).toHaveCount(8);
  await expect(
    select.getByRole("option", {
      name: "Incorporated association",
      exact: true,
    }),
  ).toHaveCount(1);
});

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

for (const failedStage of ["verify", "correct"]) {
  test(`profile retry resumes the ${failedStage} stage after a timeout`, async ({
    page,
  }) => {
    const state = await prepareDocuments(page);
    let timedOut = false;
    await page.route("**/api/ai", (route) => {
      const body = route.request().postDataJSON();
      state.ai.push(body);
      if (!timedOut && body.profileStage === failedStage) {
        timedOut = true;
        return route.fulfill({
          status: 504,
          json: { error: "Timed out", code: "SG_AI_TIMEOUT" },
        });
      }
      return route.fulfill({ json: stageResult(body) });
    });
    const text = "Keep the original wording and documents for the retry.";
    await openProfile(page, text);
    const prepare = page.getByRole("button", {
      name: "Prepare my profile",
      exact: true,
    });
    await prepare.click();
    await expect(page.getByRole("alert")).toContainText(
      "continue from the last completed step",
    );
    await expect(page.getByRole("alert")).toContainText("SG_AI_TIMEOUT");
    const timedOutRequest = state.ai.at(-1);
    await prepare.click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName(
      "Review your organisation details",
    );
    await expect(
      page.getByRole("button", { name: "Approve and save" }),
    ).toBeDisabled();
    expect(state.ai.map((body) => body.profileStage)).toEqual(
      failedStage === "verify"
        ? ["extract", "verify", "verify", "correct"]
        : ["extract", "verify", "correct", "correct"],
    );
    expect(
      state.ai.filter((body) => body.profileStage === failedStage),
    ).toEqual([timedOutRequest, timedOutRequest]);
    expect(state.updates).toHaveLength(0);
  });
}

for (const invalidation of ["edited inputs", "a stale source fingerprint"]) {
  test(`profile retry restarts extraction after ${invalidation}`, async ({
    page,
  }) => {
    const state = await prepareDocuments(page);
    let corrections = 0;
    await page.route("**/api/ai", (route) => {
      const body = route.request().postDataJSON();
      state.ai.push(body);
      if (body.profileStage === "correct") {
        corrections++;
        if (corrections === 1)
          return route.fulfill({
            status: 504,
            json: { error: "Timed out", code: "SG_AI_TIMEOUT" },
          });
        if (corrections === 2 && invalidation === "a stale source fingerprint")
          return route.fulfill({
            status: 409,
            json: {
              error: "The original sources changed. Restart the review.",
            },
          });
      }
      return route.fulfill({ json: stageResult(body) });
    });
    await openProfile(page);
    const prepare = page.getByRole("button", {
      name: "Prepare my profile",
      exact: true,
    });
    await prepare.click();
    await expect(page.getByRole("alert")).toContainText("SG_AI_TIMEOUT");
    if (invalidation === "edited inputs") {
      await page
        .getByRole("checkbox", { name: "history.xlsx", exact: true })
        .uncheck();
    } else {
      await prepare.click();
      await expect(page.getByRole("alert")).toContainText(
        "The original sources changed",
      );
    }
    await prepare.click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName(
      "Review your organisation details",
    );
    expect(state.ai.map((body) => body.profileStage)).toEqual([
      "extract",
      "verify",
      "correct",
      ...(invalidation === "a stale source fingerprint" ? ["correct"] : []),
      "extract",
      "verify",
      "correct",
    ]);
    if (invalidation === "edited inputs")
      expect(state.ai.slice(-3).map((body) => body.documentIds)).toEqual(
        Array.from({ length: 3 }, () => [initialDocuments[0].id]),
      );
    expect(state.updates).toHaveLength(0);
  });
}

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

test("a prepared profile autosaves its review and resumes after reload without approving", async ({
  page,
}) => {
  const state = await prepareDocuments(page);
  const key = `${orgId}:profile`;
  await page.route("**/api/ai", (route) => {
    const body = route.request().postDataJSON();
    state.ai.push(body);
    return route.fulfill({ json: stageResult(body) });
  });
  const review = page.getByRole("dialog", {
    name: "Review your organisation details",
  });
  const name = review.getByRole("textbox", {
    name: "Organisation name",
    exact: true,
  });
  const approval = review.getByRole("checkbox", {
    name: /I have checked these details and approve them/,
  });
  const differences = review.getByRole("checkbox", {
    name: /I checked these differences against the originals/,
  });
  const approve = review.getByRole("button", { name: "Approve and save" });
  const resume = page.getByRole("button", { name: "Resume profile draft" });

  await openProfile(page);
  await page.getByRole("button", { name: "Prepare my profile" }).click();
  await expect(name).toHaveValue("Corrected Community");
  await expect(review.getByText(/Draft saved. You can return/)).toBeVisible();
  expect(state.setupDrafts.get(key)?.data).toMatchObject({
    profile: { name: "Corrected Community" },
    result: { evidence: finalResult.evidence, checks: profileChecks },
  });
  expect(state.updates).toHaveLength(0);

  await name.fill("Corrected and reviewed Community");
  await expect
    .poll(() => state.setupDrafts.get(key)?.data.profile)
    .toMatchObject({ name: "Corrected and reviewed Community" });
  await differences.check();
  await approval.check();
  await review.getByRole("button", { name: "Save draft and close" }).click();
  await expect(review).toHaveCount(0);
  expect(state.organisations[0].verification_status).toBe("draft");

  await page.reload();
  await resume.click();
  await expect(name).toHaveValue("Corrected and reviewed Community");
  await expect(review.getByText(profileChecks[0].issue)).toBeVisible();
  await expect(approval).not.toBeChecked();
  await expect(differences).not.toBeChecked();
  await expect(approve).toBeDisabled();
  expect(state.ai).toHaveLength(3);
  expect(state.updates).toHaveLength(0);

  await differences.check();
  await approval.check();
  state.failUpdate = true;
  await approve.click();
  await expect(review.getByRole("alert")).toContainText("could not be saved");
  expect(state.setupDrafts.has(key)).toBe(true);
  expect(
    state.setupDraftRequests.some((request) => request.method === "DELETE"),
  ).toBe(false);
  state.failUpdate = false;
  await approve.click();
  await expect(review).toHaveCount(0);
  expect(state.setupDrafts.has(key)).toBe(false);
  expect(state.organisations[0]).toMatchObject({
    verification_status: "approved",
    name: "Corrected and reviewed Community",
  });
  await expect(
    page.getByRole("button", { name: "Update with AI" }),
  ).toBeVisible();
});

test("an unread profile draft cannot be discarded from a newly prepared review", async ({
  page,
}) => {
  const state = await prepareDocuments(page);
  const key = `${orgId}:profile`;
  const saved = {
    updatedAt: Date.now(),
    data: {
      version: 1,
      profile: { ...finalResult.profile, name: "Previously saved profile" },
      focusText: "Community",
      result: finalResult,
      selected: [initialDocuments[0].id],
      includeInsurance: false,
    },
  };
  state.setupDrafts.set(key, saved);
  let draftStorageAvailable = false;
  await page.route("**/api/setup-review-drafts?*", async (route) => {
    if (route.request().method() === "GET" && !draftStorageAvailable) {
      await route.fulfill({ status: 503, json: { error: "Unavailable" } });
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/ai", (route) =>
    route.fulfill({ json: stageResult(route.request().postDataJSON()) }),
  );

  await page.goto("/?view=organisation");
  await expect(
    page.getByRole("button", { name: "Retry loading profile draft" }),
  ).toBeVisible();
  draftStorageAvailable = true;
  await page
    .getByRole("button", { name: "Update with AI", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Prepare my profile", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Review your organisation details",
  });
  await expect(
    review.getByText(/this draft couldn’t be saved for later/i),
  ).toBeVisible();
  await expect(
    review.getByRole("button", { name: "Discard draft and start over" }),
  ).toHaveCount(0);
  expect(state.setupDrafts.get(key)).toEqual(saved);
  expect(state.setupDraftRequests.map(({ method }) => method)).toEqual(["GET"]);
});

for (const flow of [
  {
    kind: "grant-setup",
    open: "Set up for grants",
    review: "Review grant setup answers",
    discard: "Discard grant setup draft?",
    sources: "Set up your organisation for grants",
    pastedText: "Paste a public or redacted excerpt",
    analyse: "Suggest answers",
    draftField: "What is your registered legal name?",
  },
  {
    kind: "profile",
    open: "Resume profile draft",
    review: "Review your organisation details",
    discard: "Discard profile draft?",
    sources: "Let’s get to know your organisation",
    pastedText: "Paste your organisation’s history or information",
    analyse: "Prepare my profile",
    draftField: "Organisation name",
  },
] as const) {
  test(`discarding a ${flow.kind} review draft requires confirmation and preserves approved details and original documents`, async ({
    page,
  }) => {
    const approvedProfile = {
      name: "Test Community",
      legal_name: "Test Community Incorporated",
      mission: "Community education and support",
      grant_setup: {
        version: 1,
        answers: {
          mission: {
            status: "confirmed",
            value: "Community education and support",
          },
        },
        evidence: [],
        unresolved: [],
      },
    };
    const state = await prepareDocuments(page, initialDocuments, {
      profile: approvedProfile,
      approved: true,
    });
    const approvedOrganisation = structuredClone(state.organisations[0]);
    const source = initialDocuments[0];
    const draftName = "Edited unapproved draft name";
    const setupEvidence = {
      questionKey: "legal_name",
      value: "Candidate name from registration",
      quote: "Registration records Candidate name from registration.",
      sourceLabel: source.name,
      documentId: source.id,
      quoteVerified: true,
    };
    const grantDraftKey = `${orgId}:grant-setup`;
    const profileDraftKey = `${orgId}:profile`;
    state.setupDrafts.set(grantDraftKey, {
      updatedAt: Date.now(),
      data: {
        version: 1,
        evidence: [setupEvidence],
        edits: { legal_name: { status: "confirmed", value: draftName } },
        selected: [source.id],
        completed: [source.id],
        insurance: false,
        reviews: {},
      },
    });
    state.setupDrafts.set(profileDraftKey, {
      updatedAt: Date.now(),
      data: {
        version: 1,
        profile: { ...finalResult.profile, name: draftName },
        focusText: "Community",
        result: finalResult,
        selected: [source.id],
        includeInsurance: false,
      },
    });
    const requestedDraftKey = `${orgId}:${flow.kind}`;
    const otherDraftKey =
      flow.kind === "grant-setup" ? profileDraftKey : grantDraftKey;
    const requestedDraft = state.setupDrafts.get(requestedDraftKey);
    const otherDraft = state.setupDrafts.get(otherDraftKey);
    const deleteRequests = () =>
      state.setupDraftRequests.filter(({ method }) => method === "DELETE");
    await page.route("**/api/ai", (route) => {
      const body = route.request().postDataJSON();
      state.ai.push(body);
      return route.fulfill({
        json:
          body.action === "setup-source"
            ? { setupSuggestions: [setupEvidence] }
            : stageResult(body),
      });
    });

    const review = page.getByRole("dialog", { name: flow.review });
    const confirm = page.getByRole("dialog", { name: flow.discard });
    const sourceStep = page.getByRole("dialog", { name: flow.sources });
    const existingAnswer = review.getByRole("textbox", {
      name: flow.draftField,
      exact: true,
    });
    const discard = review.getByRole("button", {
      name: "Discard draft and start over",
      exact: true,
    });
    const confirmDiscard = confirm.getByRole("button", {
      name: "Discard and start over",
      exact: true,
    });
    async function expectDraftAnswer() {
      await expect(review).toBeVisible();
      if (flow.kind === "grant-setup" && !(await existingAnswer.isVisible()))
        await review
          .locator("summary")
          .filter({ hasText: "Legal identity and eligibility" })
          .click();
      await expect(existingAnswer).toHaveValue(draftName);
    }

    await page.goto("/?view=organisation");
    await page.getByRole("button", { name: flow.open, exact: true }).click();
    await expectDraftAnswer();
    await discard.click();
    await expect(confirm).toBeVisible();
    expect(deleteRequests()).toHaveLength(0);
    await confirm
      .getByRole("button", { name: "Keep draft", exact: true })
      .click();
    await expectDraftAnswer();
    expect(state.setupDrafts.get(requestedDraftKey)).toEqual(requestedDraft);
    expect(deleteRequests()).toHaveLength(0);

    state.failSetupDraftDelete = true;
    await discard.click();
    await confirmDiscard.click();
    await expect(confirm.getByRole("alert")).toContainText(/try again/i);
    expect(state.setupDrafts.get(requestedDraftKey)).toEqual(requestedDraft);
    await confirm
      .getByRole("button", { name: "Keep draft", exact: true })
      .click();
    await expectDraftAnswer();

    state.failSetupDraftDelete = false;
    await discard.click();
    await confirmDiscard.click();
    await expect(sourceStep).toBeVisible();
    if (flow.kind === "grant-setup")
      await sourceStep
        .getByText("Paste public or redacted text", { exact: true })
        .click();
    await expect(
      sourceStep.getByRole("textbox", { name: flow.pastedText }),
    ).toHaveValue("");
    expect(state.setupDrafts.has(requestedDraftKey)).toBe(false);
    expect(state.setupDrafts.get(otherDraftKey)).toEqual(otherDraft);
    expect(deleteRequests()).toEqual(
      Array.from({ length: 2 }, () => ({
        method: "DELETE",
        orgId,
        kind: flow.kind,
      })),
    );
    expect(state.ai).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
    expect(state.organisations[0]).toEqual(approvedOrganisation);
    expect(state.documents).toEqual(initialDocuments);

    await sourceStep
      .getByRole("checkbox", { name: source.name, exact: true })
      .check();
    await sourceStep
      .getByRole("checkbox", { name: initialDocuments[1].name, exact: true })
      .uncheck();
    await sourceStep
      .getByRole("button", { name: flow.analyse, exact: true })
      .click();
    await expect(review).toBeVisible();
    expect(state.ai.map(({ action }) => action)).toEqual(
      flow.kind === "grant-setup"
        ? ["setup-source"]
        : ["profile", "profile", "profile"],
    );
    expect(
      state.ai.every(
        ({ documentIds }) =>
          JSON.stringify(documentIds) === JSON.stringify([source.id]),
      ),
    ).toBe(true);
    expect(state.setupDrafts.get(otherDraftKey)).toEqual(otherDraft);
    expect(state.updates).toHaveLength(0);
  });
}

test("report uploads validate the entire group and send only explicitly selected library documents", async ({
  page,
}) => {
  const state = await prepareDocuments(page, initialDocuments, {
    approved: true,
  });
  await page.route("**/api/ai", (route) => {
    state.ai.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        importCandidates: [
          {
            title: "West Coast Fund",
            funder: "West Coast Trust",
            summary: "",
            guidelines_text: "",
            source_url: "",
            amount_min: null,
            amount_max: null,
            location: "WA",
            focus_areas: [],
            requirements: [],
            opens_on: null,
            closes_at: "2027-03-31T23:30:00+08:00",
            closing_date: "2027-03-31",
          },
        ],
        sourceFingerprint: fingerprint,
        stageIssuedAt: Date.now(),
      },
    });
  });
  await page.goto(`/?view=opportunities&org=${orgId}`);
  await page.getByRole("button", { name: "Import grants" }).click();
  const dialog = page.getByRole("dialog");
  const upload = dialog.getByLabel("Upload report files");
  const file = (name: string, size = 128) => ({
    name,
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(size, 65),
  });
  const reports = [
    "report.pdf",
    "research.docx",
    "prospects.xlsx",
    "rounds.csv",
    "notes.txt",
  ];
  await upload.setInputFiles([file("valid.txt"), file("unsupported.exe")]);
  await expect(dialog.getByRole("alert")).toContainText("unsupported.exe");
  await upload.setInputFiles(
    Array.from({ length: 9 }, (_, i) => file(`grant-${i}.txt`)),
  );
  await expect(dialog.getByRole("alert")).toContainText("up to 8");
  await upload.setInputFiles([file("large.pdf", 10 * 1024 * 1024 + 1)]);
  await expect(dialog.getByRole("alert")).toContainText("10 MB");
  await upload.setInputFiles([
    file("a.pdf", 8 * 1024 * 1024),
    file("b.pdf", 8 * 1024 * 1024),
  ]);
  await expect(dialog.getByRole("alert")).toContainText("15 MB");
  expect(state.uploads).toEqual([]);
  await upload.setInputFiles(reports.map((name) => file(name)));
  for (const name of reports)
    await expect(dialog.getByRole("checkbox", { name })).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "registration.docx" }),
  ).not.toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "history.xlsx" }),
  ).not.toBeChecked();
  expect(state.inserts.map((doc) => doc.category)).toEqual(
    reports.map(() => "grant_research"),
  );
  expect(state.ai).toEqual([]);
  await dialog.getByRole("checkbox", { name: "prospects.xlsx" }).uncheck();
  await dialog.getByRole("checkbox", { name: "history.xlsx" }).check();
  await dialog.getByRole("button", { name: "Read with AI" }).click();
  await expect(
    dialog.getByRole("checkbox", { name: "West Coast Fund" }),
  ).toBeChecked();
  await expect(
    dialog.getByText("Closes 31 Mar 2027", { exact: true }),
  ).toBeVisible();
  expect(state.ai).toHaveLength(1);
  expect(state.ai[0]).toMatchObject({
    text: "",
    importStage: "preview",
    documentIds: [
      ...state.inserts
        .filter((doc) => doc.name !== "prospects.xlsx")
        .map((doc) => doc.id),
      initialDocuments[1].id,
    ],
  });
});
