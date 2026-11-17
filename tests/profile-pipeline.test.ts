import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
}));
import {
  generateJSON,
  profilePipeline,
  profileSchema,
  profileSourceFingerprint,
  verifyProfileStage,
} from "../netlify/functions/lib/gemini";
import {
  safeguardingPassage,
  safeguardingProfile,
} from "./fixtures/my-safe-circle";
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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("three-pass profile evidence boundaries", () => {
  it("scopes a recovery quote to its policy record and leaf instead of trusting the full recovered array", async () => {
    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        checks: [],
        recovered_profile: {
          insurance_policies: [
            {
              insurer: "Synthetic A",
              policy_type: "Liability",
              policy_number: "UNQUOTED-A",
              expires_on: "2027-01-01",
              source: "Policy A",
            },
            {
              insurer: "Synthetic B",
              policy_type: "Indemnity",
              policy_number: "UNQUOTED-B",
              source: "Policy B",
            },
          ],
        },
        evidence: [
          {
            field: "insurance_policies[0].insurer",
            source: "Policy A",
            quote: "Insurer: Synthetic A",
          },
        ],
      }),
    });
    const result = await verifyProfileStage(
      "Synthetic original policy A names Synthetic A. No other policy facts established.",
      [],
      { name: "Synthetic" },
    );
    expect(result.profileDraft.insurance_policies).toEqual([
      { insurer: "Synthetic A", policy_type: "", source: "Policy A" },
    ]);
    expect(JSON.stringify(result.profileDraft)).not.toContain("UNQUOTED");
    expect(JSON.stringify(result.profileDraft)).not.toContain("Synthetic B");
  });

  it("accepts an indexed record recovery quote only for the record and original source it identifies", async () => {
    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        checks: [],
        recovered_profile: {
          insurance_policies: [
            {
              insurer: "Synthetic A",
              policy_type: "Liability",
              policy_number: "UNSUPPORTED-A",
              source: "Policy A",
            },
            {
              insurer: "Synthetic B",
              policy_type: "Indemnity",
              policy_number: "SUPPORTED-B",
              source: "Policy B",
            },
          ],
        },
        evidence: [
          {
            field: "insurance_policies[0]",
            source: "Different policy",
            quote: "Incorrect source cannot establish Policy A.",
          },
          {
            field: "profile.insurance_policies[1]",
            source: "Policy B",
            quote: "Synthetic B; Indemnity; Policy number SUPPORTED-B",
          },
        ],
      }),
    });
    const result = await verifyProfileStage(
      "Synthetic original policy B: Synthetic B; Indemnity; SUPPORTED-B.",
      [],
      { name: "Synthetic" },
    );
    expect(result.profileDraft.insurance_policies).toEqual([
      {
        insurer: "Synthetic B",
        policy_type: "Indemnity",
        policy_number: "SUPPORTED-B",
        source: "Policy B",
      },
    ]);
  });
  it("preserves the exact child safeguarding fixture through all three stages without inventing historical facts", async () => {
    responses(safeguardingProfile);
    const result = await profilePipeline(org, safeguardingPassage, []);
    expect(result.profile).toMatchObject(safeguardingProfile);
    for (const field of [
      "founded_on",
      "history",
      "milestones",
      "service_locations",
      "insurance_policies",
    ])
      expect(result.profile).not.toHaveProperty(field);
    for (const activity of result.profile.activities ?? []) {
      expect(activity).not.toHaveProperty("outcomes");
      expect(activity).not.toHaveProperty("start_date");
      expect(activity.status).toBe("unspecified");
    }
    for (const [request] of mocks.generateContent.mock.calls) {
      expect(request.contents[0].parts[0].text).toContain(safeguardingPassage);
      expect(request.contents[0].parts[0].text).toContain(
        "Do not infer a founding date",
      );
      expect(request.config).not.toHaveProperty("safetySettings");
      expect(request.config.systemInstruction).toContain("Australia/Melbourne");
      expect(request.config.maxOutputTokens).toBeGreaterThanOrEqual(12288);
      const contract =
        request.config.responseSchema.properties.profile ??
        request.config.responseSchema.properties.recovered_profile;
      expect(contract.properties).toHaveProperty("mission");
      expect(contract.properties).toHaveProperty("activities");
    }
  });

  it("round-trips the expanded contract and accepts null optional nested values", async () => {
    const profile = {
      ...safeguardingProfile,
      history:
        "Synthetic organisation history, documented in an annual report.",
      milestones: [
        {
          title: "Constitution adopted",
          date: "2020",
          source: "Synthetic annual report",
        },
      ],
      activities: [
        {
          name: "Synthetic 2025 program",
          status: "historical",
          start_date: "2025-03-01",
          end_date: "2025-06-30",
          outcomes: "A documented pilot report was published.",
          source: "Redacted pilot report",
        },
      ],
      service_locations: ["Victoria"],
      registration_date: "2026-06-19",
      registration_authority: "Synthetic register",
      registration_number: "SYNTHETIC-REG-001",
      charity_registration_date: "2026-06-19",
      certificate_issue_date: "2026-06-20",
      insurance_policies: [
        {
          insurer: "Synthetic Mutual",
          policy_type: "Public liability",
          policy_number: "SYNTHETIC-PRIVATE-POLICY",
          coverage_amount: "$20 million",
          starts_on: "2026-07-01",
          expires_on: "2027-06-30",
          source: "Redacted insurance schedule",
          issued_on: null,
        },
      ],
      other_facts: [
        {
          label: "Governance",
          value: "Volunteer board",
          source: "Synthetic constitution",
        },
      ],
    };
    responses(profile);
    const result = await profilePipeline(
      org,
      "Synthetic redacted source documents",
      [],
    );
    const roundTrip = profileSchema.parse(
      JSON.parse(JSON.stringify(result.profile)),
    );
    const { issued_on: _unavailable, ...policy } =
      profile.insurance_policies[0];
    expect(roundTrip).toMatchObject({
      ...profile,
      insurance_policies: [policy],
    });
    expect(roundTrip.insurance_policies?.[0]).not.toHaveProperty("issued_on");
    expect(roundTrip.insurance_policies?.[0].policy_number).toBe(
      "SYNTHETIC-PRIVATE-POLICY",
    );
  });

  it("uses the current Melbourne calendar date and removes stale future warnings before correction sees them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T14:05:00Z")); // 17 November in Melbourne.
    const profile = {
      name: "My Safe Circle",
      charity_registration_date: "2026-06-19",
    };
    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ profile }),
    });
    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        checks: [
          {
            field: "charity_registration_date",
            issue: "The registration date is in the future.",
          },
        ],
      }),
    });
    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ profile, checks: [] }),
    });
    const result = await profilePipeline(
      org,
      "Synthetic ACNC certificate: registered 19 June 2026.",
      [],
    );
    expect(result.profile.charity_registration_date).toBe("2026-06-19");
    expect(
      result.checks.some((check) => /in the future/.test(check.issue)),
    ).toBe(false);
    expect(
      mocks.generateContent.mock.calls[2][0].contents[0].parts[0].text,
    ).not.toContain('"issue":"The registration date is in the future."');
    for (const [request] of mocks.generateContent.mock.calls)
      expect(request.config.systemInstruction).toContain(
        "2026-11-17 in Australia/Melbourne",
      );
    const beforeMidnight = profileSourceFingerprint("Original source", []);
    vi.setSystemTime(new Date("2026-11-17T14:05:00Z"));
    expect(profileSourceFingerprint("Original source", [])).not.toBe(
      beforeMidnight,
    );
  });

  it("keeps a documented partial insurance record when the provider returns unknown labels as null", async () => {
    responses({
      name: "Synthetic charity",
      insurance_policies: [
        {
          insurer: null,
          policy_type: "Public liability",
          policy_number: null,
          coverage_amount: "$20 million",
          starts_on: null,
          expires_on: "2027-06-30",
          source: "Synthetic redacted certificate",
        },
      ],
    });
    const result = await profilePipeline(
      org,
      "Synthetic certificate: public liability cover $20 million, expires 30 June 2027; insurer redacted.",
      [],
    );
    expect(result.profile.insurance_policies).toEqual([
      {
        insurer: "",
        policy_type: "Public liability",
        coverage_amount: "$20 million",
        expires_on: "2027-06-30",
        source: "Synthetic redacted certificate",
      },
    ]);
  });

  it("passes provider findings plus deterministic calendar findings into correction without losing checks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T00:00:00Z"));
    const profile = {
      name: "Synthetic charity",
      insurance_policies: [
        {
          insurer: "Synthetic Mutual",
          policy_type: "Public liability",
          expires_on: "2025-06-30",
        },
      ],
    };
    const findings = Array.from({ length: 50 }, (_, index) => ({
      field: "activities",
      issue: `Synthetic source finding ${index}`,
    }));
    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ profile }),
    });
    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ checks: findings }),
    });
    mocks.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ profile, checks: [] }),
    });
    const result = await profilePipeline(
      org,
      "Synthetic historical policy certificate",
      [],
    );
    expect(result.checks).toEqual(expect.arrayContaining(findings));
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        field: "insurance_policies[0].expires_on",
        issue: "This documented insurance policy has expired.",
      }),
    );
    expect(
      mocks.generateContent.mock.calls[2][0].contents[0].parts[0].text,
    ).toContain("Synthetic source finding 49");
  });

  it.each([
    { promptFeedback: { blockReason: "SAFETY" } },
    { candidates: [{ finishReason: "SAFETY" }], text: "" },
  ])(
    "distinguishes a provider safety block without disabling safeguards",
    async (blocked) => {
      mocks.generateContent.mockResolvedValueOnce(blocked);
      await expect(generateJSON(safeguardingPassage)).rejects.toMatchObject({
        kind: "response",
        reason: "PROVIDER_BLOCKED",
      });
      expect(mocks.generateContent).toHaveBeenCalledTimes(1);
      expect(mocks.generateContent.mock.calls[0][0].config).not.toHaveProperty(
        "safetySettings",
      );
    },
  );
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
