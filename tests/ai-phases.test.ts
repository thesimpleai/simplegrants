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
  ThinkingLevel: { MINIMAL: "MINIMAL" },
}));
import handler from "../netlify/functions/ai";
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
function search() {
  mocks.generateContent.mockResolvedValueOnce({
    text: "Source-backed community grant. Confirm provider eligibility.",
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: [{ web: { title: "Provider", uri: source } }],
        },
      },
    ],
  });
}
function validDraft() {
  return {
    title: "Community garden",
    sections: [
      {
        question: "Describe the project",
        answer: "Four community gardening workshops.",
        word_limit: 100,
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
  it("gives a search-specific timeout message without document advice", async () => {
    mocks.generateContent.mockRejectedValueOnce(
      Object.assign(new Error("deadline"), { status: 504 }),
    );
    const response = await call({ discoveryStage: "search" });
    expect(response.status).toBe(504);
    const body = await response.json();
    expect(body.error).toContain("grant search took too long");
    expect(body.error).not.toContain("documents");
    const request = mocks.generateContent.mock.calls[0][0];
    expect(request.config.maxOutputTokens).toBe(1536);
    expect(request.contents).toContain("up to 3");
  });
  it("uses one call in search without writes, then one extraction call and final scoped insert", async () => {
    search();
    const first = await call({ discoveryStage: "search" });
    const state = await first.json();
    expect(first.status).toBe(200);
    expect(state.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(state.stageIssuedAt).toBe(Date.now());
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
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
          amount_min: null,
          amount_max: 10000,
        },
      ],
    });
    const second = await call({ discoveryStage: "extract", ...state });
    expect(second.status).toBe(200);
    expect((await second.json()).opportunities).toHaveLength(1);
    expect(mocks.generateContent).toHaveBeenCalledTimes(2);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls).toEqual([
      ["claim_ai_request", { p_org_id: orgId, p_action: "discover" }],
      ["claim_ai_request", { p_org_id: orgId, p_action: "discover" }],
    ]);
    expect(
      mocks.generateContent.mock.calls[1][0].config.responseSchema,
    ).toHaveProperty("properties.opportunities");
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
      expect(mocks.generateContent).toHaveBeenCalledTimes(1);
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
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  });
});
describe("signed, separate application preparation", () => {
  it("performs one preflight with no write and one generation with checked final output", async () => {
    const state = await preflight();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
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
    expect(configuration.maxOutputTokens).toBe(4096);
    expect(configuration).not.toHaveProperty("thinkingConfig");
  });
  it.each([
    { model: "gemini-2.5-flash", thinking: { thinkingBudget: 0 } },
    { model: "gemini-3-flash-preview", thinking: { thinkingLevel: "MINIMAL" } },
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
    },
    { result: { text: "" }, reason: "EMPTY_TEXT" },
    { result: { text: "PRIVATE-CANARY-NOT-JSON" }, reason: "INVALID_JSON" },
    {
      result: { text: JSON.stringify({ profile: { abn: null } }) },
      reason: "SCHEMA_MISMATCH",
    },
  ])(
    "logs only bounded output failure reason $reason",
    async ({ result, reason }) => {
      mocks.generateContent.mockResolvedValueOnce(result);
      const response = await call({
        action: "profile",
        profileStage: "extract",
        text: "Original registration",
        documentIds: [],
      });
      const body = await response.json();
      expect(response.status).toBe(502);
      expect(body.code).toBe("SG_AI_RESPONSE");
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
