import { describe, expect, it } from "vitest";
import { completeProfileReview } from "../netlify/functions/lib/profile-review";
import {
  ORGANISATION_TYPES,
  organisationType,
  profileValues,
} from "../src/lib/profile-values";
const extracted = {
  name: "社區協會 Community Association",
  abn: "51824753556",
  state: "Victoria",
  description: "Supports local Chinese and English speaking community members.",
  focus_areas: ["Community support"],
  type: "Incorporated Association",
};
describe("profile source coverage and correction omissions", () => {
  it("preserves undisputed partial string lists and respects group source findings", () => {
    const draft = {
      name: "Synthetic",
      focus_areas: ["Child safeguarding", "Abuse prevention", "Education"],
      beneficiaries: ["Children", "Families"],
      service_locations: ["Victoria", "Online"],
    };
    const corrected = {
      name: "Synthetic",
      focus_areas: ["Education"],
      beneficiaries: ["Children"],
      service_locations: ["Victoria"],
    };
    const result = completeProfileReview(draft, corrected, [], []);
    expect(result.profile.focus_areas).toEqual([
      "Education",
      "Child safeguarding",
      "Abuse prevention",
    ]);
    expect(result.profile.beneficiaries).toEqual(draft.beneficiaries);
    expect(result.profile.service_locations).toEqual(draft.service_locations);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        field: "focus_areas",
        issue: expect.stringContaining("unconfirmed draft"),
      }),
    );
    const disputed = completeProfileReview(
      draft,
      corrected,
      [{ field: "focus_areas", issue: "Other areas unsupported" }],
      [],
    );
    expect(disputed.profile.focus_areas).toEqual(["Education"]);
  });
  it("retains omitted expanded narrative and repeatable records with explicit review findings", () => {
    const expanded = {
      name: "Synthetic charity",
      mission: "Evidence-backed child safeguarding education",
      beneficiaries: ["Children"],
      service_locations: ["Victoria"],
      history: "An original constitution documents the organisation's history.",
      milestones: [{ title: "Constitution adopted", date: "2020" }],
      activities: [
        { name: "Education workshops", status: "unspecified" as const },
      ],
      insurance_policies: [
        {
          insurer: "Synthetic Mutual",
          policy_type: "Public liability",
          policy_number: "PRIVATE-SYNTHETIC-001",
        },
      ],
      other_facts: [{ label: "Governance", value: "Volunteer board" }],
    };
    const result = completeProfileReview(
      expanded,
      { name: expanded.name },
      [],
      [],
    );
    expect(result.profile).toMatchObject(expanded);
    for (const field of Object.keys(expanded).filter(
      (field) => field !== "name",
    ))
      expect(
        result.checks.some(
          (check) =>
            (check.field === field || check.field.startsWith(`${field}[`)) &&
            check.issue.includes("unconfirmed draft"),
        ),
      ).toBe(true);
  });
  it("keeps nested insurance disputes scoped to insurance while restoring independently supported fields", () => {
    const result = completeProfileReview(
      {
        name: "Synthetic charity",
        mission: "Supported purpose",
        insurance_policies: [
          { insurer: "Synthetic Mutual", policy_type: "Public liability" },
        ],
      },
      { name: "Synthetic charity" },
      [
        {
          field: "profile.insurance_policies[0].policy_number",
          issue: "Unsupported policy number",
        },
      ],
      [],
    );
    expect(result.profile.insurance_policies).toEqual([
      { insurer: "Synthetic Mutual", policy_type: "Public liability" },
    ]);
    expect(result.profile.mission).toBe("Supported purpose");
    expect(result.checks.some((check) => check.field === "history")).toBe(
      false,
    );
  });
  it("restores missing policy leaves and a removed second record without overwriting corrected values", () => {
    const policies = [
      {
        insurer: "Synthetic Mutual",
        policy_type: "Public liability",
        policy_number: "PRIVATE-A",
        expires_on: "2027-06-30",
        source: "Policy A",
      },
      {
        insurer: "Synthetic Mutual",
        policy_type: "Professional indemnity",
        policy_number: "PRIVATE-B",
        expires_on: "2028-06-30",
        source: "Policy B",
      },
    ];
    const result = completeProfileReview(
      { name: "Synthetic", insurance_policies: policies },
      {
        name: "Synthetic",
        insurance_policies: [
          {
            insurer: "Synthetic Mutual",
            policy_type: "Public liability",
            coverage: "Documented corrected coverage",
          },
        ],
      },
      [],
      [],
    );
    expect(result.profile.insurance_policies).toEqual([
      { ...policies[0], coverage: "Documented corrected coverage" },
      policies[1],
    ]);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        field: "insurance_policies[0].policy_number",
        issue: expect.stringContaining("unconfirmed draft"),
      }),
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        field: "insurance_policies[1].expires_on",
        issue: expect.stringContaining("unconfirmed draft"),
      }),
    );
  });
  it("does not restore a disputed policy leaf after correction reorders policies, while retaining independent facts", () => {
    const first = {
      insurer: "Synthetic A",
      policy_type: "Liability",
      policy_number: "DISPUTED",
      expires_on: "2027-01-01",
      source: "Policy A",
    };
    const second = {
      insurer: "Synthetic B",
      policy_type: "Liability",
      policy_number: "SUPPORTED-B",
      expires_on: "2028-01-01",
      source: "Policy B",
    };
    const finding = {
      field: "insurance_policies[0].policy_number",
      issue: "Unsupported policy number",
    };
    const result = completeProfileReview(
      { name: "Synthetic", insurance_policies: [first, second] },
      {
        name: "Synthetic",
        insurance_policies: [
          second,
          { insurer: first.insurer, policy_type: first.policy_type },
        ],
      },
      [finding],
      [],
    );
    expect(result.profile.insurance_policies?.[1]).toEqual({
      insurer: first.insurer,
      policy_type: first.policy_type,
      expires_on: first.expires_on,
      source: first.source,
    });
    expect(result.profile.insurance_policies?.[1]).not.toHaveProperty(
      "policy_number",
    );
    expect(result.checks).toContainEqual(finding);
  });
  it("restores omitted activity dates and outcomes and honours group source disputes", () => {
    const activity = {
      name: "Synthetic pilot",
      status: "historical" as const,
      start_date: "2025-01-01",
      end_date: "2025-03-31",
      outcomes: "A documented pilot report was produced.",
      source: "Pilot report",
    };
    const result = completeProfileReview(
      { name: "Synthetic", activities: [activity] },
      { name: "Synthetic", activities: [{ name: activity.name }] },
      [],
      [],
    );
    expect(result.profile.activities).toEqual([activity]);
    const disputed = completeProfileReview(
      { name: "Synthetic", activities: [activity] },
      { name: "Synthetic" },
      [{ field: "activities", issue: "Unsupported program history" }],
      [],
    );
    expect(disputed.profile.activities).toBeUndefined();
  });
  it("preserves populated extraction values omitted without a finding, with explicit review checks", () => {
    const result = completeProfileReview(
      extracted,
      {
        name: extracted.name,
        abn: "",
        state: "",
        description: "",
        focus_areas: [],
      },
      [{ field: "website", issue: "No website in the source" }],
      [],
    );
    expect(result.profile).toMatchObject({
      ...extracted,
      state: "VIC",
      type: "Incorporated association",
    });
    for (const field of ["abn", "state", "description", "focus_areas"])
      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field,
            issue: expect.stringContaining("unconfirmed draft"),
          }),
        ]),
      );
  });
  it("does not restore facts rejected by verification and keeps the finding when correction omits it", () => {
    const result = completeProfileReview(
      extracted,
      { name: extracted.name },
      [{ field: "ABN", issue: "ABN is unsupported by these originals" }],
      [],
    );
    expect(result.profile.abn).toBeUndefined();
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "ABN",
          issue: expect.stringContaining("unsupported"),
        }),
      ]),
    );
  });
  it("flags every absent field instead of returning an apparently complete sparse profile", () => {
    const result = completeProfileReview(
      { name: "Community" },
      { name: "Community" },
      [],
      [],
    );
    for (const field of [
      "abn",
      "state",
      "description",
      "focus_areas",
      "website",
    ])
      expect(result.checks.some((check) => check.field === field)).toBe(true);
  });
  it("honours combined and general findings when a correction removes values", () => {
    for (const field of ["ABN and state", "profile"]) {
      const result = completeProfileReview(
        extracted,
        { name: extracted.name },
        [
          {
            field,
            issue: "These values cannot be supported from the originals",
          },
        ],
        [],
      );
      expect(result.profile.abn).toBeUndefined();
      expect(result.profile.state).toBeUndefined();
    }
  });
  it("does not restore a rejected nested field path or bypass an unknown finding scope", () => {
    const nested = completeProfileReview(
      extracted,
      { name: extracted.name },
      [{ field: "profile.abn", issue: "Unsupported" }],
      [],
    );
    expect(nested.profile.abn).toBeUndefined();
    const unknown = completeProfileReview(
      extracted,
      { name: extracted.name },
      [
        {
          field: "unmapped source finding",
          issue: "Source evidence remains disputed",
        },
      ],
      [],
    );
    expect(unknown.profile.abn).toBeUndefined();
    expect(unknown.profile.description).toBeUndefined();
  });
  it.each([
    "Incorporated Association",
    " incorporated association ",
    "Incorporated Assn",
  ])("maps %s to one fixed entity option", (type) => {
    expect(organisationType(type)).toBe("Incorporated association");
    expect(
      ORGANISATION_TYPES.filter(
        (value) => value.toLowerCase() === "incorporated association",
      ),
    ).toHaveLength(1);
  });
  it("does not infer charity status from an unknown entity type or a blank value", () => {
    expect(organisationType("")).toBe("");
    expect(organisationType("Unlisted legal structure")).toBe("Other");
    expect(profileValues({ name: "Community", state: "NSW" }).state).toBe(
      "NSW",
    );
  });
});
