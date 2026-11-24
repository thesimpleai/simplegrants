import type { Profile } from "../types";

/** Public identifier formatting is optional. Other registry codes keep their
 * meaningful prefixes and punctuation. */
export function australianIdentifierDigits(
  field: string,
  value: string,
): string | undefined {
  const text = value.normalize("NFKC").trim();
  const digits =
    field === "abn"
      ? text.replace(
          /^(?:A\.?B\.?N\.?|Australian Business Number)\s*:?\s*/i,
          "",
        )
      : field === "registration_number"
        ? text.replace(
            /^(?:A\.?C\.?N\.?|Australian Company Number)\s*:?\s*/i,
            "",
          )
        : "";
  const compact = digits.replace(/[\s-]/gu, "");
  const length = field === "abn" ? 11 : 9;
  return compact.length === length && /^\d+$/.test(compact)
    ? compact
    : undefined;
}

export const ORGANISATION_TYPES = [
  "Charity",
  "Not-for-profit",
  "Community organisation",
  "Incorporated association",
  "Company limited by guarantee",
  "Social enterprise",
  "Other",
] as const;
const key = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export function organisationType(value: string | undefined): string {
  if (!value?.trim()) return "";
  const canonical = ORGANISATION_TYPES.find((type) => key(type) === key(value));
  if (canonical) return canonical;
  const aliases: Record<string, string> = {
    nonprofit: "Not-for-profit",
    nonprofitorganisation: "Not-for-profit",
    nonprofitorganization: "Not-for-profit",
    nfp: "Not-for-profit",
    incorporatedassn: "Incorporated association",
    incorporatedassoc: "Incorporated association",
    clg: "Company limited by guarantee",
    communityorganization: "Community organisation",
  };
  return aliases[key(value)] ?? "Other";
}
const states: Record<string, string> = {
  victoria: "VIC",
  newsouthwales: "NSW",
  queensland: "QLD",
  southaustralia: "SA",
  westernaustralia: "WA",
  tasmania: "TAS",
  northernterritory: "NT",
  australiancapitalterritory: "ACT",
  australiawide: "Australia-wide",
};

export function profileState(value: string): string {
  return states[key(value)] ?? value.trim().toUpperCase();
}

export function profileValues(profile: Profile): Profile {
  return {
    ...profile,
    ...(profile.type !== undefined
      ? { type: organisationType(profile.type) }
      : {}),
    ...(profile.state
      ? {
          state: profileState(profile.state),
        }
      : {}),
  };
}
