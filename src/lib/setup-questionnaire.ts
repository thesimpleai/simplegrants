import type { DocumentRecord, Profile } from "../types";
import { documentedProfileDate, profileDateOnly } from "./profile-dates";
import { australianIdentifierDigits, profileState } from "./profile-values";

export type SetupQuestionKind = "text" | "list" | "boolean" | "date" | "metric";
export type SetupDatedMetric = {
  value: number;
  unit: string;
  periodStart: string;
  periodEnd: string;
};
export type SetupAnswerValue = string | string[] | boolean | SetupDatedMetric;

export interface SetupQuestion {
  key: string;
  section: string;
  label: string;
  help: string;
  kind: SetupQuestionKind;
  profileField?: Extract<keyof Profile, string>;
  documentCategories: readonly string[];
  suggestedDocuments: readonly string[];
  allowsNotApplicable?: boolean;
  metricPeriod?: "point_in_time" | "date_range";
  metricUnit?: "people" | "hours";
}

function section<const Key extends string>(
  title: string,
  documentCategories: readonly string[],
  suggestedDocuments: readonly string[],
  questions: ReadonlyArray<
    Omit<
      SetupQuestion,
      "key" | "section" | "documentCategories" | "suggestedDocuments"
    > & {
      key: Key;
    }
  >,
): ReadonlyArray<SetupQuestion & { key: Key }> {
  return questions.map((question) => ({
    ...question,
    section: title,
    documentCategories,
    suggestedDocuments,
  }));
}

export const setupQuestionnaire = [
  ...section(
    "Legal identity and eligibility",
    ["registration", "acnc", "other"],
    [
      "ABN Lookup extract",
      "Incorporation certificate",
      "ACNC Charity Register record",
      "Public organisation website",
    ],
    [
      {
        key: "legal_name",
        label: "What is your registered legal name?",
        help: "Use the exact name on the relevant register or incorporation certificate.",
        kind: "text",
        profileField: "legal_name",
      },
      {
        key: "abn",
        label: "What is your Australian Business Number (ABN)?",
        help: "Use the organisation’s public 11-digit ABN. Leave this open if you have not checked it.",
        kind: "text",
        profileField: "abn",
        allowsNotApplicable: true,
      },
      {
        key: "entity_type",
        label: "What is your legal entity type?",
        help: "Use the registered legal structure, such as incorporated association or company limited by guarantee.",
        kind: "text",
        profileField: "type",
      },
      {
        key: "base_state",
        label: "Where is the organisation based?",
        help: "Record the state or territory of the registered base. Service locations are recorded separately.",
        kind: "text",
        profileField: "state",
      },
      {
        key: "website",
        label: "What is your public website?",
        help: "Use a public website address without any login or access token.",
        kind: "text",
        profileField: "website",
        allowsNotApplicable: true,
      },
      {
        key: "founded_on",
        label: "When was the organisation founded?",
        help: "Use the date, month or year stated in the source. A registration date does not establish when operations began.",
        kind: "date",
        profileField: "founded_on",
      },
      {
        key: "registration_authority",
        label: "Which authority registered or incorporated the organisation?",
        help: "Record the regulator responsible for the entity registration.",
        kind: "text",
        profileField: "registration_authority",
        allowsNotApplicable: true,
      },
      {
        key: "registration_number",
        label: "What is your public incorporation or registration number?",
        help: "Record the legal entity’s public identifier issued by that authority. The ABN is recorded separately.",
        kind: "text",
        profileField: "registration_number",
        allowsNotApplicable: true,
      },
      {
        key: "registration_date",
        label: "When was the organisation legally registered or incorporated?",
        help: "Use the recorded registration date. Certificate issue, founding and charity registration dates are separate.",
        kind: "date",
        profileField: "registration_date",
        allowsNotApplicable: true,
      },
      {
        key: "acnc_registered",
        label: "Is the organisation currently a registered charity?",
        help: "Confirm current ACNC status using the Charity Register. Answer No only when supported.",
        kind: "boolean",
        profileField: "acnc_registered",
      },
      {
        key: "charity_registration_date",
        label: "When did charity registration begin?",
        help: "Use the date stated by the ACNC. Leave this open if no date is available.",
        kind: "date",
        profileField: "charity_registration_date",
        allowsNotApplicable: true,
      },
      {
        key: "dgr_endorsed",
        label:
          "Does the organisation currently have deductible gift recipient (DGR) endorsement?",
        help: "Check current endorsement through ABN Lookup or ATO evidence. Charity registration alone does not establish DGR endorsement.",
        kind: "boolean",
      },
      {
        key: "dgr_scope",
        label: "Which entity, fund or activity has DGR endorsement?",
        help: "Record the published scope so a fund-limited endorsement is not mistaken for whole-organisation endorsement.",
        kind: "text",
        allowsNotApplicable: true,
      },
    ],
  ),
  ...section(
    "Purpose and community",
    ["mission", "background", "other", "registration", "acnc"],
    [
      "Public annual report",
      "Strategic plan",
      "Public program pages",
      "Redacted community consultation summary",
    ],
    [
      {
        key: "description",
        label: "What does the organisation do?",
        help: "Give a brief overview of your established work and who it serves.",
        kind: "text",
        profileField: "description",
      },
      {
        key: "mission",
        label: "What is the organisation’s mission or purpose?",
        help: "Use your current approved mission or public purpose statement.",
        kind: "text",
        profileField: "mission",
      },
      {
        key: "focus_areas",
        label: "What areas does the organisation focus on?",
        help: "List the main issues or service areas your work addresses.",
        kind: "list",
        profileField: "focus_areas",
      },
      {
        key: "beneficiaries",
        label: "Who does the organisation support?",
        help: "Describe communities or groups in aggregate, without identifying individuals.",
        kind: "list",
        profileField: "beneficiaries",
      },
      {
        key: "service_locations",
        label: "Where does your organisation deliver services?",
        help: "List the suburbs, councils, regions or states your documented services reach.",
        kind: "list",
        profileField: "service_locations",
      },
      {
        key: "community_need",
        label: "What documented community needs does the organisation address?",
        help: "Summarise established needs and the supporting public data or redacted consultation. Project-specific need is recorded in each application.",
        kind: "text",
      },
      {
        key: "history",
        label: "How did the organisation develop?",
        help: "Summarise documented milestones and past work. Keep dates and completed activities separate from plans.",
        kind: "text",
        profileField: "history",
      },
      {
        key: "current_programs",
        label: "Which programs and services are currently operating?",
        help: "List programs confirmed to be active. Keep past and proposed projects separate.",
        kind: "list",
      },
      {
        key: "partnerships",
        label: "Which partnerships support the organisation’s ongoing work?",
        help: "List organisations and established roles. Avoid personal contact details or claims about unsigned commitments.",
        kind: "list",
        allowsNotApplicable: true,
      },
      {
        key: "community_involvement",
        label: "How do community members shape your organisation’s work?",
        help: "Describe established consultation, co-design or feedback approaches without personal details.",
        kind: "text",
        allowsNotApplicable: true,
      },
    ],
  ),
  ...section(
    "Governance and delivery",
    ["background", "other", "registration", "acnc"],
    [
      "Constitution",
      "Public governance summary",
      "Redacted policy excerpts",
      "Program evaluation framework",
    ],
    [
      {
        key: "governance_structure",
        label: "How is the organisation governed?",
        help: "Describe governing bodies, oversight and decision-making. Leave out personal details.",
        kind: "text",
      },
      {
        key: "safeguarding",
        label: "What safeguarding arrangements are in place?",
        help: "Describe relevant policies, screening and incident procedures in general terms. Keep case details and personal records private.",
        kind: "text",
        allowsNotApplicable: true,
      },
      {
        key: "risk_and_safety",
        label: "How does the organisation manage delivery and safety risks?",
        help: "Summarise documented controls, responsibilities and review practices. Keep sensitive incident details private.",
        kind: "text",
        allowsNotApplicable: true,
      },
      {
        key: "accessibility_and_inclusion",
        label:
          "How does the organisation make its services accessible and inclusive?",
        help: "Describe established actions such as language support, access arrangements or accessible formats.",
        kind: "text",
        allowsNotApplicable: true,
      },
      {
        key: "evaluation_approach",
        label: "How does the organisation measure its outcomes?",
        help: "Describe existing methods and indicators. Save measured results and periods separately.",
        kind: "text",
        allowsNotApplicable: true,
      },
      {
        key: "reporting_capacity",
        label: "How does the organisation manage grant delivery and reporting?",
        help: "Summarise documented budgeting, record keeping, monitoring and reporting responsibilities.",
        kind: "text",
        allowsNotApplicable: true,
      },
    ],
  ),
  ...section(
    "Insurance",
    [
      "insurance",
      "insurance_certificate",
      "public_liability",
      "public_liability_insurance",
    ],
    ["Redacted certificate of currency", "Public insurance summary"],
    [
      {
        key: "insurance_current",
        label: "Does the organisation currently hold relevant insurance?",
        help: "Check the policy dates and coverage against current records. Expired cover does not establish current insurance.",
        kind: "boolean",
        allowsNotApplicable: true,
      },
      {
        key: "insurance_types",
        label: "What types of cover does the organisation currently hold?",
        help: "List the active cover types, such as public liability. Leave policy numbers and private details in the library.",
        kind: "list",
        allowsNotApplicable: true,
      },
      {
        key: "insurance_expiry",
        label: "When does the relevant insurance cover expire?",
        help: "Use the exact certificate expiry date. When recording more than one policy, use the earliest relevant expiry and identify the cover in your source.",
        kind: "date",
        allowsNotApplicable: true,
      },
    ],
  ),
  ...section(
    "Financial readiness",
    ["financial_summary", "other"],
    [
      "Public annual report or published financial summary",
      "Manually entered statement or redacted excerpt",
    ],
    [
      {
        key: "financial_summary_period",
        label: "What is the latest published financial summary period?",
        help: "Record the stated financial year or start and end dates. Keep private accounts and financial statements in the document library.",
        kind: "text",
        allowsNotApplicable: true,
      },
      {
        key: "audit_review_status",
        label:
          "Was the published financial summary independently audited or reviewed?",
        help: "Use the exact status and period from the public summary. An independent review is distinct from an audit.",
        kind: "text",
        allowsNotApplicable: true,
      },
      {
        key: "financial_controls",
        label: "What financial controls are in place?",
        help: "Summarise established oversight, approvals and reporting controls. Keep account information, balances and transactions private.",
        kind: "text",
        allowsNotApplicable: true,
      },
      {
        key: "funding_model",
        label: "Which funding sources support the organisation?",
        help: "List established funding categories such as grants, donations, fees or memberships. Leave out accounts, individual donors and unverified figures.",
        kind: "list",
        allowsNotApplicable: true,
      },
    ],
  ),
  ...section(
    "Capacity and track record",
    ["background", "financial_summary", "other"],
    [
      "Public annual report",
      "Redacted program or workforce summary",
      "Published impact report",
      "Public records of completed grants",
    ],
    [
      {
        key: "staff_count",
        label: "How many paid staff does the organisation currently have?",
        help: "Enter a documented headcount as of a stated date. Use 0 if confirmed and leave the answer open if unknown.",
        kind: "metric",
        metricPeriod: "point_in_time",
        metricUnit: "people",
      },
      {
        key: "volunteer_count",
        label:
          "How many active volunteers does the organisation currently have?",
        help: "Enter a documented headcount as of a stated date. Record volunteer hours separately.",
        kind: "metric",
        metricPeriod: "point_in_time",
        metricUnit: "people",
      },
      {
        key: "annual_participants",
        label:
          "How many unique participants did your organisation support in a recorded reporting period?",
        help: "Use the exact reporting start and end dates. Use a documented count of distinct people, without estimating unique people from attendance totals.",
        kind: "metric",
        metricPeriod: "date_range",
        metricUnit: "people",
        allowsNotApplicable: true,
      },
      {
        key: "annual_volunteer_hours",
        label: "How many volunteer hours were recorded in a reporting period?",
        help: "Use the actual reporting dates and documented hours. Keep headcounts and estimates separate.",
        kind: "metric",
        metricPeriod: "date_range",
        metricUnit: "hours",
        allowsNotApplicable: true,
      },
      {
        key: "past_grant_delivery",
        label: "Which funded projects has the organisation completed?",
        help: "Give brief examples of completed work, including relevant funder names, periods and reported outcomes. Avoid private financial details.",
        kind: "text",
        allowsNotApplicable: true,
      },
      {
        key: "outcomes_evidence",
        label: "What outcomes can the organisation substantiate?",
        help: "Summarise measured or documented outcomes and state the period and evidence. Keep goals, estimates and delivered results distinct.",
        kind: "text",
        allowsNotApplicable: true,
      },
    ],
  ),
] as const;

export type SetupQuestionKey = (typeof setupQuestionnaire)[number]["key"];
export const setupQuestionByKey = Object.fromEntries(
  setupQuestionnaire.map((question) => [question.key, question]),
) as Readonly<
  Record<SetupQuestionKey, SetupQuestion & { key: SetupQuestionKey }>
>;

export interface SetupSuggestion {
  questionKey: SetupQuestionKey;
  value: SetupAnswerValue;
  quote: string;
  sourceLabel: string;
  locator?: string;
  documentId?: string;
  quoteVerified?: boolean;
}
export interface SetupEvidenceAlternative {
  value: SetupAnswerValue;
  suggestions: SetupSuggestion[];
}
export type SetupEvidenceByQuestion = Partial<
  Record<
    SetupQuestionKey,
    { alternatives: SetupEvidenceAlternative[]; hasConflict: boolean }
  >
>;
export type SetupAnswer =
  | {
      status: "confirmed";
      value: SetupAnswerValue;
      sources?: SetupSuggestion[];
    }
  | { status: "not_applicable" };
export type SetupAnswers = Partial<Record<SetupQuestionKey, SetupAnswer>>;

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const shortText = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length <= limit && value.trim().length > 0;
const documentId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const partialDate = /^(?!0000)\d{4}(?:-(?:0[1-9]|1[0-2]))?$/;

export function isSetupQuestionKey(value: unknown): value is SetupQuestionKey {
  return typeof value === "string" && Object.hasOwn(setupQuestionByKey, value);
}

export function isSetupAnswerValue(
  question: SetupQuestion,
  value: unknown,
): value is SetupAnswerValue {
  switch (question.kind) {
    case "boolean":
      return typeof value === "boolean";
    case "list":
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.length <= 20 &&
        value.every((item) => shortText(item, 200))
      );
    case "date":
      return (
        Boolean(profileDateOnly(value)) ||
        (question.key !== "insurance_expiry" &&
          typeof value === "string" &&
          partialDate.test(value))
      );
    case "metric":
      if (!record(value)) return false;
      const starts = profileDateOnly(value.periodStart);
      const ends = profileDateOnly(value.periodEnd);
      return (
        typeof value.value === "number" &&
        Number.isFinite(value.value) &&
        value.value >= 0 &&
        value.value <= Number.MAX_SAFE_INTEGER &&
        value.unit === question.metricUnit &&
        (question.metricUnit !== "people" || Number.isInteger(value.value)) &&
        starts !== null &&
        ends !== null &&
        (question.metricPeriod === "point_in_time"
          ? starts === ends
          : starts < ends)
      );
    case "text":
      return shortText(value, 1500);
  }
}

export function setupProfileAnswer(
  question: SetupQuestion,
  profile: Profile,
): SetupAnswerValue | undefined {
  if (!question.profileField) return;
  const existing = profile[question.profileField];
  let value =
    question.kind === "date"
      ? (documentedProfileDate(existing) ?? existing)
      : existing;
  if (
    question.kind === "date" &&
    question.key !== "insurance_expiry" &&
    typeof value === "string" &&
    /^[a-z]+ \d{4}$/i.test(value.trim())
  ) {
    // Recognise the documented month while leaving its missing day unstated.
    value = documentedProfileDate(`1 ${value.trim()}`)?.slice(0, 7) ?? value;
  }
  return isSetupAnswerValue(question, value) ? value : undefined;
}

const normalisedText = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("en-AU")
    .trim()
    .replace(/\s+/g, " ");

const regulatorNames = new Map([
  ["australian securities and investments commission", "asic"],
  ["australian securities & investments commission", "asic"],
  ["australian charities and not-for-profits commission", "acnc"],
  ["australian charities & not-for-profits commission", "acnc"],
]);

export function setupAnswerComparisonKey(
  question: SetupQuestion,
  value: SetupAnswerValue,
) {
  if (typeof value === "string") {
    const digits = australianIdentifierDigits(question.key, value);
    if (digits !== undefined) return JSON.stringify(["identifier", digits]);
    if (question.key === "base_state")
      return JSON.stringify(profileState(value));
    // URL paths and query values can be case-sensitive.
    if (question.key === "website") {
      const website = value.trim();
      try {
        return JSON.stringify(new URL(website).href);
      } catch {
        return JSON.stringify(website);
      }
    }
    const text = normalisedText(value);
    return JSON.stringify(
      question.key === "registration_authority"
        ? (regulatorNames.get(text) ?? text)
        : text,
    );
  }
  if (typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value))
    return JSON.stringify([...new Set(value.map(normalisedText))].sort());
  return JSON.stringify([
    value.value,
    value.unit,
    value.periodStart,
    value.periodEnd,
  ]);
}

function metricPeriodKey(value: SetupDatedMetric) {
  return JSON.stringify([value.unit, value.periodStart, value.periodEnd]);
}

export function isSetupSuggestion(value: unknown): value is SetupSuggestion {
  if (!record(value) || !isSetupQuestionKey(value.questionKey)) return false;
  return (
    isSetupAnswerValue(setupQuestionByKey[value.questionKey], value.value) &&
    shortText(value.quote, 360) &&
    shortText(value.sourceLabel, 300) &&
    (value.quoteVerified === undefined ||
      typeof value.quoteVerified === "boolean") &&
    (value.locator === undefined || shortText(value.locator, 200)) &&
    (value.documentId === undefined ||
      (typeof value.documentId === "string" &&
        documentId.test(value.documentId)))
  );
}

function cleanAnswer(value: SetupAnswerValue): SetupAnswerValue {
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => item.trim());
  return {
    value: value.value,
    unit: value.unit,
    periodStart: value.periodStart,
    periodEnd: value.periodEnd,
  };
}

function cleanSuggestion(suggestion: SetupSuggestion): SetupSuggestion {
  return {
    questionKey: suggestion.questionKey,
    value: cleanAnswer(suggestion.value),
    quote: suggestion.quote,
    sourceLabel: suggestion.sourceLabel,
    ...(suggestion.locator ? { locator: suggestion.locator } : {}),
    ...(suggestion.documentId ? { documentId: suggestion.documentId } : {}),
    ...(suggestion.quoteVerified === undefined
      ? {}
      : { quoteVerified: suggestion.quoteVerified }),
  };
}

export function readSetupSuggestions(value: unknown): SetupSuggestion[] {
  return Array.isArray(value)
    ? value.filter(isSetupSuggestion).map(cleanSuggestion)
    : [];
}

function sourceKey(suggestion: SetupSuggestion) {
  return JSON.stringify([
    suggestion.documentId ?? suggestion.sourceLabel,
    suggestion.locator,
    suggestion.quote,
  ]);
}

/** Different reports can substantiate different reporting periods. Keep each
 * period intact, and flag only competing values for the same period. */
export function aggregateSetupEvidence(
  suggestions: readonly unknown[],
): SetupEvidenceByQuestion {
  const byQuestion = new Map<
    SetupQuestionKey,
    Map<string, SetupEvidenceAlternative>
  >();
  for (const raw of suggestions) {
    if (!isSetupSuggestion(raw)) continue;
    const suggestion = cleanSuggestion(raw);
    const question = setupQuestionByKey[suggestion.questionKey];
    const alternatives =
      byQuestion.get(suggestion.questionKey) ??
      new Map<string, SetupEvidenceAlternative>();
    byQuestion.set(suggestion.questionKey, alternatives);
    const key = setupAnswerComparisonKey(question, suggestion.value);
    const existing = alternatives.get(key);
    if (!existing) {
      if (alternatives.size < 12)
        alternatives.set(key, {
          value: suggestion.value,
          suggestions: [suggestion],
        });
    } else {
      const matching = existing.suggestions.findIndex(
        (source) => sourceKey(source) === sourceKey(suggestion),
      );
      if (matching === -1 && existing.suggestions.length < 8) {
        existing.suggestions.push(suggestion);
      } else if (matching >= 0 && suggestion.quoteVerified) {
        existing.suggestions[matching] = suggestion;
      }
    }
  }
  return Object.fromEntries(
    [...byQuestion].map(([key, entries]) => {
      const alternatives = [...entries.values()];
      const hasConflict =
        setupQuestionByKey[key].kind === "metric"
          ? new Set(
              alternatives.map(({ value }) =>
                metricPeriodKey(value as SetupDatedMetric),
              ),
            ).size < alternatives.length
          : alternatives.length > 1;
      return [key, { alternatives, hasConflict }];
    }),
  );
}

/** Record an explicit choice. Evidence supports only an equivalent choice,
 * and conflicting recommendations are never selected automatically. */
export function chooseSetupAnswer(
  question: SetupQuestion,
  choice: { status: "confirmed" | "not_applicable"; value?: unknown },
  alternatives: readonly SetupEvidenceAlternative[] = [],
): SetupAnswer | null {
  if (choice.status === "not_applicable")
    return question.allowsNotApplicable ? { status: "not_applicable" } : null;
  if (!isSetupAnswerValue(question, choice.value)) return null;
  const value = cleanAnswer(choice.value);
  const key = setupAnswerComparisonKey(question, value);
  const sources = alternatives
    .flatMap((alternative) => alternative.suggestions)
    .filter(
      (source) =>
        isSetupSuggestion(source) &&
        source.questionKey === question.key &&
        setupAnswerComparisonKey(question, source.value) === key,
    )
    .map(cleanSuggestion);
  return {
    status: "confirmed",
    value,
    ...(sources.length
      ? {
          sources: [
            ...new Map(
              sources.map((source) => [sourceKey(source), source]),
            ).values(),
          ].slice(0, 8),
        }
      : {}),
  };
}

export function readSetupAnswers(value: unknown): SetupAnswers {
  if (!record(value)) return {};
  const answers: SetupAnswers = {};
  for (const question of setupQuestionnaire) {
    const answer = value[question.key];
    if (!record(answer)) continue;
    if (answer.status === "not_applicable" && question.allowsNotApplicable)
      answers[question.key] = { status: "not_applicable" };
    if (
      answer.status !== "confirmed" ||
      !isSetupAnswerValue(question, answer.value)
    )
      continue;
    const confirmed = chooseSetupAnswer(
      question,
      {
        status: "confirmed",
        value: answer.value,
      },
      [
        {
          value: answer.value,
          suggestions: Array.isArray(answer.sources) ? answer.sources : [],
        },
      ],
    );
    if (confirmed) answers[question.key] = confirmed;
  }
  return answers;
}

const financeCategories = new Set([
  "financial",
  "financial_statement",
  "audit",
  "audit_report",
  "bank_statement",
  "payroll",
]);
const privateFinanceName =
  /\b(?:bank statements?|audit reports?|financial statements?|payroll|tax returns?)\b/i;
const publicFinanceName = /\b(?:annual report|redacted|published|public)\b/i;

export function suggestSetupDocuments(
  question: SetupQuestion,
  documents: readonly DocumentRecord[],
): { matches: DocumentRecord[]; recommended: string[] } {
  return {
    matches: documents
      .filter((document) => {
        const category = document.category.toLowerCase().trim();
        if (
          financeCategories.has(category) ||
          !question.documentCategories.includes(category)
        )
          return false;
        const name = document.name.replace(/[_-]+/g, " ");
        if (category === "financial_summary") return true;
        return (
          !privateFinanceName.test(name) &&
          (question.section !== "Financial readiness" ||
            publicFinanceName.test(name))
        );
      })
      .slice(0, 8),
    recommended: [...question.suggestedDocuments],
  };
}
