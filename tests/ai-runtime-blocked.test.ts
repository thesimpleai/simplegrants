import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AIExecutionError,
  aiFailureResponse,
  createAIRequestBudget,
  providerFailure,
} from "../netlify/functions/lib/ai-runtime";

afterEach(() => vi.restoreAllMocks());

describe("provider safety response handling", () => {
  it("keeps a provider block distinct from an empty or malformed response", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new AIExecutionError("response", "PROVIDER_BLOCKED");
    error.message = "PRIVATE-POLICY-NUMBER-SOURCE-CANARY";
    const budget = createAIRequestBudget();
    try {
      expect(providerFailure(error)).toEqual({ reason: "PROVIDER_BLOCKED" });
      const response = aiFailureResponse(error, budget, "profile_extract");
      const result = await response.json();
      expect(response.status).toBe(422);
      expect(result.code).toBe("SG_AI_BLOCKED");
      expect(result.error).toContain("safety rules");
      expect(result.error).toContain("manually");
      expect(log).toHaveBeenCalledWith(
        "Simple Grants AI step unavailable",
        expect.objectContaining({ failureReason: "PROVIDER_BLOCKED" }),
      );
      expect(JSON.stringify([result, log.mock.calls])).not.toContain(
        "PRIVATE-POLICY-NUMBER-SOURCE-CANARY",
      );
    } finally {
      budget.close();
    }
  });

  it("classifies a wrapped block without converting it to a transient network failure", () => {
    const error = new Error("SDK wrapper", {
      cause: new AIExecutionError("response", "PROVIDER_BLOCKED"),
    });
    expect(providerFailure(error)).toEqual({ reason: "PROVIDER_BLOCKED" });
  });
});
