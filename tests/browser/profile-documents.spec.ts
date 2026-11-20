import { expect, test, type Page } from "@playwright/test";
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
    recordRequests: 0,
    open: [] as { path: string; expires: number; options?: unknown }[],
    failUploadAt: 0,
    failUpdate: false,
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
