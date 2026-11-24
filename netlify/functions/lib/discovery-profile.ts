import { readGrantSetup } from "../../../src/lib/grant-setup-state";
import type { SetupQuestionKey } from "../../../src/lib/setup-questionnaire";
import type { Organisation } from "../../../src/types";
import { safeHttpsUrl } from "./core";

// Discovery sends only public-facing descriptors and reviewed eligibility
// facts. Source quotes, identifiers and financial records stay local.
function text(value: unknown, maximum: number) {
  if (typeof value !== "string") return undefined;
  return (
    value
      .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "[redacted]")
      .replace(
        /\b(?:ABN|ACN|TFN|BSB|account number)\s*[:#-]?\s*\d[\d \t-]{4,}/gi,
        "[redacted]",
      )
      .trim()
      .slice(0, maximum) || undefined
  );
}

function list(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .map((item) => text(item, 150))
    .filter((item): item is string => !!item)
    .slice(0, 8);
  return values.length ? values : undefined;
}

const yesNo = (value: unknown) =>
  typeof value === "boolean" ? value : undefined;

export function discoveryProfile(org: Organisation) {
  const profile = org.verification_status === "approved" ? org.profile : null;
  const setup = profile ? readGrantSetup(profile) : null;
  function reviewed(key: SetupQuestionKey, fallback?: unknown) {
    if (setup?.unresolved.includes(key)) return undefined;
    const answer = setup?.answers[key];
    return answer?.status === "confirmed"
      ? answer.value
      : answer?.status === "not_applicable"
        ? undefined
        : fallback;
  }

  const entity = text(reviewed("entity_type", org.type), 90);
  return {
    base_state: text(reviewed("base_state", org.state), 60),
    service_locations: list(
      reviewed("service_locations", profile?.service_locations),
    ),
    entity_type: entity?.toLowerCase() === "other" ? undefined : entity,
    description: text(reviewed("description", org.description), 700),
    mission: text(reviewed("mission", profile?.mission), 450),
    focus_areas: list(reviewed("focus_areas", org.focus_areas)),
    beneficiaries: list(reviewed("beneficiaries", profile?.beneficiaries)),
    current_programs: list(reviewed("current_programs")),
    acnc_registered: yesNo(
      reviewed("acnc_registered", profile?.acnc_registered),
    ),
    dgr_endorsed: yesNo(reviewed("dgr_endorsed")),
    dgr_scope: text(reviewed("dgr_scope"), 180),
  };
}

export function discoveryLocalityHint(org: Organisation) {
  if (org.verification_status !== "approved" || !org.profile) return "";
  const setup = readGrantSetup(org.profile);
  const name = setup.answers.legal_name;
  const site = setup.answers.website;
  const legalName = setup.unresolved.includes("legal_name")
    ? undefined
    : text(
        name?.status === "confirmed" ? name.value : org.profile.legal_name,
        150,
      );
  const website = setup.unresolved.includes("website")
    ? undefined
    : text(
        site?.status === "confirmed"
          ? site.value
          : org.website || org.profile.website,
        300,
      );
  const uri = website ? safeHttpsUrl(website) : null;
  const host = uri ? new URL(uri).hostname : undefined;
  return legalName || host
    ? `The following public organisation details may help locate its publicly documented area of work when service locations are missing: ${JSON.stringify({ legal_name: legalName, website_host: host })}. Use them only to establish geographic clues. Report where delivery still needs confirmation.`
    : "";
}
