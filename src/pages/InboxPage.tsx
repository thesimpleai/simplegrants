import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  Inbox,
  Mail,
  MessageCircle,
  Paperclip,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useApp } from "../lib/app-context";
import {
  Badge,
  Busy,
  date,
  EmptyState,
  errorMessage,
  Modal,
  Notice,
} from "../components/ui";
import type { InboxMessage } from "../types";

export default function InboxPage() {
  const app = useApp();
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<InboxMessage | null>(null);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [ask, setAsk] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const domain =
    import.meta.env.VITE_INBOUND_EMAIL_DOMAIN || "mail.thesimpleai.com";
  const inboxAddress = app.org ? `${app.org.inbox_alias}@${domain}` : "";
  const pending = app.data.messages.filter(
    (message) => !["reviewed", "archived"].includes(message.status),
  );
  const messages = app.data.messages.filter(
    (message) =>
      (tab !== "review" ||
        !["reviewed", "archived"].includes(message.status)) &&
      `${message.subject} ${message.sender} ${message.body}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  useEffect(() => {
    setSelected(null);
    setError("");
    setCopied(false);
    setAsk(false);
  }, [app.org?.id]);
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(inboxAddress);
      setCopied(true);
      app.notify("Your organisation’s inbox address copied.");
    } catch {
      setError(
        "Could not copy the address. Please select and copy it manually.",
      );
    }
  }
  function openMessage(message: InboxMessage) {
    setSelected(message);
    setProjectId(message.project_id ?? "");
    setError("");
  }
  async function reviewMessage() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await app.updateMessage(selected.id, {
        status: "reviewed",
        project_id: projectId || null,
      });
      setSelected(null);
      app.notify("Message reviewed and saved.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function askAssistant() {
    if (!question.trim()) return;
    setBusy(true);
    setError("");
    setAnswer("");
    try {
      const result = await app.runAI({
        action: "ask",
        message: question.trim(),
      });
      setAnswer(
        result.answer ||
          result.message ||
          "No answer was returned. Please try asking in another way.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR INBOX</p>
          <h1 className="page-title">A simple email goes a long way.</h1>
          <p className="page-subtitle">
            Forward updates and invoices. Keep the story of your work together.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            setError("");
            setAnswer("");
            setAsk(true);
          }}
        >
          <Sparkles size={18} />
          Ask your assistant
        </button>
      </div>
      {error && !selected && !ask && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!app.org ? (
        <EmptyState
          icon={<Inbox size={38} />}
          title="An inbox for each organisation"
          description="Add your organisation first to get its own email address and keep its updates together."
        />
      ) : (
        <>
          <section className="card inbox-address-card">
            <span className="icon-tile">
              <Mail size={25} />
            </span>
            <div className="inbox-address-content">
              <p className="eyebrow">YOUR ORGANISATION’S EMAIL ADDRESS</p>
              <strong className="inbox-address">{inboxAddress}</strong>
              <p className="muted">
                Forward messages from your signed-in email address. Add the
                project name to help you find them later.
              </p>
            </div>
            <button className="button secondary" onClick={copyAddress}>
              {copied ? <Check size={17} /> : <Copy size={17} />}{" "}
              {copied ? "Copied" : "Copy address"}
            </button>
          </section>
          <div className="inbox-explainer grid-2">
            <div className="inline-heading">
              <span className="icon-tile">
                <ArrowDownToLine size={21} />
              </span>
              <div>
                <h3>Forward it. Find it here.</h3>
                <p className="muted small">
                  Invoices, grant updates and evidence arrive ready for your
                  review.
                </p>
              </div>
            </div>
            <div className="inline-heading">
              <span className="icon-tile">
                <ShieldCheck size={21} />
              </span>
              <div>
                <h3>Your private details stay private.</h3>
                <p className="muted small">
                  Sensitive questions belong in the signed-in portal. Don’t
                  email bank details.
                </p>
              </div>
            </div>
          </div>
          <section className="card inbox-messages">
            <div className="card-heading">
              <div className="inline-heading">
                <h2>Messages</h2>
                {pending.length > 0 && (
                  <Badge tone="yellow">{pending.length} to review</Badge>
                )}
              </div>
              <div className="search-input">
                <Search size={17} />
                <input
                  aria-label="Search messages"
                  placeholder="Search messages"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="tabs" role="tablist" aria-label="Message filters">
              <button
                role="tab"
                aria-selected={tab === "all"}
                className={tab === "all" ? "active" : ""}
                onClick={() => setTab("all")}
              >
                All messages <span>{app.data.messages.length}</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === "review"}
                className={tab === "review" ? "active" : ""}
                onClick={() => setTab("review")}
              >
                Needs review <span>{pending.length}</span>
              </button>
            </div>
            {!messages.length ? (
              <EmptyState
                icon={<Inbox size={34} />}
                title={
                  search
                    ? "No messages match your search"
                    : tab === "review"
                      ? "You’re all caught up"
                      : "Your inbox is ready"
                }
                description={
                  search
                    ? "Try another name, word or email address."
                    : tab === "review"
                      ? "New messages will appear here when they need your attention."
                      : "Forward an update or invoice to your organisation’s email address. It will appear here once your email service is connected."
                }
              />
            ) : (
              <div className="message-list">
                {messages.map((message) => (
                  <button
                    className={`message-row ${message.status !== "reviewed" ? "unread" : ""}`}
                    key={message.id}
                    onClick={() => openMessage(message)}
                  >
                    <span className="message-avatar">
                      {message.classification === "invoice" ? (
                        <FileText size={21} />
                      ) : (
                        <Mail size={21} />
                      )}
                    </span>
                    <span className="message-summary">
                      <strong>{message.subject || "(No subject)"}</strong>
                      <span className="small muted">{message.sender}</span>
                      <span className="message-preview muted">
                        {message.body.slice(0, 140) ||
                          "Open to view this message."}
                      </span>
                    </span>
                    <span className="message-meta">
                      <span className="small muted">
                        {date(message.received_at)}
                      </span>
                      <Badge
                        tone={
                          message.status === "reviewed" ? "green" : "yellow"
                        }
                      >
                        {message.status === "reviewed"
                          ? "Reviewed"
                          : "Needs review"}
                      </Badge>
                      {message.attachments?.length > 0 && (
                        <span className="small muted">
                          <Paperclip size={13} /> {message.attachments.length}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <Notice>
            Messages and attachments are unverified evidence until you review
            them. Receiving an invoice does not automatically add an expense or
            change a grant’s budget. Only authorised senders are accepted.
          </Notice>
        </>
      )}
      {selected && (
        <Modal
          title={selected.subject || "Email message"}
          onClose={() => !busy && setSelected(null)}
          wide
        >
          <div className="stack">
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="row-between">
              <div>
                <p className="muted small">From {selected.sender}</p>
                <p className="muted small">
                  Received {date(selected.received_at)}
                </p>
              </div>
              <Badge tone={selected.status === "reviewed" ? "green" : "yellow"}>
                {selected.status === "reviewed"
                  ? "Reviewed"
                  : "Unverified message"}
              </Badge>
            </div>
            <div className="email-body">
              {selected.body || "No plain-text message was provided."}
            </div>
            {!!selected.attachments?.length && (
              <section>
                <h3>
                  <Paperclip size={17} />
                  Attachments
                </h3>
                <p className="muted small">
                  Attachment details are recorded here. Save original files from
                  your email and upload them to your document library before
                  using them as evidence.
                </p>
                {selected.attachments.map((attachment, index) => (
                  <div className="document-row" key={index}>
                    <FileText size={20} />
                    <div className="document-details">
                      <strong>
                        {String(
                          attachment.filename ??
                            attachment.name ??
                            `Attachment ${index + 1}`,
                        )}
                      </strong>
                      <span className="small muted">
                        {String(
                          attachment.content_type ??
                            attachment.mime_type ??
                            "Attachment",
                        )}
                      </span>
                    </div>
                    <Badge tone="neutral">Needs review</Badge>
                  </div>
                ))}
              </section>
            )}
            <label className="form-field">
              Link to a funded project
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">
                  Organisation record — no project selected
                </option>
                {app.data.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>
            <Notice>
              Review the original evidence before using these details in an
              expense, application or final report.
            </Notice>
            <div className="modal-footer">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                Close
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={reviewMessage}
              >
                {busy ? (
                  <Busy label="Saving…" />
                ) : (
                  <>
                    <CheckCircle2 size={18} />
                    {selected.status === "reviewed"
                      ? "Save project link"
                      : "Mark as reviewed"}
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {ask && (
        <Modal
          title="Ask your assistant"
          onClose={() => !busy && setAsk(false)}
        >
          <div className="stack">
            <div className="inline-heading">
              <span className="icon-tile">
                <MessageCircle size={24} />
              </span>
              <p className="muted">
                Ask about your organisation, your saved grants or what to do
                next.
              </p>
            </div>
            <label className="form-field">
              Your question
              <textarea
                rows={4}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What information is missing from our organisation profile?"
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {answer && (
              <div className="assistant-answer">
                <p className="eyebrow">YOUR ASSISTANT</p>
                <div className="email-body">{answer}</div>
                <p className="small muted">
                  AI can make mistakes. Check the original grant guidelines
                  before making a decision.
                </p>
              </div>
            )}
            <div className="modal-footer">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setAsk(false)}
              >
                Close
              </button>
              <button
                className="button primary"
                disabled={busy || !question.trim()}
                onClick={askAssistant}
              >
                {busy ? (
                  <Busy label="Looking into it…" />
                ) : (
                  <>
                    <Sparkles size={18} />
                    Ask a question
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
