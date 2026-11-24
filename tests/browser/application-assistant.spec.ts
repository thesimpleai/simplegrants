import { expect, test, type Page } from "@playwright/test";
import type { Application, Opportunity, Organisation } from "../../src/types";
import type { ApplicationResearch } from "../../src/lib/application-research";

const orgId = "bdff4e0b-1dcb-40bd-bd35-464883f18261";
const grantId = "24639278-1e43-44a2-9d25-7c88b480df23";
const appId = "bcb0ff9e-17ba-43c4-ae35-392204ce187e";
const jobId = "2a05abed-4429-4de1-8910-8d144eeb19eb";
const user = {
  id: "a55eb4de-d229-4334-b6fe-ec283e8329b6",
  email: "synthetic@example.invalid",
};
const sourceUrl = "https://www.grants.gov.au/synthetic-community-round";
const organisation: Organisation = {
  id: orgId,
  name: "Synthetic Charity",
  abn: null,
  type: "Charity",
  state: "VIC",
  description: "Community workshops",
  focus_areas: ["Education"],
  profile: {
    name: "Synthetic Charity",
    description: "Community workshops",
    mission: "Support local families",
  },
  notification_frequency: "never",
  verification_status: "approved",
  inbox_alias: "synthetic",
};
const grant: Opportunity = {
  id: grantId,
  org_id: orgId,
  title: "Synthetic Community Round",
  funder: "Synthetic Funder",
  amount_min: 1000,
  amount_max: 5000,
  opens_on: null,
  closes_at: null,
  source_url: sourceUrl,
  guidelines_text:
    "Manual complete current guidelines about community projects.",
  summary: "A synthetic grant fixture.",
  location: "VIC",
  focus_areas: ["Education"],
  match_score: null,
  requirements: [],
  status: "saved",
  provenance: { method: "user_import" },
};
const application: Application = {
  id: appId,
  org_id: orgId,
  opportunity_id: grantId,
  title: "My existing project",
  status: "draft",
  draft: { application_text: "My carefully edited manual draft." },
  project_details: {
    summary: "A documented neighbourhood workshop.",
    application_questions: "Manual application question (200 words).",
    budget_notes: "My reviewed budget notes.",
    custom_reviewed_fact: "Preserve this value",
  },
  requested_amount: null,
  created_at: "2026-11-17T00:00:00Z",
};
const research: ApplicationResearch = {
  summary: "Current source notes for your review.",
  guidelines_excerpt: "Retrieved guideline excerpt for review.",
  application_questions: "Retrieved actual question (150 words).",
  eligibility: ["Check not-for-profit status"],
  criteria: ["Community benefit"],
  required_attachments: ["Project plan"],
  deadlines: ["Confirm closing time with the funder"],
  unresolved_questions: ["Where will this project take place?"],
  sources: [{ title: "Retrieved official source fixture", uri: sourceUrl }],
  official_source_url: sourceUrl,
  retrieved_at: "2026-11-17T00:00:00Z",
  needs_guidelines_upload: true,
};

async function workspace(
  page: Page,
  options: {
    empty?: boolean;
    missingSource?: boolean;
    fallback?: boolean;
    unconfirmed?: boolean;
    async?: boolean;
  } = {},
) {
  const state = {
    grant: structuredClone({
      ...grant,
      ...(options.empty ? { guidelines_text: "" } : {}),
      ...(options.missingSource ? { source_url: "" } : {}),
    }),
    application: structuredClone({
      ...application,
      ...(options.empty
        ? {
            project_details: {
              ...application.project_details,
              application_questions: "",
            },
          }
        : {}),
    }),
    ai: [] as Record<string, unknown>[],
    updates: [] as {
      table: string;
      patch: Record<string, unknown>;
      orgId: string;
    }[],
    polls: 0,
  };
  const response = options.unconfirmed
    ? {
        ...research,
        summary:
          "The saved source could not be established as the grant funder or authorised administrator.",
        official_source_url: "",
        guidelines_excerpt: "",
        application_questions: "",
        sources: [
          {
            title: "Saved grant source — official administrator unconfirmed",
            uri: sourceUrl,
          },
        ],
      }
    : options.fallback
      ? {
          ...research,
          summary:
            "Current guidelines could not be retrieved. Download them from the funder.",
          guidelines_excerpt: "",
          application_questions: "",
          sources: [],
          official_source_url: options.missingSource ? "" : sourceUrl,
        }
      : research;
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const configured=true;
const user=${JSON.stringify(user)};
export const supabase={auth:{getSession:async()=>({data:{session:{user,access_token:'synthetic-access'}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:table=>({select:()=>({order:async()=>(await fetch('/assistant-organisations')).json(),eq:async()=>(await fetch('/assistant-records?table='+table)).json()}),update:patch=>({eq:(field,id)=>({eq:async(scope,orgId)=>(await fetch('/assistant-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table,id,orgId,patch})})).json()})})})};`,
    }),
  );
  await page.route("**/assistant-organisations", (route) =>
    route.fulfill({ json: { data: [organisation], error: null } }),
  );
  await page.route("**/assistant-records*", (route) => {
    const table = new URL(route.request().url()).searchParams.get("table");
    return route.fulfill({
      json: {
        data:
          table === "opportunities"
            ? [state.grant]
            : table === "applications"
              ? [state.application]
              : [],
        error: null,
      },
    });
  });
  await page.route("**/assistant-update", (route) => {
    const body = route.request().postDataJSON();
    state.updates.push(body);
    if (body.table === "applications")
      state.application = { ...state.application, ...body.patch };
    if (body.table === "opportunities")
      state.grant = { ...state.grant, ...body.patch };
    return route.fulfill({
      json: { data: { id: body.id, ...body.patch }, error: null },
    });
  });
  await page.route("**/api/ai", (route) => {
    state.ai.push(route.request().postDataJSON());
    expect(route.request().headers()["x-simple-grants-async"]).toBe("1");
    return route.fulfill(
      options.async
        ? { status: 202, json: { jobId, orgId } }
        : { json: { applicationResearch: response } },
    );
  });
  await page.route("**/api/ai-jobs?*", (route) => {
    state.polls++;
    expect(new URL(route.request().url()).searchParams.get("orgId")).toBe(
      orgId,
    );
    return route.fulfill({ json: { applicationResearch: response } });
  });
  return state;
}

async function openSources(page: Page) {
  await page.getByRole("button", { name: "Project", exact: true }).click();
  await page
    .getByText("Funder guidelines and questions", { exact: true })
    .click();
}
const review = (page: Page) =>
  page.getByRole("button", { name: "Draft & review", exact: true }).click();

async function researchSources(page: Page) {
  await openSources(page);
  await page
    .getByRole("button", { name: "Research this grant with AI", exact: true })
    .click();
}
async function start(page: Page) {
  await page.goto(`/?view=opportunities&org=${orgId}&grant=${grantId}`);
  await page
    .getByRole("button", { name: "Start application", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(application.title);
  await researchSources(page);
  await expect(
    page.getByRole("region", { name: "Application assistant" }),
  ).toContainText(research.summary);
}
const confirmation = (page: Page) =>
  page.getByRole("checkbox", {
    name: /I checked the complete current official guidelines/,
  });

test("requested background research preserves the existing draft through save and reopen", async ({
  page,
}) => {
  const state = await workspace(page, { async: true });
  await start(page);
  expect(state.ai).toHaveLength(1);
  expect(state.ai[0]).toMatchObject({
    action: "prepare-application",
    applicationId: appId,
    opportunityId: grantId,
    orgId,
  });
  expect(state.polls).toBe(1);
  await expect(page.getByLabel("Current program guidelines")).toHaveValue(
    grant.guidelines_text,
  );
  await expect(
    page.getByLabel("Application questions and word limits"),
  ).toHaveValue(String(application.project_details.application_questions));
  await page
    .getByText("Source excerpts and application questions", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add source details to empty fields" })
    .click();
  await expect(page.getByLabel("Current program guidelines")).toHaveValue(
    grant.guidelines_text,
  );
  await expect(
    page.getByLabel("Application questions and word limits"),
  ).toHaveValue(String(application.project_details.application_questions));
  const draftButton = page.getByRole("button", {
    name: "Prepare draft with AI",
    exact: true,
  });
  await expect(draftButton).toBeDisabled();
  await confirmation(page).check();
  await expect(draftButton).toBeEnabled();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => state.updates.length).toBe(2);
  expect(state.application.project_details).toMatchObject({
    ...application.project_details,
    application_research: research,
    research_sources_confirmed: true,
  });
  expect(state.application.draft).toEqual(application.draft);
  expect(state.grant.guidelines_text).toBe(grant.guidelines_text);
  await review(page);
  await expect(page.getByLabel("Your application draft")).toHaveValue(
    "My carefully edited manual draft.",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".application-row").click();
  await openSources(page);
  await expect(confirmation(page)).toBeChecked();
  await expect(
    page.getByRole("region", { name: "Application assistant" }),
  ).toContainText(research.summary);
  expect(state.ai).toHaveLength(1);
});

test("source suggestions fill only empty fields and require human checking of complete guidelines", async ({
  page,
}) => {
  const state = await workspace(page, { empty: true });
  await start(page);
  await expect(page.getByLabel("Current program guidelines")).toHaveValue("");
  await expect(
    page.getByLabel("Application questions and word limits"),
  ).toHaveValue("");
  await confirmation(page).check();
  await page
    .getByText("Source excerpts and application questions", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add source details to empty fields" })
    .click();
  await expect(page.getByLabel("Current program guidelines")).toHaveValue(
    research.guidelines_excerpt,
  );
  await expect(
    page.getByLabel("Application questions and word limits"),
  ).toHaveValue(research.application_questions);
  await expect(page.getByLabel("Tell us about your project")).toHaveValue(
    String(application.project_details.summary),
  );
  await expect(page.getByLabel("Budget and co-funding notes")).toHaveValue(
    String(application.project_details.budget_notes),
  );
  await expect(
    page.getByRole("button", { name: "Prepare draft with AI", exact: true }),
  ).toBeDisabled();
  await confirmation(page).check();
  await expect(
    page.getByRole("button", { name: "Prepare draft with AI", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Application questions and word limits")
    .fill("Edited source question (160 words).");
  await expect(confirmation(page)).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Prepare draft with AI", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect
    .poll(() => state.application.project_details.research_sources_confirmed)
    .toBe(false);
  expect(state.application.project_details.custom_reviewed_fact).toBe(
    "Preserve this value",
  );
});

test("unavailable guidelines retain the actual funder download or portal link", async ({
  page,
}) => {
  const state = await workspace(page, { fallback: true });
  await page.goto(`/?view=opportunities&org=${orgId}&grant=${grantId}`);
  await page
    .getByRole("button", { name: "Start application", exact: true })
    .click();
  await researchSources(page);
  const assistant = page.getByRole("region", { name: "Application assistant" });
  await expect(assistant).toContainText(
    "Current guidelines could not be retrieved",
  );
  await expect(
    assistant.getByRole("link", {
      name: "Open the funder’s guidelines or application portal",
    }),
  ).toHaveAttribute("href", sourceUrl);
  await expect(assistant).toContainText(
    "upload them to My organisation using the Guidelines type",
  );
  await expect(
    assistant.getByRole("button", {
      name: "Add source details to empty fields",
    }),
  ).toHaveCount(0);
  expect(state.ai).toHaveLength(1);
});

test("an absent funder source does not produce an invented download link", async ({
  page,
}) => {
  await workspace(page, { fallback: true, missingSource: true });
  await page.goto(`/?view=opportunities&org=${orgId}&grant=${grantId}`);
  await page
    .getByRole("button", { name: "Start application", exact: true })
    .click();
  await researchSources(page);
  const assistant = page.getByRole("region", { name: "Application assistant" });
  await expect(assistant).toContainText(
    "Current guidelines could not be retrieved",
  );
  await expect(assistant.getByRole("link")).toHaveCount(0);
  await review(page);
  await expect(page.getByLabel("Your application draft")).toHaveValue(
    "My carefully edited manual draft.",
  );
});

test("a retrieved source with unconfirmed administrator status is labelled for checking and not presented as the funder portal", async ({
  page,
}) => {
  await workspace(page, { unconfirmed: true });
  await page.goto(`/?view=opportunities&org=${orgId}&grant=${grantId}`);
  await page
    .getByRole("button", { name: "Start application", exact: true })
    .click();
  await researchSources(page);
  const assistant = page.getByRole("region", { name: "Application assistant" });
  await expect(assistant).toContainText("could not be established");
  await page.getByText("Research notes and sources", { exact: true }).click();
  await expect(
    assistant.getByRole("link", {
      name: "Open the funder’s guidelines or application portal",
    }),
  ).toHaveCount(0);
  await expect(
    assistant.getByRole("link", {
      name: "Saved grant source — official administrator unconfirmed",
    }),
  ).toHaveAttribute("href", sourceUrl);
});

test("opening an application makes no research request and users can keep writing or close during requested research", async ({
  page,
}) => {
  const state = await workspace(page);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/ai", async (route) => {
    state.ai.push(route.request().postDataJSON());
    await pending;
    return route.fulfill({ json: { applicationResearch: research } });
  });
  await page.goto(`/?view=opportunities&org=${orgId}&grant=${grantId}`);
  await page
    .getByRole("button", { name: "Start application", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check edited draft", exact: true }),
  ).toBeVisible();
  expect(state.ai).toHaveLength(0);
  await researchSources(page);
  await expect.poll(() => state.ai.length).toBe(1);
  await page
    .getByLabel("Tell us about your project")
    .fill("This can be typed while research runs.");
  await page
    .getByLabel("Current program guidelines")
    .fill("Current grant rules");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect
    .poll(() => state.grant.guidelines_text)
    .toBe("Current grant rules");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".application-row").click();
  await openSources(page);
  finish();
  await expect(page.getByLabel("Tell us about your project")).toHaveValue(
    "This can be typed while research runs.",
  );
  await expect(
    page.getByRole("button", {
      name: "Research this grant with AI",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(page.getByText(research.summary, { exact: true })).toHaveCount(
    0,
  );
});
