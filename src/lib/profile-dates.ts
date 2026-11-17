import type { Profile, ReviewCheck } from "../types";

export const PROFILE_TIME_ZONE = "Australia/Melbourne";

/** Use the server clock at each AI stage; never trust a browser-supplied today. */
export function profileToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: PROFILE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function profileDateContext(now = new Date()): string {
  return `The actual current date supplied by the server is ${profileToday(now)} in ${PROFILE_TIME_ZONE}. Use this date for all past/future and insurance currency checks, regardless of your training cutoff or dates in source text. Compare complete calendar dates as date-only values. A past registration date must not be called future. Registration, founding, charity registration, certificate issue and insurance start/expiry dates are distinct facts. Never infer one from another. A future insurance start or expiry can be valid; an expired policy does not prove current cover. Preserve incomplete documented dates without inventing a month or day.`;
}

/** Strict calendar comparison, without midnight offsets or Date.parse rollover. */
export function profileDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1]
    ? value
    : null;
}

/** Complete dates already stored as Australian document wording can be checked
 * without Date.parse heuristics. Keep the original wording in the profile. */
export function documentedProfileDate(value: unknown): string | null {
  const iso = profileDateOnly(value);
  if (iso || typeof value !== "string") return iso;
  const match = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})$/i.exec(
    value.trim(),
  );
  if (!match) return null;
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const month =
    months.findIndex(
      (name) =>
        match[2].toLowerCase() === name ||
        match[2].toLowerCase() === name.slice(0, 3),
    ) + 1;
  return profileDateOnly(
    `${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`,
  );
}

const dateFieldKey = (field: string) => {
  const key = field
    .toLowerCase()
    .replace(/^profile[.\s_-]*/, "")
    .replace(/[^a-z]/g, "");
  const aliases: Record<string, string> = {
    acncregistrationdate: "charityregistrationdate",
    acncregisteredon: "charityregistrationdate",
    foundingdate: "foundedon",
    foundationdate: "foundedon",
  };
  return aliases[key] ?? key;
};
const eventFields = [
  "founded_on",
  "registration_date",
  "charity_registration_date",
  "certificate_issue_date",
] as const;

/** Recompute temporal checks instead of preserving a model's stale clock. Other
 * source disputes remain untouched, even when they also mention the future. */
export function validateProfileDates(
  profile: Profile,
  checks: ReviewCheck[] = [],
  now = new Date(),
): ReviewCheck[] {
  const today = profileToday(now);
  const result = checks.filter((check) => {
    // These findings describe an earlier value/day, not a source dispute. A
    // director may have corrected the date since that review was saved.
    if (
      /^Calendar check as of \d{4}-\d{2}-\d{2} \(Australia\/Melbourne\)$/.test(
        check.source ?? "",
      )
    )
      return false;
    const field = eventFields.find(
      (name) => dateFieldKey(name) === dateFieldKey(check.field),
    );
    const value = field && documentedProfileDate(profile[field]);
    const futureClaim =
      /\bfuture\b|has(?:n't| not) (?:yet )?(?:occurred|happened)|after (?:today|the current date)/i.test(
        check.issue,
      );
    const otherDispute =
      /unsupported|not (?:supported|documented|established|found)|contradict|conflict|mismatch|unverif|unclear|cannot confirm|can't confirm|does not match/i.test(
        check.issue,
      );
    return !(value && value <= today && futureClaim && !otherDispute);
  });
  const add = (field: string, issue: string, suggestion: string) => {
    if (!result.some((check) => check.field === field && check.issue === issue))
      result.push({
        field,
        issue,
        suggestion,
        source: `Calendar check as of ${today} (${PROFILE_TIME_ZONE})`,
      });
  };
  const calendar = (field: string, value: unknown) => {
    if (!value || typeof value !== "string") return null;
    const parsed = documentedProfileDate(value);
    if (
      !parsed &&
      (/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        /^\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+\s+\d{4}$/i.test(value))
    )
      add(
        field,
        "This is not a valid calendar date.",
        "Check the date against the original document.",
      );
    return parsed;
  };
  for (const field of eventFields) {
    const value = calendar(field, profile[field]);
    if (value && value > today)
      add(
        field,
        "This recorded event date is in the future.",
        "Confirm whether the source describes a planned event or a different date, such as a certificate issue date.",
      );
  }
  const policies = Array.isArray(profile.insurance_policies)
    ? profile.insurance_policies
    : [];
  for (const [index, policy] of policies.entries()) {
    if (!policy || typeof policy !== "object") continue;
    const prefix = `insurance_policies[${index}]`;
    const starts = calendar(`${prefix}.starts_on`, policy.starts_on);
    const expires = calendar(`${prefix}.expires_on`, policy.expires_on);
    calendar(`${prefix}.issued_on`, policy.issued_on);
    if (expires && expires < today)
      add(
        `${prefix}.expires_on`,
        "This documented insurance policy has expired.",
        "Keep the historical record and obtain current evidence of cover where a grant requires it.",
      );
    if (starts && expires && starts > expires)
      add(
        `${prefix}.expires_on`,
        "The policy expiry precedes its start date.",
        "Check the coverage period against the original policy document.",
      );
  }
  const activities = Array.isArray(profile.activities)
    ? profile.activities
    : [];
  for (const [index, activity] of activities.entries()) {
    if (!activity || typeof activity !== "object") continue;
    const prefix = `activities[${index}]`;
    const starts = calendar(`${prefix}.start_date`, activity.start_date);
    const ends = calendar(`${prefix}.end_date`, activity.end_date);
    if (starts && ends && starts > ends)
      add(
        `${prefix}.end_date`,
        "The activity end date precedes its start date.",
        "Check the documented activity dates.",
      );
    if (
      activity.status === "historical" &&
      ((starts && starts > today) || (ends && ends > today))
    )
      add(
        prefix,
        "A historical activity has a future date.",
        "Confirm whether this is a planned activity; do not describe proposed work as completed.",
      );
  }
  return result;
}
