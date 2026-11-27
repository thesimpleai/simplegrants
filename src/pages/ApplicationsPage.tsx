import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ClipboardList,
  Download,
  Files,
  Sparkles,
} from "lucide-react";
import { useApp } from "../lib/app-context";
import { applicationIdFromParams } from "../lib/auth-links";
import {
  Badge,
  Busy,
  EmptyState,
  Modal,
  Notice,
  date,
  money,
  errorMessage,
  ExternalLink,
} from "../components/ui";
import type { Application } from "../types";
import {
  isApplicationResearch,
  type ApplicationResearch,
} from "../lib/application-research";
import { draftEvidenceBlockers } from "../lib/grant-requirements";
import {
  MAX_AI_DOCUMENTS,
  MAX_AI_DOCUMENT_BYTES,
} from "../lib/document-formats";
import { readApplicationReadiness } from "../lib/application-readiness";
import {
  ApplicationDraftReview,
  applicationDraftText,
  DraftReadiness,
} from "../components/ApplicationDraftReview";
import { ApplicationSources } from "../components/ApplicationSources";
import "./applications.css";

const sections = {
  project: "Project",
  review: "Draft & review",
  submission: "Submission",
} as const;
type Section = keyof typeof sections;

function inputSnapshot(
  details: {
    summary: string;
    application_questions: string;
    budget_notes: string;
  },
  guidelines: string,
  documents: string[],
) {
  return JSON.stringify([
    details.summary,
    details.application_questions,
    details.budget_notes,
    guidelines,
    [...documents].sort(),
  ]);
}

export default function ApplicationsPage({
  onDiscover,
}: {
  onDiscover: () => void;
}) {
  const app = useApp(),
    [selected, setSelected] = useState(""),
    [details, setDetails] = useState({
      summary: "",
      application_questions: "",
      budget_notes: "",
    }),
    [guidelines, setGuidelines] = useState(""),
    [draft, setDraft] = useState(""),
    [status, setStatus] = useState<Application["status"]>("draft"),
    [reference, setReference] = useState(""),
    [submittedConfirmed, setSubmittedConfirmed] = useState(false),
    [referenceUnavailable, setReferenceUnavailable] = useState(false),
    [sourceDocuments, setSourceDocuments] = useState<string[]>([]),
    [award, setAward] = useState({
      amount: "",
      startDate: new Date().toISOString().slice(0, 10),
      endDate: "",
      reportDue: "",
      milestone: "First progress report",
    }),
    [working, setWorking] = useState<
      "save" | "draft" | "assess" | "award" | "organisation" | null
    >(null),
    [error, setError] = useState("");
  const [research, setResearch] = useState<ApplicationResearch | null>(null);
  const busy = working !== null;
  const [section, setSection] = useState<Section>("project");
  const [draftRecord, setDraftRecord] = useState<Application["draft"]>({});
  const [savedInputs, setSavedInputs] = useState("");
  const editor = useRef<HTMLDivElement>(null);
  const supportingDocuments = useRef<HTMLDetailsElement>(null);
  const focusUploads = useRef(false);
  const [reviewVersion, setReviewVersion] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const researchRequest = useRef(0);
  const [researching, setResearching] = useState(false);
  useEffect(() => {
    const modal = editor.current?.closest(".modal");
    modal?.scrollTo({ top: 0 });
    if (
      focusUploads.current &&
      section === "project" &&
      supportingDocuments.current
    ) {
      focusUploads.current = false;
      supportingDocuments.current.open = true;
      supportingDocuments.current.querySelector("summary")?.focus();
      return;
    }
    if (modal && !modal.contains(document.activeElement))
      editor.current
        ?.querySelector<HTMLElement>("button[aria-current]")
        ?.focus({ preventScroll: true });
  }, [selected, section, reviewVersion]);
  const [sourcesConfirmed, setSourcesConfirmed] = useState(false);
  const application = app.data.applications.find((a) => a.id === selected),
    opportunity = app.data.opportunities.find(
      (o) => o.id === application?.opportunity_id,
    );
  function open(a: Application) {
    setSelected(a.id);
    setQuestionIndex(0);
    const inputs = {
      summary: String(a.project_details.summary ?? ""),
      application_questions: String(
        a.project_details.application_questions ?? "",
      ),
      budget_notes: String(a.project_details.budget_notes ?? ""),
    };
    const sourceText =
      app.data.opportunities.find((o) => o.id === a.opportunity_id)
        ?.guidelines_text ?? "";
    const documents = Array.isArray(a.project_details.source_document_ids)
      ? a.project_details.source_document_ids.filter(
          (id): id is string =>
            typeof id === "string" &&
            app.data.documents.some(
              (doc) => doc.id === id && doc.org_id === app.org?.id,
            ),
        )
      : [];
    setDetails(inputs);
    setGuidelines(sourceText);
    setSourceDocuments(documents);
    setSavedInputs(inputSnapshot(inputs, sourceText, documents));
    setDraftRecord(a.draft);
    const savedText = applicationDraftText(a.draft);
    setDraft(savedText);
    setSection(
      ["awarded", "declined", "submitted"].includes(a.status)
        ? "submission"
        : a.status === "review" || savedText.trim()
          ? "review"
          : "project",
    );
    setStatus(a.status);
    setReference(a.grant_reference ?? "");
    const confirmation = a.project_details.submission_confirmation;
    setSubmittedConfirmed(
      Boolean(
        confirmation &&
        typeof confirmation === "object" &&
        "confirmed" in confirmation &&
        confirmation.confirmed === true,
      ),
    );
    setReferenceUnavailable(
      Boolean(
        confirmation &&
        typeof confirmation === "object" &&
        "reference_unavailable" in confirmation &&
        confirmation.reference_unavailable === true,
      ),
    );
    setError("");
    setResearch(
      isApplicationResearch(a.project_details.application_research)
        ? a.project_details.application_research
        : null,
    );
    setSourcesConfirmed(a.project_details.research_sources_confirmed === true);
  }
  useEffect(() => {
    if (!app.org) return;
    const key = `simple-grants-open-application:${app.user?.id ?? "demo"}:${app.org.id}`;
    const url = new URL(window.location.href);
    const linked = applicationIdFromParams(url.searchParams);
    let pending = linked;
    if (!pending) {
      try {
        pending = sessionStorage.getItem(key);
      } catch {
        return;
      }
    }
    const saved = app.data.applications.find(
      (item) => item.id === pending && item.org_id === app.org?.id,
    );
    if (!saved) return;
    if (linked) {
      url.searchParams.delete("application");
      window.history.replaceState({}, "", url);
    } else {
      sessionStorage.removeItem(key);
    }
    open(saved);
  }, [app.org?.id, app.user?.id, app.data.applications]);
  function closeEditor() {
    if (busy) return;
    researchRequest.current++;
    setResearching(false);
    setSelected("");
  }
  async function prepareSources() {
    if (!application) return;
    const request = ++researchRequest.current;
    setResearching(true);
    setError("");
    try {
      const result = await app.runAI({
        action: "prepare-application",
        applicationId: application.id,
        opportunityId: application.opportunity_id,
      });
      if (request !== researchRequest.current) return;
      if (!result.applicationResearch)
        throw new Error(
          "The source research could not be read. Use the funder’s current guidelines below.",
        );
      setResearch(result.applicationResearch);
      setSourcesConfirmed(false);
    } catch (error) {
      if (request === researchRequest.current) setError(errorMessage(error));
    } finally {
      if (request === researchRequest.current) setResearching(false);
    }
  }
  function useResearch() {
    if (!research) return;
    if (
      (!guidelines.trim() && research.guidelines_excerpt.trim()) ||
      (!details.application_questions.trim() &&
        research.application_questions.trim())
    )
      setSourcesConfirmed(false);
    setGuidelines((current) =>
      current.trim() ? current : research.guidelines_excerpt,
    );
    setDetails((current) => ({
      ...current,
      application_questions: current.application_questions.trim()
        ? current.application_questions
        : research.application_questions,
    }));
    app.notify(
      "Available source details added to empty fields. Check them against the complete current official documents.",
    );
  }
  const currentInputs = inputSnapshot(details, guidelines, sourceDocuments);
  const originalText = useMemo(
    () => applicationDraftText(draftRecord),
    [draftRecord],
  );
  const textChanged = draft !== originalText;
  const hasManualText =
    draft.trim() !== "" &&
    (typeof draftRecord.application_text === "string" || textChanged);
  const inputsChanged = currentInputs !== savedInputs;
  const readiness = useMemo(
    () => readApplicationReadiness(draftRecord.readiness),
    [draftRecord],
  );
  const nextSuggestion =
    readiness?.suggestions.find((item) => item.priority === "required") ??
    readiness?.suggestions[0];
  const stale =
    draftRecord.readiness_stale === true ||
    textChanged ||
    inputsChanged ||
    Boolean(research && !sourcesConfirmed);
  async function save() {
    if (!application) return;
    if (status === "submitted" && !submittedConfirmed)
      throw new Error(
        "Confirm that you completed the funder’s submission process before marking this application as submitted.",
      );
    if (status === "submitted" && !reference.trim() && !referenceUnavailable)
      throw new Error(
        "Add the funder’s submission reference, or confirm that the funder did not provide one.",
      );
    const existingConfirmation =
      application.project_details.submission_confirmation;
    const changedDraft =
      textChanged ||
      (readiness && stale && draftRecord.readiness_stale !== true)
        ? {
            ...draftRecord,
            ...(textChanged ? { application_text: draft } : {}),
            ...(readiness ? { readiness_stale: true } : {}),
          }
        : null;
    await app.updateApplication(application.id, {
      project_details: {
        ...application.project_details,
        ...details,
        source_document_ids: sourceDocuments,
        ...(research
          ? {
              application_research: research,
              research_sources_confirmed: sourcesConfirmed,
            }
          : {}),
        ...(status === "submitted"
          ? {
              submission_confirmation: {
                confirmed: true,
                reference_unavailable:
                  !reference.trim() && referenceUnavailable,
                confirmed_at:
                  existingConfirmation &&
                  typeof existingConfirmation === "object" &&
                  "confirmed_at" in existingConfirmation &&
                  typeof existingConfirmation.confirmed_at === "string"
                    ? existingConfirmation.confirmed_at
                    : new Date().toISOString(),
              },
            }
          : {}),
      },
      status,
      grant_reference: reference.trim() || null,
      submitted_at:
        status === "submitted"
          ? (application.submitted_at ?? new Date().toISOString())
          : application.submitted_at,
      ...(changedDraft ? { draft: changedDraft } : {}),
    });
    if (changedDraft) setDraftRecord(changedDraft);
    if (opportunity)
      await app.saveOpportunity({
        id: opportunity.id,
        guidelines_text: guidelines,
      });
    setSavedInputs(currentInputs);
  }
  async function perform(action: "save" | "draft" | "assess" | "organisation") {
    setWorking(action);
    setError("");
    try {
      if (action === "draft" && evidenceBlockers.length)
        throw new Error(evidenceBlockers.join(" "));
      await save();
      if (action === "organisation" && app.org) {
        window.location.assign(
          `?view=organisation&org=${encodeURIComponent(app.org.id)}`,
        );
        return;
      }
      if ((action === "draft" || action === "assess") && application) {
        const result = await app.runAI({
          action: "draft",
          applicationId: application.id,
          opportunityId: application.opportunity_id,
          documentIds: sourceDocuments,
          allowIncompleteDraft: true,
          ...(action === "assess" ? { reviewExistingDraft: true } : {}),
        });
        if (result.draft) {
          setReviewVersion((version) => version + 1);
          setDraftRecord(result.draft);
          setDraft(applicationDraftText(result.draft));
          if (action === "draft") {
            setStatus("draft");
            setQuestionIndex(0);
          }
          setSection("review");
        }
        app.notify(
          action === "assess"
            ? "Draft readiness updated."
            : "Your draft is ready for review. Check every fact before submitting.",
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(null);
    }
  }
  function download() {
    const a = document.createElement("a"),
      url = URL.createObjectURL(
        new Blob(
          [
            `DRAFT · ${application?.title}\n\n${draft}`,
            ...(readiness && !stale
              ? readiness.suggestions
                  .filter((item) => item.priority === "required")
                  .map(
                    (item) => `\n\nRequired before submission: ${item.action}`,
                  )
              : []),
            "\n\nReview every answer and attachment before submitting through the funder.",
          ],
          { type: "text/plain" },
        ),
      );
    a.href = url;
    a.download = "simple-grant-application.txt";
    a.click();
    URL.revokeObjectURL(url);
  }
  async function recordAward() {
    if (!application) return;
    setError("");
    setWorking("award");
    try {
      await app.createFundedProject(application.id, {
        ...award,
        amount: Number(award.amount),
      });
      setSelected("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(null);
    }
  }
  const evidenceBlockers = draftEvidenceBlockers(
    guidelines,
    app.data.documents,
  );
  const sourceBytes = app.data.documents
    .filter((doc) => sourceDocuments.includes(doc.id))
    .reduce((sum, doc) => sum + doc.size_bytes, 0);
  const sourcesTooLarge =
    sourceDocuments.length > MAX_AI_DOCUMENTS ||
    sourceBytes > MAX_AI_DOCUMENT_BYTES;
  const requirements = [
    {
      missing: !["draft", "review"].includes(status),
      title: "This application is in its submission stage.",
      target: "submission",
      action: "Open submission",
    },
    {
      missing: app.org?.verification_status !== "approved",
      title: "Review and approve your organisation profile in My organisation.",
      target: "organisation",
      action: "Save and open My organisation",
    },
    {
      missing: !guidelines.trim(),
      title: "Add the funder’s current program guidelines.",
      target: "sources",
      action: "Open funder sources",
    },
    {
      missing: !details.application_questions.trim(),
      title: "Copy the funder’s application questions and word limits.",
      target: "sources",
      action: "Open funder sources",
    },
    {
      missing: research && !sourcesConfirmed,
      title:
        "Check the guidelines and questions against the funder’s current documents.",
      target: "sources",
      action: "Open funder sources",
    },
    {
      missing: !details.summary.trim(),
      title: "Describe what you’ll do, who it’s for and where it will happen.",
      target: "summary",
      action: "Add project details",
    },
    {
      missing: evidenceBlockers.length > 0,
      generationOnly: true,
      title: evidenceBlockers[0],
      target: "organisation",
      action: "Save and open My organisation",
    },
    {
      missing: sourcesTooLarge,
      title: `Choose up to ${MAX_AI_DOCUMENTS} supporting documents totalling no more than 15 MB.`,
      target: "documents",
      action: "Choose documents",
    },
  ];
  const issue = requirements.find(({ missing }) => missing);
  const ready = !issue;
  const reviewIssue = requirements.find(
    (item) => item.missing && !item.generationOnly,
  );
  const canReview = !reviewIssue;
  const reviewBlocker = hasManualText ? reviewIssue : issue;
  const funderUrl = research
    ? research.official_source_url
    : opportunity?.source_url;
  function openInput(target: string) {
    if (target === "organisation") {
      void perform("organisation");
      return;
    }
    if (target === "submission") {
      setSection("submission");
      return;
    }
    const field = document.getElementById(`application-${target}`);
    if (field instanceof HTMLDetailsElement) {
      field.open = true;
      field.querySelector("summary")?.focus();
    } else field?.focus();
  }
  const generate = (
    <button
      className={
        section === "review" && hasManualText
          ? "button secondary align-start"
          : "button primary align-start"
      }
      disabled={busy || researching || !ready}
      onClick={() => perform("draft")}
    >
      {working === "draft" ? (
        <Busy label="Checking evidence and preparing…" />
      ) : (
        <>
          <Sparkles size={16} />
          {readiness ? "Refresh draft and score" : "Prepare draft with AI"}
        </>
      )}
    </button>
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1 className="page-title">Your applications</h1>
        </div>
        <button className="button secondary" onClick={onDiscover}>
          Find an opportunity <ArrowRight size={17} />
        </button>
      </div>
      <div className="stat-strip">
        <div>
          <strong>
            {app.data.applications.filter((a) => a.status === "draft").length}
          </strong>
          <span>Being prepared</span>
        </div>
        <div>
          <strong>
            {app.data.applications.filter((a) => a.status === "review").length}
          </strong>
          <span>Ready for review</span>
        </div>
        <div>
          <strong>
            {
              app.data.applications.filter((a) => a.status === "submitted")
                .length
            }
          </strong>
          <span>Submitted by you</span>
        </div>
      </div>
      <div className="stack">
        {app.data.applications.map((a) => {
          const o = app.data.opportunities.find(
            (x) => x.id === a.opportunity_id,
          );
          const rowReadiness = readApplicationReadiness(a.draft.readiness);
          return (
            <button
              className="card application-row"
              key={a.id}
              onClick={() => open(a)}
            >
              <span className="item-icon">
                <ClipboardList size={24} />
              </span>
              <span className="application-info">
                <span className="funder-name">
                  {o?.funder ?? "Grant application"}
                </span>
                <strong>{a.title}</strong>
                <span className="muted">
                  {money(a.requested_amount)} requested · Closes{" "}
                  {date(o?.closes_at)}
                </span>
                {rowReadiness && (
                  <span className="application-row-score">
                    {a.draft.readiness_stale === true
                      ? "Readiness needs an update"
                      : `Draft readiness · ${rowReadiness.score}/100`}
                  </span>
                )}
              </span>
              <Badge
                tone={
                  a.status === "draft"
                    ? "cream"
                    : a.status === "submitted"
                      ? "blue"
                      : "green"
                }
              >
                {a.status === "review"
                  ? "Needs your review"
                  : a.status.charAt(0).toUpperCase() + a.status.slice(1)}
              </Badge>
              <ArrowRight size={20} />
            </button>
          );
        })}
      </div>
      {!app.data.applications.length && (
        <EmptyState
          icon={<ClipboardList size={32} />}
          title="No applications yet"
          description="Find a grant that fits your organisation, then choose Start application."
          action={
            <button className="button primary" onClick={onDiscover}>
              Explore grants
            </button>
          }
        />
      )}
      {application && (
        <Modal title={application.title} onClose={closeEditor} wide>
          <div className="application-editor" ref={editor}>
            <nav
              className="application-navigation"
              aria-label="Application sections"
            >
              {(Object.keys(sections) as Section[]).map((key) => (
                <button
                  type="button"
                  key={key}
                  aria-current={key === section ? "step" : undefined}
                  onClick={() => setSection(key)}
                >
                  {sections[key]}
                </button>
              ))}
            </nav>
            {section === "project" && (
              <section className="stack" aria-label="Project">
                <div className="application-guide">
                  <span className="application-field-caption">
                    {issue
                      ? "Next step"
                      : nextSuggestion
                        ? "From your last draft"
                        : research?.unresolved_questions.length
                          ? "From the grant research"
                          : "Ready to draft"}
                  </span>
                  <h3>
                    {issue?.title ||
                      nextSuggestion?.action ||
                      research?.unresolved_questions[0] ||
                      "Prepare answers to the funder’s questions."}
                  </h3>
                  {issue ? (
                    <button
                      className="text-link"
                      type="button"
                      disabled={busy}
                      onClick={() => openInput(issue.target)}
                    >
                      {issue.action} <ArrowRight size={15} />
                    </button>
                  ) : (
                    <p>
                      {nextSuggestion?.why ||
                        (research?.unresolved_questions.length
                          ? "Add your answer to the project details below."
                          : "The AI will use your approved profile, project details and selected evidence.")}
                    </p>
                  )}
                </div>
                <details
                  className="application-disclosure project-uploads"
                  id="application-documents"
                  ref={supportingDocuments}
                >
                  <summary>
                    <Files size={21} aria-hidden="true" />
                    <span className="upload-summary">
                      <strong>Supporting documents</strong>
                      <span>
                        {sourceDocuments.length
                          ? `${sourceDocuments.length} selected for this draft`
                          : "No files selected for this draft"}
                      </span>
                    </span>
                    <span className="upload-action">
                      Review uploads <ArrowRight size={15} />
                    </span>
                  </summary>
                  <div className="application-disclosure-body">
                    {app.org?.verification_status === "approved" && (
                      <details className="application-source-notes">
                        <summary>Approved organisation information</summary>
                        <strong>{app.org.name}</strong>
                        <p>
                          {app.org.profile.mission ||
                            app.org.profile.description ||
                            app.org.description}
                        </p>
                        {!!app.org.profile.beneficiaries?.length && (
                          <p>
                            People served ·{" "}
                            {app.org.profile.beneficiaries.join(", ")}
                          </p>
                        )}
                        {!!app.org.focus_areas.length && (
                          <p>Focus areas · {app.org.focus_areas.join(", ")}</p>
                        )}
                      </details>
                    )}
                    {app.data.documents.length ? (
                      <>
                        <p>
                          Choose the uploads that support this application. The
                          AI reads only the files you select. Spreadsheet values
                          are used as saved.
                        </p>
                        {app.data.documents.map((doc) => (
                          <label className="checkbox-row" key={doc.id}>
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={sourceDocuments.includes(doc.id)}
                              onChange={(event) =>
                                setSourceDocuments((ids) =>
                                  event.target.checked
                                    ? [...ids, doc.id]
                                    : ids.filter((id) => id !== doc.id),
                                )
                              }
                            />
                            <span>Use {doc.name} for this draft</span>
                            <span
                              className="upload-category"
                              aria-hidden="true"
                            >
                              {doc.category.replaceAll("_", " ")}
                            </span>
                          </label>
                        ))}
                        <p className="small muted">
                          {sourceDocuments.length} of {MAX_AI_DOCUMENTS}{" "}
                          documents · {(sourceBytes / (1024 * 1024)).toFixed(1)}{" "}
                          of 15 MB
                        </p>
                      </>
                    ) : (
                      <p>
                        Add budgets, letters or other evidence to My
                        organisation to use them here.
                      </p>
                    )}
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() => perform("organisation")}
                    >
                      Save and open document library <ArrowRight size={15} />
                    </button>
                  </div>
                </details>
                <label className="form-field">
                  Tell us about your project
                  <textarea
                    id="application-summary"
                    rows={3}
                    disabled={busy}
                    value={details.summary}
                    onChange={(e) =>
                      setDetails((d) => ({ ...d, summary: e.target.value }))
                    }
                    placeholder="Describe the activity, who will benefit, where and when it will happen, and what will change."
                  />
                </label>
                <label className="form-field">
                  Budget and co-funding notes
                  <textarea
                    rows={2}
                    disabled={busy}
                    value={details.budget_notes}
                    onChange={(e) =>
                      setDetails((d) => ({
                        ...d,
                        budget_notes: e.target.value,
                      }))
                    }
                    placeholder="List the costs, how much you are requesting, and any other funding."
                  />
                </label>
                <ApplicationSources
                  guidelines={guidelines}
                  questions={details.application_questions}
                  research={research}
                  confirmed={sourcesConfirmed}
                  sourceUrl={opportunity?.source_url}
                  canResearch={
                    app.mode === "live" &&
                    ["draft", "review"].includes(application.status)
                  }
                  researching={researching}
                  busy={busy}
                  onResearch={() => prepareSources()}
                  useResearch={useResearch}
                  onConfirm={setSourcesConfirmed}
                  onGuidelines={(value) => {
                    setGuidelines(value);
                    if (research) setSourcesConfirmed(false);
                  }}
                  onQuestions={(value) => {
                    setDetails((d) => ({ ...d, application_questions: value }));
                    if (research) setSourcesConfirmed(false);
                  }}
                />
                {generate}
              </section>
            )}
            {section === "review" && (
              <section
                className="stack application-review-panel"
                aria-label="Draft and review"
              >
                <ApplicationDraftReview
                  key={reviewVersion}
                  questionIndex={questionIndex}
                  onQuestion={setQuestionIndex}
                  textChanged={textChanged}
                  record={draftRecord}
                  draft={draft}
                  busy={busy}
                  setDraft={setDraft}
                  onSources={() => {
                    focusUploads.current = true;
                    setSection("project");
                  }}
                />
                {readiness ? (
                  <DraftReadiness
                    readiness={readiness}
                    stale={stale}
                    blocked={reviewBlocker?.title}
                    onProject={() => setSection("project")}
                  />
                ) : (
                  <div className="application-guide">
                    <h3>
                      {draft
                        ? "Give this draft a readiness check"
                        : "Prepare your first draft"}
                    </h3>
                    <p>
                      {reviewBlocker?.title ||
                        (hasManualText
                          ? "Check the text you wrote against the funder’s questions and see what to add next."
                          : "Prepare a draft with AI to see its readiness score and what to add next.")}
                    </p>
                    {reviewBlocker && (
                      <button
                        className="text-link"
                        onClick={() => setSection("project")}
                      >
                        Review project inputs <ArrowRight size={15} />
                      </button>
                    )}
                  </div>
                )}
                <div className="application-actions">
                  {hasManualText && (
                    <button
                      type="button"
                      className="button primary"
                      disabled={busy || researching || !canReview}
                      onClick={() => perform("assess")}
                    >
                      {working === "assess" ? (
                        <Busy label="Checking edited draft…" />
                      ) : (
                        <>
                          <Sparkles size={16} />
                          Check edited draft
                        </>
                      )}
                    </button>
                  )}
                  {generate}
                  {draft && (
                    <button className="button secondary" onClick={download}>
                      <Download size={16} />
                      Download draft
                    </button>
                  )}
                </div>
                {draft && (
                  <p className="small muted">
                    {hasManualText
                      ? "Check edited draft keeps your wording. Preparing a new draft replaces it."
                      : "Preparing a new draft replaces this version. Download a copy to keep it."}
                  </p>
                )}
              </section>
            )}
            {section === "submission" && (
              <section className="stack" aria-label="Submission">
                <div className="application-guide">
                  <h3>Submit through the funder</h3>
                  <p>
                    Check every answer and attachment, sign the declarations
                    yourself, then record the outcome here.
                  </p>
                  {funderUrl && (
                    <ExternalLink href={funderUrl}>
                      Open the funder’s website to submit
                    </ExternalLink>
                  )}
                </div>
                <div className="form-grid">
                  <label className="form-field">
                    Application status
                    <select
                      disabled={busy}
                      value={status}
                      onChange={(e) => {
                        setStatus(e.target.value as Application["status"]);
                        setSubmittedConfirmed(false);
                        setReferenceUnavailable(false);
                      }}
                    >
                      <option value="draft">Being prepared</option>
                      <option value="review">Ready for review</option>
                      <option value="submitted">
                        I have submitted to the funder
                      </option>
                      <option value="awarded">Awarded by the funder</option>
                      <option value="declined">Not awarded</option>
                    </select>
                  </label>
                  <label className="form-field">
                    Funder’s submission reference
                    <input
                      disabled={busy}
                      value={reference}
                      onChange={(e) => {
                        setReference(e.target.value);
                        if (e.target.value.trim())
                          setReferenceUnavailable(false);
                      }}
                      placeholder="Add after submitting"
                    />
                  </label>
                </div>
                {application.status === "awarded" &&
                  !app.data.projects.some(
                    (p) => p.application_id === application.id,
                  ) && (
                    <section className="card-soft stack">
                      <h3>Make this a funded project</h3>
                      <p>
                        Use your signed grant agreement to record the award and
                        reporting dates. Keep the agreement in your document
                        library.
                      </p>
                      <div className="form-grid">
                        <label className="form-field">
                          Amount awarded (AUD)
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={award.amount}
                            onChange={(e) =>
                              setAward((a) => ({
                                ...a,
                                amount: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="form-field">
                          First report due
                          <input
                            type="date"
                            value={award.reportDue}
                            onChange={(e) =>
                              setAward((a) => ({
                                ...a,
                                reportDue: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="form-field">
                          Project starts
                          <input
                            type="date"
                            value={award.startDate}
                            onChange={(e) =>
                              setAward((a) => ({
                                ...a,
                                startDate: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="form-field">
                          Project ends
                          <input
                            type="date"
                            value={award.endDate}
                            onChange={(e) =>
                              setAward((a) => ({
                                ...a,
                                endDate: e.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>
                      <label className="form-field">
                        First milestone
                        <input
                          value={award.milestone}
                          onChange={(e) =>
                            setAward((a) => ({
                              ...a,
                              milestone: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <button
                        className="button primary align-start"
                        disabled={
                          busy ||
                          !award.amount ||
                          !award.startDate ||
                          !award.endDate
                        }
                        onClick={recordAward}
                      >
                        Create funded project <ArrowRight size={17} />
                      </button>
                    </section>
                  )}
                {status === "submitted" && (
                  <div className="stack">
                    <Notice>
                      You can track an application completed outside Simple
                      Grant. Only mark it submitted after completing the
                      funder’s own process. Save the confirmation or receipt in
                      your document library.
                    </Notice>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={submittedConfirmed}
                        onChange={(e) =>
                          setSubmittedConfirmed(e.target.checked)
                        }
                        disabled={busy}
                      />{" "}
                      I submitted this application to the funder.
                    </label>
                    {!reference.trim() && (
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={referenceUnavailable}
                          onChange={(e) =>
                            setReferenceUnavailable(e.target.checked)
                          }
                          disabled={busy}
                        />{" "}
                        The funder did not provide a submission reference.
                      </label>
                    )}
                  </div>
                )}
              </section>
            )}
            {error && (
              <p className="error-box" role="alert">
                {error}
              </p>
            )}
            <div className="modal-footer">
              <button
                className="button secondary"
                disabled={busy}
                onClick={closeEditor}
              >
                Close
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => perform("save")}
              >
                {working === "save" ? <Busy label="Saving…" /> : "Save changes"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
