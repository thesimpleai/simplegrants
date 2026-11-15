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
  it("recovers omitted bilingual source facts during verification and retains them for review after a sparse correction", async () => {
    const name = "社區協會 Community Association";
    const facts = {
      abn: "51824753556",
      state: "Victoria",
      description: "Supporting local Chinese and English speaking members.",
      focus_areas: ["Community support"],
    };
    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        profile: { name, type: "Incorporated Association" },
        evidence: [],
      }),
    });
    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        checks: [{ field: "website", issue: "No website supplied" }],
        recovered_profile: facts,
        evidence: Object.keys(facts).map((field) => ({
          field,
          source: "Registration and history",
          quote: `Original source supports ${field}`,
        })),
      }),
    });
    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        profile: {
          name,
          type: "Incorporated Association",
          abn: "",
          state: "",
          description: "",
          focus_areas: [],
        },
        checks: [],
      }),
    });
    const result = await profilePipeline(
      org,
      "原始資料 / original registration, state and community activities",
      [],
    );
    expect(result.profile).toMatchObject({
      name,
      ...facts,
      state: "VIC",
      type: "Incorporated association",
    });
    for (const field of Object.keys(facts))
      expect(
        result.checks.some(
          (check) =>
            check.field === field && check.issue.includes("unconfirmed draft"),
        ),
      ).toBe(true);
    expect(result.checks.some((check) => check.field === "website")).toBe(true);
    expect(
      mocks.generateContent.mock.calls[2][0].contents[0].parts[0].text,
    ).toContain(facts.abn);
  });
  it("ignores recovery values that have no field-specific source quote", async () => {
    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ profile: { name: "Community" } }),
    });
    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        checks: [],
        recovered_profile: { abn: "51824753556" },
        evidence: [],
      }),
    });
    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ profile: { name: "Community" }, checks: [] }),
    });
    const result = await profilePipeline(
      org,
      "Source without an established ABN",
      [],
    );
    expect(result.profile.abn).toBeUndefined();
    expect(result.checks.some((check) => check.field === "abn")).toBe(true);
  });
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
    expect(
      result.checks.find(
        (item) => item.source === "Existing user-entered organisation name",
      )?.issue,
    ).toContain("not been verified");
  });
});
