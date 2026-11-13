import type { DocumentRecord } from "../types";

type EvidenceDocument = Pick<DocumentRecord, "category" | "expires_on">;

export const isInsuranceCategory = (category: string) =>
  [
    "insurance",
    "insurance_certificate",
    "public_liability",
    "public_liability_insurance",
  ].includes(category);
export function validExpiryDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function documentExpiryStatus(
  value: string | null | undefined,
  now = new Date(),
): "unknown" | "expired" | "current" {
  if (!value || !validExpiryDate(value)) return "unknown";
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return value < today ? "expired" : "current";
}
export function hasCurrentInsurance(
  documents: EvidenceDocument[],
  now = new Date(),
): boolean {
  return documents.some(
    (doc) =>
      isInsuranceCategory(doc.category) &&
      documentExpiryStatus(doc.expires_on, now) === "current",
  );
}

/** A narrow source-based gate; ambiguous and conditional clauses still need preflight review. */
export function explicitlyRequiresInsurance(guidelines: string): boolean {
  const clauses = guidelines
    .replace(/\r/g, "")
    .split(/[.!?;]+|\n\s*\n|\bbut\b/i)
    .map((clause) => clause.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(
      (clause) =>
        !/\b(?:if|unless|where applicable|when applicable)\b/.test(clause),
    )
    .flatMap((clause) => clause.split(","))
    .filter(Boolean);
  return clauses.some((clause) => {
    if (!/\binsurance\b|\bpublic[ -]liability\b/.test(clause)) return false;
    // Never turn an optional, negated or unresolved conditional clause into a universal rule.
    if (
      /\boptional\b|\bnot\s+(?:[a-z]+\s+){0,2}(?:required|mandatory|compulsory|necessary|needed)\b|\b(?:do|does)\s+not\s+require\b|\bno\s+(?:insurance\s+)?requirement\b|\bno\s+(?:current\s+)?(?:insurance|public[ -]liability(?:\s+(?:insurance|cover))?)\s+(?:is\s+)?(?:required|needed|necessary)\b|\b(?:if|unless|where applicable|when applicable|may provide|can provide|recommended)\b/.test(
        clause,
      ) ||
      /\bmust\s+not\s+(?:be\s+)?(?:provided|submitted|uploaded|supplied|provide|submit|upload|supply)\b/.test(
        clause,
      )
    )
      return false;
    const mandatory =
      /\b(?:must|shall|required|mandatory|compulsory|requires?)\b|\bneed(?:s)?\s+to\s+(?:have|hold|provide|supply|upload)\b/.test(
        clause,
      );
    const absenceDisqualifies =
      /\bwithout\b/.test(clause) &&
      /\bineligible\b|\bnot\s+(?:be\s+)?(?:eligible|accepted|considered)\b|\brejected\b|\bno\s+application\b/.test(
        clause,
      );
    return mandatory || absenceDisqualifies;
  });
}

export function draftEvidenceBlockers(
  guidelines: string,
  documents: EvidenceDocument[],
  now = new Date(),
): string[] {
  if (!explicitlyRequiresInsurance(guidelines)) return [];
  const present = hasCurrentInsurance(documents, now);
  return present
    ? []
    : [
        documents.some((doc) => isInsuranceCategory(doc.category))
          ? "The current guidelines require insurance. Record a current expiry date for your insurance document in My organisation before preparing a draft."
          : "The current guidelines require insurance. Upload a current insurance document before preparing a draft.",
      ];
}
