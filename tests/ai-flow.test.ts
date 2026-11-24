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
const modelReadiness = {
  criteria: { coverage: "partial", note: "The example needs human review." },
  delivery: { coverage: "partial", note: "Dates are pending." },
  budget: { coverage: "partial", note: "Costs need confirmation." },
  suggestions: [],
};
const user = { id: "verified-user", email: "member@example.com" };
let member: { role: string } | null;
let guidelines: string;
let details: Record<string, unknown>;
let savedDraft: Record<string, unknown>;
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
              draft: savedDraft,
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
  rule: "required",
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
  savedDraft = {};
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
  it("sends the same selected spreadsheet evidence to preflight and draft generation", async () => {
    const parts = [
      {
        text: "EXCEL TEXT EXTRACT (unverified). SHEET: Budget\nB2: 1250.50\nB3: [Formula result unavailable]\nC3: [Saved spreadsheet error: #DIV/0!]",
      },
    ];
    const selected = { id: grantId, name: "Budget.xlsx" };
    mocks.documentParts.mockResolvedValue({
      parts,
      documents: [selected],
      documentTexts: new Map([[grantId, parts[0].text]]),
    });
    mocks.generateJSON.mockResolvedValueOnce({
      documents: [],
      information: [],
    });
    mocks.generateJSON.mockResolvedValueOnce({
      readiness_review: modelReadiness,
      sections: [
        {
          question: "Describe the budget",
          coverage: "partial",
          answer:
            "Budget B2 records $1,250.50; remaining formula results require review.",
          citations: [
            { source: grantId, quote: "B2: 1250.50" },
            { source: appId, quote: "unselected file" },
          ],
        },
      ],
      missing_information: ["Budget B3 and C3 require correction"],
    });
    const first = await call({ documentIds: [grantId] });
    expect(first.status).toBe(200);
    const state = await first.json();
    const response = await call({
      ...state,
      draftStage: "generate",
      documentIds: [grantId],
    });
    expect(response.status).toBe(200);
    const { draft } = await response.json();
    expect(draft.evidence_sources).toEqual([selected]);
    expect(draft.sections[0].evidence).toEqual(["Budget.xlsx · “B2: 1250.50”"]);
    expect(mocks.generateJSON.mock.calls[0][1]).toEqual(parts);
    expect(mocks.generateJSON.mock.calls[1][1]).toEqual(parts);
    expect(mocks.generateJSON.mock.calls[0][0]).toContain(
      "not numbers to invent or recalculate",
    );
    expect(mocks.generateJSON.mock.calls[1][0]).toContain(
      "sheet and cell address",
    );
  });
  it("keeps a reviewed answer and scores it separately from a selected-file revision", async () => {
    const original = "We run workshops.\n\nProject dates are pending.";
    savedDraft = { application_text: original };
    const selected = { id: appId, name: "Delivery review.pdf" };
    const quote = "In 2024, 36 carers attended workshops in Northfield.";
    mocks.documentParts.mockResolvedValue({
      documents: [selected],
      parts: [
        { text: "SOURCE DOCUMENT: Delivery review.pdf" },
        { text: `[Page 2]\n${quote}` },
      ],
      documentTexts: new Map([[selected.id, `[Page 2]\n${quote}`]]),
    });
    const citation = { source: selected.id, quote };
    const revision = {
      answer: `We run workshops. ${quote}\n\nProject dates are pending.`,
      citations: [citation],
    };
    const section = {
      question: "Describe your delivery experience",
      answer: "We run workshops. Project dates are pending.",
      word_limit: 60,
      coverage: "partial",
      evidence: ["Insurance.pdf"],
      suggestion: revision,
    };
    mocks.generateJSON.mockResolvedValueOnce({
      documents: [],
      information: [],
    });
    mocks.generateJSON.mockResolvedValueOnce({
      readiness_review: modelReadiness,
      sections: [
        section,
        {
          ...section,
          suggestion: { ...revision, citations: [{ source: grantId, quote }] },
        },
        {
          ...section,
          suggestion: {
            ...revision,
            citations: [
              citation,
              { source: selected.id, quote: "400 carers attended" },
            ],
          },
        },
        { ...section, word_limit: 3 },
        { ...section, character_limit: 12 },
        { ...section, suggestion: { ...revision, answer: original } },
        {
          ...section,
          answer: "A complete and newly invented answer.",
          coverage: "complete",
        },
      ],
    });
    const inputs = { reviewExistingDraft: true, documentIds: [selected.id] };
    const preflight = await call(inputs);
    expect(preflight.status).toBe(200);
    const response = await call({
      ...inputs,
      ...(await preflight.json()),
      draftStage: "generate",
    });
    expect(response.status).toBe(200);
    const { draft } = await response.json();
    expect(draft.evidence_sources).toEqual([selected]);
    expect(draft.application_text).toBe(original);
    expect(draft.sections[0]).toMatchObject({
      answer: original,
      evidence: [],
      coverage: "partial",
      suggestion: {
        answer: revision.answer,
        evidence: [`Delivery review.pdf, p. 2 · “${quote}”`],
      },
    });
    for (const remaining of draft.sections.slice(1))
      expect(remaining).not.toHaveProperty("suggestion");
    expect(draft.sections.at(-1)).toMatchObject({
      answer: "",
      coverage: "missing",
      evidence: [],
    });
    expect(
      draft.readiness.checks.find(
        (check: { key: string }) => check.key === "evidence",
      ).points,
    ).toBe(0);
    expect(writes).toEqual([{ draft }]);
  });
  it("checks approved profile citations without claiming to have read library files", async () => {
    savedDraft = { application_text: "We organise workshops." };
    mocks.generateJSON.mockResolvedValueOnce({
      documents: [],
      information: [],
    });
    mocks.generateJSON.mockResolvedValueOnce({
      readiness_review: modelReadiness,
      sections: [
        {
          question: "Which organisation runs the workshops?",
          answer: "We organise workshops.",
          coverage: "complete",
          character_limit: 18,
          citations: [
            {
              source: "project.summary",
              quote: "Community gardening workshops",
            },
          ],
          suggestion: {
            answer: "Example Charity.",
            citations: [{ source: "profile.name", quote: "Example Charity" }],
          },
        },
      ],
    });
    const preflight = await call({ reviewExistingDraft: true });
    const response = await call({
      ...(await preflight.json()),
      draftStage: "generate",
      reviewExistingDraft: true,
    });
    expect(response.status).toBe(200);
    const { draft } = await response.json();
    expect(draft.evidence_sources).toEqual([]);
    expect(draft.sections[0]).toMatchObject({
      evidence: ["Project summary · “Community gardening workshops”"],
      suggestion: {
        answer: "Example Charity.",
        evidence: ["Approved profile · name · “Example Charity”"],
      },
    });
    expect(
      draft.readiness.checks.find(
        (check: { key: string }) => check.key === "answers",
      ).points,
    ).toBe(15);
  });
  it.each([null, "2000-01-01", "2099-02-30"])(
    "blocks insurance with missing, expired or invalid expiry (%s) before model access",
    async (expires_on) => {
      documents = [
        { name: "Insurance.pdf", category: "insurance", expires_on },
      ];
      const response = await call();
      expect(response.status).toBe(422);
      expect(JSON.stringify(await response.json())).toContain("expiry date");
      expect(mocks.generateJSON).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
    },
  );
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
          rule: "required",
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
  it("keeps a missing project budget visible in an explicitly incomplete working draft", async () => {
    details.budget_notes = "";
    mocks.generateJSON.mockResolvedValueOnce({
      documents: [],
      information: [
        {
          label: "a project budget",
          source_quote: "A project budget is mandatory.",
          field: "budget",
          rule: "required",
          critical: true,
          missing: true,
        },
      ],
    });
    mocks.generateJSON.mockResolvedValueOnce({
      sections: [
        {
          question: "Describe the activities",
          answer: "Community gardening workshops",
          coverage: "complete",
          evidence: ["Project summary"],
        },
        { question: "Attach a budget", answer: "", coverage: "missing" },
      ],
      readiness_review: {
        criteria: { coverage: "partial", note: "The budget is mandatory." },
        delivery: { coverage: "partial", note: "Workshop dates are pending." },
        budget: {
          coverage: "missing",
          note: "No cost estimates are supplied.",
        },
        suggestions: [
          {
            action:
              "Prepare a balanced project budget with venue and facilitator costs.",
            why: "The funder requires an itemised budget.",
            priority: "required",
            requirement_labels: ["a project budget"],
          },
          {
            action: "List venue and facilitator costs",
            why: "This funds the two main delivery inputs.",
            priority: "recommended",
          },
        ],
      },
    });
    const preflight = await call({ allowIncompleteDraft: true });
    expect(preflight.status).toBe(200);
    const response = await call({
      ...(await preflight.json()),
      draftStage: "generate",
      allowIncompleteDraft: true,
    });
    expect(response.status).toBe(200);
    const { draft } = await response.json();
    expect(draft.sections[1].answer).toBe("");
    expect(draft.readiness).toMatchObject({
      score: 46,
      scoreLimit: 69,
      suggestions: [
        {
          action:
            "Prepare a balanced project budget with venue and facilitator costs.",
          priority: "required",
        },
        { action: "List venue and facilitator costs", priority: "recommended" },
      ],
    });
    expect(writes).toContainEqual(expect.objectContaining({ draft }));
  });
  it("keeps the required insurance gate for incomplete draft requests", async () => {
    documents = [];
    expect((await call({ allowIncompleteDraft: true })).status).toBe(422);
    expect(mocks.generateJSON).not.toHaveBeenCalled();
  });
  it("assesses exact saved text while reporting missing mandatory evidence", async () => {
    savedDraft = {
      application_text:
        "My original workshop description.\n\nDates are pending.",
    };
    documents = [];
    mocks.generateJSON.mockResolvedValueOnce({
      documents: [requirement()],
      information: [],
    });
    mocks.generateJSON.mockResolvedValueOnce({
      readiness_review: modelReadiness,
      sections: [
        {
          question: "Describe the activities",
          answer: "My original workshop description.",
          coverage: "complete",
        },
      ],
    });
    const preflight = await call({ reviewExistingDraft: true });
    expect(preflight.status).toBe(200);
    const receipt = await preflight.json();
    const response = await call({
      ...receipt,
      draftStage: "generate",
      reviewExistingDraft: true,
    });
    expect(response.status).toBe(200);
    const { draft } = await response.json();
    expect(draft.application_text).toBe(savedDraft.application_text);
    expect(draft.readiness).toMatchObject({
      scoreLimit: 69,
      suggestions: [
        { action: "Upload public liability insurance.", priority: "required" },
      ],
    });
    expect((await call({ ...receipt, draftStage: "generate" })).status).toBe(
      422,
    );
    expect(writes).toContainEqual(expect.objectContaining({ draft }));
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
          rule: "optional",
        }),
      ],
      information: [],
    });
    mocks.generateJSON.mockResolvedValueOnce({
      readiness_review: modelReadiness,
      sections: [
        {
          question: "Describe activities",
          coverage: "partial",
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
      readiness_review: modelReadiness,
      sections: [
        {
          question: "Describe activities",
          coverage: "partial",
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
