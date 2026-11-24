import { z } from "zod";

export const draftCitationsSchema = z
  .array(
    z.object({
      source: z.string().max(200),
      quote: z.string().max(500),
    }),
  )
  .max(20);

export const answerSuggestionSchema = z.object({
  answer: z.string().max(20000),
  citations: draftCitationsSchema,
});

const spaces = (value: string) => value.replace(/\s+/g, " ").trim();
const fieldLabel = (key: string) => key.replace(/_/g, " ");
type Passage = { text: string; location?: string };
type CitationSource = {
  kind: "profile" | "project" | "document";
  label: string;
  passages: Passage[];
};
function fieldPassages(value: unknown): Passage[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "object")
    return Object.values(value).flatMap(fieldPassages);
  return [{ text: spaces(String(value)) }];
}

function documentPassages(text: string): Passage[] {
  return text
    .split(/(?=^\s*\[Page \d+\]|^SHEET: )/im)
    .filter(Boolean)
    .map((block) => {
      const page = block.match(/^\s*\[Page (\d+)\]/i)?.[1];
      const sheet = block.match(/^SHEET: ([^\r\n]+)/i)?.[1];
      return { text: spaces(block), location: page ? `p. ${page}` : sheet };
    });
}

export function draftCitationSources(
  profile: Record<string, unknown>,
  project: Record<string, unknown>,
  brief: string,
  documents: { id: string; name: string }[],
  documentTexts: ReadonlyMap<string, string>,
) {
  const sources = new Map<string, CitationSource>();
  for (const [key, value] of Object.entries(profile))
    sources.set(`profile.${key}`, {
      kind: "profile",
      label: `Approved profile · ${fieldLabel(key)}`,
      passages: fieldPassages(value),
    });
  for (const [key, value] of Object.entries(project))
    if (key !== "application_questions" && value)
      sources.set(`project.${key}`, {
        kind: "project",
        label: `Project ${fieldLabel(key)}`,
        passages: fieldPassages(value),
      });
  if (brief.trim())
    sources.set("brief", {
      kind: "project",
      label: "Project brief",
      passages: fieldPassages(brief),
    });
  for (const { id, name } of documents) {
    const text = documentTexts.get(id);
    sources.set(id, {
      kind: "document",
      label: name,
      passages: text ? documentPassages(text) : [],
    });
  }
  return sources;
}

type Sources = ReturnType<typeof draftCitationSources>;
type Citation = z.infer<typeof draftCitationsSchema>[number];
function checkedCitation(
  { source, quote }: Citation,
  sources: Sources,
  forSuggestion: boolean,
) {
  const item = sources.get(source);
  const excerpt = spaces(quote);
  if (!item || !excerpt || (forSuggestion && item.kind === "project")) return;
  // Raw PDFs and images without a transcript are still visible to the writer.
  if (!forSuggestion && item.kind === "document" && !item.passages.length)
    return `${item.label} (check against original) · “${excerpt}”`;
  const match = item.passages.find(
    ({ text }) =>
      (item.kind !== "document" && text === excerpt) ||
      (excerpt.length >= 8 && text.includes(excerpt)),
  );
  if (!match) return;
  return `${item.label}${match.location ? `, ${match.location}` : ""} · “${excerpt}”`;
}

function originalPassage(draft: string, answer: string) {
  const excerpt = answer.trim();
  if (!excerpt || draft.includes(excerpt)) return excerpt;
  // A model may collapse a paragraph break. Recover the applicant's layout.
  const needle = spaces(excerpt);
  let start = draft.replace(/\s+/g, " ").indexOf(needle);
  if (start === -1) return;
  let end = start + needle.length;
  for (const run of draft.matchAll(/\s+/g)) {
    if (run.index >= end) break;
    const skipped = run[0].length - 1;
    if (run.index < start) start += skipped;
    end += skipped;
  }
  return draft.slice(start, end);
}

type ModelSection = {
  answer: string;
  word_limit?: number | null;
  character_limit?: number | null;
  evidence?: string[];
  citations?: Citation[];
  coverage?: "missing" | "partial" | "complete";
  needs_review?: boolean;
  suggestion?: z.infer<typeof answerSuggestionSchema> | null;
};

export function reviewedSection<T extends ModelSection>(
  { suggestion, citations, evidence: labels, ...section }: T,
  editedText: string,
  sources: Sources,
) {
  // Older provider responses contain label-only evidence. Keep only a known
  // source label, never an unverified file name or quote from that response.
  const evidence = citations
    ? citations.flatMap((cite) => checkedCitation(cite, sources, false) ?? [])
    : (labels ?? []).flatMap((label) => {
        const known = [...sources.values()].find(
          ({ label: name }) =>
            label === name ||
            label.startsWith(name + " ") ||
            label.startsWith(name + ","),
        );
        return known ? [known.label] : [];
      });
  const answer = editedText
    ? originalPassage(editedText, section.answer)
    : section.answer;
  if (answer === undefined)
    return {
      ...section,
      answer: "",
      coverage: "missing" as const,
      needs_review: true,
      evidence: [],
    };
  const original = { ...section, answer, evidence: [...new Set(evidence)] };
  if (!editedText || !suggestion) return original;
  const revision = suggestion.answer.trim();
  if (
    !revision ||
    spaces(revision) === spaces(answer) ||
    (section.word_limit != null &&
      revision.split(/\s+/).length > section.word_limit) ||
    (section.character_limit != null &&
      revision.length > section.character_limit) ||
    !suggestion.citations.length
  )
    return original;
  const supporting = new Set<string>();
  for (const cite of suggestion.citations) {
    const checked = checkedCitation(cite, sources, true);
    if (!checked) return original;
    supporting.add(checked);
  }
  return {
    ...original,
    suggestion: { answer: revision, evidence: [...supporting] },
  };
}
