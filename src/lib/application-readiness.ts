import { z } from "zod";

const readinessKey = z.enum([
  "answers",
  "evidence",
  "criteria",
  "delivery",
  "budget",
]);

export const applicationSuggestionSchema = z.object({
  action: z.string().trim().min(1).max(350),
  why: z.string().trim().min(1).max(500),
  priority: z.enum(["required", "recommended"]),
});

const applicationReadinessSchema = z.object({
  score: z.number().int().min(0).max(100),
  scoreLimit: z.number().int().min(0).max(100).optional(),
  checks: z
    .array(
      z.object({
        key: readinessKey,
        label: z.string(),
        points: z.number().int().min(0),
        maxPoints: z.number().int().positive(),
        note: z.string(),
      }),
    )
    .length(5),
  suggestions: z.array(applicationSuggestionSchema).max(12),
});

export type ApplicationReadiness = z.infer<typeof applicationReadinessSchema>;
export type ApplicationSuggestion = z.infer<typeof applicationSuggestionSchema>;

export function readApplicationReadiness(
  value: unknown,
): ApplicationReadiness | null {
  const parsed = applicationReadinessSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
