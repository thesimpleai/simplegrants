import type { Profile } from "../types";

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
export function profileValues(profile: Profile): Profile {
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
  return {
    ...profile,
    ...(profile.type !== undefined
      ? { type: organisationType(profile.type) }
      : {}),
    ...(profile.state
      ? {
          state:
            states[key(profile.state)] ?? profile.state.trim().toUpperCase(),
        }
      : {}),
  };
}
