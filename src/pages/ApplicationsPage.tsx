import { useState } from "react";
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
    [award, setAward] = useState({
      amount: "",
      startDate: new Date().toISOString().slice(0, 10),
      endDate: "",
      reportDue: "",
      milestone: "First progress report",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
    setDraft(formatDraft(a.draft));
    setStatus(a.status);
    setReference(a.grant_reference ?? "");
    setError("");
  }
  async function save() {
    if (!application) return;
    await app.updateApplication(application.id, {
      project_details: details,
      status,
      grant_reference: reference || null,
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
      await save();
      if (action === "draft" && application) {
        const result = await app.runAI({
          action: "draft",
          applicationId: application.id,
          opportunityId: application.opportunity_id,
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
  const ready = Boolean(
    app.org?.verification_status === "approved" &&
    guidelines.trim() &&
    details.summary.trim() &&
    details.application_questions.trim(),
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
                onChange={(e) => setGuidelines(e.target.value)}
                placeholder="Paste the funder’s current guidelines, eligibility rules and evidence requirements…"
              />
            </label>
            <label className="form-field">
              Application questions and word limits
              <textarea
                rows={4}
                value={details.application_questions}
                onChange={(e) =>
                  setDetails((d) => ({
                    ...d,
                    application_questions: e.target.value,
                  }))
                }
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
            {!ready && (
              <Notice>
                Before drafting, approve your organisation profile and add the
                current guidelines, actual application questions and project
                description. Any evidence required by the guidelines must also
                be available.
              </Notice>
            )}
            <button
              className="button primary align-start"
              disabled={busy || !ready}
              onClick={() => perform("draft")}
            >
              {busy ? (
                <Busy label="Preparing…" />
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
                  onChange={(e) =>
                    setStatus(e.target.value as Application["status"])
                  }
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
                  onChange={(e) => setReference(e.target.value)}
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
              <Notice>
                Only select Submitted after you have completed the funder’s own
                submission process. Save its confirmation or receipt in your
                document vault.
              </Notice>
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
