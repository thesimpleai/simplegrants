import type { Profile, ReviewCheck } from "../types";
import { australianIdentifierDigits } from "./profile-values";

const listFields = new Set([
  "focus_areas",
  "beneficiaries",
  "service_locations",
]);
const recordFields = new Set([
  "activities",
  "milestones",
  "insurance_policies",
  "other_facts",
]);
const metadataFields = new Set(["source_evidence", "review_notes"]);
const normalise = (value: unknown) =>
  typeof value === "string"
    ? value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ")
    : "";
const present = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.length > 0
    : typeof value === "string"
      ? !!value.trim()
      : value !== undefined && value !== null;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const equivalent = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right) ||
  (typeof left === "string" &&
    typeof right === "string" &&
    normalise(left) === normalise(right));

function equivalentProfileValue(field: string, left: unknown, right: unknown) {
  if (equivalent(left, right)) return true;
  if (typeof left !== "string" || typeof right !== "string") return false;
  const digits = australianIdentifierDigits(field, left);
  return (
    digits !== undefined && digits === australianIdentifierDigits(field, right)
  );
}
function identity(field: string, row: Record<string, unknown>): string {
  if (field === "activities") return normalise(row.name);
  if (field === "milestones")
    return normalise(row.title)
      ? `${normalise(row.title)}|${normalise(row.date)}`
      : "";
  if (field === "other_facts") return normalise(row.label);
  if (normalise(row.policy_number))
    return `policy:${normalise(row.policy_number)}`;
  return normalise(row.insurer) && normalise(row.policy_type)
    ? `cover:${normalise(row.insurer)}|${normalise(row.policy_type)}|${normalise(row.starts_on)}`
    : "";
}
function unique(values: unknown[]) {
  return [
    ...new Map(values.map((value) => [JSON.stringify(value), value])).values(),
  ];
}

/** Keep reviewed facts while adding new documented candidates for final approval.
 * Matching records retain conflicting reviewed values; separate records stay separate. */
export function mergeReviewedProfile(
  saved: Profile,
  proposed: Profile,
): { profile: Profile; checks: ReviewCheck[] } {
  const profile: Profile = { ...saved, ...proposed };
  const checks: ReviewCheck[] = [];
  const conflict = (field: string, value: unknown) =>
    checks.push({
      field,
      issue:
        "Your previously approved value has been kept. The new source review proposed a different value.",
      source: "Previously approved organisation profile",
      suggestion:
        `Compare the originals before changing it. New draft: ${JSON.stringify(value)}`.slice(
          0,
          1500,
        ),
    });
  for (const [field, previous] of Object.entries(saved)) {
    if (!present(previous)) continue;
    const candidate = proposed[field];
    if (metadataFields.has(field)) {
      profile[field] =
        Array.isArray(previous) && Array.isArray(candidate)
          ? unique([...previous, ...candidate])
          : previous;
    } else if (listFields.has(field) && Array.isArray(previous)) {
      const entries = new Map<string, unknown>();
      for (const value of [
        ...previous,
        ...(Array.isArray(candidate) ? candidate : []),
      ]) {
        const key = normalise(value) || JSON.stringify(value);
        if (!entries.has(key)) entries.set(key, value);
      }
      profile[field] = [...entries.values()];
    } else if (recordFields.has(field) && Array.isArray(previous)) {
      const rows = previous.map((value) =>
        record(value) ? { ...value } : value,
      );
      for (const value of Array.isArray(candidate) ? candidate : []) {
        if (!record(value)) continue;
        const key = identity(field, value);
        const index = key
          ? rows.findIndex((row) => record(row) && identity(field, row) === key)
          : -1;
        if (index < 0) {
          if (
            !rows.some((row) => JSON.stringify(row) === JSON.stringify(value))
          )
            rows.push({ ...value });
          continue;
        }
        const existing = rows[index] as Record<string, unknown>;
        for (const [property, next] of Object.entries(value)) {
          if (!present(next)) continue;
          if (!present(existing[property])) existing[property] = next;
          else if (!equivalent(existing[property], next)) {
            if (property === "source") {
              existing.source = [existing.source, next]
                .filter(
                  (source, position, sources) =>
                    sources.findIndex(
                      (item) => normalise(item) === normalise(source),
                    ) === position,
                )
                .join("; ");
            } else conflict(`${field}[${index}].${property}`, next);
          }
        }
      }
      profile[field] = rows;
    } else {
      if (
        present(candidate) &&
        !equivalentProfileValue(field, previous, candidate)
      )
        conflict(field, candidate);
      profile[field] = previous;
    }
  }
  return { profile, checks };
}
