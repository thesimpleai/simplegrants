import type { AIRequestBudget } from "./ai-runtime";
import { HttpError } from "./core";
import type { AppDb } from "./db";

export type ExtractedDocumentText = {
  text: string;
  method: "local" | "ocr";
};

// Re-extract when changes to the parser or transcription contract make older
// outputs incompatible. The original document is always the source of record.
const extractionVersion = 1;
export const MAX_DOCUMENT_TEXT_CHARS = 400_000;
const table = "document_text_extracts";

function sourceKey(orgId: string, documentId: string, sha256: string) {
  return {
    org_id: orgId,
    document_id: documentId,
    source_sha256: sha256,
    extraction_version: extractionVersion,
  };
}
type SourceKey = ReturnType<typeof sourceKey>;

function extractionStorageError(code?: string): never {
  if (code === "23503")
    throw new HttpError(409, "The source document was removed during review.");
  throw new HttpError(
    ["PGRST205", "42P01", "42501"].includes(code ?? "") ? 503 : 502,
    "The document text library is unavailable. Your original file is still saved.",
  );
}

async function find(
  db: AppDb,
  key: SourceKey,
  budget?: AIRequestBudget,
): Promise<ExtractedDocumentText | undefined> {
  const query = db.from(table).select("text,method").match(key);
  if (budget) query.abortSignal(budget.signal);
  const { data, error } = await query.maybeSingle();
  budget?.assert();
  if (error) extractionStorageError(error.code);
  return data ? (data as ExtractedDocumentText) : undefined;
}

// This service-only store is reachable after the caller has checked the
// original with the user's organisation-scoped database and storage session.
export async function documentText(
  db: AppDb,
  source: { orgId: string; documentId: string; sha256: string },
  extract?: () => Promise<ExtractedDocumentText>,
  budget?: AIRequestBudget,
): Promise<ExtractedDocumentText | undefined> {
  const key = sourceKey(source.orgId, source.documentId, source.sha256);
  const existing = await find(db, key, budget);
  if (existing || !extract) return existing;

  const { text: original, method } = await extract();
  const text = original
    .replace(/\u0000/g, " ")
    .replace(
      /\b(?:BSB|bank account(?: number)?|account number|tax file number|TFN|card number)\s*[:#=-]?\s*\d[\d .\t-]{4,}|\b(?:password|API[ -]?key|secret(?: key)?|access token)\s*[:=]\s*\S+/gi,
      "[redacted]",
    )
    .trim();
  if (!text)
    throw new HttpError(422, "No readable text was found in this document.");
  if (text.length > MAX_DOCUMENT_TEXT_CHARS)
    throw new HttpError(
      413,
      "This document contains too much text for AI review. Upload the relevant pages in a smaller file.",
    );
  budget?.assert();

  // Concurrent review jobs converge on the same stored transcript.
  const insert = db.from(table).upsert(
    { ...key, text, method },
    {
      onConflict: "org_id,document_id,source_sha256,extraction_version",
      ignoreDuplicates: true,
    },
  );
  if (budget) insert.abortSignal(budget.signal);
  const { data, error } = await insert.select("text,method").maybeSingle();
  budget?.assert();
  if (error) extractionStorageError(error.code);
  if (data) return data as ExtractedDocumentText;
  return (await find(db, key, budget)) ?? extractionStorageError();
}
