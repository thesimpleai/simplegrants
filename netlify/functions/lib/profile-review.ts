import type { Profile, ReviewCheck } from "../../../src/types";
import { profileValues } from "../../../src/lib/profile-values";

export const hasProfileValue = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(hasProfileValue)
    : value && typeof value === "object"
      ? Object.entries(value).some(
          ([field, item]) => field !== "source" && hasProfileValue(item),
        )
      : typeof value === "string"
        ? !!value.trim()
        : typeof value === "boolean";
export const profileField = (value: string) =>
  value
    .toLowerCase()
    .replace(/^profile[.\s]+/, "")
    .split(/[.\[]/)[0]
    .replace(/[^a-z]/g, "")
    .replace(/^profile/, "")
    .replace(/^organisationtype$|^organizationtype$/, "type")
    .replace(/^stateorterritory$/, "state")
    .replace(/^charityregistration$|^acnc$/, "acncregistered");
function findingAffects(field: string, target: string) {
  return field.split(/[,;/]|\band\b|\bor\b/i).some((part) => {
    const normalised = profileField(part);
    // Unknown/general scope must not silently override a source finding.
    return !knownFields.has(normalised) || normalised === profileField(target);
  });
}
const fields = [
  "name",
  "legal_name",
  "abn",
  "type",
  "state",
  "description",
  "focus_areas",
  "website",
  "acnc_registered",
  "mission",
  "beneficiaries",
  "service_locations",
  "history",
  "milestones",
  "activities",
  "founded_on",
  "registration_date",
  "registration_authority",
  "registration_number",
  "charity_registration_date",
  "charity_registration_number",
  "certificate_issue_date",
  "insurance_policies",
  "other_facts",
] as const;
// Optional sections should stay optional in the review form. Missing core
// fields remain explicit gaps; missing optional records do not create noise.
const coreFields = new Set<string>(fields.slice(0, 9));
const knownFields = new Set(fields.map(profileField));

const recordGroups = {
  milestones: { title: "" },
  activities: { name: "" },
  insurance_policies: { insurer: "", policy_type: "" },
  other_facts: { label: "", value: "" },
} as const;
const identityText = (value: unknown) =>
  typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";
function sameRecord(
  group: string,
  left: Record<string, unknown>,
  right: Record<string, unknown>,
) {
  if (
    Object.keys(left).length === Object.keys(right).length &&
    Object.entries(left).every(([key, value]) => value === right[key])
  )
    return true;
  if (group === "insurance_policies") {
    const first = identityText(left.policy_number),
      second = identityText(right.policy_number);
    if (first && second) return first === second;
    return (
      ["insurer", "policy_type"].every(
        (field) =>
          identityText(left[field]) &&
          identityText(left[field]) === identityText(right[field]),
      ) &&
      !(left.starts_on && right.starts_on && left.starts_on !== right.starts_on)
    );
  }
  const label =
    group === "milestones"
      ? "title"
      : group === "activities"
        ? "name"
        : "label";
  return (
    !!identityText(left[label]) &&
    identityText(left[label]) === identityText(right[label])
  );
}
/** An indexed source finding disputes that record/leaf, not all sibling facts.
 * General, unknown and group-level findings remain conservative. */
function recordFindingAffects(
  field: string,
  group: string,
  indices: number[],
  leaf: string,
) {
  return field.split(/[,;/]|\band\b|\bor\b/i).some((part) => {
    const root = profileField(part);
    if (!knownFields.has(root)) return true;
    if (root !== profileField(group)) return false;
    const indexed = part
      .trim()
      .toLowerCase()
      .replace(/^profile[.\s]+/, "")
      .match(/^[a-z_]+\s*(?:\[(\d+)\]|\.(\d+))(?:\.([a-z_]+))?/);
    if (!indexed) return true;
    if (!indices.includes(Number(indexed[1] ?? indexed[2]))) return false;
    return !indexed[3] || profileField(indexed[3]) === profileField(leaf);
  });
}

function restoreRecordOmissions(
  profile: Profile,
  draft: Profile,
  findings: ReviewCheck[],
  checks: ReviewCheck[],
) {
  for (const [group, defaults] of Object.entries(recordGroups)) {
    const original = draft[group];
    if (!Array.isArray(original)) continue;
    const corrected = Array.isArray(profile[group])
      ? (profile[group] as Record<string, unknown>[])
      : [];
    const records = corrected.map((record) => ({ ...record }));
    const used = new Set<number>();
    for (const [originalIndex, candidate] of original.entries()) {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      )
        continue;
      const record = candidate as Record<string, unknown>;
      const matches = corrected.flatMap((item, index) =>
        !used.has(index) && sameRecord(group, record, item) ? [index] : [],
      );
      // Ambiguous identities stay separate for explicit review. Never attach an
      // omitted policy number to one of several indistinguishable policies.
      let index = matches.length === 1 ? matches[0] : -1;
      if (
        index < 0 &&
        original.length === 1 &&
        corrected.length === 1 &&
        !Object.keys(defaults).some(
          (key) =>
            hasProfileValue(record[key]) || hasProfileValue(corrected[0][key]),
        )
      )
        index = 0;
      const indices = index < 0 ? [originalIndex] : [originalIndex, index];
      const target: Record<string, unknown> =
        index < 0 ? { ...defaults } : records[index];
      const restored: string[] = [];
      for (const [leaf, value] of Object.entries(record)) {
        if (
          !hasProfileValue(target[leaf]) &&
          hasProfileValue(value) &&
          !findings.some((finding) =>
            recordFindingAffects(finding.field, group, indices, leaf),
          )
        ) {
          target[leaf] = value;
          restored.push(leaf);
        }
      }
      if (index >= 0) used.add(index);
      if (!restored.length) continue;
      if (index < 0) {
        // A source label alone is not an organisation fact or insurance record.
        if (!hasProfileValue(target)) continue;
        index = records.length;
        records.push(target);
      }
      for (const leaf of restored)
        checks.push({
          field: `${group}[${index}].${leaf}`,
          issue:
            "The correction step omitted this extracted value without a source finding. It is retained as an unconfirmed draft; check it against the originals.",
          source: "Initial extraction and independent source review",
          suggestion:
            "Confirm this value from the source document, or clear it if it is not supported.",
        });
    }
    if (records.length) Object.assign(profile, { [group]: records });
  }
}

/** Preserve extracted candidates for explicit review, never an old saved profile.
 * A field with a source finding is allowed to be removed; it is never restored. */
export function completeProfileReview(
  draft: Profile,
  corrected: Profile,
  verified: ReviewCheck[],
  final: ReviewCheck[],
) {
  const checks = [
    ...new Map(
      [...verified, ...final].map((item) => [JSON.stringify(item), item]),
    ).values(),
  ];
  const profile: Profile = { ...corrected };
  const findings = [...checks];
  restoreRecordOmissions(profile, draft, findings, checks);
  for (const field of [
    "focus_areas",
    "beneficiaries",
    "service_locations",
  ] as const) {
    if (findings.some((check) => findingAffects(check.field, field))) continue;
    const values = profile[field] ?? [];
    const restored = (draft[field] ?? []).filter(
      (value) =>
        value.trim() &&
        !values.some((item) => identityText(item) === identityText(value)),
    );
    if (!restored.length) continue;
    profile[field] = [...values, ...restored];
    checks.push({
      field,
      issue:
        "The correction step omitted extracted list entries without a source finding. They are retained as unconfirmed draft values; check them against the originals.",
      source: "Initial extraction and independent source review",
      suggestion:
        "Confirm each retained value from the source document, or remove it if it is not supported.",
    });
  }
  for (const field of fields) {
    const disputed = findings.some((check) =>
      findingAffects(check.field, field),
    );
    if (
      !hasProfileValue(profile[field]) &&
      hasProfileValue(draft[field]) &&
      !disputed
    ) {
      Object.assign(profile, { [field]: draft[field] });
      checks.push({
        field,
        issue:
          "The correction step omitted this extracted value without a source finding. It is retained as an unconfirmed draft; check it against the originals.",
        source: "Initial extraction and independent source review",
        suggestion:
          "Confirm this value from the source document, or clear it if it is not supported.",
      });
    }
    if (
      coreFields.has(field) &&
      !hasProfileValue(profile[field]) &&
      !checks.some((check) => profileField(check.field) === profileField(field))
    )
      checks.push({
        field,
        issue: "This information was not established in the selected sources.",
        suggestion:
          "Leave it blank unless you can confirm it against an original source.",
      });
  }
  const normalised = profileValues(profile);
  if (
    profile.type &&
    normalised.type === "Other" &&
    profile.type.trim().toLowerCase() !== "other"
  )
    checks.push({
      field: "type",
      issue: `The source type “${profile.type}” does not match a standard option. It is shown as Other for your review.`,
      suggestion:
        "Confirm the legal entity type from the original registration document.",
    });
  return { profile: normalised, checks };
}
