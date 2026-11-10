import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
}));
import { profilePipeline } from "../netlify/functions/lib/gemini";
import type { Organisation } from "../src/types";
const org = {
  name: "User-entered old name",
  profile: {
    name: "User-entered old name",
    description: "STALE-UNVERIFIED-CONTEXT",
  },
} as Organisation;
function responses(profile: Record<string, unknown>) {
  mocks.generateContent.mockResolvedValueOnce({
    text: JSON.stringify({ profile, evidence: [] }),
  });
  mocks.generateContent.mockResolvedValueOnce({
    text: JSON.stringify({ checks: [], verified_fields: [] }),
  });
  mocks.generateContent.mockResolvedValueOnce({
    text: JSON.stringify({ profile, checks: [], evidence: [] }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GEMINI_API_KEY", "test");
});
afterEach(() => vi.unstubAllEnvs());
describe("three-pass profile evidence boundaries", () => {
  it("verifies and corrects against original sources without treating stale profile context as evidence", async () => {
    responses({
      name: "Community Club",
      legal_name: "Community Club Incorporated",
    });
    const result = await profilePipeline(
      org,
      "Registration document: Community Club Incorporated.",
      [],
    );
    expect(mocks.generateContent).toHaveBeenCalledTimes(3);
    const first =
      mocks.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(first).toContain("CONTEXT ONLY, NOT SOURCE EVIDENCE");
    for (const call of mocks.generateContent.mock.calls.slice(1)) {
      const prompt = call[0].contents[0].parts[0].text;
      expect(prompt).toContain(
        "Registration document: Community Club Incorporated.",
      );
      expect(prompt).not.toContain("STALE-UNVERIFIED-CONTEXT");
    }
    expect(result.profile.name).toBe("Community Club");
    expect(result.profile).not.toHaveProperty("acnc_registered");
  });
  it("marks a fallback user-entered name as unverified instead of presenting it as sourced", async () => {
    responses({ name: "" });
    const result = await profilePipeline(
      org,
      "No legal organisation name appears in this history.",
      [],
    );
    expect(result.profile.name).toBe(org.name);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "name",
          source: "Existing user-entered organisation name",
        }),
      ]),
    );
    expect(result.checks[0].issue).toContain("not been verified");
  });
});
