import { useEffect, useMemo, useRef, useState } from "react";
import type { AIResult, DocumentRecord, Organisation } from "../types";
import { AIRequestError, useApp } from "../lib/app-context";
import { MAX_AI_DOCUMENTS } from "../lib/document-formats";
import { isInsuranceCategory } from "../lib/grant-requirements";
import {
  grantSetupProfilePatch,
  readGrantSetup,
  readGrantSetupEvidence,
  type GrantSetupAnswers,
} from "../lib/grant-setup-state";
import {
  aggregateSetupEvidence,
  chooseSetupAnswer,
  isSetupQuestionKey,
  readSetupAnswers,
  setupProfileAnswer,
  setupQuestionnaire,
  suggestSetupDocuments,
  type SetupAnswer,
  type SetupAnswerValue,
  type SetupDatedMetric,
  type SetupEvidenceAlternative,
  type SetupQuestion,
  type SetupQuestionKey,
  type SetupSuggestion,
} from "../lib/setup-questionnaire";
import {
  loadSetupReviewDraft,
  removeSetupReviewDraft,
  saveSetupReviewDraft,
} from "../lib/setup-review-draft";
import { Busy, Modal, Notice, errorMessage } from "./ui";
import "./grant-setup.css";

type Question = SetupQuestion & { key: SetupQuestionKey };
type Edit = SetupAnswer | null;
type Edits = Partial<Record<SetupQuestionKey, Edit>>;
type ConflictReview = Pick<
  NonNullable<AIResult["setupConflicts"]>[number],
  "note" | "recommendedAlternative"
>;
type ConflictReviews = Partial<Record<SetupQuestionKey, ConflictReview>>;
type SetupGroups = ReturnType<typeof aggregateSetupEvidence>;

const sections = [...new Set(setupQuestionnaire.map(({ section }) => section))];
const CONFLICT_CHECK_BATCH_SIZE = 4;

function conflictChecks(groups: SetupGroups) {
  return setupQuestionnaire.flatMap(({ key }) => {
    const group = groups[key];
    if (!group?.hasConflict || group.alternatives.length > 4) return [];
    return [
      {
        questionKey: key,
        candidates: group.alternatives.map(({ suggestions }) => {
          const [{ questionKey: _key, ...candidate }] = suggestions;
          return candidate;
        }),
      },
    ];
  });
}

function reviewsForEvidence(
  reviews: ConflictReviews,
  before: SetupGroups,
  after: SetupGroups,
): ConflictReviews {
  const previous = new Map(
    conflictChecks(before).map(({ questionKey, candidates }) => [
      questionKey,
      JSON.stringify(candidates),
    ]),
  );
  return Object.fromEntries(
    conflictChecks(after).flatMap(({ questionKey, candidates }) =>
      reviews[questionKey] &&
      previous.get(questionKey) === JSON.stringify(candidates)
        ? [[questionKey, reviews[questionKey]]]
        : [],
    ),
  );
}

function draftSourceIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
}

function draftEdits(value: unknown): Edits {
  const edits: Edits = readSetupAnswers(value);
  if (!value || typeof value !== "object") return edits;
  const stored = value as Record<string, unknown>;
  for (const { key, kind } of setupQuestionnaire) {
    const answer = stored[key];
    if (answer === null) edits[key] = null;
    if (edits[key] || !answer || typeof answer !== "object") continue;
    if (
      !("status" in answer) ||
      answer.status !== "confirmed" ||
      !("value" in answer)
    )
      continue;

    // A draft can contain incomplete dates, lists and metrics while being edited.
    const input = answer.value;
    if (
      ((kind === "date" || kind === "text") && typeof input === "string") ||
      (kind === "list" &&
        Array.isArray(input) &&
        input.every((item) => typeof item === "string"))
    ) {
      edits[key] = { status: "confirmed", value: input };
    } else if (
      kind === "metric" &&
      input &&
      typeof input === "object" &&
      "value" in input &&
      (input.value === null || typeof input.value === "number") &&
      "unit" in input &&
      typeof input.unit === "string" &&
      "periodStart" in input &&
      typeof input.periodStart === "string" &&
      "periodEnd" in input &&
      typeof input.periodEnd === "string"
    ) {
      edits[key] = {
        status: "confirmed",
        value: {
          value: input.value ?? NaN,
          unit: input.unit,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        },
      };
    }
  }
  return edits;
}

function draftConflictReviews(value: unknown): ConflictReviews {
  if (!value || typeof value !== "object") return {};
  const result: ConflictReviews = {};
  for (const [key, review] of Object.entries(value)) {
    if (!isSetupQuestionKey(key) || !review || typeof review !== "object")
      continue;
    result[key] = {
      note: typeof review.note === "string" ? review.note : undefined,
      recommendedAlternative: Number.isInteger(review.recommendedAlternative)
        ? review.recommendedAlternative
        : undefined,
    };
  }
  return result;
}

function supportedBy(
  question: Question,
  value: SetupAnswerValue,
  alternatives: SetupEvidenceAlternative[],
) {
  const chosen = chooseSetupAnswer(
    question,
    { status: "confirmed", value },
    alternatives,
  );
  return chosen?.status === "confirmed" && !!chosen.sources?.length;
}

function displayValue(value: SetupAnswerValue): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  const period =
    value.periodStart === value.periodEnd
      ? value.periodStart
      : `${value.periodStart} to ${value.periodEnd}`;
  return `${value.value} ${value.unit} · ${period}`;
}

function AnswerInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value?: SetupAnswerValue;
  onChange: (value?: SetupAnswerValue) => void;
}) {
  if (question.kind === "boolean") {
    return (
      <select
        aria-label={question.label}
        value={typeof value === "boolean" ? String(value) : ""}
        onChange={(event) =>
          onChange(
            event.target.value ? event.target.value === "true" : undefined,
          )
        }
      >
        <option value="">Unanswered</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  if (question.kind === "metric") {
    const metric: SetupDatedMetric =
      value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {
            value: NaN,
            unit: question.metricUnit ?? "",
            periodStart: "",
            periodEnd: "",
          };
    const snapshot = question.metricPeriod === "point_in_time";
    return (
      <div className="grant-setup-metric">
        <label>
          {question.metricUnit === "hours" ? "Hours" : "People"}
          <input
            aria-label={question.label}
            type="number"
            min={0}
            step={question.metricUnit === "hours" ? "any" : 1}
            value={Number.isFinite(metric.value) ? metric.value : ""}
            onChange={(event) =>
              onChange({ ...metric, value: event.target.valueAsNumber })
            }
          />
        </label>
        <label>
          {snapshot ? "As-of date" : "Period start"}
          <input
            type="date"
            value={metric.periodStart}
            onChange={(event) =>
              onChange({
                ...metric,
                periodStart: event.target.value,
                ...(snapshot ? { periodEnd: event.target.value } : {}),
              })
            }
          />
        </label>
        {!snapshot && (
          <label>
            Period end
            <input
              type="date"
              value={metric.periodEnd}
              onChange={(event) =>
                onChange({ ...metric, periodEnd: event.target.value })
              }
            />
          </label>
        )}
      </div>
    );
  }

  if (question.kind === "list") {
    return (
      <textarea
        className="grant-setup-answer"
        aria-label={question.label}
        rows={4}
        placeholder="One item per line"
        value={Array.isArray(value) ? value.join("\n") : ""}
        onChange={(event) =>
          onChange(
            event.target.value ? event.target.value.split("\n") : undefined,
          )
        }
      />
    );
  }

  return question.kind === "date" ? (
    <input
      aria-label={question.label}
      placeholder={
        question.key === "insurance_expiry"
          ? "YYYY-MM-DD"
          : "YYYY, YYYY-MM or YYYY-MM-DD"
      }
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value || undefined)}
    />
  ) : (
    <textarea
      className="grant-setup-answer"
      aria-label={question.label}
      rows={5}
      maxLength={1500}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value || undefined)}
    />
  );
}

export default function GrantSetupWizard({
  organisation,
  onClose,
}: {
  organisation: Organisation;
  onClose: () => void;
}) {
  const app = useApp();
  const [saved] = useState(() => readGrantSetup(organisation.profile));
  const [evidence, setEvidence] = useState(saved.evidence);
  const [edits, setEdits] = useState<Edits>(() => ({
    ...saved.answers,
    ...Object.fromEntries(saved.unresolved.map((key) => [key, null])),
  }));
  const [reviews, setReviews] = useState<ConflictReviews>({});
  const [conflictError, setConflictError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [insurance, setInsurance] = useState(false);
  const [paste, setPaste] = useState("");
  const [completed, setCompleted] = useState<string[]>([]);
  const [analysedPaste, setAnalysedPaste] = useState("");
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [approveProfile, setApproveProfile] = useState(false);
  const draftActor = app.mode === "demo" ? undefined : app.user?.id;
  const [loadingDraft, setLoadingDraft] = useState(Boolean(draftActor));
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftError, setDraftError] = useState("");
  const draftLoadFailed = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    if (!draftActor) return;
    let cancelled = false;
    loadSetupReviewDraft(organisation.id, draftActor, "grant-setup")
      .then((draft) => {
        if (cancelled || draft?.data.version !== 1) return;
        const data = draft.data;
        setEvidence(readGrantSetupEvidence(data.evidence));
        setEdits(draftEdits(data.edits));
        setReviews(draftConflictReviews(data.reviews));
        setSelected(draftSourceIds(data.selected));
        setCompleted(draftSourceIds(data.completed));
        setInsurance(data.insurance === true);
        setDraftSaved(true);
        setReviewing(true);
      })
      .catch((e) => {
        if (!cancelled) {
          draftLoadFailed.current = true;
          setDraftError(errorMessage(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDraft(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draftActor, organisation.id]);

  const groups = useMemo(() => aggregateSetupEvidence(evidence), [evidence]);
  const pendingConflictChecks = conflictChecks(groups).filter(
    ({ questionKey }) => !reviews[questionKey],
  );
  const availableSources = app.data.documents.filter(
    (item) =>
      ["registration", "acnc", "other"].includes(item.category) ||
      (insurance && isInsuranceCategory(item.category)),
  );
  const coreProfile = {
    ...organisation.profile,
    description: organisation.description,
    abn: organisation.abn ?? undefined,
    type: organisation.type,
    state: organisation.state,
    focus_areas: organisation.focus_areas,
    website: organisation.website ?? undefined,
  };

  function baseline(question: Question): SetupAnswer | undefined {
    const answer = saved.answers[question.key];
    if (answer) return answer;
    const value = setupProfileAnswer(question, coreProfile);
    return value === undefined ? undefined : { status: "confirmed", value };
  }

  function answerFor(question: Question): Edit {
    if (Object.hasOwn(edits, question.key)) return edits[question.key] ?? null;
    const alternatives = groups[question.key]?.alternatives ?? [];
    if (alternatives.length > 1) return null;
    const previous = baseline(question);
    if (previous) {
      if (!alternatives.length) return previous;
      if (
        previous.status !== "confirmed" ||
        !supportedBy(question, previous.value, alternatives)
      )
        return null;
      return previous;
    }
    return alternatives.length === 1
      ? { status: "confirmed", value: alternatives[0].value }
      : null;
  }

  function editAnswer(key: SetupQuestionKey, answer: Edit) {
    setEdits((current) => ({ ...current, [key]: answer }));
    setDraftDirty(true);
    setSaveConfirmed(false);
  }

  function recordNewEvidence(
    previous: SetupSuggestion[],
    incoming: SetupSuggestion[],
    currentEdits: Edits,
    documentId?: string,
  ) {
    const next = previous
      .filter((source) => !documentId || source.documentId !== documentId)
      .concat(incoming);
    const before = aggregateSetupEvidence(previous);
    const after = aggregateSetupEvidence(next);
    const updates = { ...currentEdits };
    for (const question of setupQuestionnaire) {
      const prior = currentEdits[question.key] ?? baseline(question);
      if (!prior) continue;
      const alternatives = after[question.key]?.alternatives ?? [];
      const oldAlternatives = before[question.key]?.alternatives ?? [];
      const addedDifferent = alternatives.some(
        (alternative) =>
          !supportedBy(question, alternative.value, oldAlternatives) &&
          (prior.status !== "confirmed" ||
            !supportedBy(question, prior.value, [alternative])),
      );
      if (addedDifferent) updates[question.key] = null;
    }
    setEdits(updates);
    setSaveConfirmed(false);
    setEvidence(next);
    return { evidence: next, edits: updates, before, after };
  }

  async function persistDraft(
    evidence: SetupSuggestion[],
    edits: Edits,
    completed: string[],
    reviews: ConflictReviews,
  ) {
    if (!draftActor) return false;
    try {
      if (draftLoadFailed.current) {
        const previous = await loadSetupReviewDraft(
          organisation.id,
          draftActor,
          "grant-setup",
        );
        if (previous)
          throw new Error(
            "A saved draft already exists. Reopen this form to review it.",
          );
        draftLoadFailed.current = false;
      }

      await saveSetupReviewDraft(organisation.id, draftActor, "grant-setup", {
        version: 1,
        evidence,
        edits,
        completed,
        selected,
        insurance,
        reviews,
      });
      if (active.current) {
        setDraftSaved(true);
        setDraftDirty(false);
        setDraftError("");
      }
      return true;
    } catch (e) {
      if (active.current) setDraftError(errorMessage(e));
      return false;
    }
  }

  async function saveDraftAndClose() {
    if (progress || loadingDraft) return;
    setProgress("Saving your draft");
    const savedDraft = await persistDraft(evidence, edits, completed, reviews);
    if (active.current) {
      setProgress("");
      if (savedDraft) onClose();
    }
  }

  async function checkConflicts(
    conflicts: ReturnType<typeof conflictChecks>,
    existing: ConflictReviews,
  ) {
    if (!conflicts.length) return existing;
    const checked = { ...existing };
    setConflictError("");
    setProgress("Checking conflicting excerpts");

    async function checkBatch(batch: typeof conflicts): Promise<boolean> {
      if (!active.current) return false;
      try {
        const result = await app.runAI({
          action: "setup-conflicts",
          conflicts: batch,
        });
        if (!active.current) return false;
        for (const item of result.setupConflicts ?? []) {
          const sent = batch.find(
            ({ questionKey }) => questionKey === item.questionKey,
          );
          if (!sent) continue;
          const index = item.recommendedAlternative;
          checked[item.questionKey] = {
            note: item.note,
            recommendedAlternative:
              index !== undefined &&
              Number.isInteger(index) &&
              index >= 0 &&
              index < sent.candidates.length
                ? index
                : undefined,
          };
        }
        return true;
      } catch (e) {
        if (!active.current) return false;
        if (e instanceof AIRequestError && e.code === "SG_AI_OUTPUT_LIMIT") {
          if (batch.length === 1) return true;
          const middle = Math.floor(batch.length / 2);
          return (
            (await checkBatch(batch.slice(0, middle))) &&
            (await checkBatch(batch.slice(middle)))
          );
        }
        setConflictError(errorMessage(e));
        return false;
      }
    }

    for (
      let start = 0;
      start < conflicts.length;
      start += CONFLICT_CHECK_BATCH_SIZE
    ) {
      if (
        !(await checkBatch(
          conflicts.slice(start, start + CONFLICT_CHECK_BATCH_SIZE),
        ))
      )
        break;
    }
    if (active.current) setReviews(checked);
    return checked;
  }

  async function retryConflictChecks() {
    if (progress || !pendingConflictChecks.length) return;
    const checked = await checkConflicts(pendingConflictChecks, reviews);
    if (!active.current) return;
    if (Object.keys(checked).length > Object.keys(reviews).length)
      await persistDraft(evidence, edits, completed, checked);
    if (active.current) setProgress("");
  }

  async function analyseSources() {
    if (progress) return;
    const documents = availableSources.filter(
      ({ id }) => selected.includes(id) && !completed.includes(id),
    );
    const pasted = paste.trim();
    const sources: {
      label: string;
      document?: DocumentRecord;
      text?: string;
    }[] = documents.map((document) => ({ label: document.name, document }));
    if (pasted && pasted !== analysedPaste)
      sources.push({ label: "Pasted information", text: pasted });
    if (!sources.length) return;
    let current = { evidence, edits };
    let currentCompleted = completed;
    let currentReviews = reviews;
    let finishedSource = false;
    setError("");
    setConflictError("");
    for (const [index, source] of sources.entries()) {
      const id = source.document?.id;
      const key = id ?? "paste";
      setProgress(
        `Reading ${index + 1} of ${sources.length} · ${source.label}`,
      );
      try {
        const result = await app.runAI({
          action: "setup-source",
          documentIds: id ? [id] : [],
          text: source.text ?? "",
          ...(source.document && isInsuranceCategory(source.document.category)
            ? { includeInsurance: true }
            : {}),
        });
        if (!active.current) return;
        const suggestions = readGrantSetupEvidence(
          result.setupSuggestions,
        ).filter((suggestion) => suggestion.documentId === id);
        const next = recordNewEvidence(
          current.evidence,
          suggestions,
          current.edits,
          id,
        );
        current = next;
        currentReviews = reviewsForEvidence(
          currentReviews,
          next.before,
          next.after,
        );
        setReviews(currentReviews);
        if (id) {
          currentCompleted = [...currentCompleted, id];
          setCompleted(currentCompleted);
        } else setAnalysedPaste(pasted);
        setSourceErrors((errors) => {
          const next = { ...errors };
          delete next[key];
          return next;
        });
        finishedSource = true;
        setDraftDirty(true);
        await persistDraft(
          current.evidence,
          current.edits,
          currentCompleted,
          currentReviews,
        );
        if (!active.current) return;
      } catch (e) {
        if (!active.current) return;
        setSourceErrors((errors) => ({
          ...errors,
          [key]: `${source.label}: ${errorMessage(e)}`,
        }));
      }
    }
    if (finishedSource) {
      const pending = conflictChecks(
        aggregateSetupEvidence(current.evidence),
      ).filter(({ questionKey }) => !currentReviews[questionKey]);
      const checked = await checkConflicts(pending, currentReviews);
      if (
        active.current &&
        Object.keys(checked).length > Object.keys(currentReviews).length
      )
        await persistDraft(
          current.evidence,
          current.edits,
          currentCompleted,
          checked,
        );
    }
    if (active.current) {
      setReviewing(true);
      setProgress("");
    }
  }

  const unanswered = setupQuestionnaire.filter(
    (question) => !answerFor(question),
  );
  const documentRecommendations = [
    ...new Set(
      unanswered.flatMap(
        (question) => suggestSetupDocuments(question, []).recommended,
      ),
    ),
  ];

  async function saveAnswers() {
    if (!saveConfirmed || progress) return;
    const answers: GrantSetupAnswers = {};
    for (const question of setupQuestionnaire) {
      const answer = answerFor(question);
      if (!answer) continue;
      const choice =
        answer.status === "confirmed" && Array.isArray(answer.value)
          ? {
              status: "confirmed" as const,
              value: answer.value.map((item) => item.trim()).filter(Boolean),
            }
          : answer;
      const confirmed = chooseSetupAnswer(
        question,
        choice,
        groups[question.key]?.alternatives,
      );
      if (!confirmed) {
        setError(
          `Check your answer to “${question.label}” or leave it unanswered.`,
        );
        return;
      }
      answers[question.key] = confirmed;
    }
    const unresolved = unanswered
      .filter(
        (question) =>
          groups[question.key]?.hasConflict ||
          (baseline(question) && groups[question.key]?.alternatives.length),
      )
      .map(({ key }) => key);
    setError("");
    setProgress("Saving reviewed answers");
    try {
      await app.updateOrg(
        grantSetupProfilePatch(
          organisation,
          answers,
          evidence,
          unresolved,
          approveProfile && mayApprove,
        ),
      );
      let cleanupMessage = "";
      if (
        draftActor &&
        (draftSaved || (draftError && !draftLoadFailed.current))
      )
        await removeSetupReviewDraft(
          organisation.id,
          draftActor,
          "grant-setup",
        ).catch((e) => {
          cleanupMessage = errorMessage(e);
        });
      if (active.current) {
        app.notify(cleanupMessage || "Reviewed grant answers saved.");
        onClose();
      }
    } catch (e) {
      if (active.current) setError(errorMessage(e));
    } finally {
      if (active.current) setProgress("");
    }
  }

  const pending =
    selected.some((id) => !completed.includes(id)) ||
    Boolean(paste.trim() && paste.trim() !== analysedPaste);
  const mayApprove =
    organisation.verification_status !== "approved" &&
    answerFor(setupQuestionnaire.find(({ key }) => key === "description")!)
      ?.status === "confirmed";

  return (
    <Modal
      wide
      title={
        reviewing
          ? "Review grant setup answers"
          : "Set up your organisation for grants"
      }
      onClose={() => {
        if (!progress) onClose();
      }}
    >
      <div className="stack grant-setup">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {draftError && (
          <p className="form-error" role="alert">
            {draftError}
          </p>
        )}
        {draftSaved && !draftDirty && !draftError && !progress && (
          <p className="small muted" role="status">
            Draft saved for later.
          </p>
        )}
        {progress && (
          <p role="status">
            <Busy label={progress} />
          </p>
        )}
        {Object.values(sourceErrors).length > 0 && (
          <Notice>
            <strong>Some sources still need attention</strong>
            <ul>
              {Object.entries(sourceErrors).map(([key, value]) => (
                <li key={key}>{value}</li>
              ))}
            </ul>
          </Notice>
        )}
        {loadingDraft ? (
          <p role="status">
            <Busy label="Opening your grant setup" />
          </p>
        ) : !reviewing ? (
          <>
            <p className="muted">
              Build a reusable set of grant answers. Your assistant works
              through one source at a time and brings back answers with
              supporting excerpts.
            </p>
            <details className="grant-setup-section">
              <summary>See all {setupQuestionnaire.length} questions</summary>
              {sections.map((section) => (
                <div key={section}>
                  <h3>{section}</h3>
                  <ul>
                    {setupQuestionnaire
                      .filter((item) => item.section === section)
                      .map((item) => (
                        <li key={item.key}>{item.label}</li>
                      ))}
                  </ul>
                </div>
              ))}
            </details>
            <label>
              Paste a public or redacted excerpt
              <textarea
                className="grant-setup-answer"
                maxLength={30000}
                rows={4}
                value={paste}
                disabled={!!progress}
                onChange={(event) => setPaste(event.target.value)}
              />
            </label>
            <fieldset disabled={!!progress}>
              <legend>Choose documents already in your library</legend>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={insurance}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setInsurance(checked);
                    if (!checked)
                      setSelected((ids) =>
                        ids.filter(
                          (id) =>
                            !app.data.documents.some(
                              (doc) =>
                                doc.id === id &&
                                isInsuranceCategory(doc.category),
                            ),
                        ),
                      );
                  }}
                />
                Include insurance certificates in the AI review
              </label>
              {availableSources.length ? (
                availableSources.map((source) => (
                  <label key={source.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={selected.includes(source.id)}
                      disabled={
                        !selected.includes(source.id) &&
                        selected.length >= MAX_AI_DOCUMENTS
                      }
                      onChange={(event) =>
                        setSelected((ids) =>
                          event.target.checked
                            ? [...ids, source.id]
                            : ids.filter((id) => id !== source.id),
                        )
                      }
                    />
                    <span>
                      {source.name}
                      {completed.includes(source.id) && (
                        <small> · Analysed</small>
                      )}
                    </span>
                  </label>
                ))
              ) : (
                <p className="small muted">
                  Add a public source in your document library, paste an
                  excerpt, or answer manually.
                </p>
              )}
            </fieldset>
            <p className="small muted">
              Choose up to {MAX_AI_DOCUMENTS} documents per run. Keep private
              financial statements and audits in your library. For the financial
              questions, use a published summary, a redacted excerpt, or a
              manual answer.
            </p>
            <div className="section-actions">
              <button
                className="button primary"
                onClick={analyseSources}
                disabled={!pending || !!progress || app.mode === "demo"}
              >
                Analyse pending sources
              </button>
              <button
                className="button secondary"
                onClick={() => setReviewing(true)}
                disabled={!!progress}
              >
                Review or answer manually
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              Confirm the answers you want to reuse in grant applications. Where
              sources disagree, choose the applicable value, enter a correction,
              or leave the question open.
            </p>
            {pendingConflictChecks.length > 0 && app.mode === "live" && (
              <Notice>
                <p>
                  Some conflicting excerpts still need a check. You can retry
                  the comparison or review the sources below yourself.
                </p>
                {conflictError && <p className="small">{conflictError}</p>}
                <button
                  className="button secondary"
                  type="button"
                  disabled={!!progress}
                  onClick={retryConflictChecks}
                >
                  Retry excerpt check
                </button>
              </Notice>
            )}
            {documentRecommendations.length > 0 && (
              <Notice>
                <strong>Documents that could fill gaps</strong>
                <ul>
                  {documentRecommendations.slice(0, 6).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="small">
                  Each unanswered question includes more specific suggestions.
                  Add sources in your document library, then reopen this form.
                </p>
              </Notice>
            )}
            {sections.map((section) => {
              const questions = setupQuestionnaire.filter(
                (question) => question.section === section,
              );
              const disagreements = questions.filter(
                ({ key }) => groups[key]?.hasConflict,
              ).length;
              return (
                <details
                  key={section}
                  className="grant-setup-section"
                  open={disagreements > 0 || undefined}
                >
                  <summary>
                    {section} ·{" "}
                    {questions.filter((question) => answerFor(question)).length}{" "}
                    of {questions.length} answered
                    {disagreements > 0 ? ` · ${disagreements} to compare` : ""}
                  </summary>
                  {questions.map((question) => {
                    const answer = answerFor(question);
                    const group = groups[question.key];
                    const review = reviews[question.key];
                    const previous = baseline(question);
                    const documents = suggestSetupDocuments(
                      question,
                      availableSources.filter(
                        ({ id }) => !completed.includes(id),
                      ),
                    );
                    return (
                      <fieldset
                        key={question.key}
                        className="grant-setup-question"
                        disabled={!!progress}
                      >
                        <legend>{question.label}</legend>
                        <p className="small muted">{question.help}</p>
                        {answer?.status !== "not_applicable" ? (
                          <AnswerInput
                            question={question}
                            value={
                              answer?.status === "confirmed"
                                ? answer.value
                                : undefined
                            }
                            onChange={(value) =>
                              editAnswer(
                                question.key,
                                value === undefined
                                  ? null
                                  : { status: "confirmed", value },
                              )
                            }
                          />
                        ) : (
                          <p className="small muted">
                            Marked as not applicable.
                          </p>
                        )}
                        {group && (
                          <div className="grant-setup-evidence">
                            {group.hasConflict && (
                              <strong>
                                Sources disagree. Which answer applies?
                              </strong>
                            )}
                            {!group.hasConflict &&
                              group.alternatives.length > 1 && (
                                <strong>Which reporting period applies?</strong>
                              )}
                            {!!review?.note && (
                              <p className="small muted">{review.note}</p>
                            )}
                            {group.alternatives.map((alternative, index) => (
                              <div
                                className="grant-setup-alternative"
                                key={JSON.stringify(alternative.value)}
                              >
                                <strong>
                                  {displayValue(alternative.value)}
                                </strong>
                                {review?.recommendedAlternative === index && (
                                  <p className="small">
                                    Suggested by the second review. Check the
                                    original before choosing.
                                  </p>
                                )}
                                <ul>
                                  {alternative.suggestions.map((source) => (
                                    <li
                                      key={JSON.stringify([
                                        source.documentId,
                                        source.locator,
                                        source.quote,
                                      ])}
                                    >
                                      <span className="small">
                                        {source.sourceLabel}
                                        {source.locator
                                          ? ` · ${source.locator}`
                                          : ""}
                                      </span>
                                      {source.quoteVerified === false && (
                                        <span className="small muted">
                                          {" "}
                                          · Check this excerpt against the
                                          original
                                        </span>
                                      )}
                                      <blockquote>{source.quote}</blockquote>
                                      {source.documentId &&
                                        app.data.documents.some(
                                          ({ id }) => id === source.documentId,
                                        ) && (
                                          <button
                                            className="button secondary"
                                            type="button"
                                            onClick={() =>
                                              void app
                                                .openDocument(
                                                  source.documentId!,
                                                )
                                                .catch((e) =>
                                                  setError(errorMessage(e)),
                                                )
                                            }
                                          >
                                            Open original
                                          </button>
                                        )}
                                    </li>
                                  ))}
                                </ul>
                                <button
                                  className="button secondary"
                                  type="button"
                                  onClick={() =>
                                    editAnswer(question.key, {
                                      status: "confirmed",
                                      value: alternative.value,
                                    })
                                  }
                                >
                                  Use this answer
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {!answer &&
                          previous?.status === "confirmed" &&
                          group && (
                            <button
                              className="button secondary"
                              type="button"
                              onClick={() => editAnswer(question.key, previous)}
                            >
                              Keep saved answer · {displayValue(previous.value)}
                            </button>
                          )}
                        <div className="section-actions">
                          {answer && (
                            <button
                              type="button"
                              className="button secondary"
                              onClick={() => editAnswer(question.key, null)}
                            >
                              Leave unanswered
                            </button>
                          )}
                          {question.allowsNotApplicable &&
                            answer?.status !== "not_applicable" && (
                              <button
                                type="button"
                                className="button secondary"
                                onClick={() =>
                                  editAnswer(question.key, {
                                    status: "not_applicable",
                                  })
                                }
                              >
                                Mark not applicable
                              </button>
                            )}
                        </div>
                        {!answer && (
                          <div className="small muted">
                            <p>
                              Possible sources ·{" "}
                              {documents.recommended.join(", ")}
                            </p>
                            {!!documents.matches.length && (
                              <p>
                                In your library ·{" "}
                                {documents.matches
                                  .slice(0, 3)
                                  .map(({ name }) => name)
                                  .join(", ")}
                              </p>
                            )}
                          </div>
                        )}
                      </fieldset>
                    );
                  })}
                </details>
              );
            })}
            {mayApprove && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={approveProfile}
                  disabled={!!progress}
                  onChange={(event) => setApproveProfile(event.target.checked)}
                />
                I approve the core organisation profile for grant drafting.
              </label>
            )}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={saveConfirmed}
                disabled={!!progress}
                onChange={(event) => setSaveConfirmed(event.target.checked)}
              />
              I’ve checked the answers above and want to save them for future
              applications.
            </label>
            <div className="section-actions">
              <button
                className="button primary"
                disabled={!saveConfirmed || !!progress}
                onClick={saveAnswers}
              >
                Save reviewed answers
              </button>
              {draftActor && (
                <button
                  className="button secondary"
                  disabled={!!progress}
                  onClick={saveDraftAndClose}
                >
                  Save draft and close
                </button>
              )}
              <button
                className="button secondary"
                disabled={!!progress}
                onClick={() => setReviewing(false)}
              >
                Back to sources
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
