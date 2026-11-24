import { Sparkles } from "lucide-react";
import { Busy, ExternalLink } from "./ui";
import type { ApplicationResearch } from "../lib/application-research";

export function ApplicationSources({
  guidelines,
  questions,
  research,
  confirmed,
  sourceUrl,
  canResearch,
  researching,
  busy,
  onGuidelines,
  onQuestions,
  onConfirm,
  onResearch,
  useResearch,
}: {
  guidelines: string;
  questions: string;
  research: ApplicationResearch | null;
  confirmed: boolean;
  sourceUrl?: string | null;
  canResearch: boolean;
  researching: boolean;
  busy: boolean;
  onGuidelines: (value: string) => void;
  onQuestions: (value: string) => void;
  onConfirm: (value: boolean) => void;
  onResearch: () => void;
  useResearch: () => void;
}) {
  const source = research ? research.official_source_url : sourceUrl;
  return (
    <details className="application-disclosure" id="application-sources">
      <summary>
        <span>Funder guidelines and questions</span>
        <small>
          {researching
            ? "Researching…"
            : research && !confirmed
              ? "Check sources"
              : guidelines.trim() && questions.trim()
                ? "Added"
                : "To add"}
        </small>
      </summary>
      <section
        className="application-disclosure-body"
        aria-label="Application assistant"
      >
        {source && (
          <ExternalLink href={source}>
            {research
              ? "Open the funder’s guidelines or application portal"
              : "Open the saved grant source and check the official guidelines"}
          </ExternalLink>
        )}
        <p>
          Paste the current guidelines and the exact questions and word limits
          from the funder’s form. For files, upload them to My organisation
          using the Guidelines type and select them as supporting documents.
        </p>
        <button
          className="button secondary align-start"
          disabled={!canResearch || busy || researching}
          onClick={onResearch}
        >
          {researching ? (
            <Busy label="Reading official grant sources…" />
          ) : (
            <>
              <Sparkles size={16} />
              {research
                ? "Refresh source research"
                : "Research this grant with AI"}
            </>
          )}
        </button>
        {research && (
          <>
            <p>{research.summary}</p>
            <details className="application-source-notes">
              <summary>Research notes and sources</summary>
              {(
                [
                  ["Eligibility to check", research.eligibility],
                  ["Assessment criteria", research.criteria],
                  ["Dates to confirm", research.deadlines],
                  ["Required attachments", research.required_attachments],
                  [
                    "Still needed for this project",
                    research.unresolved_questions,
                  ],
                ] as const
              )
                .filter(([, items]) => items.length)
                .map(([heading, items]) => (
                  <div key={heading}>
                    <strong>{heading}</strong>
                    <ul>
                      {items.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              {research.sources.map((item, i) => (
                <ExternalLink key={i} href={item.uri}>
                  {item.title}
                </ExternalLink>
              ))}
            </details>
            {(research.guidelines_excerpt ||
              research.application_questions) && (
              <details className="application-source-notes">
                <summary>Source excerpts and application questions</summary>
                {research.guidelines_excerpt && (
                  <p className="application-prose">
                    {research.guidelines_excerpt}
                  </p>
                )}
                {research.application_questions && (
                  <p className="application-prose">
                    {research.application_questions}
                  </p>
                )}
                <button
                  className="button secondary"
                  onClick={useResearch}
                  disabled={busy}
                >
                  Add source details to empty fields
                </button>
              </details>
            )}
          </>
        )}
        <label className="form-field">
          Current program guidelines
          <textarea
            rows={4}
            value={guidelines}
            disabled={busy}
            onChange={(event) => onGuidelines(event.target.value)}
            placeholder="Paste the current eligibility rules, criteria and evidence requirements."
          />
        </label>
        <label className="form-field">
          Application questions and word limits
          <textarea
            rows={3}
            value={questions}
            disabled={busy}
            onChange={(event) => onQuestions(event.target.value)}
            placeholder="Copy the questions and limits from the application form."
          />
        </label>
        {research && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => onConfirm(event.target.checked)}
            />{" "}
            I checked the complete current official guidelines and application
            questions, including the grant round, eligibility, deadlines and
            required attachments.
          </label>
        )}
      </section>
    </details>
  );
}
