import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { formatDraft } from "./ui";
import type { ApplicationReadiness } from "../lib/application-readiness";

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim()),
      )
    : [];
}

function readAnswers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !item ||
      typeof item.question !== "string" ||
      typeof item.answer !== "string"
    )
      return [];
    const answer: string = item.answer.trim();
    const limit: number | null =
      typeof item.word_limit === "number" ? item.word_limit : null;
    const characterLimit: number | null =
      typeof item.character_limit === "number" ? item.character_limit : null;
    const characters = answer.length;
    const words = answer ? answer.split(/\s+/).length : 0;
    const flag = !answer
      ? "Needs an answer"
      : limit !== null && words > limit
        ? "Over word limit"
        : characterLimit !== null && characters > characterLimit
          ? "Over character limit"
          : item.needs_review ||
              item.coverage === "partial" ||
              item.coverage === "missing"
            ? "Check details"
            : null;
    return [
      {
        question: item.question as string,
        answer,
        words,
        limit,
        characters,
        characterLimit,
        flag,
        evidence: strings(item.evidence),
        suggestion:
          typeof item.suggestion?.answer === "string" &&
          item.suggestion.answer.trim()
            ? {
                answer: item.suggestion.answer.trim() as string,
                evidence: strings(item.suggestion.evidence),
              }
            : null,
      },
    ];
  });
}

export function applicationDraftText(record: Record<string, unknown>): string {
  if (typeof record.application_text === "string")
    return record.application_text;
  const { readiness, readiness_stale, evidence_sources, ...content } = record;
  const answers = readAnswers(record.sections);
  if (!answers.length) return formatDraft(content);
  const parts = answers.map((item, i) =>
    [
      `${i + 1}. ${item.question}`,
      item.answer || "[Answer needed]",
      item.evidence.length
        ? "Supporting evidence\n" +
          item.evidence.map((line) => `• ${line}`).join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
  if (typeof record.title === "string" && record.title.trim())
    parts.unshift(record.title);
  for (const [heading, value] of [
    ["Draft budget", record.budget],
    ["Missing information", record.missing_information],
    ["Submission checklist", record.submission_checklist],
  ] as const) {
    const text = formatDraft(value);
    if (text) parts.push(`${heading}\n${text}`);
  }
  return parts.join("\n\n");
}

export function DraftReadiness({
  readiness,
  stale,
  blocked,
  onProject,
}: {
  readiness: ApplicationReadiness;
  stale: boolean;
  blocked?: string;
  onProject: () => void;
}) {
  const suggestions = [...readiness.suggestions].sort(
    (a, b) =>
      Number(b.priority === "required") - Number(a.priority === "required"),
  );
  return (
    <section aria-label="Draft readiness">
      <details className="application-disclosure application-readiness">
        <summary>
          Readiness and suggestions
          {stale ? (
            <small>Needs a new check</small>
          ) : (
            <strong aria-label={`${readiness.score} out of 100`}>
              {readiness.score} / 100
            </strong>
          )}
        </summary>
        <div className="application-disclosure-body">
          {stale ? (
            <>
              <p>
                {blocked ||
                  "Your inputs or draft have changed. Check the draft again for an updated score."}
              </p>
              {blocked && (
                <button type="button" className="text-link" onClick={onProject}>
                  Review project inputs <ArrowRight size={15} />
                </button>
              )}
            </>
          ) : (
            <>
              <p>
                The score reflects how complete the answers are and how much
                evidence supports them. The funder decides awards.
              </p>
              {suggestions.length > 0 && (
                <>
                  <ul className="application-suggestions">
                    {suggestions.map((item, i) => (
                      <li key={i}>
                        <span className="application-field-caption">
                          {item.priority === "required"
                            ? "Required"
                            : "Recommended"}
                        </span>
                        <strong>{item.action}</strong>
                        <p>{item.why}</p>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="text-link"
                    onClick={onProject}
                  >
                    Update project inputs <ArrowRight size={15} />
                  </button>
                </>
              )}
              <details>
                <summary>How the score is calculated</summary>
                {readiness.scoreLimit !== undefined && (
                  <p>
                    The score is capped at {readiness.scoreLimit} while required
                    inputs are missing.
                  </p>
                )}
                <dl className="application-checks">
                  {readiness.checks.map((check) => (
                    <div key={check.key}>
                      <dt>
                        {check.label}
                        <strong>
                          {check.points} / {check.maxPoints}
                        </strong>
                      </dt>
                      <dd>{check.note}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </>
          )}
        </div>
      </details>
    </section>
  );
}

function Paragraphs({ text }: { text: string }) {
  return (
    <div className="answer-prose">
      {text
        .trim()
        .split(/\r?\n[ \t]*\r?\n+/)
        .map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: string[] }) {
  return (
    <ul className="answer-evidence-list">
      {evidence.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function SuggestedRevision({
  suggestion,
}: {
  suggestion: { answer: string; evidence: string[] };
}) {
  const [feedback, setFeedback] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(suggestion.answer);
      setFeedback("Revision copied.");
    } catch {
      setFeedback("Select the suggested text and copy it manually.");
    }
  }
  return (
    <section className="answer-suggestion" aria-label="Suggested revision">
      <h4>Suggested revision</h4>
      <p className="suggestion-help">
        Copy any wording you want to use, then edit your draft.
      </p>
      <Paragraphs text={suggestion.answer} />
      {suggestion.evidence.length > 0 && (
        <>
          <h5>Evidence for this revision</h5>
          <EvidenceList evidence={suggestion.evidence} />
        </>
      )}
      <button type="button" className="text-link" onClick={copy}>
        Copy suggested wording
      </button>
      <span role="status" className="copy-feedback">
        {feedback}
      </span>
    </section>
  );
}

export function ApplicationDraftReview({
  record,
  draft,
  textChanged,
  questionIndex,
  onQuestion,
  setDraft,
  busy,
  onSources,
}: {
  record: Record<string, unknown>;
  draft: string;
  textChanged: boolean;
  questionIndex: number;
  onQuestion: (index: number) => void;
  setDraft: (text: string) => void;
  busy: boolean;
  onSources: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const returnToHeading = useRef(false);
  useLayoutEffect(() => {
    if (returnToHeading.current && heading.current) {
      heading.current.focus({ preventScroll: true });
      heading.current.scrollIntoView({ block: "start" });
      returnToHeading.current = false;
    }
  }, [questionIndex]);
  const answers = useMemo(
    () => readAnswers(record.sections),
    [record.sections],
  );
  const index = Math.min(questionIndex, answers.length - 1);
  const current = answers[index];
  const reviewed =
    current &&
    !(
      typeof record.application_text === "string" &&
      (!record.readiness || record.readiness_stale === true)
    );
  const showAnswer = reviewed && !editing && !textChanged;
  const gaps = strings(record.missing_information);
  const checklist = strings(record.submission_checklist);
  const files = Array.isArray(record.evidence_sources)
    ? record.evidence_sources.filter(
        (f): f is { id: string; name: string } =>
          f && typeof f.id === "string" && typeof f.name === "string",
      )
    : null;
  const rangeStart = Math.floor(Math.max(0, index) / 6) * 6;
  return (
    <>
      {showAnswer ? (
        <div className="answer-workspace">
          <nav className="answer-index" aria-label="Application questions">
            <h3>Questions</h3>
            <label
              className={
                answers.length > 6
                  ? "question-picker"
                  : "question-picker compact-only"
              }
            >
              <span>Choose a question</span>
              <select
                value={index}
                onChange={(e) => onQuestion(Number(e.target.value))}
              >
                {answers.map((item, i) => (
                  <option value={i} key={i}>
                    {i + 1}. {item.question}
                  </option>
                ))}
              </select>
            </label>
            <ol className="question-list" start={rangeStart + 1}>
              {answers.slice(rangeStart, rangeStart + 6).map((item, offset) => {
                const n = rangeStart + offset;
                return (
                  <li key={n}>
                    <button
                      type="button"
                      aria-current={n === index ? "true" : undefined}
                      onClick={() => onQuestion(n)}
                    >
                      <span className="question-number" aria-hidden="true">
                        {String(n + 1).padStart(2, "0")}
                      </span>
                      <span>{item.question}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
          <article className="answer-sheet" aria-labelledby={titleId}>
            <div className="answer-toolbar">
              <span
                className="answer-position"
                aria-live="polite"
                aria-atomic="true"
              >
                Question {index + 1} of {answers.length}
              </span>
              <div className="answer-pagination">
                <button
                  type="button"
                  aria-label="Previous question"
                  disabled={index === 0}
                  onClick={() => onQuestion(index - 1)}
                >
                  <ChevronLeft size={17} /> Previous
                </button>
                <button
                  type="button"
                  aria-label="Next question"
                  disabled={index === answers.length - 1}
                  onClick={() => onQuestion(index + 1)}
                >
                  Next <ChevronRight size={17} />
                </button>
              </div>
            </div>
            <h3 id={titleId} ref={heading} tabIndex={-1}>
              {current.question}
            </h3>
            <div className="answer-meta">
              <span>
                {current.words} {current.words === 1 ? "word" : "words"}
                {current.limit !== null && ` · ${current.limit}-word limit`}
              </span>
              {current.characterLimit !== null && (
                <span>
                  {current.characters} of {current.characterLimit} characters
                </span>
              )}
              {current.flag && <strong>{current.flag}</strong>}
            </div>
            {current.answer ? (
              <Paragraphs text={current.answer} />
            ) : (
              <p className="answer-missing">
                Add the missing project details to prepare this answer.
              </p>
            )}
            <div className="answer-evidence">
              <h4>Supporting evidence</h4>
              {current.evidence.length ? (
                <EvidenceList evidence={current.evidence} />
              ) : (
                <p>No source cited for this answer.</p>
              )}
            </div>
            {current.suggestion && (
              <SuggestedRevision key={index} suggestion={current.suggestion} />
            )}
            <div className="answer-bottom-actions">
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                Edit draft text <ArrowRight size={15} />
              </button>
              {index < answers.length - 1 && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    returnToHeading.current = true;
                    onQuestion(index + 1);
                  }}
                >
                  Continue to next question <ChevronRight size={16} />
                </button>
              )}
            </div>
          </article>
        </div>
      ) : (
        <div className="manual-draft">
          <label className="form-field">
            Your application draft
            <textarea
              autoFocus={editing}
              rows={10}
              disabled={busy}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write your draft here, or prepare one with AI."
            />
          </label>
          {reviewed && !textChanged && (
            <button
              type="button"
              className="text-link"
              onClick={() => setEditing(false)}
            >
              Back to answers <ArrowRight size={15} />
            </button>
          )}
        </div>
      )}
      {!!draft.trim() && (
        <div className="application-file-record">
          <FileText size={18} aria-hidden="true" />
          <div>
            <h4>Files consulted for this draft</h4>
            {files?.length ? (
              <ul>
                {files.map((file) => (
                  <li key={file.id}>{file.name}</li>
                ))}
              </ul>
            ) : (
              <p>
                {files
                  ? "No uploaded files were used."
                  : "This draft has no saved record of which uploads were used."}
              </p>
            )}
          </div>
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={onSources}
          >
            Review uploads <ArrowRight size={15} />
          </button>
        </div>
      )}
      {Array.isArray(record.budget) && record.budget.length > 0 && (
        <details className="application-disclosure">
          <summary>Draft budget</summary>
          <p className="application-disclosure-body application-prose">
            {formatDraft(record.budget)}
          </p>
        </details>
      )}
      {gaps.length > 0 && (
        <details className="application-disclosure">
          <summary>Missing information ({gaps.length})</summary>
          <EvidenceList evidence={gaps} />
        </details>
      )}
      {checklist.length > 0 && (
        <details className="application-disclosure">
          <summary>Submission checklist</summary>
          <EvidenceList evidence={checklist} />
        </details>
      )}
    </>
  );
}
