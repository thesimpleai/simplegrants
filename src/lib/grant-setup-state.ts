import type { Organisation, Profile } from "../types";
import { profileValues } from "./profile-values";
import {
  aggregateSetupEvidence,
  isSetupQuestionKey,
  readSetupAnswers,
  readSetupSuggestions,
  setupQuestionnaire,
  type SetupAnswer,
  type SetupQuestionKey,
  type SetupSuggestion,
} from "./setup-questionnaire";

export type GrantSetupAnswers = Partial<Record<SetupQuestionKey, SetupAnswer>>;

export function readGrantSetupEvidence(value: unknown): SetupSuggestion[] {
  return readSetupSuggestions(value);
}

export function readGrantSetup(profile: Profile) {
  const saved = profile.grant_setup;
  if (
    !saved ||
    typeof saved !== "object" ||
    !("version" in saved) ||
    saved.version !== 1
  )
    return {
      answers: {} as GrantSetupAnswers,
      evidence: [] as SetupSuggestion[],
      unresolved: [] as SetupQuestionKey[],
    };
  return {
    answers: readSetupAnswers("answers" in saved ? saved.answers : null),
    evidence: readGrantSetupEvidence(
      "evidence" in saved ? saved.evidence : null,
    ),
    unresolved:
      "unresolved" in saved && Array.isArray(saved.unresolved)
        ? saved.unresolved.filter(isSetupQuestionKey)
        : [],
  };
}

export function grantSetupProfilePatch(
  org: Organisation,
  answers: GrantSetupAnswers,
  evidence: SetupSuggestion[],
  unresolved: SetupQuestionKey[],
  approveProfile: boolean,
): Partial<Organisation> {
  const profile: Profile = {
    ...org.profile,
    grant_setup: {
      version: 1,
      answers,
      evidence: Object.values(aggregateSetupEvidence(evidence)).flatMap(
        ({ alternatives }) =>
          alternatives.flatMap(({ suggestions }) => suggestions),
      ),
      unresolved,
    },
  };
  const patch: Partial<Organisation> = {};
  for (const question of setupQuestionnaire) {
    if (!("profileField" in question) || !question.profileField) continue;
    const answer = answers[question.key];
    if (answer?.status !== "confirmed") continue;
    const field = question.profileField;
    Object.assign(profile, { [field]: answer.value });
    if (
      [
        "abn",
        "description",
        "type",
        "state",
        "focus_areas",
        "website",
      ].includes(field)
    ) {
      const normalized = profileValues(profile);
      Object.assign(patch, { [field]: normalized[field] });
      Object.assign(profile, { [field]: normalized[field] });
    }
  }
  if (
    approveProfile &&
    org.name.trim() &&
    (patch.description ?? org.description).trim()
  ) {
    patch.verification_status = "approved";
  }
  return { ...patch, profile };
}
