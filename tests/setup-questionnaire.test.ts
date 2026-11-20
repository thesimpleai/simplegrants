import { describe, expect, it } from "vitest";
import type { DocumentRecord } from "../src/types";
import {
  aggregateSetupEvidence,
  chooseSetupAnswer,
  isSetupAnswerValue,
  readSetupAnswers,
  setupProfileAnswer,
  setupQuestionByKey as questions,
  setupQuestionnaire,
  suggestSetupDocuments,
  type SetupAnswerValue,
  type SetupQuestionKey,
  type SetupSuggestion,
} from "../src/lib/setup-questionnaire";

function finding(
  questionKey: SetupQuestionKey,
  value: SetupAnswerValue,
  sourceLabel: string,
): SetupSuggestion {
  return {
    questionKey,
    value,
    sourceLabel,
    quote: "Exact evidence from the source",
    quoteVerified: true,
  };
}

describe("reusable grant-readiness questions", () => {
  it("separates legal identity and service locations, and preserves documented dates and negative answers", () => {
    expect(
      new Set(setupQuestionnaire.map((question) => question.key)).size,
    ).toBe(setupQuestionnaire.length);
    const profile = {
      name: "Public name",
      legal_name: "Exact registered name",
      founded_on: "May 2012",
      registration_date: "24 May 2015",
      acnc_registered: false,
      state: "VIC",
      service_locations: ["VIC", "NSW"],
    };
    expect(setupProfileAnswer(questions.legal_name, profile)).toBe(
      profile.legal_name,
    );
    expect(setupProfileAnswer(questions.registration_date, profile)).toBe(
      "2015-05-24",
    );
    expect(setupProfileAnswer(questions.founded_on, profile)).toBe("2012-05");
    expect(setupProfileAnswer(questions.acnc_registered, profile)).toBe(false);
    expect(setupProfileAnswer(questions.base_state, profile)).toBe("VIC");
    expect(setupProfileAnswer(questions.service_locations, profile)).toEqual([
      "VIC",
      "NSW",
    ]);
    expect(setupProfileAnswer(questions.dgr_endorsed, profile)).toBeUndefined();
    expect(isSetupAnswerValue(questions.founded_on, "2012-05")).toBe(true);
    expect(isSetupAnswerValue(questions.insurance_expiry, "2025-02-29")).toBe(
      false,
    );
    expect(isSetupAnswerValue(questions.insurance_expiry, "2025")).toBe(false);
  });

  it("suggests public or redacted financial evidence while excluding originals and unrelated files", () => {
    const base: DocumentRecord = {
      id: "e00418c4-03ed-436f-8e2b-8095af7667af",
      org_id: "acbafcc3-037a-4aee-90e4-c9f566a8757a",
      name: "",
      category: "other",
      storage_path: "test.pdf",
      mime_type: "application/pdf",
      size_bytes: 10,
      verified: false,
      created_at: "2025-01-01T00:00:00Z",
    };
    const annualReport = { ...base, name: "Public annual report.pdf" };
    const records = [
      { ...base, name: "private.pdf", category: "financial_statement" },
      { ...base, name: "audit-copy.pdf", category: "audit_report" },
      { ...base, name: "bank_statement.pdf" },
      { ...base, name: "unrelated scan.pdf" },
      annualReport,
    ];
    expect(
      suggestSetupDocuments(questions.financial_summary_period, records),
    ).toEqual({
      matches: [annualReport],
      recommended: [
        expect.stringContaining("Public annual report"),
        expect.stringContaining("redacted excerpt"),
      ],
    });
    expect(
      suggestSetupDocuments(questions.mission, records).matches.map(
        (doc) => doc.name,
      ),
    ).toEqual(["unrelated scan.pdf", "Public annual report.pdf"]);
  });
});

describe("questionnaire evidence review", () => {
  it("groups equivalent alternatives and keeps the provenance for competing values", () => {
    const registers = [
      finding("legal_name", "Example Incorporated", "Incorporation register"),
      finding("legal_name", " example  incorporated ", "Public annual report"),
      finding("legal_name", "Example Limited", "Other register"),
    ];
    const result = aggregateSetupEvidence([
      ...registers,
      registers[0],
      finding("service_locations", ["VIC", "NSW"], "Annual report"),
      finding("service_locations", ["nsw", "vic"], "Website"),
      { ...registers[0], questionKey: "malformed" },
      { ...registers[0], quote: "" },
    ]);
    expect(result.legal_name?.hasConflict).toBe(true);
    expect(result.legal_name?.alternatives.map((entry) => entry.value)).toEqual(
      ["Example Incorporated", "Example Limited"],
    );
    expect(
      result.legal_name?.alternatives[0].suggestions.map(
        (entry) => entry.sourceLabel,
      ),
    ).toEqual(["Incorporation register", "Public annual report"]);
    expect(result.service_locations?.hasConflict).toBe(false);
    expect(result.service_locations?.alternatives).toHaveLength(1);
  });

  it("keeps old and new reporting periods separate and detects conflicts within a single period", () => {
    const earlier = {
      value: 25,
      unit: "people",
      periodStart: "2023-07-01",
      periodEnd: "2024-06-30",
    };
    const later = {
      ...earlier,
      value: 30,
      periodStart: "2024-07-01",
      periodEnd: "2025-06-30",
    };
    const trends = [
      finding("annual_participants", earlier, "2024 report"),
      finding("annual_participants", later, "2025 report"),
    ];
    expect(
      aggregateSetupEvidence(trends).annual_participants?.hasConflict,
    ).toBe(false);
    expect(
      aggregateSetupEvidence([
        ...trends,
        finding(
          "annual_participants",
          { ...later, value: 31 },
          "Other 2025 report",
        ),
      ]).annual_participants?.hasConflict,
    ).toBe(true);
    expect(isSetupAnswerValue(questions.staff_count, later)).toBe(false);
    expect(
      isSetupAnswerValue(questions.staff_count, {
        ...later,
        periodStart: later.periodEnd,
        value: 0,
      }),
    ).toBe(true);
    expect(
      isSetupAnswerValue(questions.annual_participants, {
        ...later,
        value: 10.5,
      }),
    ).toBe(false);
  });

  it("confirms the reviewer choice and attaches only its matching sources", () => {
    const current = finding("acnc_registered", false, "Charity Register");
    const old = {
      ...finding("acnc_registered", true, "Prior certificate"),
      quoteVerified: false,
    };
    const alternatives = aggregateSetupEvidence([current, old]).acnc_registered
      ?.alternatives;
    expect(
      chooseSetupAnswer(
        questions.acnc_registered,
        {
          status: "confirmed",
          value: false,
        },
        alternatives,
      ),
    ).toEqual({ status: "confirmed", value: false, sources: [current] });
    expect(
      chooseSetupAnswer(
        questions.acnc_registered,
        { status: "confirmed" },
        alternatives,
      ),
    ).toBeNull();
    expect(
      chooseSetupAnswer(questions.acnc_registered, {
        status: "not_applicable",
      }),
    ).toBeNull();
    expect(
      chooseSetupAnswer(questions.website, {
        status: "not_applicable",
        value: "https://irrelevant.invalid",
      }),
    ).toEqual({ status: "not_applicable" });
    expect(
      chooseSetupAnswer(
        questions.legal_name,
        {
          status: "confirmed",
          value: "Manually checked legal name",
        },
        aggregateSetupEvidence([
          finding("legal_name", "Earlier name", "Old register"),
        ]).legal_name?.alternatives,
      ),
    ).toEqual({
      status: "confirmed",
      value: "Manually checked legal name",
    });
  });

  it("validates saved answers and rebuilds their structured fields without unknown data", () => {
    const snapshot = {
      value: 0,
      unit: "people",
      periodStart: "2025-05-01",
      periodEnd: "2025-05-01",
    };
    expect(
      readSetupAnswers({
        staff_count: {
          status: "confirmed",
          value: { ...snapshot, hidden: "unrelated" },
        },
        website: { status: "not_applicable", value: "irrelevant" },
        legal_name: {
          status: "confirmed",
          value: "New name",
          sources: [
            finding("legal_name", "Different name", "Old source"),
            {
              ...finding("legal_name", "New name", "Current certificate"),
              hidden: "unrelated",
            },
          ],
        },
        abn: { status: "suggested", value: "example-only" },
        mission: { status: "not_applicable" },
        unknown: { status: "confirmed", value: "unknown" },
      }),
    ).toEqual({
      staff_count: { status: "confirmed", value: snapshot },
      website: { status: "not_applicable" },
      legal_name: {
        status: "confirmed",
        value: "New name",
        sources: [finding("legal_name", "New name", "Current certificate")],
      },
    });
  });
});
