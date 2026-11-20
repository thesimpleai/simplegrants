import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ClipboardList,
  Download,
  FileText,
  Sparkles,
} from "lucide-react";
import { useApp } from "../lib/app-context";
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
  formatDraft,
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
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [research, setResearch] = useState<ApplicationResearch | null>(null);
  const [researching, setResearching] = useState(false);
  const [sourcesConfirmed, setSourcesConfirmed] = useState(false);
  const application = app.data.applications.find((a) => a.id === selected),
    opportunity = app.data.opportunities.find(
      (o) => o.id === application?.opportunity_id,
    );
  function open(a: Application) {
    setSelected(a.id);
    setDetails({
      summary: String(a.project_details.summary ?? ""),
      application_questions: String(
        a.project_details.application_questions ?? "",
      ),
      budget_notes: String(a.project_details.budget_notes ?? ""),
    });
    setGuidelines(
      app.data.opportunities.find((o) => o.id === a.opportunity_id)
        ?.guidelines_text ?? "",
    );
    setDraft(
      typeof a.draft.application_text === "string"
        ? a.draft.application_text
        : formatDraft(a.draft),
    );
    setStatus(a.status);
    setReference(a.grant_reference ?? "");
    setSourceDocuments(
      Array.isArray(a.project_details.source_document_ids)
        ? a.project_details.source_document_ids.filter(
            (id): id is string =>
              typeof id === "string" &&
              app.data.documents.some(
                (doc) => doc.id === id && doc.org_id === app.org?.id,
              ),
          )
        : [],
    );
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
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(key);
    } catch {
      return;
    }
    const saved = app.data.applications.find(
      (item) => item.id === pending && item.org_id === app.org?.id,
    );
    if (!saved) return;
    sessionStorage.removeItem(key);
    open(saved);
    if (
      app.mode === "live" &&
      ["draft", "review"].includes(saved.status) &&
      !isApplicationResearch(saved.project_details.application_research)
    )
      void prepareSources(saved);
  }, [app.org?.id, app.user?.id, app.data.applications]);
  async function prepareSources(target = application) {
    if (!target) return;
    setBusy(true);
    setResearching(true);
    setError("");
    try {
      const result = await app.runAI({
        action: "prepare-application",
        applicationId: target.id,
        opportunityId: target.opportunity_id,
      });
      if (!result.applicationResearch)
        throw new Error(
          "The source research could not be read. Use the funder’s current guidelines below.",
        );
      setResearch(result.applicationResearch);
      setSourcesConfirmed(false);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
      setResearching(false);
    }
  }
  function useResearch() {
    if (!research) return;
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
      draft: draft ? { application_text: draft } : application.draft,
    });
    if (opportunity)
      await app.saveOpportunity({
        id: opportunity.id,
        guidelines_text: guidelines,
      });
  }
  async function perform(action: "save" | "draft") {
    setBusy(true);
    setError("");
    try {
      if (action === "draft" && evidenceBlockers.length)
        throw new Error(evidenceBlockers.join(" "));
      await save();
      if (action === "draft" && application) {
        const result = await app.runAI({
          action: "draft",
          applicationId: application.id,
          opportunityId: application.opportunity_id,
          documentIds: sourceDocuments,
        });
        if (result.draft) setDraft(formatDraft(result.draft));
        app.notify(
          "Your draft is ready for review. Check every fact before submitting.",
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const a = document.createElement("a"),
      url = URL.createObjectURL(
        new Blob([`${application?.title}\n\n${draft}`], { type: "text/plain" }),
      );
    a.href = url;
    a.download = "simple-grant-application.txt";
    a.click();
    URL.revokeObjectURL(url);
  }
  async function recordAward() {
    if (!application) return;
    setError("");
    setBusy(true);
    try {
      await app.createFundedProject(application.id, {
        ...award,
        amount: Number(award.amount),
      });
      setSelected("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
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
  const ready = Boolean(
    app.org?.verification_status === "approved" &&
    guidelines.trim() &&
    details.summary.trim() &&
    details.application_questions.trim() &&
    evidenceBlockers.length === 0 &&
    !sourcesTooLarge &&
    (!research || sourcesConfirmed),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ONE STEP CLOSER</div>
          <h1 className="page-title">Your applications</h1>
          <p className="page-subtitle">
            From a good idea to a well-prepared application.
          </p>
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
          title="Every application starts with a possibility"
          description="Find a grant that fits your organisation, then choose Start application."
          action={
            <button className="button primary" onClick={onDiscover}>
              Explore grants
            </button>
          }
        />
      )}
      <Notice>
        Simple Grant helps prepare your application. You submit it through the
        funder’s portal, sign the declarations, and keep the submission receipt.
      </Notice>
      {application && (
        <Modal
          title={application.title}
          onClose={() => !busy && setSelected("")}
          wide
        >
          <div className="stack">
            <div className="section-intro">
              <FileText size={20} />
              <p>Let’s collect what we need for a useful, accurate draft.</p>
            </div>
            <section
              className="card-soft stack"
              aria-label="Application assistant"
            >
              <h3>Start with the funder’s current information</h3>
              <p>
                Your assistant can research this grant, check what is already
                known about your organisation, and highlight what is still
                needed for this project.
              </p>
              {app.org?.verification_status === "approved" ? (
                <>
                  <p className="small muted">
                    Your approved organisation profile and the evidence you
                    select below are available when preparing this application.
                    You do not need to re-enter your organisation’s background.
                  </p>
                  <details>
                    <summary>
                      Organisation information already available
                    </summary>
                    <p>
                      <strong>{app.org.name}</strong>
                    </p>
                    <p>
                      {app.org.profile.mission ||
                        app.org.profile.description ||
                        app.org.description}
                    </p>
                    {app.org.profile.beneficiaries?.length ? (
                      <p>
                        People served:{" "}
                        {app.org.profile.beneficiaries.join(", ")}
                      </p>
                    ) : null}
                    {app.org.focus_areas.length ? (
                      <p>Focus areas: {app.org.focus_areas.join(", ")}</p>
                    ) : null}
                    <p className="small muted">
                      Approved history, programs, registration and insurance
                      details are also available where relevant to the
                      application questions.
                    </p>
                  </details>
                </>
              ) : (
                <Notice>
                  Review and approve your organisation profile in My
                  organisation before preparing a draft.
                </Notice>
              )}
              <button
                className="button secondary align-start"
                disabled={
                  busy ||
                  app.mode !== "live" ||
                  !["draft", "review"].includes(application.status)
                }
                onClick={() => prepareSources()}
              >
                {researching ? (
                  <Busy label="Reading official grant sources…" />
                ) : (
                  <>
                    <Sparkles size={17} />
                    {research
                      ? "Refresh source research"
                      : "Research this grant with AI"}
                  </>
                )}
              </button>
              {research && (
                <>
                  <p>{research.summary}</p>
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
                          {items.map((item, index) => (
                            <li key={index}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  {(research.guidelines_excerpt ||
                    research.application_questions) && (
                    <details>
                      <summary>
                        Source excerpts and application questions
                      </summary>
                      {research.guidelines_excerpt && (
                        <p style={{ whiteSpace: "pre-wrap" }}>
                          {research.guidelines_excerpt}
                        </p>
                      )}
                      {research.application_questions && (
                        <p style={{ whiteSpace: "pre-wrap" }}>
                          {research.application_questions}
                        </p>
                      )}
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={useResearch}
                      >
                        Add source details to empty fields
                      </button>
                    </details>
                  )}
                  {research.sources.map((source) => (
                    <ExternalLink key={source.uri} href={source.uri}>
                      {source.title}
                    </ExternalLink>
                  ))}
                </>
              )}
              {(research
                ? research.official_source_url
                : opportunity?.source_url) && (
                <ExternalLink
                  href={
                    research
                      ? research.official_source_url
                      : opportunity!.source_url
                  }
                >
                  {research
                    ? "Open the funder’s guidelines or application portal"
                    : "Open the saved grant source and check the official guidelines"}
                </ExternalLink>
              )}
              <p className="small muted">
                Download the complete current guidelines and application form
                from the funder. Upload them to My organisation using the
                Guidelines type, or paste the full text below. If a portal
                requires sign-in, open it yourself and copy the actual questions
                and word limits. Research excerpts may omit mandatory
                conditions.
              </p>
              {research && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={sourcesConfirmed}
                    disabled={busy}
                    onChange={(event) =>
                      setSourcesConfirmed(event.target.checked)
                    }
                  />{" "}
                  I checked the complete current official guidelines and
                  application questions, including the grant round, eligibility,
                  deadlines and required attachments.
                </label>
              )}
              <p className="small muted">
                Save changes to resume from these source notes later. Your
                existing answers and draft are preserved while research runs.
              </p>
            </section>
            <div className="requirements">
              <span
                className={
                  app.org?.verification_status === "approved" ? "done" : ""
                }
              >
                <Check size={16} />
                Organisation approved
              </span>
              <span className={guidelines.trim() ? "done" : ""}>
                <Check size={16} />
                Guidelines added
              </span>
              <span
                className={details.application_questions.trim() ? "done" : ""}
              >
                <Check size={16} />
                Questions added
              </span>
            </div>
            <label className="form-field">
              Current program guidelines
              <textarea
                rows={5}
                value={guidelines}
                onChange={(e) => {
                  setGuidelines(e.target.value);
                  if (research) setSourcesConfirmed(false);
                }}
                placeholder="Paste the funder’s current guidelines, eligibility rules and evidence requirements…"
              />
            </label>
            <label className="form-field">
              Application questions and word limits
              <textarea
                rows={4}
                value={details.application_questions}
                onChange={(e) => {
                  setDetails((d) => ({
                    ...d,
                    application_questions: e.target.value,
                  }));
                  if (research) setSourcesConfirmed(false);
                }}
                placeholder="Paste the actual questions from the application form…"
              />
            </label>
            <label className="form-field">
              Tell us about your project
              <textarea
                rows={4}
                value={details.summary}
                onChange={(e) =>
                  setDetails((d) => ({ ...d, summary: e.target.value }))
                }
                placeholder="What will you do, who will benefit, where, when and what will change?"
              />
            </label>
            <label className="form-field">
              Budget and co-funding notes
              <textarea
                rows={3}
                value={details.budget_notes}
                onChange={(e) =>
                  setDetails((d) => ({ ...d, budget_notes: e.target.value }))
                }
                placeholder="Project costs, GST treatment, requested amount and any other funding…"
              />
            </label>
            {app.data.documents.length > 0 && (
              <fieldset className="stack" disabled={busy}>
                <legend>Supporting documents for this draft</legend>
                <p className="small muted">
                  Choose the files the assistant should read, such as a project
                  budget spreadsheet. Saved spreadsheet values are not
                  recalculated or audited.
                </p>
                {app.data.documents.map((document) => (
                  <label className="checkbox-row" key={document.id}>
                    <input
                      type="checkbox"
                      checked={sourceDocuments.includes(document.id)}
                      onChange={(event) =>
                        setSourceDocuments((ids) =>
                          event.target.checked
                            ? [...ids, document.id]
                            : ids.filter((id) => id !== document.id),
                        )
                      }
                    />
                    Use {document.name} for this draft
                  </label>
                ))}
                <p className="small muted">
                  {sourceDocuments.length} of {MAX_AI_DOCUMENTS} documents ·{" "}
                  {(sourceBytes / (1024 * 1024)).toFixed(1)} of 15 MB
                </p>
                {sourcesTooLarge && (
                  <Notice>
                    Choose up to 8 documents totalling no more than 15 MB before
                    preparing the draft.
                  </Notice>
                )}
              </fieldset>
            )}
            {!ready && (
              <Notice>
                Before drafting, approve your organisation profile and add the
                current guidelines, actual application questions and project
                description. Any evidence required by the guidelines must also
                be available.
              </Notice>
            )}
            {evidenceBlockers.length > 0 && (
              <Notice>
                <strong>Before drafting, add the required evidence:</strong>
                <ul>
                  {evidenceBlockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
                <p>
                  Upload it to My organisation using the Insurance document
                  type. Save a current certificate and its expiry date.
                </p>
              </Notice>
            )}
            <button
              className="button primary align-start"
              disabled={busy || !ready}
              onClick={() => perform("draft")}
            >
              {busy ? (
                <Busy label="Checking evidence and preparing…" />
              ) : (
                <>
                  <Sparkles size={17} />
                  Prepare draft with AI
                </>
              )}
            </button>
            <hr />
            <label className="form-field">
              Your application draft
              <textarea
                rows={14}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Your AI-assisted draft will appear here. You can also write your own application."
              />
            </label>
            {draft && (
              <button
                className="button secondary align-start"
                onClick={download}
              >
                <Download size={16} />
                Download draft
              </button>
            )}
            <div className="form-grid">
              <label className="form-field">
                Application status
                <select
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
                  value={reference}
                  onChange={(e) => {
                    setReference(e.target.value);
                    if (e.target.value.trim()) setReferenceUnavailable(false);
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
                          setAward((a) => ({ ...a, amount: e.target.value }))
                        }
                      />
                    </label>
                    <label className="form-field">
                      First report due
                      <input
                        type="date"
                        value={award.reportDue}
                        onChange={(e) =>
                          setAward((a) => ({ ...a, reportDue: e.target.value }))
                        }
                      />
                    </label>
                    <label className="form-field">
                      Project starts
                      <input
                        type="date"
                        value={award.startDate}
                        onChange={(e) =>
                          setAward((a) => ({ ...a, startDate: e.target.value }))
                        }
                      />
                    </label>
                    <label className="form-field">
                      Project ends
                      <input
                        type="date"
                        value={award.endDate}
                        onChange={(e) =>
                          setAward((a) => ({ ...a, endDate: e.target.value }))
                        }
                      />
                    </label>
                  </div>
                  <label className="form-field">
                    First milestone
                    <input
                      value={award.milestone}
                      onChange={(e) =>
                        setAward((a) => ({ ...a, milestone: e.target.value }))
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
                  You can track an application completed outside Simple Grant.
                  Only mark it submitted after completing the funder’s own
                  process. Save the confirmation or receipt in your document
                  library.
                </Notice>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={submittedConfirmed}
                    onChange={(e) => setSubmittedConfirmed(e.target.checked)}
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
            {opportunity?.source_url && (
              <ExternalLink href={opportunity.source_url}>
                Open the funder’s website to submit
              </ExternalLink>
            )}
            {error && (
              <p className="error-box" role="alert">
                {error}
              </p>
            )}
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setSelected("")}
              >
                Close
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => perform("save")}
              >
                {busy ? <Busy label="Saving…" /> : "Save changes"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
