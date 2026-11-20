import { describe, expect, it } from "vitest";
import { mergeReviewedProfile } from "../src/lib/profile-merge";
import type { Profile } from "../src/types";

describe("reviewed profile updates", () => {
  it("adds distinct milestones and facts while retaining conflicting reviewed record values", () => {
    const saved: Profile = {
      name: "Reviewed organisation",
      milestones: [
        {
          title: "Program launched",
          date: "2024",
          details: "Reviewed launch details",
          source: "annual-report.pdf",
        },
      ],
      other_facts: [
        {
          label: "Resources",
          value: "Reviewed education materials",
          source: "reviewed-resources.pdf",
        },
      ],
      legacy_field: "Keep this existing value",
    };
    const original = structuredClone(saved);
    const result = mergeReviewedProfile(saved, {
      name: "Proposed name",
      milestones: [
        {
          title: "program launched",
          date: "2024",
          details: "Conflicting new details",
          source: "later-report.pdf",
        },
        {
          title: "Program launched",
          date: "2025",
          details: "Separate documented launch",
        },
      ],
      other_facts: [
        { label: "resources", value: "Conflicting resources" },
        { label: "Partnership", value: "A documented partnership" },
      ],
    });
    expect(result.profile.name).toBe(saved.name);
    expect(result.profile.milestones).toHaveLength(2);
    expect(result.profile.milestones?.[0]).toMatchObject({
      title: "Program launched",
      date: "2024",
      details: "Reviewed launch details",
      source: "annual-report.pdf; later-report.pdf",
    });
    expect(result.profile.milestones?.[1].date).toBe("2025");
    expect(result.profile.other_facts).toEqual([
      saved.other_facts![0],
      { label: "Partnership", value: "A documented partnership" },
    ]);
    expect(result.profile.legacy_field).toBe(saved.legacy_field);
    expect(result.checks.map((check) => check.field)).toEqual(
      expect.arrayContaining([
        "name",
        "milestones[0].details",
        "other_facts[0].value",
      ]),
    );
    expect(saved).toEqual(original);
  });

  it("keeps policy periods separate without numbers and recognises numbered policies", () => {
    const saved: Profile = {
      name: "Reviewed organisation",
      insurance_policies: [
        {
          insurer: "Insurer A",
          policy_type: "Public liability",
          starts_on: "2025-01-01",
          expires_on: "2025-12-31",
        },
        {
          insurer: "Insurer B",
          policy_type: "Professional indemnity",
          policy_number: "REDACTED-123",
          coverage_amount: "$10 million",
        },
      ],
    };
    const result = mergeReviewedProfile(saved, {
      name: saved.name,
      insurance_policies: [
        {
          insurer: "insurer a",
          policy_type: "Public liability",
          starts_on: "2025-01-01",
          coverage_amount: "$20 million",
        },
        {
          insurer: "Insurer A",
          policy_type: "Public liability",
          starts_on: "2026-01-01",
          expires_on: "2026-12-31",
        },
        {
          insurer: "Insurer B",
          policy_type: "Professional indemnity",
          policy_number: "redacted-123",
          coverage_amount: "$5 million",
          expires_on: "2027-01-01",
        },
      ],
    });
    expect(result.profile.insurance_policies).toHaveLength(3);
    expect(result.profile.insurance_policies?.[0]).toMatchObject({
      insurer: "Insurer A",
      starts_on: "2025-01-01",
      expires_on: "2025-12-31",
      coverage_amount: "$20 million",
    });
    expect(result.profile.insurance_policies?.[1]).toMatchObject({
      policy_number: "REDACTED-123",
      coverage_amount: "$10 million",
      expires_on: "2027-01-01",
    });
    expect(result.profile.insurance_policies?.[2].starts_on).toBe("2026-01-01");
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        field: "insurance_policies[1].coverage_amount",
      }),
    );
  });
});
