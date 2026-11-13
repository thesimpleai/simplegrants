import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// This file deliberately uses the real installed SDK. Mocking generateContent
// hid the SDK retry adapter's loss of HTTP status on failed responses.
import {
  generateJSON,
  verifyProfileStage,
} from "../netlify/functions/lib/gemini";
import { applicationPreflight } from "../netlify/functions/lib/preflight";
import {
  aiFailureResponse,
  createAIRequestBudget,
} from "../netlify/functions/lib/ai-runtime";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GEMINI_API_KEY", "synthetic-provider-key");
  vi.stubEnv("GEMINI_MODEL", "gemini-flash-latest");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});
function failed(status: number, code: string) {
  return new Response(
    JSON.stringify({
      error: {
        code: status,
        status: code,
        message: "PRIVATE-DOCUMENT-KEY-CANARY request timed out",
        details: [{ quotaMetric: "PRIVATE-QUOTA-ID" }],
      },
    }),
    {
      status,
      statusText: "Provider response",
      headers: { "Content-Type": "application/json" },
    },
  );
}
const success = () =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: '{"profile":{"name":"Synthetic Community"}}' }],
          },
          finishReason: "STOP",
        },
      ],
    }),
    { headers: { "Content-Type": "application/json" } },
  );

describe("real Gemini SDK HTTP failure handling", () => {
  it("sends profile verification and draft preflight through the native Gemini schema contract", async () => {
    const outputs = [
      { checks: [], verified_fields: [] },
      { documents: [], information: [] },
    ];
    const payloads: Record<string, any>[] = [];
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      payloads.push(body);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: JSON.stringify(outputs.shift()) }],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    await verifyProfileStage("Original registration", [], {
      name: "Synthetic Community",
    });
    await applicationPreflight(
      "Insurance is optional.",
      { application_questions: "Describe the activity." },
      "",
      [],
    );
    for (const body of payloads) {
      expect(body.generationConfig.responseSchema.type).toBe("OBJECT");
      expect(body.generationConfig).not.toHaveProperty("responseJsonSchema");
      expect(JSON.stringify(body.generationConfig.responseSchema)).not.toMatch(
        /additionalProperties|\$schema|anyOf|maxLength|minLength/,
      );
    }
    expect(
      payloads[0].generationConfig.responseSchema.properties.checks.items
        .properties.source,
    ).toEqual({ type: "STRING", nullable: true });
    expect(
      payloads[1].generationConfig.responseSchema.properties.documents.items
        .properties.condition_applies,
    ).toEqual({ type: "BOOLEAN", nullable: true });
  });
  it("records the rejected schema field without logging quoted source values", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            status: "INVALID_ARGUMENT",
            message: `Invalid JSON payload received. Unknown name "additionalProperties" at 'generation_config.response_schema.properties[checks].items': Cannot find field. PRIVATE-SOURCE-CANARY contents.PRIVATE_SOURCE Unknown name "PRIVATE_VALUE"`,
            details: [],
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    const budget = createAIRequestBudget();
    try {
      await generateJSON("Synthetic evidence", [], budget);
    } catch (error) {
      const response = aiFailureResponse(error, budget, "profile_verify");
      expect(console.error).toHaveBeenCalledWith(
        "Simple Grants AI step unavailable",
        expect.objectContaining({
          providerMessage: expect.stringContaining("additionalProperties"),
        }),
      );
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain(
        "generation_config.response_schema.properties[checks].items",
      );
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
        "PRIVATE",
      );
      expect(JSON.stringify(await response.json())).not.toContain(
        "additionalProperties",
      );
    } finally {
      budget.close();
    }
  });
  it.each([
    [400, "INVALID_ARGUMENT", 503, "SG_AI_PROVIDER"],
    [401, "UNAUTHENTICATED", 503, "SG_AI_PROVIDER"],
    [402, "FAILED_PRECONDITION", 503, "SG_AI_PROVIDER"],
    [403, "PERMISSION_DENIED", 503, "SG_AI_PROVIDER"],
    [404, "NOT_FOUND", 503, "SG_AI_PROVIDER"],
    [429, "RESOURCE_EXHAUSTED", 429, "SG_AI_QUOTA"],
    [504, "DEADLINE_EXCEEDED", 504, "SG_AI_TIMEOUT"],
  ])(
    "preserves HTTP %i and a safe provider enum without retrying or leaking the body",
    async (status, providerCode, http, code) => {
      fetchMock.mockResolvedValueOnce(
        failed(Number(status), String(providerCode)),
      );
      const budget = createAIRequestBudget();
      try {
        await generateJSON("Synthetic evidence", [], budget);
        throw new Error("Expected provider rejection");
      } catch (error) {
        expect(error).toMatchObject({ name: "ApiError", status });
        const response = aiFailureResponse(error, budget, "profile_verify");
        expect(response.status).toBe(http);
        expect((await response.json()).code).toBe(code);
        expect(console.error).toHaveBeenCalledWith(
          "Simple Grants AI step unavailable",
          expect.objectContaining({
            providerStatus: status,
            errorType: "ApiError",
            providerCode,
          }),
        );
        expect(
          JSON.stringify(vi.mocked(console.error).mock.calls),
        ).not.toContain("PRIVATE");
      } finally {
        budget.close();
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it("retries an actual HTTP 503 once and returns the checked response", async () => {
    fetchMock
      .mockResolvedValueOnce(failed(503, "UNAVAILABLE"))
      .mockResolvedValueOnce(success());
    const pending = generateJSON("Synthetic evidence");
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toEqual({ profile: { name: "Synthetic Community" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("retains HTTP status after a retry also fails", async () => {
    fetchMock.mockImplementation(async () => failed(503, "UNAVAILABLE"));
    const budget = createAIRequestBudget();
    const pending = generateJSON("Synthetic evidence", [], budget).catch(
      (error) => aiFailureResponse(error, budget, "draft_preflight"),
    );
    await vi.advanceTimersByTimeAsync(250);
    expect((await pending).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      "Simple Grants AI step unavailable",
      expect.objectContaining({
        providerStatus: 503,
        errorType: "ApiError",
        providerCode: "UNAVAILABLE",
      }),
    );
    budget.close();
  });
});
