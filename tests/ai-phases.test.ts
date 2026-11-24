import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  generateContent: vi.fn(),
  rpc: vi.fn(),
  write: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM" },
}));
import handler from "../netlify/functions/ai";
import { AIExecutionError } from "../netlify/functions/lib/ai-runtime";
const orgId = "6a03978d-6266-46b6-b35e-bf8069e50743",
  grantId = "6a03978d-6266-46b6-b35e-bf8069e50744",
  appId = "6a03978d-6266-46b6-b35e-bf8069e50745";
const source = "https://www.grants.gov.au/public-program";
let org: Record<string, unknown>,
  grant: Record<string, unknown>,
  application: Record<string, unknown>,
  actor: string,
  role: string,
  documents: Record<string, unknown>[];
function db() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: actor } }, error: null }),
    },
    rpc: mocks.rpc,
    from(table: string) {
      let operation = "select",
        patch: Record<string, unknown> = {};
      const filters = new Map<string, unknown>();
      let allowedStatuses: string[] | undefined;
      const result = (single: boolean) => {
        if (
          table === "applications" &&
          operation === "update" &&
          (filters.get("updated_at") !== application.updated_at ||
            !allowedStatuses?.includes(String(application.status)))
        )
          return { data: null, error: null };
        if (operation !== "select") mocks.write({ table, operation, patch });
        if (table === "organization_members")
          return { data: { role }, error: null };
        if (table === "organizations") return { data: org, error: null };
        if (table === "documents") return { data: documents, error: null };
        if (table === "applications")
          return { data: { ...application, ...patch }, error: null };
        if (table === "opportunities")
          return {
            data:
              operation === "insert"
                ? { ...patch, id: "new-opportunity" }
                : single
                  ? grant
                  : [],
            error: null,
          };
        throw Error("Unexpected table");
      };
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => {
          filters.set(key, value);
          return chain;
        },
        in: (key: string, values: string[]) => {
          if (key === "status") allowedStatuses = values;
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        single: async () => result(true),
        maybeSingle: async () => result(true),
        insert: (value: Record<string, unknown>) => {
          operation = "insert";
          patch = value;
          return chain;
        },
        update: (value: Record<string, unknown>) => {
          operation = "update";
          patch = value;
          return chain;
        },
        then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result(false)).then(resolve),
      };
      return chain;
    },
  };
}
function call(extra: Record<string, unknown> = {}) {
  return handler(
    new Request("https://simplegrants.com.au/api/ai", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-session",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orgId, action: "discover", ...extra }),
    }),
  );
}
function model(data: unknown) {
  mocks.generateContent.mockResolvedValueOnce({ text: JSON.stringify(data) });
}
function grounded(
  uri = source,
  text = "Source-backed community grant. Confirm provider eligibility.",
  additional: string[] = [],
  retrieved: string[] = [],
) {
  mocks.generateContent.mockResolvedValueOnce({
    text,
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: [uri, ...additional].map((link) => ({
            web: { title: "Provider", uri: link },
          })),
        },
        urlContextMetadata: {
          urlMetadata: retrieved.map((retrievedUrl) => ({
            retrievedUrl,
            urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS",
          })),
        },
      },
    ],
  });
}
function search() {
  for (const lane of ["local", "sector", "foundations"])
    grounded(
      source,
      `Source-backed ${lane} grant. Confirm provider eligibility.`,
    );
}
function validDraft() {
  return {
    title: "Community garden",
    sections: [
      {
        question: "Describe the project",
        answer: "Four community gardening workshops.",
        word_limit: 100,
        coverage: "partial",
        evidence: ["Project brief"],
        needs_review: true,
      },
    ],
    budget: [
      {
        item: "Garden supplies",
        amount: 1000,
        notes: "Recorded project budget",
      },
    ],
    readiness_review: {
      criteria: { coverage: "partial", note: "Project scope needs review." },
      delivery: {
        coverage: "partial",
        note: "Workshop dates need confirmation.",
      },
      budget: { coverage: "partial", note: "Some costs are estimates." },
      suggestions: [],
    },
    missing_information: [],
    submission_checklist: ["Authorised review"],
    human_review_required: true,
  };
}
async function preflight() {
  model({ documents: [], information: [] });
  const response = await call({
    action: "draft",
    draftStage: "preflight",
    opportunityId: grantId,
    applicationId: appId,
  });
  expect(response.status).toBe(200);
  return response.json();
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_ANON_KEY", "public-key");
  vi.stubEnv("GEMINI_API_KEY", "model-key");
  vi.stubEnv(
    "AUTH_RATE_LIMIT_SECRET",
    "bdc425cd51fca0d1e84bc137295ec5ab159a0f9c5dabfcae986af53c7184b25d",
  );
  vi.stubEnv("GEMINI_MODEL", "gemini-flash-latest");
  actor = "actor-one";
  role = "member";
  documents = [];
  org = {
    id: orgId,
    name: "Community Club",
    abn: null,
    type: "Community organisation",
    state: "Victoria",
    description: "Local community workshops",
    focus_areas: ["Community"],
    profile: {
      name: "Community Club",
      description: "Local community workshops",
    },
    verification_status: "approved",
  };
  grant = {
    id: grantId,
    org_id: orgId,
    title: "Community grant",
    funder: "Provider",
    guidelines_text:
      "Applicants must describe the planned community activities and provide an accurate project budget. Outcomes must be based on the project proposal.",
    requirements: [],
  };
  application = {
    id: appId,
    org_id: orgId,
    opportunity_id: grantId,
    status: "draft",
    updated_at: "2026-11-11T00:00:00.000Z",
    project_details: {
      summary: "Four community gardening workshops",
      budget_notes: "Garden supplies $1000",
      application_questions:
        "Describe your project (100 words) and list the budget.",
    },
  };
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.createClient.mockReturnValue(db());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("signed, separate grant discovery phases", () => {
  it("uses the Melbourne calendar day for grounded search across UTC midnight", async () => {
    vi.setSystemTime(new Date("2026-11-16T13:30:00Z"));
    search();
    expect((await call({ discoveryStage: "search" })).status).toBe(200);
    const parameters = mocks.generateContent.mock.calls[0][0];
    expect(parameters.contents).toContain("2026-11-17 in Australia/Melbourne");
    expect(parameters.config.systemInstruction).toContain(
      "2026-11-17 in Australia/Melbourne",
    );
  });
  it("gives a search-specific timeout message without document advice", async () => {
    mocks.generateContent.mockRejectedValue(
      Object.assign(new Error("deadline"), { status: 504 }),
    );
    const response = await call({ discoveryStage: "search" });
    expect(response.status).toBe(504);
    const body = await response.json();
    expect(body.error).toContain("grant search took too long");
    expect(body.error).not.toContain("documents");
    const request = mocks.generateContent.mock.calls[0][0];
    expect(request.config.maxOutputTokens).toBe(6144);
    expect(request.contents).toContain("Search lane local");
  });
  it("searches in three lanes, rechecks the shortlist, then saves from the verified source", async () => {
    search();
    const first = await call({ discoveryStage: "search" });
    const state = await first.json();
    expect(first.status).toBe(200);
    expect(state.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(state.stageIssuedAt).toBe(Date.now());
    expect(state.searchDraft).toMatchObject({
      phase: "search",
      completed_lanes: 3,
      failed_lanes: 0,
      sources: [{ uri: source }],
    });
    expect(mocks.generateContent).toHaveBeenCalledTimes(3);
    expect(mocks.write).not.toHaveBeenCalled();
    const verifiedSource = "https://funder.example.au/current-program/2027";
    grounded(
      verifiedSource,
      "The provider lists this 2027 round and close date.",
    );
    const verified = await call({ discoveryStage: "verify", ...state });
    expect(verified.status).toBe(200);
    const verifiedState = await verified.json();
    expect(verifiedState.searchDraft).toMatchObject({
      phase: "verified",
      sources: [{ uri: verifiedSource }],
    });
    expect(mocks.generateContent).toHaveBeenCalledTimes(4);
    expect(mocks.write).not.toHaveBeenCalled();
    model({
      opportunities: [
        {
          title: "Community Grant 2027",
          funder: "Provider",
          summary: "Upcoming source-backed round; confirm eligibility",
          source_index: 0,
          opens_on: "2027-01-01",
          closes_at: "2027-02-01T17:00:00+11:00",
          round_status: "upcoming",
          fit: "potential",
          amount_min: null,
          amount_max: 10000,
        },
      ],
    });
    const second = await call({ discoveryStage: "extract", ...verifiedState });
    expect(second.status).toBe(200);
    expect((await second.json()).opportunities).toMatchObject([
      {
        source_url: verifiedSource,
        opens_on: null,
        closes_at: null,
        provenance: {
          round_status: "unknown",
          round_status_check_required: true,
          fit: "check",
          closing_date: null,
          deadline_note:
            "Check the current round and dates in the funder's application form.",
          sources: [{ uri: verifiedSource }],
        },
      },
    ]);
    expect(mocks.generateContent).toHaveBeenCalledTimes(5);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(
      mocks.generateContent.mock.calls.map(([request]) => request.model),
    ).toEqual(Array(5).fill("gemini-flash-latest"));
    expect(mocks.rpc.mock.calls).toEqual([
      ["claim_ai_request", { p_org_id: orgId, p_action: "discover" }],
      ["claim_ai_request", { p_org_id: orgId, p_action: "discover" }],
      ["claim_ai_request", { p_org_id: orgId, p_action: "discover" }],
    ]);
    expect(
      mocks.generateContent.mock.calls[4][0].config.responseSchema,
    ).toHaveProperty("properties.opportunities");
  });
  it("preserves successful lanes when another lane lacks grounding", async () => {
    grounded(source, "Local round");
    mocks.generateContent.mockResolvedValueOnce({
      text: "Uncited recommendations",
    });
    grounded("https://funder.example.au/foundation", "Foundation round");
    const response = await call({ discoveryStage: "search" });
    expect(response.status).toBe(200);
    expect((await response.json()).searchDraft).toMatchObject({
      phase: "search",
      completed_lanes: 2,
      failed_lanes: 1,
      sources: [
        { uri: source },
        { uri: "https://funder.example.au/foundation" },
      ],
    });
  });
  it("retrieves concrete provider pages and excludes generic or superseded citations and incompatible work", async () => {
    const portal = "https://council.smartygrants.com.au/";
    const oldForm = "https://council.example.au/2024-application-preview.pdf";
    const actual = "https://council.smartygrants.com.au/CommunityRound2027";
    for (const _lane of ["local", "sector", "foundations"])
      grounded(portal, "Provider leads", [oldForm, actual]);
    const preliminary = await call({ discoveryStage: "search" });
    expect(preliminary.status).toBe(200);
    grounded(
      portal,
      "The portal links the current official round.",
      [oldForm, actual],
      [portal, oldForm, actual],
    );
    const response = await call({
      discoveryStage: "verify",
      ...(await preliminary.json()),
    });
    expect(response.status).toBe(200);
    const verified = await response.json();
    expect(verified.searchDraft.sources).toEqual([
      { title: "Provider", uri: actual, retrieved: true },
    ]);
    const request = mocks.generateContent.mock.calls[3][0];
    expect(request.config.tools).toEqual([
      { googleSearch: {} },
      { urlContext: {} },
    ]);
    expect(request.contents).toContain(`\n${actual}\n`);
    expect(request.contents).not.toContain(oldForm);
    expect(request.contents).not.toContain(`\n${portal}\n`);

    model({
      opportunities: [
        {
          title: "Physical works only",
          funder: "Provider",
          summary: "The location fits, but funding only covers construction",
          source_index: 0,
          round_status: "open",
          fit: "potential",
          project_fit: "ineligible",
        },
        {
          title: "Community workshops",
          funder: "Provider",
          summary: "Workshops are eligible",
          source_index: 0,
          round_status: "open",
          fit: "potential",
          project_fit: "supported",
          closing_date: "2027-01-31",
          closes_at: "2027-01-31T17:00:00+11:00",
        },
        {
          title: "Program with disputed application dates",
          funder: "Provider",
          summary: "Workshops are eligible",
          source_index: 0,
          round_status: "open",
          closing_date: "2027-01-31",
          closes_at: "2027-01-31T17:00:00+11:00",
          date_conflict: true,
          deadline_note:
            "The application form and funder disagree on the date.",
        },
      ],
    });
    const extracted = await call({ discoveryStage: "extract", ...verified });
    expect(extracted.status).toBe(200);
    expect((await extracted.json()).opportunities).toMatchObject([
      {
        title: "Community workshops",
        source_url: actual,
        closes_at: "2027-01-31T06:00:00.000Z",
        provenance: { sources: [{ uri: actual, retrieved: true }] },
      },
      {
        title: "Program with disputed application dates",
        closes_at: null,
        provenance: {
          closing_date: null,
          date_review_required: true,
          deadline_note:
            "The application form and funder disagree on the date.",
        },
      },
    ]);
  });
  it.each([
    Object.assign(new Error("Unsupported tool combination"), { status: 400 }),
    new AIExecutionError("timeout"),
  ])(
    "checks exact URLs when combined verification fails within budget",
    async (error) => {
      search();
      const first = await call({ discoveryStage: "search" });
      expect(first.status).toBe(200);
      mocks.generateContent.mockRejectedValueOnce(error);
      grounded(source, "Retrieved current form", [], [source]);
      const checked = await call({
        discoveryStage: "verify",
        ...(await first.json()),
      });
      expect(checked.status).toBe(200);
      expect(mocks.generateContent.mock.calls[4][0].config.tools).toEqual([
        { urlContext: {} },
      ]);
      expect((await checked.json()).searchDraft.sources).toMatchObject([
        { uri: source, retrieved: true },
      ]);
    },
  );
  it("omits hard DGR mismatches and keeps a disputed time as a date-only auspice lead", async () => {
    org.profile = {
      name: "Community Club",
      source_evidence: [{ quote: "Private association evidence" }],
      grant_setup: {
        version: 1,
        answers: {
          dgr_endorsed: { status: "confirmed", value: false },
          service_locations: { status: "confirmed", value: ["Warrandyte"] },
          financial_controls: {
            status: "confirmed",
            value: "Private bank details",
          },
        },
      },
    };
    search();
    const first = await call({ discoveryStage: "search" });
    const state = await first.json();
    expect(first.status).toBe(200);
    const localPrompt = mocks.generateContent.mock.calls[0][0].contents;
    expect(localPrompt).toContain('"dgr_endorsed":false');
    expect(localPrompt).toContain("Warrandyte");
    expect(localPrompt).not.toContain("Private");
    grounded(source, "Retrieved current funder page", [], [source]);
    const verified = await call({ discoveryStage: "verify", ...state });
    const verifiedState = await verified.json();
    expect(verified.status).toBe(200);
    model({
      opportunities: [
        {
          title: "Direct DGR round",
          funder: "Provider",
          summary: "Direct DGR eligibility",
          source_index: 0,
          dgr_requirement: "direct",
          fit: "potential",
          round_status: "open",
        },
        {
          title: "Eligible auspice round",
          funder: "Provider",
          summary: "An eligible auspice can apply",
          source_index: 0,
          dgr_requirement: "auspice_allowed",
          fit: "potential",
          round_status: "open",
          closing_date: "2027-01-31",
          closes_at: "2027-01-31T17:00:00+11:00",
          deadline_conflict: true,
          deadline_note: "Two official pages show different closing times.",
        },
      ],
    });
    const response = await call({
      discoveryStage: "extract",
      ...verifiedState,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).opportunities).toMatchObject([
      {
        title: "Eligible auspice round",
        closes_at: null,
        provenance: {
          closing_date: "2027-01-31",
          deadline_note: "Two official pages show different closing times.",
          date_review_required: true,
          fit: "check",
          fit_note: "Confirm an eligible auspice before applying.",
        },
      },
    ]);
  });
  it.each([
    "state",
    "actor",
    "org",
    "original",
    "expired",
    "future",
    "signature",
  ])(
    "rejects modified/expired search continuation %s before a model or write",
    async (what) => {
      search();
      const state = await (await call({ discoveryStage: "search" })).json();
      if (what === "state") state.searchDraft.summary = "Tampered search";
      if (what === "actor") actor = "another-member";
      if (what === "org") org.id = "6a03978d-6266-46b6-b35e-bf8069e50746";
      if (what === "original") org.description = "Changed focus";
      if (what === "expired") await vi.advanceTimersByTimeAsync(900001);
      if (what === "future") state.stageIssuedAt = Date.now() + 1;
      if (what === "signature") state.sourceFingerprint = "0".repeat(64);
      const response = await call({
        discoveryStage: "extract",
        ...state,
        ...(what === "org" ? { orgId: org.id } : {}),
      });
      expect(response.status).toBe(409);
      expect(mocks.generateContent).toHaveBeenCalledTimes(3);
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );
  it("rejects old unstaged clients and malformed source state without invoking the provider", async () => {
    expect((await call()).status).toBe(422);
    expect(
      (
        await call({
          discoveryStage: "extract",
          searchDraft: {
            summary: "private",
            sources: [{ title: "x", uri: "javascript:alert(1)" }],
          },
        })
      ).status,
    ).toBe(400);
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });
  it("rechecks membership on the second phase", async () => {
    search();
    const state = await (await call({ discoveryStage: "search" })).json();
    role = "viewer";
    expect((await call({ discoveryStage: "extract", ...state })).status).toBe(
      403,
    );
    expect(mocks.generateContent).toHaveBeenCalledTimes(3);
  });
});
describe("signed, separate application preparation", () => {
  it("reuses approved expanded organisation evidence through preflight and drafting", async () => {
    org.profile = {
      ...(org.profile as object),
      mission: "Prevent abuse through child safeguarding education",
      beneficiaries: ["Children and families"],
      history: "A documented organisation history",
      activities: [
        {
          name: "Educational workshops",
          status: "current",
          source: "Synthetic annual report",
        },
      ],
      charity_registration_date: "2026-06-19",
      source_evidence: [
        { field: "history", quote: "REJECTED-EXTRACTION-CANDIDATE" },
      ],
      review_notes: [{ field: "history", issue: "UNRESOLVED-REVIEW-FINDING" }],
      insurance_policies: [
        {
          insurer: "Synthetic insurer",
          policy_type: "Public liability",
          policy_number: "SYNTHETIC-PRIVATE-POLICY",
          expires_on: "2027-06-19",
        },
      ],
    };
    const state = await preflight();
    model(validDraft());
    const response = await call({
      action: "draft",
      draftStage: "generate",
      opportunityId: grantId,
      applicationId: appId,
      ...state,
    });
    expect(response.status).toBe(200);
    for (const [parameters] of mocks.generateContent.mock.calls) {
      const prompt = JSON.stringify(parameters.contents);
      expect(prompt).toContain(
        "Prevent abuse through child safeguarding education",
      );
      expect(prompt).toContain("Educational workshops");
      expect(prompt).toContain("2026-06-19");
      expect(prompt).toContain("SYNTHETIC-PRIVATE-POLICY");
      expect(prompt).not.toContain("REJECTED-EXTRACTION-CANDIDATE");
      expect(prompt).not.toContain("UNRESOLVED-REVIEW-FINDING");
      expect(parameters.config.systemInstruction).toContain(
        "Australia/Melbourne",
      );
      expect(parameters.config.systemInstruction).toContain("2026-11-11");
    }
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "SYNTHETIC-PRIVATE-POLICY",
    );
  });
  it("performs one preflight with no write and one generation with checked final output", async () => {
    const state = await preflight();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
    const prompt = JSON.stringify(
      mocks.generateContent.mock.calls[0][0].contents,
    );
    expect(prompt).toContain("APPROVED ORGANISATION PROFILE");
    expect(prompt).toContain(
      (org.profile as { description: string }).description,
    );
    expect(prompt).toContain(
      "does not establish project-specific community need",
    );

    model(validDraft());
    const response = await call({
      action: "draft",
      draftStage: "generate",
      opportunityId: grantId,
      applicationId: appId,
      ...state,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).draft.human_review_required).toBe(true);
    expect(mocks.generateContent).toHaveBeenCalledTimes(2);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.generateContent.mock.calls[0][0].model).toBe(
      "gemini-flash-latest",
    );
    expect(mocks.generateContent.mock.calls[1][0]).toMatchObject({
      model: "gemini-4-neon",
      config: {
        thinkingConfig: { thinkingLevel: "LOW" },
        maxOutputTokens: 16_384,
      },
    });
    expect(mocks.generateContent.mock.calls[1][0].config).not.toHaveProperty(
      "temperature",
    );
    expect(
      mocks.generateContent.mock.calls[0][0].config.responseSchema,
    ).toHaveProperty("properties.documents");
    expect(
      mocks.generateContent.mock.calls[1][0].config.responseSchema,
    ).toHaveProperty("properties.sections");
  });
  it.each([
    "requirements",
    "guidelines",
    "project",
    "documents",
    "profile",
    "actor",
    "expired",
  ])(
    "rejects stale/tampered draft continuation %s before generation",
    async (what) => {
      const state = await preflight();
      if (what === "requirements")
        state.draftRequirements.documents = [
          {
            label: "invented",
            source_quote: "Unrelated invented source sentence",
            category: "other",
            mandatory: false,
            conditional: false,
            condition_applies: false,
          },
        ];
      if (what === "guidelines")
        grant.guidelines_text += " New assessment rule.";
      if (what === "project")
        application.project_details = {
          ...(application.project_details as object),
          budget_notes: "Changed to $2000",
        };
      if (what === "documents")
        documents = [
          {
            id: "new-evidence",
            name: "New.txt",
            category: "other",
            size_bytes: 10,
            storage_path: "new",
          },
        ];
      if (what === "profile") org.profile = { name: "Changed legal name" };
      if (what === "actor") actor = "another-member";
      if (what === "expired") await vi.advanceTimersByTimeAsync(900001);
      const response = await call({
        action: "draft",
        draftStage: "generate",
        opportunityId: grantId,
        applicationId: appId,
        ...state,
      });
      expect(response.status).toBe(409);
      expect(mocks.generateContent).toHaveBeenCalledTimes(1);
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );
  it("rechecks explicit insurance requirements before either model phase", async () => {
    grant.guidelines_text +=
      " Applications without current insurance are ineligible.";
    const response = await call({
      action: "draft",
      draftStage: "preflight",
      opportunityId: grantId,
      applicationId: appId,
    });
    expect(response.status).toBe(422);
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("preserves a concurrent submission instead of resetting it to an AI draft", async () => {
    const state = await preflight();
    let release: (value: unknown) => void = () => {};
    mocks.generateContent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = call({
      action: "draft",
      draftStage: "generate",
      opportunityId: grantId,
      applicationId: appId,
      ...state,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.generateContent).toHaveBeenCalledTimes(2);
    application = {
      ...application,
      status: "submitted",
      updated_at: "2026-11-11T00:00:01.000Z",
      draft: { manual_text: "Concurrent reviewed submission" },
    };
    release({ text: JSON.stringify(validDraft()) });
    const response = await pending;
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("preserved");
    expect(application.status).toBe("submitted");
    expect(application.draft).toEqual({
      manual_text: "Concurrent reviewed submission",
    });
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("keeps the saved application when a provider omits its readiness assessment", async () => {
    const state = await preflight();
    const { readiness_review, ...withoutReview } = validDraft();
    model(withoutReview);
    const response = await call({
      action: "draft",
      draftStage: "generate",
      opportunityId: grantId,
      applicationId: appId,
      ...state,
    });
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("SG_AI_RESPONSE");
    expect(
      mocks.generateContent.mock.calls[1][0].config.responseSchema.required,
    ).toContain("readiness_review");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("never writes malformed generated applications", async () => {
    const state = await preflight();
    model({ sections: [] });
    const response = await call({
      action: "draft",
      draftStage: "generate",
      opportunityId: grantId,
      applicationId: appId,
      ...state,
    });
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("SG_AI_RESPONSE");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("discards late generation after its deadline without automatic retries or writes", async () => {
    const state = await preflight();
    let release: (value: unknown) => void = () => {};
    mocks.generateContent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = call({
      action: "draft",
      draftStage: "generate",
      opportunityId: grantId,
      applicationId: appId,
      ...state,
    });
    await vi.advanceTimersByTimeAsync(25000);
    const response = await pending;
    expect(response.status).toBe(504);
    expect((await response.json()).code).toBe("SG_AI_TIMEOUT");
    release({ text: JSON.stringify(validDraft()) });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.generateContent).toHaveBeenCalledTimes(2);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
describe("bounded structured model reliability", () => {
  it("logs only safe usage counters and resolved model version when output is exhausted", async () => {
    mocks.generateContent.mockResolvedValueOnce({
      text: "PRIVATE-OUTPUT",
      candidates: [{ finishReason: "MAX_TOKENS" }],
      modelVersion: "gemini-3-flash-preview",
      usageMetadata: {
        candidatesTokenCount: 100,
        thoughtsTokenCount: 3000,
        promptTokenCount: 999,
      },
    });
    const response = await call({
      action: "profile",
      profileStage: "extract",
      text: "Original source",
      documentIds: [],
    });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe("SG_AI_OUTPUT_LIMIT");
    expect(body.error).toContain("response length limit");
    expect(console.error).toHaveBeenCalledWith(
      "Simple Grants AI step unavailable",
      expect.objectContaining({
        reference: body.reference,
        inputTokens: 999,
        outputTokens: 100,
        thinkingTokens: 3000,
        tokenLimit: 16384,
        modelVersion: "gemini-3-flash-preview",
      }),
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "PRIVATE-OUTPUT",
    );
  });
  it("applies the configured concrete model's thinking controls to extraction and grounded search", async () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash");
    model({ profile: { name: "Community Club" } });
    expect(
      (
        await call({
          action: "profile",
          profileStage: "extract",
          text: "Original registration",
        })
      ).status,
    ).toBe(200);
    search();
    expect((await call({ discoveryStage: "search" })).status).toBe(200);
    for (const [request] of mocks.generateContent.mock.calls) {
      expect(request.model).toBe("gemini-2.5-flash");
      expect(request.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    }
  });
  it.each([
    Object.assign(new Error("private provider payload"), { status: 503 }),
    new Error("SDK wrapper", { cause: { status: 502 } }),
    new Error(
      "exception TypeError: fetch failed sending request private-canary",
    ),
  ])(
    "recovers once from a quick transient failure within the same quota claim",
    async (error) => {
      mocks.generateContent.mockRejectedValueOnce(error);
      model({ profile: { name: "Community Club" } });
      const pending = call({
        action: "profile",
        profileStage: "extract",
        text: "Original registration",
      });
      await vi.advanceTimersByTimeAsync(250);
      const response = await pending;
      expect(response.status).toBe(200);
      expect((await response.json()).profileDraft.name).toBe("Community Club");
      expect(mocks.generateContent).toHaveBeenCalledTimes(2);
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(mocks.write).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    },
  );
  it("never retries more than once and logs a fixed network category without the SDK payload", async () => {
    mocks.generateContent.mockRejectedValue(
      new Error("fetch failed PRIVATE-NETWORK-CANARY"),
    );
    const pending = call({
      action: "profile",
      profileStage: "extract",
      text: "Original registration",
    });
    await vi.advanceTimersByTimeAsync(250);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(mocks.generateContent).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      "Simple Grants AI step unavailable",
      expect.objectContaining({ failureReason: "NETWORK" }),
    );
    expect(JSON.stringify(await response.json())).not.toContain(
      "PRIVATE-NETWORK-CANARY",
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "PRIVATE-NETWORK-CANARY",
    );
  });
  it.each([400, 401, 403, 404, 429, 504])(
    "does not retry provider status %s",
    async (status) => {
      mocks.generateContent.mockRejectedValue(
        Object.assign(new Error("private"), { status }),
      );
      await call({
        action: "profile",
        profileStage: "extract",
        text: "Original registration",
      });
      expect(mocks.generateContent).toHaveBeenCalledTimes(1);
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );
  it("does not retry a late transient failure with insufficient request time remaining", async () => {
    mocks.generateContent.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(
            () =>
              reject(Object.assign(new Error("late failure"), { status: 503 })),
            21000,
          );
        }),
    );
    const pending = call({
      action: "profile",
      profileStage: "extract",
      text: "Original registration",
    });
    await vi.advanceTimersByTimeAsync(21000);
    expect((await pending).status).toBe(503);
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  });
  it("retries draft generation without repeating preflight, quota claims or the application write", async () => {
    const state = await preflight();
    mocks.generateContent.mockRejectedValueOnce(
      Object.assign(new Error("transient"), { status: 503 }),
    );
    model(validDraft());
    const pending = call({
      action: "draft",
      draftStage: "generate",
      opportunityId: grantId,
      applicationId: appId,
      ...state,
    });
    await vi.advanceTimersByTimeAsync(250);
    expect((await pending).status).toBe(200);
    expect(mocks.generateContent).toHaveBeenCalledTimes(3);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("allows a genuine20s single pass that the old18s limit killed", async () => {
    mocks.generateContent.mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                text: JSON.stringify({
                  profile: {
                    name: "Community Club",
                    abn: null,
                    acnc_registered: null,
                  },
                }),
              }),
            20000,
          ),
        ),
    );
    const pending = call({
      action: "profile",
      profileStage: "extract",
      text: "Original community registration",
      documentIds: [],
    });
    await vi.advanceTimersByTimeAsync(20000);
    const response = await pending;
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.profileDraft.name).toBe("Community Club");
    expect(result.profileDraft).not.toHaveProperty("abn");
    expect(result.profileDraft).not.toHaveProperty("acnc_registered");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("supports bilingual text and unknown optional nulls with a targeted provider schema", async () => {
    model({
      profile: {
        name: "社區中心 Community Club",
        legal_name: null,
        abn: null,
        description: "支持本地社區。 Supporting the community.",
        focus_areas: null,
        acnc_registered: null,
      },
      evidence: [],
    });
    const response = await call({
      action: "profile",
      profileStage: "extract",
      text: "原始文件 — Community registration",
      documentIds: [],
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.profileDraft.name).toContain("社區中心");
    expect(result.profileDraft).not.toHaveProperty("acnc_registered");
    const configuration = mocks.generateContent.mock.calls[0][0].config;
    expect(configuration.responseSchema).toHaveProperty("properties.profile");
    expect(configuration.responseSchema.properties).not.toHaveProperty(
      "missing_information",
    );
    expect(configuration.maxOutputTokens).toBe(16384);
    expect(configuration).not.toHaveProperty("thinkingConfig");
  });
  it.each([
    { model: "gemini-2.5-flash", thinking: { thinkingBudget: 0 } },
    { model: "gemini-3-flash-preview", thinking: { thinkingLevel: "MINIMAL" } },
    { model: "gemini-3.8-flash", thinking: { thinkingLevel: "LOW" } },
  ])(
    "uses thinking controls only for the known compatible $model",
    async ({ model: identifier, thinking }) => {
      vi.stubEnv("GEMINI_MODEL", identifier);
      model({ profile: { name: "Community Club" } });
      expect(
        (
          await call({
            action: "profile",
            profileStage: "extract",
            text: "Original registration",
            documentIds: [],
          })
        ).status,
      ).toBe(200);
      expect(
        mocks.generateContent.mock.calls[0][0].config.thinkingConfig,
      ).toEqual(thinking);
    },
  );
  it.each([
    {
      result: { text: "{}", candidates: [{ finishReason: "MAX_TOKENS" }] },
      reason: "MODEL_OUTPUT_LIMIT",
      code: "SG_AI_OUTPUT_LIMIT",
    },
    { result: { text: "" }, reason: "EMPTY_TEXT" },
    { result: { text: "PRIVATE-CANARY-NOT-JSON" }, reason: "INVALID_JSON" },
    {
      result: { text: JSON.stringify({ profile: { abn: null } }) },
      reason: "SCHEMA_MISMATCH",
    },
  ])(
    "logs only bounded output failure reason $reason",
    async ({ result, reason, code = "SG_AI_RESPONSE" }) => {
      mocks.generateContent.mockResolvedValueOnce(result);
      const response = await call({
        action: "profile",
        profileStage: "extract",
        text: "Original registration",
        documentIds: [],
      });
      const body = await response.json();
      expect(response.status).toBe(502);
      expect(body.code).toBe(code);
      expect(console.error).toHaveBeenCalledWith(
        "Simple Grants AI step unavailable",
        expect.objectContaining({ failureReason: reason }),
      );
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
        "PRIVATE-CANARY-NOT-JSON",
      );
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );
  it("recognises wrapped SDK timeout errors without leaking their text", async () => {
    const canary = "PRIVATE-EMAIL-TOKEN-KEY-CANARY";
    mocks.generateContent.mockRejectedValueOnce(
      new Error(`Request timed out. ${canary}`),
    );
    const response = await call({
      action: "profile",
      profileStage: "extract",
      text: "Original registration",
      documentIds: [],
    });
    const result = await response.json();
    expect(response.status).toBe(504);
    expect(result.code).toBe("SG_AI_TIMEOUT");
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      canary,
    );
  });
});
