import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  generateContent: vi.fn(),
  rpc: vi.fn(),
  download: vi.fn(),
  getUser: vi.fn(),
  write: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@google/genai", () => ({
  ThinkingLevel: { LOW: "LOW" },
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
}));
import handler from "../netlify/functions/ai";
import { profileSourceFingerprint } from "../netlify/functions/lib/gemini";
const orgId = "6a03978d-6266-46b6-b35e-bf8069e50743",
  docId = "6a03978d-6266-46b6-b35e-bf8069e50744",
  secondId = "6a03978d-6266-46b6-b35e-bf8069e50745";
const originalText =
  "ORIGINAL PASTED REGISTER: Community Club Incorporated supports community workshops.";
const profileDraft = {
  name: "Community Club",
  description: "Community workshops",
};
const check = {
  field: "name",
  issue: "Check the legal suffix",
  source: "Original registration",
  suggestion: "Community Club Incorporated",
};
let role: string | null,
  fileText: string,
  documents: Record<string, unknown>[],
  reverseDocuments: boolean;
const document = (id = docId) => ({
  id,
  org_id: orgId,
  name: `${id}.txt`,
  category: "registration",
  storage_path: `${orgId}/${id}/registration.txt`,
  mime_type: "text/plain",
  size_bytes: 100,
  verified: false,
  expires_on: null,
});
function fakeDb() {
  return {
    rpc: mocks.rpc,
    auth: { getUser: mocks.getUser },
    storage: { from: () => ({ download: mocks.download }) },
    from(table: string) {
      mocks.from(table);
      const result = () => {
        if (table === "organization_members")
          return { data: role ? { role } : null, error: null };
        if (table === "organizations")
          return {
            data: {
              id: orgId,
              name: "Existing entered name",
              verification_status: "draft",
              profile: {
                name: "Existing entered name",
                description: "STALE-NOT-SOURCE",
              },
            },
            error: null,
          };
        if (table === "documents") {
          reverseDocuments = !reverseDocuments;
          return {
            data: reverseDocuments ? [...documents].reverse() : [...documents],
            error: null,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        single: async () => result(),
        maybeSingle: async () => result(),
        update: (value: unknown) => {
          mocks.write(value);
          return chain;
        },
        insert: (value: unknown) => {
          mocks.write(value);
          return chain;
        },
        then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result()).then(resolve),
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
        Authorization: "Bearer test-user-session",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "profile",
        orgId,
        text: originalText,
        documentIds: [docId],
        ...extra,
      }),
    }),
  );
}
function model(value: unknown) {
  mocks.generateContent.mockResolvedValueOnce({ text: JSON.stringify(value) });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_ANON_KEY", "test-public-key");
  vi.stubEnv("GEMINI_API_KEY", "test-model-key");
  role = "member";
  fileText =
    "ORIGINAL FILE: Community Club Incorporated registration evidence.";
  documents = [document()];
  reverseDocuments = false;
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "member-id" } },
    error: null,
  });
  mocks.download.mockImplementation(async () => ({
    data: new Blob([fileText]),
    error: null,
  }));
  mocks.createClient.mockReturnValue(fakeDb());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("separate authenticated profile stages", () => {
  it("performs exactly one model call per stage, rechecks original sources and only returns an approvable profile after correction", async () => {
    model({ profile: profileDraft, evidence: [] });
    const extractResponse = await call({ profileStage: "extract" });
    const extracted = await extractResponse.json();
    expect(extractResponse.status).toBe(200);
    expect(extracted.profileDraft).toEqual(profileDraft);
    expect(extracted).not.toHaveProperty("profile");
    expect(extracted.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
    model({ checks: [check] });
    const verifyResponse = await call({
      profileStage: "verify",
      profileDraft: extracted.profileDraft,
      sourceFingerprint: extracted.sourceFingerprint,
    });
    const verified = await verifyResponse.json();
    expect(verifyResponse.status).toBe(200);
    expect(verified.profileChecks).toEqual([check]);
    expect(verified).not.toHaveProperty("profile");
    expect(verified.sourceFingerprint).toBe(extracted.sourceFingerprint);
    expect(mocks.generateContent).toHaveBeenCalledTimes(2);
    model({
      profile: { ...profileDraft, name: "Community Club Incorporated" },
      checks: [],
      evidence: [],
    });
    const correctResponse = await call({
      profileStage: "correct",
      profileDraft: verified.profileDraft,
      profileChecks: verified.profileChecks,
      sourceFingerprint: extracted.sourceFingerprint,
    });
    const corrected = await correctResponse.json();
    expect(correctResponse.status).toBe(200);
    expect(corrected.profile.name).toBe("Community Club Incorporated");
    expect(corrected.sourceFingerprint).toBe(extracted.sourceFingerprint);
    expect(mocks.generateContent).toHaveBeenCalledTimes(3);
    expect(mocks.getUser).toHaveBeenCalledTimes(3);
    expect(mocks.download).toHaveBeenCalledTimes(3);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    for (const args of mocks.rpc.mock.calls)
      expect(args).toEqual([
        "claim_ai_request",
        { p_org_id: orgId, p_action: "profile" },
      ]);
    for (const [request] of mocks.generateContent.mock.calls) {
      const parts = request.contents[0].parts as { text?: string }[];
      expect(parts[0].text).toContain(originalText);
      expect(parts.some((part) => part.text?.includes(fileText))).toBe(true);
    }
    for (const [request] of mocks.generateContent.mock.calls.slice(1))
      expect(request.contents[0].parts[0].text).not.toContain(
        "STALE-NOT-SOURCE",
      );
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("keeps the fingerprint stable when database document rows arrive in a different order", async () => {
    documents = [document(), document(secondId)];
    model({ profile: profileDraft });
    const extracted = await (
      await call({ profileStage: "extract", documentIds: [docId, secondId] })
    ).json();
    model({ checks: [] });
    const response = await call({
      profileStage: "verify",
      documentIds: [docId, secondId],
      profileDraft,
      sourceFingerprint: extracted.sourceFingerprint,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).sourceFingerprint).toBe(
      extracted.sourceFingerprint,
    );
    expect(mocks.download.mock.calls.map(([path]) => path)).toEqual([
      document().storage_path,
      document(secondId).storage_path,
      document().storage_path,
      document(secondId).storage_path,
    ]);
  });
  it("rejects changed original file contents or pasted source between stages before another model call", async () => {
    model({ profile: profileDraft });
    const extracted = await (await call({ profileStage: "extract" })).json();
    fileText = "REPLACED SOURCE CONTENT";
    const changedFile = await call({
      profileStage: "verify",
      profileDraft,
      sourceFingerprint: extracted.sourceFingerprint,
    });
    expect(changedFile.status).toBe(409);
    const changedText = await call({
      profileStage: "verify",
      text: originalText + " changed",
      profileDraft,
      sourceFingerprint: extracted.sourceFingerprint,
    });
    expect(changedText.status).toBe(409);
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("detects raw source byte changes even when decoded document text is unchanged", async () => {
    model({ profile: profileDraft });
    const extracted = await (await call({ profileStage: "extract" })).json();
    // The UTF-8 BOM is stripped by text decoding, while the original file bytes differ.
    fileText = "\uFEFF" + fileText;
    const response = await call({
      profileStage: "verify",
      profileDraft,
      sourceFingerprint: extracted.sourceFingerprint,
    });
    expect(response.status).toBe(409);
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  });
  it("requires refreshed clients and validates bounded intermediate state instead of trusting forged fields", async () => {
    expect((await call()).status).toBe(422);
    expect(
      (
        await call({
          profileStage: "verify",
          profileDraft: { ...profileDraft, org_id: "another-org" },
          sourceFingerprint: "a".repeat(64),
        })
      ).status,
    ).toBe(400);
    expect((await call({ profileStage: "verify", profileDraft })).status).toBe(
      409,
    );
    expect(
      (
        await call({
          profileStage: "correct",
          profileDraft,
          profileChecks: Array(301).fill(check),
          sourceFingerprint: "a".repeat(64),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call({
          profileStage: "correct",
          profileDraft,
          profileChecks: [{ ...check, issue: "x".repeat(1501) }],
          sourceFingerprint: "a".repeat(64),
        })
      ).status,
    ).toBe(400);
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(["extract", "verify", "correct"])(
    "rechecks write permission for %s",
    async (profileStage) => {
      role = "viewer";
      expect(
        (
          await call({
            profileStage,
            profileDraft,
            profileChecks: [],
            sourceFingerprint: "a".repeat(64),
          })
        ).status,
      ).toBe(403);
      expect(mocks.generateContent).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it.each(["extract", "verify", "correct"])(
    "rejects financial documents in %s before provider access",
    async (profileStage) => {
      documents[0].category = "audit_report";
      expect(
        (
          await call({
            profileStage,
            profileDraft,
            profileChecks: [],
            sourceFingerprint: "a".repeat(64),
          })
        ).status,
      ).toBe(422);
      expect(mocks.generateContent).not.toHaveBeenCalled();
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );
  it("rejects converted text beyond400k combined without truncating or calling the model", async () => {
    const thirdId = "6a03978d-6266-46b6-b35e-bf8069e50746";
    documents = [document(), document(secondId), document(thirdId)];
    fileText = "x".repeat(150000);
    const response = await call({
      profileStage: "extract",
      documentIds: [docId, secondId, thirdId],
    });
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain(
      "no text has been truncated",
    );
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("accepts converted text at the400k combined boundary", async () => {
    documents = [document(), document(secondId)];
    fileText = "x".repeat(200000);
    model({ profile: profileDraft });
    const response = await call({
      profileStage: "extract",
      documentIds: [docId, secondId],
    });
    expect(response.status).toBe(200);
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  });
  it("accepts bounded verification state larger than the old 160KB limit without altering original text", async () => {
    const text = "Original history. ".repeat(6000);
    const checks = Array.from({ length: 50 }, () => ({
      field: "description",
      issue: "i".repeat(1400),
      source: "s".repeat(400),
      suggestion: "c".repeat(1400),
    }));
    model({ profile: profileDraft, checks: [], evidence: [] });
    const response = await call({
      profileStage: "correct",
      text,
      documentIds: [],
      profileDraft,
      profileChecks: checks,
      sourceFingerprint: profileSourceFingerprint(text, [], [], orgId),
    });
    expect(response.status).toBe(200);
    expect(
      mocks.generateContent.mock.calls[0][0].contents[0].parts[0].text,
    ).toContain(text);
  });
});

describe("source-based grant setup", () => {
  const suggestionText = {
    questionKey: "legal_name",
    textValue: "Community Club Incorporated",
    quote: "Name: Community Club Incorporated",
  };
  function setup(extra: Record<string, unknown> = {}) {
    return call({ action: "setup-source", text: "", ...extra });
  }

  it("returns only evidenced, typed suggestions and never forwards visible credentials from pasted text", async () => {
    const legalName = suggestionText.quote;
    const hours =
      "From 1 July 2024 to 30 June 2025, 1,200 volunteer hours were recorded.";
    const financialCanary = "Bank account number: 123456789";
    const unrelated = "The organisation runs weekly community workshops.";
    const dgrStatus =
      "The organisation is not endorsed as a deductible gift recipient.";
    const dated = {
      value: 1200,
      unit: "hours",
      periodStart: "2024-07-01",
      periodEnd: "2025-06-30",
    };
    model({
      suggestions: [
        suggestionText,
        {
          questionKey: "annual_volunteer_hours",
          metricValue: dated,
          quote: hours,
        },
        {
          questionKey: "annual_volunteer_hours",
          metricValue: { ...dated, value: 100 },
          quote: hours,
        },
        {
          questionKey: "annual_volunteer_hours",
          metricValue: { ...dated, periodStart: "2024-07-02" },
          quote: hours,
        },
        {
          questionKey: "mission",
          textValue: "Invented mission",
          quote: "Invented mission",
        },
        {
          questionKey: "financial_controls",
          textValue: financialCanary,
          quote: financialCanary,
        },
        {
          questionKey: "acnc_registered",
          booleanValue: true,
          quote: unrelated,
        },
        { questionKey: "dgr_endorsed", booleanValue: true, quote: dgrStatus },
        { questionKey: "dgr_endorsed", booleanValue: false, quote: dgrStatus },
      ],
    });
    const response = await setup({
      documentIds: [],
      text: `${legalName}\n${hours}\n${financialCanary}\n${unrelated}\n${dgrStatus}`,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      setupSuggestions: [
        {
          questionKey: "legal_name",
          value: suggestionText.textValue,
          quote: legalName,
          sourceLabel: "Pasted information",
          quoteVerified: true,
        },
        {
          questionKey: "annual_volunteer_hours",
          value: dated,
          quote: hours,
          sourceLabel: "Pasted information",
          quoteVerified: true,
        },
        {
          questionKey: "dgr_endorsed",
          value: false,
          quote: dgrStatus,
          sourceLabel: "Pasted information",
          quoteVerified: true,
        },
      ],
    });
    const prompt = JSON.stringify(
      mocks.generateContent.mock.calls[0][0].contents,
    );
    expect(prompt).toContain(legalName);
    expect(prompt).toContain("[redacted]");
    expect(prompt).not.toContain("123456789");
    expect(prompt).not.toContain("STALE-NOT-SOURCE");
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("claim_ai_request", {
      p_org_id: orgId,
      p_action: "profile",
    });
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("checks one selected document against its own bytes and stamps provenance from the tenant row", async () => {
    const filename = `${docId}.txt`;
    fileText = "Name:\nCommunity Club Incorporated\nEnd of declaration.";
    model({ suggestions: [{ ...suggestionText, locator: "Declaration" }] });
    const response = await setup();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      setupSuggestions: [
        {
          questionKey: "legal_name",
          value: suggestionText.textValue,
          quote: "Name:\nCommunity Club Incorporated",
          sourceLabel: filename,
          locator: "Declaration",
          documentId: docId,
          quoteVerified: true,
        },
      ],
    });
    expect(mocks.download).toHaveBeenCalledOnce();
    expect(mocks.generateContent).toHaveBeenCalledOnce();
  });

  it("labels visual evidence as not locally text-checked", async () => {
    documents = [
      { ...document(), name: "register.pdf", mime_type: "application/pdf" },
    ];
    model({ suggestions: [{ ...suggestionText, locator: "Page 1" }] });
    const response = await setup();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      setupSuggestions: [
        {
          questionKey: "legal_name",
          value: suggestionText.textValue,
          quote: suggestionText.quote,
          sourceLabel: "register.pdf",
          locator: "Page 1",
          documentId: docId,
          quoteVerified: false,
        },
      ],
    });
    expect(
      mocks.generateContent.mock.calls[0][0].contents[0].parts[2].inlineData
        .mimeType,
    ).toBe("application/pdf");
  });

  it.each([
    { category: "financial_statement", includeInsurance: true },
    { category: "audit_report", includeInsurance: false },
    { category: "insurance", includeInsurance: false },
  ])(
    "does not download or send $category sources without authorization",
    async ({ category, includeInsurance }) => {
      documents = [{ ...document(), category }];
      expect((await setup({ includeInsurance })).status).toBe(422);
      expect(mocks.download).not.toHaveBeenCalled();
      expect(mocks.generateContent).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("requires one source with an owned storage path and explicit insurance consent", async () => {
    expect((await setup({ text: "second source" })).status).toBe(422);
    expect((await setup({ documentIds: [docId, secondId] })).status).toBe(422);
    documents = [
      { ...document(), storage_path: `${secondId}/private-note.txt` },
    ];
    expect((await setup()).status).toBe(403);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    documents = [{ ...document(), category: "insurance" }];
    fileText = "Public liability insurance expires on 30 June 2027.";
    model({
      suggestions: [
        {
          questionKey: "insurance_expiry",
          textValue: "2027-06-30",
          quote: fileText,
        },
      ],
    });
    const response = await setup({ includeInsurance: true });
    expect(response.status).toBe(200);
    expect((await response.json()).setupSuggestions[0].value).toBe(
      "2027-06-30",
    );
  });

  it("checks only submitted conflict excerpts and preserves all alternatives without resolving uncertain conflicts", async () => {
    const first = {
      value: "Old Club",
      quote: "Previous entity name: Old Club",
      sourceLabel: "Original registration",
      documentId: docId,
      quoteVerified: true,
    };
    const second = {
      value: "New Club",
      quote: "The legal name is New Club",
      sourceLabel: "Updated registration",
      documentId: secondId,
      quoteVerified: true,
    };
    const scopeA = {
      value: "Metro",
      quote: "Metro offices are open",
      sourceLabel: "Annual summary",
    };
    const scopeB = {
      value: "Regional",
      quote: "Regional offices opened",
      sourceLabel: "Program review",
    };
    model({
      reviews: [
        {
          questionKey: "legal_name",
          advice: "use_1",
        },
        {
          questionKey: "description",
          advice: "unresolved",
        },
        {
          questionKey: "mission",
          advice: "use_0",
        },
      ],
    });
    const response = await setup({
      action: "setup-conflicts",
      documentIds: [],
      conflicts: [
        { questionKey: "legal_name", candidates: [first, second] },
        { questionKey: "description", candidates: [scopeA, scopeB] },
      ],
    });
    expect(response.status).toBe(200);
    const { setupConflicts } = await response.json();
    expect(mocks.generateContent.mock.calls[0][0]).toMatchObject({
      model: "gemini-4-neon",
      config: {
        thinkingConfig: { thinkingLevel: "LOW" },
        maxOutputTokens: 4096,
      },
    });
    const providerProperties =
      mocks.generateContent.mock.calls[0][0].config.responseSchema.properties
        .reviews.items.properties;
    expect(Object.keys(providerProperties)).toEqual(["questionKey", "advice"]);
    expect(providerProperties.advice.enum).toContain("use_3");
    expect(setupConflicts).toHaveLength(2);
    expect(setupConflicts[0]).toMatchObject({
      questionKey: "legal_name",
      recommendedAlternative: 1,
      alternatives: [first, second],
    });
    expect(setupConflicts[1]).toMatchObject({
      questionKey: "description",
      alternatives: [scopeA, scopeB],
    });
    expect(setupConflicts[1]).not.toHaveProperty("recommendedAlternative");
    const prompt = JSON.stringify(
      mocks.generateContent.mock.calls[0][0].contents,
    );
    expect(prompt).toContain("The legal name is New Club");
    expect(prompt).not.toContain("Updated registration");
    expect(prompt).not.toContain(docId);
    expect(prompt).not.toContain("STALE-NOT-SOURCE");
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it.each([
    ["out of range", ["use_3"]],
    ["not supported by its source quote", ["use_0"]],
    ["reported more than once", ["use_1", "use_1"]],
  ])(
    "preserves both alternatives when the recommendation is %s",
    async (_reason, advice) => {
      const candidates = [
        {
          value: "Old Club",
          quote: "The register gives no name.",
          sourceLabel: "Earlier report",
        },
        {
          value: "New Club",
          quote: "The legal name is New Club.",
          sourceLabel: "New register",
          quoteVerified: true,
        },
      ];
      model({
        reviews: advice.map((code) => ({
          questionKey: "legal_name",
          advice: code,
        })),
      });
      const response = await setup({
        action: "setup-conflicts",
        documentIds: [],
        conflicts: [{ questionKey: "legal_name", candidates }],
      });
      expect(response.status).toBe(200);
      expect((await response.json()).setupConflicts).toEqual([
        {
          questionKey: "legal_name",
          alternatives: candidates.map((candidate) => ({
            questionKey: "legal_name",
            ...candidate,
          })),
          note: "These excerpts do not resolve the difference. Check the originals or answer manually.",
        },
      ]);
    },
  );

  it("reports a Neon conflict output limit without retrying the same payload", async () => {
    mocks.generateContent.mockResolvedValueOnce({
      text: '{"reviews":[',
      modelVersion: "gemini-4-neon",
      candidates: [{ finishReason: "MAX_TOKENS" }],
      usageMetadata: { candidatesTokenCount: 16, thoughtsTokenCount: 4080 },
    });
    const response = await setup({
      action: "setup-conflicts",
      documentIds: [],
      conflicts: [
        {
          questionKey: "legal_name",
          candidates: [
            {
              value: "Old Club",
              quote: "Registered name: Old Club",
              sourceLabel: "Earlier register",
            },
            {
              value: "New Club",
              quote: "Registered name: New Club",
              sourceLabel: "New register",
            },
          ],
        },
      ],
    });
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("SG_AI_OUTPUT_LIMIT");
    expect(mocks.generateContent).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
});

describe("bounded AI failures", () => {
  it.each([
    {
      name: "renamed.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: "This is plain text renamed as an Office document.",
      status: 415,
    },
    {
      name: "corrupt.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: "PK\u0003\u0004" + "broken".repeat(12),
      status: 422,
    },
    {
      name: "oversize.txt",
      mime: "text/plain",
      content: "x".repeat(200001),
      status: 413,
    },
  ])(
    "does not claim AI quota for rejected $name",
    async ({ name, mime, content, status }) => {
      documents = [
        { ...document(), name, mime_type: mime, size_bytes: content.length },
      ];
      fileText = content;
      const response = await call({ profileStage: "extract" });
      expect(response.status).toBe(status);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.generateContent).not.toHaveBeenCalled();
    },
  );
  it("returns controlled JSON before the platform deadline for stalled document reads and never continues to the model", async () => {
    vi.useFakeTimers();
    let release: (value: unknown) => void = () => {};
    mocks.download.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = call({ profileStage: "extract" });
    await vi.advanceTimersByTimeAsync(27000);
    const response = await pending;
    const body = await response.json();
    expect(response.status).toBe(504);
    expect(body.code).toBe("SG_AI_TIMEOUT");
    expect(body.reference).toMatch(/^[a-f0-9-]{36}$/);
    release({ data: new Blob([fileText]), error: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("aborts a stalled model after25s and discards any late result", async () => {
    vi.useFakeTimers();
    let release: (value: unknown) => void = () => {};
    mocks.generateContent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = call({ profileStage: "extract" });
    await vi.advanceTimersByTimeAsync(25000);
    const response = await pending;
    expect(response.status).toBe(504);
    expect((await response.json()).code).toBe("SG_AI_TIMEOUT");
    expect(
      mocks.generateContent.mock.calls[0][0].config.abortSignal.aborted,
    ).toBe(true);
    release({ text: JSON.stringify({ profile: profileDraft }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each([
    { status: 429, code: "SG_AI_QUOTA", http: 429 },
    { status: 401, code: "SG_AI_PROVIDER", http: 503 },
    { status: 404, code: "SG_AI_PROVIDER", http: 503 },
    { status: 503, code: "SG_AI_UNAVAILABLE", http: 503 },
  ])(
    "classifies provider status$status without leaking its payload",
    async ({ status, code, http }) => {
      const canary = "PRIVATE-DOCUMENT-EMAIL-BANK-TOKEN-APIKEY-CANARY";
      mocks.generateContent.mockRejectedValue(
        Object.assign(new Error(canary), {
          status,
          body: canary,
          cause: { message: canary },
        }),
      );
      const response = await call({ profileStage: "extract" });
      const body = await response.json();
      expect(response.status).toBe(http);
      expect(body.code).toBe(code);
      expect(body.error).toContain(body.reference);
      expect(JSON.stringify(body)).not.toContain(canary);
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
        canary,
      );
    },
  );
  it("returns a response diagnostic for malformed model JSON", async () => {
    mocks.generateContent.mockResolvedValueOnce({
      text: "not-json-private-content",
    });
    const response = await call({ profileStage: "extract" });
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.code).toBe("SG_AI_RESPONSE");
    expect(JSON.stringify(body)).not.toContain("not-json-private-content");
  });
});
