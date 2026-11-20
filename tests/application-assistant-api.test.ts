import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  research: vi.fn(),
  quota: vi.fn(),
  queue: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("../netlify/functions/lib/application-research", () => ({
  researchApplication: mocks.research,
}));
vi.mock("../netlify/functions/lib/ai-jobs", () => ({
  queueAIJob: mocks.queue,
}));
vi.mock("../netlify/functions/lib/gemini", async () => ({
  ...(await vi.importActual<typeof import("../netlify/functions/lib/gemini")>(
    "../netlify/functions/lib/gemini",
  )),
  documentParts: vi.fn(async () => ({
    parts: [],
    documents: [],
    sourceDigests: [],
  })),
}));
import handler from "../netlify/functions/ai";
const orgId = "6a03978d-6266-46b6-b35e-bf8069e50743";
const grantId = "6a03978d-6266-46b6-b35e-bf8069e50744";
const appId = "6a03978d-6266-46b6-b35e-bf8069e50745";
let role: string;
let organisation: Record<string, unknown>;
let application: Record<string, unknown>;
let grant: Record<string, unknown>;
const lookups: { table: string; filters: Record<string, unknown> }[] = [];
function db() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: "synthetic-user" } },
        error: null,
      }),
    },
    rpc: mocks.quota,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const result = () => {
        lookups.push({ table, filters: { ...filters } });
        if (table === "organization_members")
          return { data: { role }, error: null };
        const row =
          table === "organizations"
            ? organisation
            : table === "applications"
              ? application
              : table === "opportunities"
                ? grant
                : null;
        if (table === "documents") return { data: [], error: null };
        return {
          data:
            row &&
            Object.entries(filters).every(([key, value]) => row[key] === value)
              ? row
              : null,
          error: null,
        };
      };
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return query;
        },
        maybeSingle: async () => result(),
        single: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  };
}
function call(
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return handler(
    new Request("https://simplegrants.com.au/api/ai", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic-session", ...headers },
      body: JSON.stringify({
        action: "prepare-application",
        orgId,
        applicationId: appId,
        opportunityId: grantId,
        ...extra,
      }),
    }),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  lookups.length = 0;
  vi.stubEnv("SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("SUPABASE_ANON_KEY", "synthetic-publishable-key");
  vi.stubEnv("GEMINI_API_KEY", "synthetic-model-key");
  role = "member";
  organisation = {
    id: orgId,
    name: "Synthetic charity",
    verification_status: "approved",
    profile: {
      name: "Synthetic charity",
      mission: "Community education",
      bank_account_number: "PRIVATE-CANARY",
      source_evidence: [
        {
          field: "history",
          source: "Unapproved source",
          quote: "REJECTED-EVIDENCE-CANARY",
        },
      ],
      review_notes: [{ field: "history", issue: "UNRESOLVED-CHECK-CANARY" }],
    },
  };
  application = {
    id: appId,
    org_id: orgId,
    opportunity_id: grantId,
    status: "draft",
    project_details: {
      summary: "Manual summary",
      budget_notes: "Recorded costs only",
      application_research: { summary: "PRIOR-AI-OUTPUT-CANARY" },
      research_sources_confirmed: true,
      submission_confirmation: { confirmed: true },
    },
  };
  grant = {
    id: grantId,
    org_id: orgId,
    title: "Synthetic grant",
    source_url: "https://www.grants.gov.au/round",
    guidelines_text:
      "Current official guidelines with detailed eligibility, criteria, actual questions and conditions for this synthetic grant round.",
    requirements: [],
  };
  mocks.createClient.mockReturnValue(db());
  mocks.quota.mockResolvedValue({ data: true, error: null });
  mocks.research.mockResolvedValue({ summary: "Research for human review" });
});
afterEach(() => vi.unstubAllEnvs());

describe("application assistant API", () => {
  it("researches the tenant's saved application using only approved filtered facts and the existing quota category", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      applicationResearch: { summary: "Research for human review" },
    });
    expect(mocks.quota).toHaveBeenCalledWith("claim_ai_request", {
      p_org_id: orgId,
      p_action: "draft",
    });
    expect(mocks.research).toHaveBeenCalledWith(
      grant,
      { name: "Synthetic charity", mission: "Community education" },
      { summary: "Manual summary", budget_notes: "Recorded costs only" },
      expect.any(Object),
    );
    expect(JSON.stringify(mocks.research.mock.calls)).not.toContain(
      "REJECTED-EVIDENCE-CANARY",
    );
    expect(JSON.stringify(mocks.research.mock.calls)).not.toContain(
      "UNRESOLVED-CHECK-CANARY",
    );
    expect(JSON.stringify(mocks.research.mock.calls)).not.toContain(
      "PRIOR-AI-OUTPUT-CANARY",
    );
    expect(lookups).toContainEqual({
      table: "applications",
      filters: { org_id: orgId, id: appId, opportunity_id: grantId },
    });
    expect(lookups).toContainEqual({
      table: "opportunities",
      filters: { org_id: orgId, id: grantId },
    });
  });
  it("does not prefill from an unapproved organisation profile", async () => {
    organisation.verification_status = "review";
    expect((await call()).status).toBe(200);
    expect(mocks.research.mock.calls[0][1]).toEqual({});
  });
  it.each(["submitted", "awarded", "declined"])(
    "preserves completed %s applications without running research",
    async (status) => {
      application.status = status;
      expect((await call()).status).toBe(409);
      expect(mocks.research).not.toHaveBeenCalled();
      expect(mocks.quota).not.toHaveBeenCalled();
    },
  );
  it("rejects viewers before reading private grant context", async () => {
    role = "viewer";
    expect((await call()).status).toBe(403);
    expect(mocks.research).not.toHaveBeenCalled();
  });
  it.each(["org_id", "opportunity_id"])(
    "rejects an application with a different %s",
    async (key) => {
      application[key] = "6a03978d-6266-46b6-b35e-bf8069e50749";
      expect((await call()).status).toBe(404);
      expect(mocks.research).not.toHaveBeenCalled();
    },
  );
  it("rejects missing application identity before consuming quota", async () => {
    expect((await call({ applicationId: undefined })).status).toBe(422);
    expect(mocks.quota).not.toHaveBeenCalled();
  });
  it("retains the asynchronous job transport for research", async () => {
    mocks.queue.mockResolvedValue(
      new Response(JSON.stringify({ jobId: appId, orgId }), { status: 202 }),
    );
    expect((await call({}, { "X-Simple-Grants-Async": "1" })).status).toBe(202);
    expect(mocks.queue).toHaveBeenCalledOnce();
    expect(mocks.research).not.toHaveBeenCalled();
  });
  it("requires complete official source review before drafting research excerpts", async () => {
    application.project_details = {
      summary: "Manual summary",
      application_questions: "Actual provider question",
      application_research: { summary: "Excerpts only" },
      research_sources_confirmed: false,
    };
    const response = await call({ action: "draft", draftStage: "preflight" });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain(
      "complete current official guidelines",
    );
    expect(mocks.quota).not.toHaveBeenCalled();
  });
});
