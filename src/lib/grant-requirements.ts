import type { DocumentRecord } from "../types";

type EvidenceDocument = Pick<DocumentRecord, "category" | "expires_on">;

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
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const present = documents.some(
    (document) =>
      [
        "insurance",
        "insurance_certificate",
        "public_liability",
        "public_liability_insurance",
      ].includes(document.category) &&
      (!document.expires_on ||
        (/^\d{4}-\d{2}-\d{2}$/.test(document.expires_on) &&
          !Number.isNaN(Date.parse(`${document.expires_on}T00:00:00Z`)) &&
          new Date(`${document.expires_on}T00:00:00Z`)
            .toISOString()
            .slice(0, 10) === document.expires_on &&
          document.expires_on >= today)),
  );
  return present
    ? []
    : [
        "The current guidelines require insurance. Upload a current insurance document before preparing a draft.",
      ];
}
