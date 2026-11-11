import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  generateJSON: vi.fn(),
  documentParts: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("../netlify/functions/lib/gemini", async () => ({
  ...(await vi.importActual<typeof import("../netlify/functions/lib/gemini")>(
    "../netlify/functions/lib/gemini",
  )),
  generateJSON: mocks.generateJSON,
  documentParts: mocks.documentParts,
  discoverOpportunities: vi.fn(),
  importOpportunity: vi.fn(),
  profilePipeline: vi.fn(),
}));
import handler from "../netlify/functions/ai";

const orgId = "6a03978d-6266-46b6-b35e-bf8069e50743";
const grantId = "6a03978d-6266-46b6-b35e-bf8069e50744";
const appId = "6a03978d-6266-46b6-b35e-bf8069e50745";
const guidance =
  "Applicants must supply current public liability insurance. A project budget is mandatory. Financial audits are optional for this round.";
const user = { id: "verified-user", email: "member@example.com" };
let member: { role: string } | null;
let guidelines: string;
let details: Record<string, unknown>;
let documents: { name: string; category: string; expires_on: string | null }[];
let writes: unknown[];
let project: Record<string, unknown>;

function fakeDb() {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    rpc: vi.fn(async () => ({ data: true, error: null })),
    from(table: string) {
      let update: unknown;
      const result = () => {
        if (table === "organization_members")
          return { data: member, error: null };
        if (table === "organizations")
          return {
            data: {
              id: orgId,
              name: "Example Charity",
              profile: { name: "Example Charity" },
              verification_status: "approved",
            },
            error: null,
          };
        if (table === "opportunities")
          return {
            data: {
              id: grantId,
              org_id: orgId,
              title: "Example grant",
              guidelines_text: guidelines,
              requirements: [],
            },
            error: null,
          };
        if (table === "documents") return { data: documents, error: null };
        if (table === "funded_projects")
          return {
            data: {
              ...project,
              ...(typeof update === "object" && update !== null ? update : {}),
            },
            error: null,
          };
        if (table === "expenses")
          return {
            data: [{ description: "Recorded supplies", amount: 120 }],
            error: null,
          };
        if (table === "applications")
          return {
            data: {
              id: appId,
              org_id: orgId,
              opportunity_id: grantId,
              status: "draft",
              updated_at: "2026-11-11T00:00:00.000Z",
              project_details: details,
              ...(typeof update === "object" && update !== null ? update : {}),
            },
            error: null,
          };
        throw new Error(`Unexpected table ${table}`);
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        limit: () => chain,
        update: (value: unknown) => {
          update = value;
          writes.push(value);
          return chain;
        },
        insert: (value: unknown) => {
          writes.push(value);
          return chain;
        },
        maybeSingle: async () => result(),
        single: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return chain;
    },
  };
}
function call(extra: Record<string, unknown> = {}) {
  return handler(
    new Request("https://portal.example.com/api/ai", {
      method: "POST",
      headers: { Authorization: "Bearer test-jwt" },
      body: JSON.stringify({
        action: "draft",
        draftStage: "preflight",
        orgId,
        opportunityId: grantId,
        applicationId: appId,
        ...extra,
      }),
    }),
  );
}
const requirement = (extra: Record<string, unknown> = {}) => ({
  category: "insurance",
  label: "public liability insurance",
  source_quote: "Applicants must supply current public liability insurance.",
  mandatory: true,
  conditional: false,
  condition_applies: true,
  ...extra,
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_ANON_KEY", "public-test-key");
  vi.stubEnv("GEMINI_API_KEY", "test-model-key");
  vi.stubEnv(
    "AUTH_RATE_LIMIT_SECRET",
    "326cb95c142a5937654e812e4bb13ca49952e7553bbab015dea4b42342e24122",
  );
  member = { role: "member" };
  guidelines = guidance;
  details = {
    summary: "Community gardening workshops",
    application_questions: "Describe the activities and attach a budget.",
    budget_notes: "$5,000 requested for tools and workshops.",
  };
  documents = [
    { name: "Insurance.pdf", category: "insurance", expires_on: "2099-01-01" },
  ];
  writes = [];
  project = {
    id: "6a03978d-6266-46b6-b35e-bf8069e50746",
    org_id: orgId,
    title: "Community garden",
    funder: "Provider",
    awarded_amount: 5000,
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    next_report_due: "2026-12-20",
    status: "active",
    proposal: { activities: "User recorded workshops" },
    budget: { supplies: 120 },
    milestones: [],
    report_draft: { summary: "UNSUPPORTED-PRIOR-AI-SENTINEL" },
    unexpected_internal_note: "UNLISTED-PROJECT-FIELD",
  };
  mocks.createClient.mockReturnValue(fakeDb());
  mocks.documentParts.mockResolvedValue({ parts: [], documents: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe("AI handler authentication and required input flow", () => {
  it("denies a viewer mutation before model access", async () => {
    member = { role: "viewer" };
    expect((await call()).status).toBe(403);
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "public-test-key",
      expect.objectContaining({ db: { schema: "simple_grant" } }),
    );
    expect(mocks.generateJSON).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
  it("denies a user without organisation membership", async () => {
    member = null;
    expect((await call()).status).toBe(403);
    expect(mocks.generateJSON).not.toHaveBeenCalled();
  });
  it("blocks absent guidelines before any model call", async () => {
    guidelines = "";
    const result = await call();
    expect(result.status).toBe(422);
    expect(JSON.stringify(await result.json())).toContain("program guidelines");
    expect(mocks.generateJSON).not.toHaveBeenCalled();
  });
  it.each(["application_questions", "summary"])(
    "requires actual %s before preflight or draft generation",
    async (field) => {
      details[field] = "";
      expect((await call()).status).toBe(422);
      expect(mocks.generateJSON).not.toHaveBeenCalled();
    },
  );
});

describe("original-guideline evidence preflight", () => {
  it("blocks missing mandatory insurance despite an empty grant-card checklist", async () => {
    documents = [];
    mocks.generateJSON.mockResolvedValueOnce({
      documents: [requirement()],
      information: [],
    });
    const response = await call();
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).toContain("insurance");
    expect(mocks.generateJSON).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
  it("asks for a mandatory budget before drafting when project facts lack it", async () => {
    details.budget_notes = "";
    mocks.generateJSON.mockResolvedValueOnce({
      documents: [],
      information: [
        {
          label: "a project budget",
          source_quote: "A project budget is mandatory.",
          field: "budget",
          mandatory: true,
          conditional: false,
          condition_applies: true,
          critical: true,
          missing: true,
        },
      ],
    });
    const response = await call();
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).toContain("project budget");
    expect(mocks.generateJSON).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([]);
  });
  it("permits drafting after required evidence is available, without requiring optional audit", async () => {
    documents = [
      {
        name: "Insurance.pdf",
        category: "insurance",
        expires_on: "2099-01-01",
      },
    ];
    mocks.generateJSON.mockResolvedValueOnce({
      documents: [
        requirement(),
        requirement({
          category: "audit_report",
          label: "financial audit",
          source_quote: "Financial audits are optional for this round.",
          mandatory: false,
        }),
      ],
      information: [],
    });
    mocks.generateJSON.mockResolvedValueOnce({
      sections: [
        {
          question: "Describe activities",
          answer: "Community gardening workshops.",
        },
      ],
      missing_information: [],
    });
    const first = await call();
    expect(first.status).toBe(200);
    const state = await first.json();
    expect(writes).toHaveLength(0);
    const response = await call({ ...state, draftStage: "generate" });
    expect(response.status).toBe(200);
    expect(mocks.generateJSON).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(1);
  });
  it("ignores unsupported model-invented requirements with no exact original quote", async () => {
    mocks.generateJSON.mockResolvedValueOnce({
      documents: [
        requirement({
          category: "audit_report",
          label: "an audit",
          source_quote: "Every applicant must upload an audited statement.",
        }),
      ],
      information: [],
    });
    mocks.generateJSON.mockResolvedValueOnce({
      sections: [
        {
          question: "Describe activities",
          answer: "Community gardening workshops",
        },
      ],
      missing_information: [],
    });
    const first = await call();
    expect(first.status).toBe(200);
    const state = await first.json();
    expect((await call({ ...state, draftStage: "generate" })).status).toBe(200);
    expect(writes).toHaveLength(1);
  });
});

describe("report regeneration evidence", () => {
  it("uses only whitelisted project records and ledger, excluding the prior AI draft entirely", async () => {
    mocks.generateJSON.mockResolvedValueOnce({
      title: "New draft report",
      summary: "Recorded project information",
      evidence_gaps: [],
    });
    const result = await call({ action: "report", projectId: project.id });
    expect(result.status).toBe(200);
    expect(mocks.generateJSON).toHaveBeenCalledTimes(1);
    const prompt = mocks.generateJSON.mock.calls[0][0] as string;
    expect(prompt).toContain("User recorded workshops");
    expect(prompt).toContain("Recorded supplies");
    expect(prompt).toContain("unverified source data");
    expect(prompt).not.toContain("UNSUPPORTED-PRIOR-AI-SENTINEL");
    expect(prompt).not.toContain("report_draft");
    expect(prompt).not.toContain("UNLISTED-PROJECT-FIELD");
    expect(writes).toEqual([
      expect.objectContaining({
        report_draft: expect.objectContaining({
          title: "New draft report",
          human_review_required: true,
        }),
      }),
    ]);
  });
});
