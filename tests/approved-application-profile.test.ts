import { describe, expect, it } from "vitest";
import {
  approvedApplicationProfileFacts,
  approvedProfileFacts,
} from "../netlify/functions/lib/core";
import { setupQuestionByKey } from "../src/lib/setup-questionnaire";

describe("approved grant setup context", () => {
  it("only projects confirmed answers into the application context", () => {
    const profile = {
      name: "Example",
      description: "A community organisation.",
      source_evidence: [{ quote: "Private original source" }],
      review_notes: [{ issue: "Unresolved conflict" }],
      reviewed_grant_answers: [{ answer: "Unexpected top-level answer" }],
      grant_setup: {
        version: 1,
        answers: {
          legal_name: {
            status: "confirmed",
            value: "Example Incorporated",
            sources: [
              {
                questionKey: "legal_name",
                value: "Example Incorporated",
                quote: "The registered name is Example Incorporated.",
                sourceLabel: "Private confirmation source",
              },
            ],
          },
          abn: { status: "suggested", value: "Unconfirmed value" },
          entity_type: { status: "confirmed", value: "x".repeat(1501) },
          website: { status: "not_applicable" },
          unknown: { status: "confirmed", value: "Unknown question" },
        },
        unresolved: [{ quote: "Raw document candidate" }],
      },
    };
    const profileFacts = {
      name: "Example",
      description: "A community organisation.",
    };

    expect(approvedProfileFacts(profile)).toEqual(profileFacts);
    expect(approvedApplicationProfileFacts(profile)).toEqual({
      ...profileFacts,
      reviewed_grant_answers: [
        {
          question: setupQuestionByKey.legal_name.label,
          answer: "Example Incorporated",
        },
      ],
    });
  });

  it("preserves confirmed zero, No and reporting dates without extra fields", () => {
    const headcount = {
      value: 0,
      unit: "people",
      periodStart: "2025-05-01",
      periodEnd: "2025-05-01",
    };
    const profile = {
      name: "Example",
      grant_setup: {
        version: 1,
        answers: {
          dgr_endorsed: { status: "confirmed", value: false },
          staff_count: {
            status: "confirmed",
            value: { ...headcount, rawSource: "Private source text" },
          },
        },
      },
    };

    expect(approvedApplicationProfileFacts(profile)).toEqual({
      name: "Example",
      reviewed_grant_answers: [
        { question: setupQuestionByKey.dgr_endorsed.label, answer: false },
        { question: setupQuestionByKey.staff_count.label, answer: headcount },
      ],
    });
  });

  it("keeps ordinary profile context for missing or unsupported setup data", () => {
    const profile = { name: "Existing organisation" };
    expect(approvedApplicationProfileFacts(profile)).toEqual(profile);
    expect(
      approvedApplicationProfileFacts({
        ...profile,
        grant_setup: {
          version: 99,
          answers: { legal_name: { status: "confirmed", value: "Unknown" } },
        },
      }),
    ).toEqual(profile);
  });

  it("keeps unresolved legacy fields out of application context until reviewed", () => {
    const profile = {
      name: "Existing organisation",
      legal_name: "Old legal name",
      grant_setup: {
        version: 1,
        answers: {
          legal_name: { status: "confirmed", value: "Old legal name" },
        },
        unresolved: ["legal_name"],
      },
    };
    expect(approvedProfileFacts(profile).legal_name).toBe("Old legal name");
    expect(approvedApplicationProfileFacts(profile)).toEqual({
      name: "Existing organisation",
    });
  });
});
