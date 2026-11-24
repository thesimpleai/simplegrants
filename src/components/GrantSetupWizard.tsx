import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AIResult,
  DocumentRecord,
  Organisation,
  UploadBatchResult,
} from "../types";
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
  setupQuestionByKey,
  setupQuestionnaire,
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
import GrantSetupSources, { setupSourceCategory } from "./GrantSetupSources";
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

function websiteURL(value: string) {
  const input = value.trim();
  if (!input) return "";
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.includes(".")
    )
      return null;
    return /^https?:\/\//i.test(input) ? input : `https://${input}`;
  } catch {
    return null;
  }
}

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

function approvedEdits(saved: ReturnType<typeof readGrantSetup>): Edits {
  return {
    ...saved.answers,
    ...Object.fromEntries(saved.unresolved.map((key) => [key, null])),
  };
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

function SourceExcerpts({
  suggestions,
  openOriginal,
}: {
  suggestions: SetupSuggestion[];
  openOriginal: (id: string) => void;
}) {
  const {
    data: { documents },
  } = useApp();
  return (
    <details className="grant-setup-excerpts">
      <summary>View {suggestions.length === 1 ? "source" : "sources"}</summary>
      <ul>
        {suggestions.map(
          ({ documentId, locator, quote, quoteVerified, sourceLabel }) => (
            <li key={JSON.stringify([documentId, sourceLabel, locator, quote])}>
              <span className="small">
                {sourceLabel}
                {locator && ` · ${locator}`}
              </span>
              {quoteVerified === false && (
                <p className="small muted">
                  Check this excerpt against the original.
                </p>
              )}
              <blockquote>{quote}</blockquote>
              {documentId && documents.some(({ id }) => id === documentId) && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => openOriginal(documentId)}
                >
                  Open original
                </button>
              )}
            </li>
          ),
        )}
      </ul>
    </details>
  );
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

  if (question.key === "website") {
    return (
      <input
        aria-label={question.label}
        autoComplete="url"
        inputMode="url"
        maxLength={1500}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value || undefined)}
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
  const [edits, setEdits] = useState<Edits>(() => approvedEdits(saved));
  const [reviews, setReviews] = useState<ConflictReviews>({});
  const [conflictError, setConflictError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [paste, setPaste] = useState("");
  const [uploadReport, setUploadReport] = useState<UploadBatchResult>();
  const [completed, setCompleted] = useState<string[]>([]);
  const [analysedPaste, setAnalysedPaste] = useState("");
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const [showAllQuestions, setShowAllQuestions] = useState(true);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [approveProfile, setApproveProfile] = useState(false);
  const draftActor = app.mode === "demo" ? undefined : app.user?.id;
  const [loadingDraft, setLoadingDraft] = useState(Boolean(draftActor));
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardError, setDiscardError] = useState("");
  const intro = useRef<HTMLParagraphElement>(null);
  const draftLoadFailed = useRef(false);
  const active = useRef(true);
  const mayDiscardDraft =
    !!draftActor &&
    !loadingDraft &&
    !draftLoadFailed.current &&
    (draftSaved || draftDirty);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    if (loadingDraft || discardOpen) return;
    intro.current?.closest(".modal")?.scrollTo(0, 0);
    intro.current?.focus({ preventScroll: true });
  }, [reviewing, loadingDraft, discardOpen]);

  useEffect(() => {
    if (!draftActor) return;
    let cancelled = false;
    loadSetupReviewDraft(organisation.id, draftActor, "grant-setup")
      .then((draft) => {
        if (cancelled || draft?.data.version !== 1) return;
        const data = draft.data;
        const restoredEvidence = readGrantSetupEvidence(data.evidence);
        setEvidence(restoredEvidence);
        setEdits(draftEdits(data.edits));
        setReviews(draftConflictReviews(data.reviews));
        setSelected(draftSourceIds(data.selected));
        setCompleted(draftSourceIds(data.completed));
        setDraftSaved(true);
        setShowAllQuestions(restoredEvidence.length === 0);
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
  const availableSources = app.data.documents.filter(({ category }) =>
    Boolean(setupSourceCategory(category)),
  );
  const pendingDocuments = availableSources.filter(
    ({ id }) => selected.includes(id) && !completed.includes(id),
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

  function selectSource(id: string, checked: boolean) {
    setSelected((ids) =>
      checked ? [...ids, id] : ids.filter((item) => item !== id),
    );
    if (!checked && sourceErrors[id])
      setSourceErrors(({ [id]: _removed, ...remaining }) => remaining);
  }

  async function uploadSources(category: string, files: File[]) {
    if (progress || !files.length) return;
    setError("");
    setUploadReport(undefined);
    setProgress("Uploading documents");
    try {
      const result = await app.uploadDocuments(files, category);
      if (!active.current) return;
      setUploadReport(result);
      const room = MAX_AI_DOCUMENTS - pendingDocuments.length;
      if (
        !isInsuranceCategory(category) &&
        result.savedDocumentIds.length &&
        room > 0
      ) {
        setSelected((ids) => [
          ...ids,
          ...result.savedDocumentIds.slice(0, room),
        ]);
        setDraftDirty(true);
      }
    } catch (e) {
      if (active.current) setError(errorMessage(e));
    } finally {
      if (active.current) setProgress("");
    }
  }

  function recordNewEvidence(
    previous: SetupSuggestion[],
    incoming: SetupSuggestion[],
    currentEdits: Edits,
    documentId?: string,
  ) {
    const next = previous
      .filter((source) => source.documentId !== documentId)
      .concat(incoming);
    const before = aggregateSetupEvidence(previous);
    const after = aggregateSetupEvidence(next);
    const updates = { ...currentEdits };
    for (const question of setupQuestionnaire) {
      if (question.key === "website" && Object.hasOwn(currentEdits, "website"))
        continue;
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

  async function discardDraft() {
    if (!draftActor || !mayDiscardDraft || !discardOpen || progress) return;
    setProgress("Discarding draft");
    setDiscardError("");
    try {
      await removeSetupReviewDraft(organisation.id, draftActor, "grant-setup");
      if (!active.current) return;
      setEvidence(saved.evidence);
      setEdits(approvedEdits(saved));
      setReviews({});
      setConflictError("");
      setSelected([]);
      setPaste("");
      setUploadReport(undefined);
      setCompleted([]);
      setAnalysedPaste("");
      setSourceErrors({});
      setReviewing(false);
      setError("");
      setSaveConfirmed(false);
      setApproveProfile(false);
      setDraftSaved(false);
      setDraftDirty(false);
      setDraftError("");
      setDiscardOpen(false);
      app.notify("Grant setup draft discarded.");
    } catch {
      if (active.current)
        setDiscardError("Couldn’t discard your grant setup draft. Try again.");
    } finally {
      if (active.current) setProgress("");
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
    const pasted = paste.trim();
    const sources: {
      label: string;
      document?: DocumentRecord;
      text?: string;
    }[] = pendingDocuments.map((document) => ({
      label: document.name,
      document,
    }));
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
      if (finishedSource) {
        setShowAllQuestions(current.evidence.length === 0);
        setReviewing(true);
      }
      setProgress("");
    }
  }

  const unanswered = setupQuestionnaire.filter(
    (question) => !answerFor(question),
  );

  function hasEvidenceChoice(question: Question) {
    const group = groups[question.key];
    if (!group) return false;
    const previous = baseline(question);
    return (
      group.alternatives.length > 1 ||
      (previous !== undefined &&
        (previous.status !== "confirmed" ||
          !supportedBy(question, previous.value, group.alternatives)))
    );
  }

  async function saveAnswers() {
    if (!saveConfirmed || progress) return;
    const answers: GrantSetupAnswers = {};
    for (const question of setupQuestionnaire) {
      const answer = answerFor(question);
      if (!answer) continue;
      let choice =
        answer.status === "confirmed" && Array.isArray(answer.value)
          ? {
              status: "confirmed" as const,
              value: answer.value.map((item) => item.trim()).filter(Boolean),
            }
          : answer;
      if (
        question.key === "website" &&
        choice.status === "confirmed" &&
        typeof choice.value === "string"
      ) {
        const url = websiteURL(choice.value);
        if (!url) {
          setError("Enter a valid public website address or leave it blank.");
          return;
        }
        choice = { status: "confirmed", value: url };
      }
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
    pendingDocuments.length > 0 ||
    Boolean(paste.trim() && paste.trim() !== analysedPaste);
  const websiteAnswer = answerFor(setupQuestionByKey.website);
  const website =
    websiteAnswer?.status === "confirmed" &&
    typeof websiteAnswer.value === "string"
      ? websiteAnswer.value
      : "";
  const disagreements = unanswered.filter(hasEvidenceChoice).length;
  const visibleQuestions = setupQuestionnaire.filter(
    (question) =>
      showAllQuestions || groups[question.key] || answerFor(question),
  );
  const firstSuggestedSection = setupQuestionnaire.find(
    ({ key }) => groups[key],
  )?.section;
  const uploadIssues = uploadReport
    ? [...uploadReport.failed, ...uploadReport.skipped]
    : [];
  const mayApprove =
    organisation.verification_status !== "approved" &&
    answerFor(setupQuestionnaire.find(({ key }) => key === "description")!)
      ?.status === "confirmed";

  if (discardOpen) {
    return (
      <Modal
        title="Discard grant setup draft?"
        onClose={() => !progress && setDiscardOpen(false)}
      >
        <div className="stack">
          <p>
            This deletes your draft and returns you to source selection.
            Approved organisation details and uploaded documents stay saved.
          </p>
          {discardError && (
            <p className="form-error" role="alert">
              {discardError}
            </p>
          )}
          <div className="modal-footer">
            <button
              type="button"
              className="button secondary"
              autoFocus
              disabled={!!progress}
              onClick={() => setDiscardOpen(false)}
            >
              Keep draft
            </button>
            <button
              type="button"
              className="button primary"
              disabled={!!progress}
              onClick={discardDraft}
            >
              {progress ? <Busy label={progress} /> : "Discard and start over"}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

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
        {mayDiscardDraft && reviewing && (
          <div className="section-actions">
            {draftSaved && !draftDirty && !draftError && !progress && (
              <p className="small muted" role="status">
                Draft saved for later.
              </p>
            )}
            <button
              type="button"
              className="button secondary"
              disabled={!!progress}
              onClick={() => {
                setDiscardError("");
                setDiscardOpen(true);
              }}
            >
              Discard draft and start over
            </button>
          </div>
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
            <p className="muted" ref={intro} tabIndex={-1}>
              Add any documents you have. We’ll use the files you select to
              suggest grant answers for you to review.
            </p>
            {app.mode === "demo" && (
              <p className="small muted">
                You can enter answers manually in the demo.
              </p>
            )}
            <div className="section-actions grant-setup-actions">
              <button
                className="button primary"
                type="button"
                onClick={analyseSources}
                disabled={!pending || !!progress || app.mode === "demo"}
              >
                Suggest answers
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setShowAllQuestions(true);
                  setReviewing(true);
                }}
                disabled={!!progress}
              >
                Enter answers manually
              </button>
            </div>
            <GrantSetupSources
              documents={availableSources}
              selected={selected}
              completed={completed}
              busy={!!progress}
              demo={app.mode === "demo"}
              onUpload={uploadSources}
              onSelect={selectSource}
            />
            {uploadReport && (
              <div
                className="grant-setup-upload-result"
                role={uploadReport.failed.length ? "alert" : "status"}
                aria-label="Setup upload results"
              >
                <strong>
                  {uploadReport.saved.length}{" "}
                  {uploadReport.saved.length === 1 ? "file" : "files"} added
                </strong>
                {uploadIssues.length > 0 && (
                  <ul>
                    {uploadIssues.map(({ name, reason }, index) => (
                      <li key={`${name}-${index}`}>
                        {name}. {reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <label className="form-field grant-setup-website">
              <span>
                Organisation website <span className="muted">(optional)</span>
              </span>
              <input
                inputMode="url"
                autoComplete="url"
                aria-label="Organisation website"
                maxLength={1500}
                placeholder="https://example.org.au"
                value={website}
                disabled={!!progress}
                onChange={(event) =>
                  editAnswer(
                    "website",
                    event.target.value.trim()
                      ? { status: "confirmed", value: event.target.value }
                      : null,
                  )
                }
              />
            </label>
            <details
              className="grant-setup-section"
              open={paste ? true : undefined}
            >
              <summary>Paste public or redacted text</summary>
              <label className="form-field">
                Paste a public or redacted excerpt
                <textarea
                  className="grant-setup-answer grant-setup-paste"
                  maxLength={30000}
                  rows={4}
                  value={paste}
                  disabled={!!progress}
                  onChange={(event) => setPaste(event.target.value)}
                />
              </label>
            </details>
            <p className="small muted">
              Use public or redacted information for AI analysis. Keep private
              financial reports in your document library. Upload up to 10 MB per
              file.
            </p>
          </>
        ) : (
          <>
            <p className="muted" ref={intro} tabIndex={-1}>
              {evidence.length
                ? "Check the suggested answers and fill in what you know."
                : completed.length || analysedPaste
                  ? "We found no suggested answers. You can enter what you know."
                  : "Enter what you know. You can leave questions blank and return later."}
            </p>
            {disagreements > 0 && (
              <p className="grant-setup-review-count" role="status">
                {disagreements}{" "}
                {disagreements === 1 ? "answer needs" : "answers need"} your
                review.
              </p>
            )}
            {evidence.length > 0 && (
              <button
                className="grant-setup-text-button grant-setup-question-filter"
                type="button"
                onClick={() => setShowAllQuestions(!showAllQuestions)}
              >
                {showAllQuestions
                  ? "Hide unanswered questions"
                  : "Show all questions"}
              </button>
            )}
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
            {sections.map((section) => {
              const questions = visibleQuestions.filter(
                (question) => question.section === section,
              );
              if (!questions.length) return null;
              const unresolvedComparisons = questions.filter(
                (question) =>
                  !answerFor(question) && hasEvidenceChoice(question),
              ).length;
              return (
                <details
                  key={section}
                  className="grant-setup-section"
                  open={
                    questions.some(hasEvidenceChoice) ||
                    (!showAllQuestions &&
                      disagreements === 0 &&
                      section === firstSuggestedSection) ||
                    undefined
                  }
                >
                  <summary>
                    <span>{section}</span>
                    <small>
                      {unresolvedComparisons > 0
                        ? `${unresolvedComparisons} to review`
                        : `${questions.filter((question) => answerFor(question)).length} answered`}
                    </small>
                  </summary>
                  {questions.map((question) => {
                    const answer = answerFor(question);
                    const group = groups[question.key];
                    const review = reviews[question.key];
                    const previous = baseline(question);
                    const openOriginal = (id: string) => {
                      void app
                        .openDocument(id)
                        .catch((e) => setError(errorMessage(e)));
                    };
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
                        {group && !hasEvidenceChoice(question) && (
                          <SourceExcerpts
                            suggestions={group.alternatives[0].suggestions}
                            openOriginal={openOriginal}
                          />
                        )}
                        {group && hasEvidenceChoice(question) && (
                          <div className="grant-setup-evidence">
                            {group.hasConflict && !answer && (
                              <strong>
                                Sources disagree. Which answer applies?
                              </strong>
                            )}
                            {!group.hasConflict &&
                              group.alternatives.length > 1 && (
                                <strong>Which reporting period applies?</strong>
                              )}
                            {review?.note && !answer && (
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
                                <SourceExcerpts
                                  suggestions={alternative.suggestions}
                                  openOriginal={openOriginal}
                                />
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
                        <div className="section-actions grant-setup-answer-actions">
                          {answer && (
                            <button
                              type="button"
                              className="grant-setup-text-button"
                              onClick={() => editAnswer(question.key, null)}
                            >
                              Leave unanswered
                            </button>
                          )}
                          {question.allowsNotApplicable &&
                            answer?.status !== "not_applicable" && (
                              <button
                                type="button"
                                className="grant-setup-text-button"
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
