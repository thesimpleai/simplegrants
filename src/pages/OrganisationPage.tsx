import { useEffect, useRef, useState } from "react";
import {
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  FolderOpen,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  ArrowUpRight,
  Download,
  Mail,
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
import type {
  AIResult,
  Frequency,
  Organisation,
  Profile,
  ProfileStage,
} from "../types";
import {
  DOCUMENT_ACCEPT,
  SUPPORTED_DOCUMENT_LABEL,
  MAX_AI_DOCUMENTS,
  MAX_AI_DOCUMENT_BYTES,
  resolveDocumentFormat,
} from "../lib/document-formats";
const profileProgress: Record<ProfileStage, string> = {
  extract: "Step 1 of 3: Reading your documents…",
  verify: "Step 2 of 3: Checking details against the originals…",
  correct: "Step 3 of 3: Preparing the corrected draft…",
};

const categories = [
  ["registration", "Registration documents"],
  ["acnc", "ACNC documents"],
  ["financial_statement", "Financial statements"],
  ["audit_report", "Audited financial statements"],
  ["insurance", "Insurance"],
  ["guidelines", "Grant guidelines"],
  ["other", "Other documents"],
];
const states = [
  "ACT",
  "NSW",
  "NT",
  "QLD",
  "SA",
  "TAS",
  "VIC",
  "WA",
  "Australia-wide",
];
const previewable = (document: { name: string; mime_type: string }) => {
  const format = resolveDocumentFormat({
    name: document.name,
    type: document.mime_type,
  });
  return format?.kind === "pdf" || format?.kind === "image";
};
const categoryLabel = (value: string) =>
  categories.find(([key]) => key === value)?.[1] ?? value;
const evidenceText = (value: unknown): string =>
  typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? Object.entries(value)
          .map(
            ([key, item]) =>
              `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`,
          )
          .join(" · ")
      : String(value);

export default function OrganisationPage() {
  const app = useApp();
  const org = app.org;
  const [wizard, setWizard] = useState(false);
  const [step, setStep] = useState<"sources" | "review">("sources");
  const [history, setHistory] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<AIResult | null>(null);
  const [profile, setProfile] = useState<Profile>({ name: "" });
  const [focusText, setFocusText] = useState("");
  const [checksConfirmed, setChecksConfirmed] = useState(false);
  const [approveConfirmed, setApproveConfirmed] = useState(false);
  const [busy, setBusy] = useState("");
  const [profileStage, setProfileStage] = useState<ProfileStage | null>(null);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("registration");
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [create, setCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFrequency, setNewFrequency] = useState<Frequency>("weekly");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const wizardInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFrequency(org?.notification_frequency ?? "weekly");
    setWizard(false);
    setError("");
  }, [org?.id]);
  const publicDocuments = app.data.documents.filter((document) =>
    ["registration", "acnc", "other"].includes(document.category),
  );
  const selectedBytes = publicDocuments
    .filter((document) => selected.includes(document.id))
    .reduce((total, document) => total + document.size_bytes, 0);
  const selectionTooLarge =
    selected.length > MAX_AI_DOCUMENTS || selectedBytes > MAX_AI_DOCUMENT_BYTES;
  const requiredFacts = [
    org?.name,
    org?.abn,
    org?.description,
    org?.state,
    org?.focus_areas?.length,
  ];
  const completeness = Math.round(
    (requiredFacts.filter(Boolean).length / requiredFacts.length) * 100,
  );

  function openWizard() {
    setWizard(true);
    setStep("sources");
    setHistory("");
    setError("");
    setResult(null);
    let selectedSize = 0;
    let selectedCount = 0;
    setSelected(
      publicDocuments
        .filter((document) => {
          if (
            selectedCount >= MAX_AI_DOCUMENTS ||
            selectedSize + document.size_bytes > MAX_AI_DOCUMENT_BYTES
          )
            return false;
          selectedSize += document.size_bytes;
          selectedCount++;
          return true;
        })
        .map((document) => document.id),
    );
    setProfileStage(null);
    setProfile(org?.profile ?? { name: org?.name ?? "" });
    setFocusText((org?.focus_areas ?? []).join(", "));
    setChecksConfirmed(false);
    setApproveConfirmed(false);
  }
  async function upload(files: File[], selectedCategory = category) {
    if (!files.length) return;
    setBusy("upload");
    setError("");
    try {
      await app.uploadDocuments(files, selectedCategory);
      app.notify(
        `${files.length === 1 ? "Document" : "Documents"} added to your organisation.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
      if (fileInput.current) fileInput.current.value = "";
      if (wizardInput.current) wizardInput.current.value = "";
    }
  }
  async function prepareProfile() {
    if (!history.trim() && selected.length === 0) {
      setError(
        "Add some organisation history or choose a document to get started.",
      );
      return;
    }
    if (selectionTooLarge) {
      setError(
        "Choose up to 8 documents totalling no more than 15 MB. Your other documents remain in the library.",
      );
      return;
    }
    setBusy("profile");
    setProfileStage("extract");
    setError("");
    try {
      const draft = await app.runAI(
        {
          action: "profile",
          text: history,
          documentIds: selected,
        },
        (stage) => setProfileStage(stage),
      );
      if (!draft.profile)
        throw new Error("A profile draft was not returned. Please try again.");
      setResult(draft);
      setProfile(draft.profile);
      setFocusText((draft.profile.focus_areas ?? []).join(", "));
      setChecksConfirmed(false);
      setApproveConfirmed(false);
      setStep("review");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
      setProfileStage(null);
    }
  }
  async function approveProfile() {
    if (!profile.name.trim() || !String(profile.description ?? "").trim()) {
      setError(
        "Add the organisation name and a short description before approving.",
      );
      return;
    }
    if (
      !approveConfirmed ||
      ((result?.checks?.length ?? 0) > 0 && !checksConfirmed)
    ) {
      setError(
        "Please review and confirm the organisation details and any differences first.",
      );
      return;
    }
    setBusy("approve");
    setError("");
    try {
      const reviewedProfile = {
        ...profile,
        focus_areas: focusText
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      };
      const patch: Partial<Organisation> = {
        profile: reviewedProfile,
        name: profile.name.trim(),
        abn: profile.abn || null,
        description: String(profile.description ?? ""),
        type: String(profile.type ?? org?.type ?? "Not-for-profit"),
        state: String(profile.state ?? ""),
        focus_areas: reviewedProfile.focus_areas,
        website: typeof profile.website === "string" ? profile.website : null,
        verification_status: "approved",
      };
      await app.updateOrg(patch);
      setWizard(false);
      app.notify("Organisation details approved and saved.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  async function saveFrequency() {
    setBusy("frequency");
    setError("");
    try {
      await app.updateOrg({ notification_frequency: frequency });
      app.notify("Grant email preference saved.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  async function createOrganisation() {
    if (!newName.trim()) {
      setError("Please enter your organisation name.");
      return;
    }
    setBusy("create");
    setError("");
    try {
      await app.createOrg(newName.trim(), newFrequency);
      setCreate(false);
      setNewName("");
      app.notify("Your organisation is ready to set up.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  async function removeDocument() {
    if (!removeId) return;
    setBusy("remove");
    setError("");
    try {
      await app.removeDocument(removeId);
      setSelected((ids) => ids.filter((id) => id !== removeId));
      setRemoveId(null);
      app.notify("Document removed.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  async function openDocument(id: string) {
    try {
      await app.openDocument(id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR ORGANISATION</p>
          <h1 className="page-title">A home for your organisation.</h1>
          <p className="page-subtitle">
            Keep your story and important documents together. Use them for every
            application.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            setError("");
            setCreate(true);
          }}
        >
          <Plus size={18} />
          Add organisation
        </button>
      </div>
      {error && !wizard && !create && !removeId && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!org ? (
        <EmptyState
          icon={<Building2 size={38} />}
          title="Let's start with your organisation"
          description="One login can look after several organisations. Add your first one here."
          action={
            <button className="button primary" onClick={() => setCreate(true)}>
              Add your organisation
              <Plus size={18} />
            </button>
          }
        />
      ) : (
        <>
          <div className="grid-2 organisation-layout">
            <section className="card organisation-profile">
              <div className="card-heading">
                <div className="inline-heading">
                  <span className="icon-tile">
                    <Building2 size={22} />
                  </span>
                  <h2>Organisation profile</h2>
                </div>
                <Badge
                  tone={
                    org.verification_status === "approved" ? "green" : "yellow"
                  }
                >
                  {org.verification_status === "approved"
                    ? "Approved by you"
                    : "Needs your review"}
                </Badge>
              </div>
              <h3 className="organisation-name">{org.name}</h3>
              <p className="muted">
                {org.description ||
                  "Add your organisation’s story. We can help turn your documents into a profile."}
              </p>
              <dl className="profile-facts">
                <div>
                  <dt>Australian Business Number</dt>
                  <dd>{org.abn || "Not provided"}</dd>
                </div>
                <div>
                  <dt>Organisation type</dt>
                  <dd>{org.type || "Not provided"}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>{org.state || "Not provided"}</dd>
                </div>
                <div>
                  <dt>Website</dt>
                  <dd>{org.website || "Not provided"}</dd>
                </div>
              </dl>
              <div className="profile-focus">
                <span className="muted">Areas of focus</span>
                <div className="tag-list">
                  {org.focus_areas.length ? (
                    org.focus_areas.map((area) => (
                      <Badge tone="neutral" key={area}>
                        {area}
                      </Badge>
                    ))
                  ) : (
                    <span className="muted">Not added yet</span>
                  )}
                </div>
              </div>
              <div className="profile-completeness">
                <div className="row-between">
                  <span>Core profile information</span>
                  <strong>{completeness}%</strong>
                </div>
                <progress
                  value={completeness}
                  max={100}
                  aria-label="Core profile information completeness"
                />
              </div>
              <div className="section-actions">
                <button className="button primary" onClick={openWizard}>
                  <Sparkles size={18} />
                  Update with AI
                </button>
                <button
                  className="button secondary"
                  onClick={() => {
                    setProfile({
                      ...org.profile,
                      name: org.name,
                      abn: org.abn ?? "",
                      description: org.description,
                      type: org.type,
                      state: org.state,
                      focus_areas: org.focus_areas,
                      website: org.website ?? "",
                    });
                    setFocusText(org.focus_areas.join(", "));
                    setResult(null);
                    setStep("review");
                    setApproveConfirmed(false);
                    setChecksConfirmed(false);
                    setError("");
                    setWizard(true);
                  }}
                >
                  Edit details
                </button>
              </div>
            </section>
            <div className="stack">
              <section className="card card-soft">
                <span className="icon-tile">
                  <Sparkles size={23} />
                </span>
                <h2>Tell your story once.</h2>
                <p>
                  Upload your registration documents and paste in your
                  organisation’s history. Your assistant will prepare the
                  details for you.
                </p>
                <ol className="simple-steps">
                  <li>
                    <span>1</span>Read your source documents
                  </li>
                  <li>
                    <span>2</span>Check facts against the originals
                  </li>
                  <li>
                    <span>3</span>Correct differences for your review
                  </li>
                </ol>
                <p className="small muted">
                  You always have the final say. Nothing is approved
                  automatically.
                </p>
              </section>
              <section className="card">
                <div className="card-heading">
                  <div className="inline-heading">
                    <Mail size={21} />
                    <h2>New grants, at your pace</h2>
                  </div>
                </div>
                <p className="muted">
                  Choose how often we look for opportunities and email a
                  summary.
                </p>
                <label className="form-field">
                  Email me about new grants
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as Frequency)}
                  >
                    <option value="weekly">Once a week</option>
                    <option value="monthly">Once a month</option>
                    <option value="never">Never</option>
                  </select>
                </label>
                <button
                  className="button secondary"
                  disabled={
                    busy === "frequency" ||
                    frequency === org.notification_frequency
                  }
                  onClick={saveFrequency}
                >
                  {busy === "frequency" ? (
                    <Busy label="Saving…" />
                  ) : (
                    "Save preference"
                  )}
                </button>
                <p className="small muted">
                  Links in each email take you straight to the grant after you
                  sign in.
                </p>
              </section>
            </div>
          </div>
          <section className="card document-vault">
            <div className="card-heading">
              <div>
                <div className="inline-heading">
                  <FolderOpen size={22} />
                  <h2>Your document library</h2>
                  <Badge tone="neutral">{app.data.documents.length}</Badge>
                </div>
                <p className="muted">
                  Private documents, ready when an application needs them.
                </p>
              </div>
            </div>
            <div className="document-upload-controls">
              <label className="form-field">
                Document type
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {categories.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button secondary"
                disabled={busy === "upload"}
                onClick={() => fileInput.current?.click()}
              >
                {busy === "upload" ? (
                  <Busy label="Uploading…" />
                ) : (
                  <>
                    <Upload size={18} />
                    Upload documents
                  </>
                )}
              </button>
              <input
                ref={fileInput}
                hidden
                type="file"
                accept={DOCUMENT_ACCEPT}
                multiple
                onChange={(e) => upload(Array.from(e.target.files ?? []))}
              />
            </div>
            <div
              className="upload-dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!busy) void upload(Array.from(e.dataTransfer.files));
              }}
            >
              <Upload size={25} />
              <p>Drop documents here, or use the upload button</p>
              <span className="small muted">
                {SUPPORTED_DOCUMENT_LABEL} · up to 10 MB each
              </span>
            </div>
            {!app.data.documents.length ? (
              <EmptyState
                icon={<FileText size={30} />}
                title="Your documents will live here"
                description="Start with your registration or ACNC documents. You can add financial statements and insurance when needed."
              />
            ) : (
              <div className="document-list">
                {app.data.documents.map((document) => (
                  <div className="document-row" key={document.id}>
                    <span className="document-icon">
                      <FileText size={22} />
                    </span>
                    <div className="document-details">
                      <strong>{document.name}</strong>
                      <span className="muted small">
                        {categoryLabel(document.category)} ·{" "}
                        {document.size_bytes < 1024 * 1024
                          ? `${Math.round(document.size_bytes / 1024)} KB`
                          : `${(document.size_bytes / (1024 * 1024)).toFixed(1)} MB`}
                        {document.expires_on &&
                          ` · Expires ${date(document.expires_on)}`}
                      </span>
                    </div>
                    <Badge tone={document.verified ? "green" : "neutral"}>
                      {document.verified ? "Reviewed" : "Uploaded"}
                    </Badge>
                    <button
                      className="icon-button"
                      aria-label={`${previewable(document) ? "Open" : "Download"} ${document.name}`}
                      onClick={() => openDocument(document.id)}
                    >
                      {previewable(document) ? (
                        <ArrowUpRight size={20} />
                      ) : (
                        <Download size={20} />
                      )}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${document.name}`}
                      onClick={() => {
                        setError("");
                        setRemoveId(document.id);
                      }}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Notice>
              Requirements vary by grant. We’ll help you identify the financial
              statements, audit reports or insurance that a specific application
              asks for. Please don’t upload bank account details.
            </Notice>
          </section>
        </>
      )}
      {wizard && (
        <Modal
          title={
            step === "sources"
              ? "Let’s get to know your organisation"
              : "Review your organisation details"
          }
          onClose={() => !busy && setWizard(false)}
          wide
        >
          <div className="wizard-progress">
            <span className={step === "sources" ? "active" : "complete"}>
              {step === "review" ? <Check size={16} /> : "1"} Add your
              information
            </span>
            <ChevronRight size={16} />
            <span className={step === "review" ? "active" : ""}>
              2 Review and approve
            </span>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {step === "sources" ? (
            <div className="stack">
              <p className="muted">
                Start with what you already have. Your assistant will extract
                details, check them against the sources, then prepare a
                corrected draft for you.
              </p>
              <label className="form-field">
                Paste your organisation’s history or information
                <textarea
                  rows={6}
                  disabled={!!busy}
                  value={history}
                  onChange={(e) => setHistory(e.target.value)}
                  placeholder="What does your organisation do? Who do you support? You can paste information from your website, annual report or past applications."
                />
              </label>
              <div>
                <h3>Choose source documents</h3>
                <p className="small muted">
                  Use registration documents and public background information.
                  Financial statements stay in your document library.
                </p>
                <p className="small muted">
                  Choose up to 8 documents, totalling no more than 15 MB.
                  Uncheck a document to make room for another.
                </p>
                <p className="small">
                  <strong>
                    {selected.length} of {publicDocuments.length} selected
                  </strong>{" "}
                  · {(selectedBytes / (1024 * 1024)).toFixed(1)} MB of 15 MB
                </p>
                {publicDocuments.length ? (
                  <div className="source-document-list">
                    {publicDocuments.map((document) => (
                      <label className="checkbox-row" key={document.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(document.id)}
                          disabled={
                            !!busy ||
                            (!selected.includes(document.id) &&
                              (selected.length >= MAX_AI_DOCUMENTS ||
                                selectedBytes + document.size_bytes >
                                  MAX_AI_DOCUMENT_BYTES))
                          }
                          onChange={(e) =>
                            setSelected((ids) =>
                              e.target.checked
                                ? [...ids, document.id]
                                : ids.filter((id) => id !== document.id),
                            )
                          }
                        />
                        <FileText size={18} />
                        <span>{document.name}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="muted">
                    No background documents added yet. You can still start with
                    the information above.
                  </p>
                )}
                <input
                  hidden
                  type="file"
                  ref={wizardInput}
                  accept={DOCUMENT_ACCEPT}
                  multiple
                  onChange={(e) =>
                    upload(Array.from(e.target.files ?? []), "registration")
                  }
                />
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => wizardInput.current?.click()}
                >
                  <Upload size={18} />
                  Add registration documents
                </button>
                <p className="small muted">
                  Select newly uploaded documents above to include them.{" "}
                  {SUPPORTED_DOCUMENT_LABEL} · up to 10 MB per file.
                </p>
              </div>
              <Notice>
                Only the background documents you select above and the
                information you paste here are sent to Gemini for this profile
                step. Share only information you are authorised to provide.
                Before uploading a document for AI, redact bank account details,
                personal identifiers and confidential financial information.
                Financial statements and audit reports are kept in your document
                library and are not selected for this profile step.
              </Notice>
              {busy === "profile" && profileStage && (
                <div role="status" aria-live="polite">
                  <Notice>
                    <strong>{profileProgress[profileStage]}</strong>
                    <p className="small">
                      Keep this page open. Your saved documents will stay in the
                      library if you need to try again.
                    </p>
                  </Notice>
                </div>
              )}
              <div className="modal-footer">
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => setWizard(false)}
                >
                  Cancel
                </button>
                <button
                  className="button primary"
                  disabled={!!busy || selectionTooLarge}
                  onClick={prepareProfile}
                >
                  {busy === "profile" ? (
                    <Busy label="Preparing your profile…" />
                  ) : busy === "upload" ? (
                    <Busy label="Uploading…" />
                  ) : (
                    <>
                      <Sparkles size={18} />
                      Prepare my profile
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="stack">
              {result && (
                <div className="pipeline-complete">
                  <CheckCircle2 size={20} />
                  <div>
                    <strong>Draft prepared for your review</strong>
                    <p className="small muted">
                      Your sources were read, checked and used to prepare these
                      details. AI can still make mistakes.
                    </p>
                  </div>
                </div>
              )}
              {!!result?.checks?.length && (
                <section className="review-differences">
                  <h3>These details need your attention</h3>
                  {result.checks.map((check, index) => (
                    <div
                      className="review-check"
                      key={`${check.field}-${index}`}
                    >
                      <strong>{check.field.replaceAll("_", " ")}</strong>
                      <p>{check.issue}</p>
                      {check.source && (
                        <p className="small muted">Source: {check.source}</p>
                      )}
                      {check.suggestion && (
                        <p className="small">
                          Suggested correction: {check.suggestion}
                        </p>
                      )}
                    </div>
                  ))}
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={checksConfirmed}
                      onChange={(e) => setChecksConfirmed(e.target.checked)}
                    />
                    <span>
                      I checked these differences against the originals and
                      corrected the details below.
                    </span>
                  </label>
                </section>
              )}
              <div className="form-grid">
                <label className="form-field">
                  Organisation name
                  <input
                    value={profile.name}
                    required
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  ABN <span className="muted small">(if registered)</span>
                  <input
                    value={profile.abn ?? ""}
                    inputMode="numeric"
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, abn: e.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  Organisation type
                  <select
                    value={profile.type ?? ""}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, type: e.target.value }))
                    }
                  >
                    <option value="">Choose a type</option>
                    {[
                      "Charity",
                      "Not-for-profit",
                      "Community organisation",
                      "Incorporated association",
                      "Company limited by guarantee",
                      "Social enterprise",
                      "Other",
                    ].map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                    {profile.type &&
                      ![
                        "Charity",
                        "Not-for-profit",
                        "Community organisation",
                        "Incorporated association",
                        "Company limited by guarantee",
                        "Social enterprise",
                        "Other",
                      ].includes(profile.type) && (
                        <option>{profile.type}</option>
                      )}
                  </select>
                </label>
                <label className="form-field">
                  State or territory
                  <select
                    value={profile.state ?? ""}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, state: e.target.value }))
                    }
                  >
                    <option value="">Choose a location</option>
                    {states.map((state) => (
                      <option key={state}>{state}</option>
                    ))}
                    {profile.state && !states.includes(profile.state) && (
                      <option>{profile.state}</option>
                    )}
                  </select>
                </label>
              </div>
              <label className="form-field">
                What your organisation does
                <textarea
                  rows={4}
                  value={String(profile.description ?? "")}
                  required
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, description: e.target.value }))
                  }
                />
              </label>
              <label className="form-field">
                Areas of focus{" "}
                <span className="muted small">(separate with commas)</span>
                <input
                  value={focusText}
                  onChange={(e) => setFocusText(e.target.value)}
                  placeholder="Community connection, education, wellbeing"
                />
              </label>
              <label className="form-field">
                Website
                <input
                  type="url"
                  value={String(profile.website ?? "")}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, website: e.target.value }))
                  }
                  placeholder="https://"
                />
              </label>
              {!!result?.evidence?.length && (
                <details>
                  <summary>View source references</summary>
                  <ul className="evidence-list">
                    {result.evidence.map((source, index) => (
                      <li key={index}>{evidenceText(source)}</li>
                    ))}
                  </ul>
                </details>
              )}
              <label className="checkbox-row approval-confirmation">
                <input
                  type="checkbox"
                  checked={approveConfirmed}
                  onChange={(e) => setApproveConfirmed(e.target.checked)}
                />
                <span>
                  I have checked these details and approve them for use in grant
                  applications.
                </span>
              </label>
              <div className="modal-footer">
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() =>
                    result ? setStep("sources") : setWizard(false)
                  }
                >
                  {result ? "Back to sources" : "Cancel"}
                </button>
                <button
                  className="button primary"
                  disabled={
                    !!busy ||
                    !approveConfirmed ||
                    (!!result?.checks?.length && !checksConfirmed)
                  }
                  onClick={approveProfile}
                >
                  {busy === "approve" ? (
                    <Busy label="Saving…" />
                  ) : (
                    <>
                      <ShieldCheck size={18} />
                      Approve and save
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
      {create && (
        <Modal
          title="Add another organisation"
          onClose={() => !busy && setCreate(false)}
        >
          <div className="stack">
            <p className="muted">
              Keep each organisation’s documents and grants separate, with the
              same login.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <label className="form-field">
              Organisation name
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Your organisation’s name"
              />
            </label>
            <label className="form-field">
              How often would you like new grant emails?
              <select
                value={newFrequency}
                onChange={(e) => setNewFrequency(e.target.value as Frequency)}
              >
                <option value="weekly">Once a week</option>
                <option value="monthly">Once a month</option>
                <option value="never">Never</option>
              </select>
            </label>
            <div className="modal-footer">
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => setCreate(false)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={!!busy || !newName.trim()}
                onClick={createOrganisation}
              >
                {busy === "create" ? (
                  <Busy label="Creating…" />
                ) : (
                  "Create organisation"
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {removeId && (
        <Modal
          title="Remove this document?"
          onClose={() => !busy && setRemoveId(null)}
        >
          <div className="stack">
            <p>
              This removes the document from this organisation’s library. Keep a
              copy if you need it for your records.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-footer">
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => setRemoveId(null)}
              >
                Keep document
              </button>
              <button
                className="button primary"
                disabled={!!busy}
                onClick={removeDocument}
              >
                {busy === "remove" ? (
                  <Busy label="Removing…" />
                ) : (
                  "Remove document"
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
