/** Source suggestions stay separate from the user's application and full guidelines. */
export interface ApplicationResearch {
  summary: string;
  guidelines_excerpt: string;
  application_questions: string;
  eligibility: string[];
  criteria: string[];
  required_attachments: string[];
  deadlines: string[];
  unresolved_questions: string[];
  sources: { title: string; uri: string }[];
  official_source_url: string;
  retrieved_at: string;
  needs_guidelines_upload: boolean;
}

export function isApplicationResearch(
  value: unknown,
): value is ApplicationResearch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const safeUrl = (value: string) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  };
  return (
    [
      "summary",
      "guidelines_excerpt",
      "application_questions",
      "official_source_url",
      "retrieved_at",
    ].every((field) => typeof item[field] === "string") &&
    [
      "eligibility",
      "criteria",
      "required_attachments",
      "deadlines",
      "unresolved_questions",
    ].every(
      (field) =>
        Array.isArray(item[field]) &&
        item[field].every((entry: unknown) => typeof entry === "string"),
    ) &&
    Array.isArray(item.sources) &&
    item.sources.every((entry: unknown) => {
      if (!entry || typeof entry !== "object") return false;
      const source = entry as Record<string, unknown>;
      return (
        typeof source.title === "string" &&
        typeof source.uri === "string" &&
        safeUrl(source.uri)
      );
    }) &&
    typeof item.needs_guidelines_upload === "boolean" &&
    (item.official_source_url === "" ||
      safeUrl(String(item.official_source_url)))
  );
}
