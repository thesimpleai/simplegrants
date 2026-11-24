import { z } from "zod";
import {
  applicationSuggestionSchema,
  type ApplicationReadiness,
  type ApplicationSuggestion,
} from "../../../src/lib/application-readiness";
import type { evaluatePreflight } from "./preflight";

const coverage = z.enum(["missing", "partial", "complete"]);
const reviewCheck = z.object({
  coverage,
  note: z.string().trim().min(1).max(500),
});

export const draftReadinessReviewSchema = z.object({
  criteria: reviewCheck,
  delivery: reviewCheck,
  budget: reviewCheck,
  suggestions: z
    .array(
      applicationSuggestionSchema.extend({
        requirement_labels: z.array(z.string().max(300)).max(12).optional(),
      }),
    )
    .max(12),
});

type Coverage = z.infer<typeof coverage>;
type DraftForReadiness = {
  sections: {
    answer: string;
    word_limit?: number | null;
    character_limit?: number | null;
    evidence?: string[];
    coverage?: Coverage;
    needs_review?: boolean;
  }[];
  missing_information?: string[];
  readiness_review?: z.infer<typeof draftReadinessReviewSchema>;
};

const progress = { missing: 0, partial: 0.5, complete: 1 };

export function scoreApplicationDraft(
  draft: DraftForReadiness,
  preflight: ReturnType<typeof evaluatePreflight>,
  currentInsuranceMissing = false,
): ApplicationReadiness {
  const sections = draft.sections.map((section) => {
    const answer = section.answer.trim();
    const overLimit =
      (section.word_limit != null &&
        answer.split(/\s+/).length > section.word_limit) ||
      (section.character_limit != null &&
        answer.length > section.character_limit);
    const coverage =
      !answer || section.coverage === "missing"
        ? 0
        : overLimit || section.coverage !== "complete" || section.needs_review
          ? 0.5
          : 1;
    const hasSource = section.evidence?.some((source) => source.trim());
    return { coverage, evidence: hasSource ? coverage : 0 };
  });
  const average = (key: "coverage" | "evidence") =>
    sections.reduce((sum, section) => sum + section[key], 0) /
    Math.max(1, sections.length);
  const check = (
    key: "criteria" | "delivery" | "budget",
    label: string,
    maxPoints: number,
  ): ApplicationReadiness["checks"][number] => {
    const review = draft.readiness_review?.[key];
    return {
      key,
      label,
      maxPoints,
      points: Math.round(maxPoints * (review ? progress[review.coverage] : 0)),
      note: review?.note ?? "This area still needs a review.",
    };
  };
  const checks: ApplicationReadiness["checks"] = [
    {
      key: "answers",
      label: "Question coverage",
      maxPoints: 30,
      points: Math.round(30 * average("coverage")),
      note: `${sections.filter(({ coverage }) => coverage === 1).length} of ${sections.length} drafted answers are complete and within their stated limits.`,
    },
    {
      key: "evidence",
      label: "Supporting evidence",
      maxPoints: 25,
      points: Math.round(25 * average("evidence")),
      note: `${sections.filter(({ evidence }) => evidence > 0).length} of ${sections.length} drafted answers cite supporting information.`,
    },
    check("criteria", "Funder criteria", 20),
    check("delivery", "Delivery and outcomes", 15),
    check("budget", "Budget and resources", 10),
  ];

  const requiredGaps = [
    ...preflight.documentGaps,
    ...preflight.informationGaps,
  ];
  const aiSuggestions = draft.readiness_review?.suggestions ?? [];
  const covered = new Set(
    aiSuggestions
      .filter(({ priority }) => priority === "required")
      .flatMap(({ requirement_labels }) => requirement_labels ?? [])
      .map((label) => label.trim().toLowerCase()),
  );
  const required: ApplicationSuggestion[] = requiredGaps
    .filter(({ label }) => !covered.has(label.trim().toLowerCase()))
    .map((requirement) => {
      const { label, source_quote, conditional, condition_applies } =
        requirement;
      return {
        action:
          `${conditional && condition_applies === null ? "Check whether you need to supply" : "category" in requirement ? "Upload" : "Supply"} ${label.replace(/[.!?]+$/, "")}.`.slice(
            0,
            350,
          ),
        why: `The funder asks for this. “${source_quote.slice(0, 450)}”`,
        priority: "required",
      };
    });
  if (
    currentInsuranceMissing &&
    !preflight.documentGaps.some(({ category }) => category === "insurance")
  )
    required.unshift({
      action: "Add a current public liability insurance certificate.",
      why: "The official funder guidelines require current cover. Include its expiry date.",
      priority: "required",
    });
  const fallback: ApplicationSuggestion[] = aiSuggestions.length
    ? []
    : (draft.missing_information ?? []).map((item) => ({
        action: item.trim().slice(0, 350),
        why: "The draft has a gap here. Supply the project fact or explain why it does not apply.",
        priority: "recommended",
      }));
  const suggestions = new Map<string, ApplicationSuggestion>();
  // Prefer the model's concrete instructions when available, then retain other funder gaps.
  for (const { action, why, priority } of [
    ...aiSuggestions.filter(({ priority }) => priority === "required"),
    ...required,
    ...aiSuggestions.filter(({ priority }) => priority === "recommended"),
    ...fallback,
  ]) {
    const key = action
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (key && !suggestions.has(key))
      suggestions.set(key, { action, why, priority });
  }
  const scoreLimit =
    required.length ||
    aiSuggestions.some(({ priority }) => priority === "required")
      ? 69
      : undefined;
  return {
    score: Math.min(
      scoreLimit ?? 100,
      checks.reduce((sum, item) => sum + item.points, 0),
    ),
    scoreLimit,
    checks,
    suggestions: [...suggestions.values()].slice(0, 12),
  };
}
