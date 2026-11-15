import type { Profile, ReviewCheck } from "../../../src/types";
import { profileValues } from "../../../src/lib/profile-values";

export const hasProfileValue = (value: unknown) =>
  Array.isArray(value)
    ? value.some((item) => typeof item === "string" && item.trim())
    : typeof value === "string"
      ? !!value.trim()
      : typeof value === "boolean";
export const profileField = (value: string) =>
  value
    .toLowerCase()
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
] as const;
const knownFields = new Set(fields.map(profileField));

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
  for (const field of fields) {
    const disputed = checks.some((check) => findingAffects(check.field, field));
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
