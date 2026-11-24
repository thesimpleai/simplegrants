import { z } from "zod";

export const GRANT_RESEARCH_CATEGORY = "grant_research";
export const MAX_GRANT_IMPORT_ITEMS = 20;
export const MAX_GRANT_REPORT_CHARS = 40_000;

export const grantImportCandidateSchema = z.object({
  title: z.string().min(1).max(300),
  funder: z.string().max(300),
  summary: z.string().max(2_000),
  source_url: z.string().max(2_000),
  guidelines_text: z.string().max(4_000),
  amount_min: z.number().nonnegative().nullable(),
  amount_max: z.number().nonnegative().nullable(),
  opens_on: z.string().max(40).nullable(),
  closes_at: z.string().max(40).nullable(),
  closing_date: z.string().max(40).nullable().optional(),
  location: z.string().max(200),
  focus_areas: z.array(z.string().max(100)).max(10),
  requirements: z.array(z.string().max(300)).max(10),
});

export const grantImportCandidatesSchema = z
  .array(grantImportCandidateSchema)
  .max(MAX_GRANT_IMPORT_ITEMS);

export const grantImportPreviewSchema = z.object({
  importCandidates: grantImportCandidatesSchema,
  importNotes: z.array(z.string().max(500)).max(8).optional(),
  sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  stageIssuedAt: z.number().int().nonnegative(),
});

export type GrantImportCandidate = z.infer<typeof grantImportCandidateSchema>;
