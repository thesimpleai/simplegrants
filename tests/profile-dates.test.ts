import { describe, expect, it } from "vitest";
import {
  profileDateContext,
  profileDateOnly,
  documentedProfileDate,
  profileToday,
  validateProfileDates,
} from "../src/lib/profile-dates";

describe("organisation calendar checks", () => {
  const now = new Date("2026-11-17T00:00:00Z");
  it("supplies the actual Melbourne day across UTC midnight and daylight saving", () => {
    expect(profileToday(new Date("2026-11-16T13:30:00Z"))).toBe("2026-11-17");
    expect(profileToday(new Date("2026-06-18T14:30:00Z"))).toBe("2026-06-19");
    expect(profileDateContext(now)).toContain(
      "2026-11-17 in Australia/Melbourne",
    );
  });
  it("validates real date-only values without rolling over impossible dates", () => {
    expect(profileDateOnly("2026-06-19")).toBe("2026-06-19");
    expect(profileDateOnly("2026-02-29")).toBeNull();
    expect(profileDateOnly("2028-02-29")).toBe("2028-02-29");
    expect(profileDateOnly("2026-06-31")).toBeNull();
    expect(profileDateOnly("2026-06-19T00:00:00Z")).toBeNull();
    expect(profileDateOnly("2026")).toBeNull();
    expect(documentedProfileDate("19 June 2026")).toBe("2026-06-19");
    expect(documentedProfileDate("31 June 2026")).toBeNull();
    expect(documentedProfileDate("June 2026")).toBeNull();
    expect(
      validateProfileDates(
        { name: "My Safe Circle", charity_registration_date: "19 June 2026" },
        [
          {
            field: "ACNC registration date",
            issue: "The registration is in the future.",
          },
        ],
        now,
      ),
    ).toEqual([]);
  });
  it("removes the false future warning for 19 June 2026, preserving source disputes", () => {
    const checks = validateProfileDates(
      { name: "My Safe Circle", charity_registration_date: "2026-06-19" },
      [
        {
          field: "charity_registration_date",
          issue: "This registration date is in the future.",
        },
        {
          field: "ACNC registration date",
          issue: "This date is in the future.",
        },
        {
          field: "charity_registration_date",
          issue: "This future date conflicts with another source.",
        },
        {
          field: "description",
          issue: "Confirm this wording from the source.",
        },
      ],
      now,
    );
    expect(checks.map((check) => check.issue)).toEqual([
      "This future date conflicts with another source.",
      "Confirm this wording from the source.",
    ]);
  });
  it("distinguishes future registration from valid future insurance and past expiry", () => {
    const checks = validateProfileDates(
      {
        name: "Example",
        registration_date: "2026-11-18",
        insurance_policies: [
          {
            insurer: "Synthetic",
            policy_type: "Public liability",
            starts_on: "2026-12-01",
            expires_on: "2027-12-01",
          },
          {
            insurer: "Synthetic",
            policy_type: "Historical",
            starts_on: "2025-01-01",
            expires_on: "2026-11-16",
          },
          {
            insurer: "Synthetic",
            policy_type: "Current",
            expires_on: "2026-11-17",
          },
        ],
      },
      [],
      now,
    );
    expect(checks.map((check) => check.field)).toEqual([
      "registration_date",
      "insurance_policies[1].expires_on",
    ]);
  });
  it("preserves incomplete evidence, flags invalid dates and reversed periods", () => {
    const checks = validateProfileDates(
      {
        name: "Example",
        founded_on: "2020",
        certificate_issue_date: "2026-02-30",
        activities: [
          {
            name: "Documented program",
            status: "historical",
            start_date: "2027-01-02",
            end_date: "2027-01-01",
          },
        ],
      },
      [],
      now,
    );
    expect(checks.map((check) => check.field)).toEqual([
      "certificate_issue_date",
      "activities[0].end_date",
      "activities[0]",
    ]);
  });
  it("recomputes its own saved findings after corrected values and a new day", () => {
    const sourceDispute = {
      field: "certificate_issue_date",
      issue: "This date conflicts with the original document.",
      source: "Original certificate",
    };
    const previous = validateProfileDates(
      {
        name: "Example",
        certificate_issue_date: "2026-02-30",
        insurance_policies: [
          {
            insurer: "Synthetic",
            policy_type: "Public liability",
            starts_on: "2026-11-16",
            expires_on: "2026-11-15",
          },
        ],
      },
      [sourceDispute],
      now,
    );
    expect(previous.length).toBeGreaterThan(1);
    expect(
      validateProfileDates(
        {
          name: "Example",
          certificate_issue_date: "2026-06-19",
          insurance_policies: [
            {
              insurer: "Synthetic",
              policy_type: "Public liability",
              starts_on: "2026-11-01",
              expires_on: "2027-11-01",
            },
          ],
        },
        previous,
        new Date("2026-11-18T00:00:00Z"),
      ),
    ).toEqual([sourceDispute]);
  });
});
