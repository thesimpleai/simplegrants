import { useCallback, useEffect, useRef, useState } from "react";
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
  CalendarDays,
} from "lucide-react";
import { useApp } from "../lib/app-context";
import type { ProfileReviewCheckpoint } from "../lib/contracts";
import GrantSetupWizard from "../components/GrantSetupWizard";
import { ORGANISATION_TYPES, profileValues } from "../lib/profile-values";
import { validateProfileDates } from "../lib/profile-dates";
import { mergeReviewedProfile } from "../lib/profile-merge";
import {
  loadSetupReviewDraft,
  removeSetupReviewDraft,
  saveSetupReviewDraft,
} from "../lib/setup-review-draft";
import {
  ProfileDetailsForm,
  ProfileDetailsSummary,
} from "../components/ProfileDetails";
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
  UploadBatchResult,
  DocumentRecord,
  ReviewCheck,
} from "../types";
import {
  isInsuranceCategory,
  documentExpiryStatus,
} from "../lib/grant-requirements";
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

type ProfileReviewResult = Pick<AIResult, "sourceFingerprint" | "message"> & {
  profile: Profile;
  checks: ReviewCheck[];
  evidence: unknown[];
};
type PendingProfileReview = {
  version: 1;
  profile: Profile;
  focusText: string;
  result: ProfileReviewResult;
  selected: string[];
  includeInsurance: boolean;
};
type ProfileReviewDraft = {
  scope: string;
  review: PendingProfileReview;
  status: "saving" | "saved" | "unsaved";
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isTextList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const isReviewProfile = (value: unknown): value is Profile =>
  isRecord(value) &&
  typeof value.name === "string" &&
  ["abn", "type", "state", "description", "website"].every(
    (key) => value[key] === undefined || typeof value[key] === "string",
  ) &&
  ["focus_areas", "beneficiaries", "service_locations"].every(
    (key) => value[key] === undefined || isTextList(value[key]),
  );
function readPendingProfileReview(
  data: Record<string, unknown>,
): PendingProfileReview | null {
  const { profile, result, focusText, selected, includeInsurance } = data;
  if (
    data.version !== 1 ||
    !isReviewProfile(profile) ||
    !isRecord(result) ||
    !isReviewProfile(result.profile) ||
    !Array.isArray(result.checks) ||
    !result.checks.every(
      (check) =>
        isRecord(check) &&
        typeof check.field === "string" &&
        typeof check.issue === "string" &&
        ["source", "suggestion"].every(
          (key) => check[key] === undefined || typeof check[key] === "string",
        ),
    ) ||
    !Array.isArray(result.evidence) ||
    typeof focusText !== "string" ||
    !isTextList(selected) ||
    typeof includeInsurance !== "boolean"
  )
    return null;
  return {
    version: 1,
    profile,
    focusText,
    selected,
    includeInsurance,
    result: {
      profile: result.profile,
      checks: result.checks,
      evidence: result.evidence,
      sourceFingerprint:
        typeof result.sourceFingerprint === "string"
          ? result.sourceFingerprint
          : undefined,
      message: typeof result.message === "string" ? result.message : undefined,
    },
  };
}

export default function OrganisationPage() {
  const app = useApp();
  const org = app.org;
  const [wizard, setWizard] = useState(false);
  const [grantSetupOpen, setGrantSetupOpen] = useState(false);
  const [step, setStep] = useState<"sources" | "review">("sources");
  const [history, setHistory] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [includeInsurance, setIncludeInsurance] = useState(false);
  const [result, setResult] = useState<ProfileReviewResult | null>(null);
  const [profile, setProfile] = useState<Profile>({ name: "" });
  const [focusText, setFocusText] = useState("");
  const [checksConfirmed, setChecksConfirmed] = useState(false);
  const [approveConfirmed, setApproveConfirmed] = useState(false);
  const [busy, setBusy] = useState("");
  const [profileStage, setProfileStage] = useState<ProfileStage | null>(null);
  const [error, setError] = useState("");
  const [uploadReport, setUploadReport] = useState<UploadBatchResult | null>(
    null,
  );
  const [category, setCategory] = useState("registration");
  const [uploadExpiry, setUploadExpiry] = useState("");
  const [editingExpiry, setEditingExpiry] = useState<DocumentRecord | null>(
    null,
  );
  const [expiryValue, setExpiryValue] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [create, setCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFrequency, setNewFrequency] = useState<Frequency>("weekly");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileReviewDraft | null>(
    null,
  );
  const [loadedDraftScope, setLoadedDraftScope] = useState("");
  const [failedDraftScope, setFailedDraftScope] = useState("");
  const [draftLoadAttempt, setDraftLoadAttempt] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const wizardInput = useRef<HTMLInputElement>(null);
  const profileReview = useRef<ProfileReviewCheckpoint | null>(null);
  const currentDraft = useRef<ProfileReviewDraft | null>(null);
  const checkedDraftScope = useRef("");
  const pendingDraftWrite = useRef<Promise<boolean> | null>(null);
  const draftOrgId = app.mode === "live" ? org?.id : undefined;
  const draftActorId = app.user?.id;
  const draftScope =
    draftOrgId && draftActorId ? `${draftOrgId}:${draftActorId}` : "";
  const activeDraftScope = useRef(draftScope);
  activeDraftScope.current = draftScope;
  const currentProfileDraft =
    profileDraft?.scope === draftScope ? profileDraft : null;
  const loadingProfileDraft = !!draftScope && loadedDraftScope !== draftScope;

  useEffect(() => {
    profileReview.current = null;
    setFrequency(org?.notification_frequency ?? "weekly");
    setWizard(false);
    setGrantSetupOpen(false);
    setError("");
    setBusy("");
    setProfileStage(null);
    setHistory("");
    setResult(null);
    setProfile({ name: "" });
    setUploadReport(null);
    setEditingExpiry(null);
    setUploadExpiry("");
  }, [org?.id, app.user?.id]);

  useEffect(() => {
    if (currentDraft.current?.scope !== draftScope) {
      currentDraft.current = null;
      setProfileDraft(null);
    }
    if (!draftOrgId || !draftActorId) return;
    let active = true;
    void loadSetupReviewDraft(draftOrgId, draftActorId, "profile")
      .then((stored) => {
        if (!active) return;
        if (currentDraft.current?.scope === draftScope && stored) return;
        const review = stored && readPendingProfileReview(stored.data);
        if (stored && !review) {
          setFailedDraftScope(draftScope);
          return;
        }
        checkedDraftScope.current = draftScope;
        setFailedDraftScope("");
        if (!review) return;
        const entry: ProfileReviewDraft = {
          scope: draftScope,
          review,
          status: "saved",
        };
        currentDraft.current = entry;
        setProfileDraft(entry);
      })
      .catch(() => {
        if (active) setFailedDraftScope(draftScope);
      })
      .finally(() => {
        if (active) setLoadedDraftScope(draftScope);
      });
    return () => {
      active = false;
    };
  }, [draftActorId, draftLoadAttempt, draftOrgId, draftScope]);

  const persistProfileDraft = useCallback(
    (review: PendingProfileReview) => {
      if (!draftOrgId || !draftActorId) return Promise.resolve(false);
      const entry: ProfileReviewDraft = {
        scope: draftScope,
        review,
        status: "saving",
      };
      const inScope = () => activeDraftScope.current === draftScope;
      if (inScope()) {
        currentDraft.current = entry;
        setProfileDraft(entry);
      }
      async function writeDraft() {
        if (!draftOrgId || !draftActorId) return false;
        if (checkedDraftScope.current !== draftScope) {
          const stored = await loadSetupReviewDraft(
            draftOrgId,
            draftActorId,
            "profile",
          );
          // Preserve a prior review if this wizard opened while storage was unreachable.
          if (stored) return false;
          if (inScope()) {
            checkedDraftScope.current = draftScope;
            setFailedDraftScope("");
          }
        }
        await saveSetupReviewDraft(draftOrgId, draftActorId, "profile", review);
        return true;
      }
      const finished = writeDraft()
        .catch(() => false)
        .then((saved) => {
          if (inScope() && currentDraft.current === entry) {
            const next: ProfileReviewDraft = {
              ...entry,
              status: saved ? "saved" : "unsaved",
            };
            currentDraft.current = next;
            setProfileDraft(next);
          }
          return saved;
        });
      pendingDraftWrite.current = finished;
      return finished;
    },
    [draftActorId, draftOrgId, draftScope],
  );

  useEffect(() => {
    if (!wizard || step !== "review" || !result || !draftScope || busy) return;
    const previous =
      currentDraft.current?.scope === draftScope
        ? currentDraft.current.review
        : null;
    if (
      previous?.profile === profile &&
      previous?.focusText === focusText &&
      previous?.result === result
    )
      return;
    const timer = window.setTimeout(() => {
      void persistProfileDraft({
        version: 1,
        profile,
        focusText,
        result,
        selected,
        includeInsurance,
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    busy,
    draftScope,
    focusText,
    includeInsurance,
    persistProfileDraft,
    profile,
    result,
    selected,
    step,
    wizard,
  ]);
  const publicDocuments = app.data.documents.filter((document) =>
    ["registration", "acnc", "other"].includes(document.category),
  );
  const insuranceDocuments = app.data.documents.filter((document) =>
    isInsuranceCategory(document.category),
  );
  const sourceDocuments = includeInsurance
    ? [...publicDocuments, ...insuranceDocuments]
    : publicDocuments;
  const selectedBytes = app.data.documents
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
  const sourceEvidence =
    result?.evidence ??
    (Array.isArray(profile.source_evidence) ? profile.source_evidence : []);
  const savedChecks = Array.isArray(profile.review_notes)
    ? profile.review_notes.filter(
        (note): note is ReviewCheck =>
          !!note &&
          typeof note === "object" &&
          typeof note.field === "string" &&
          typeof note.issue === "string",
      )
    : [];
  const reviewChecks = validateProfileDates(
    profile,
    result?.checks ?? savedChecks,
  );

  function openWizard() {
    profileReview.current = null;
    setWizard(true);
    setHistory("");
    setError("");
    setProfileStage(null);
    setChecksConfirmed(false);
    setApproveConfirmed(false);
    const draft = currentProfileDraft?.review;
    if (draft) {
      setStep("review");
      setResult(draft.result);
      setProfile(draft.profile);
      setFocusText(draft.focusText);
      setSelected(draft.selected);
      setIncludeInsurance(draft.includeInsurance);
      return;
    }
    setStep("sources");
    setResult(null);
    setIncludeInsurance(false);
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
    setProfile(profileValues(org?.profile ?? { name: org?.name ?? "" }));
    setFocusText((org?.focus_areas ?? []).join(", "));
  }
  function closeWizard() {
    profileReview.current = null;
    setWizard(false);
  }
  async function saveCurrentProfileDraft() {
    if (!result || !draftScope) return false;
    const current = currentDraft.current;
    if (
      current?.scope === draftScope &&
      current.review.profile === profile &&
      current.review.focusText === focusText &&
      current.review.result === result &&
      current.status !== "unsaved"
    ) {
      if (current.status === "saved") return true;
      return (await pendingDraftWrite.current) ?? false;
    }
    return persistProfileDraft({
      version: 1,
      profile,
      focusText,
      result,
      selected,
      includeInsurance,
    });
  }
  function leaveWizard() {
    if (step === "review" && result) void saveCurrentProfileDraft();
    closeWizard();
  }
  async function saveProfileDraftAndClose() {
    setBusy("save-draft");
    try {
      if (
        (await saveCurrentProfileDraft()) &&
        activeDraftScope.current === draftScope
      )
        closeWizard();
    } finally {
      if (activeDraftScope.current === draftScope) setBusy("");
    }
  }
  function changeProfileSources() {
    if (profileReview.current) setError("");
    profileReview.current = null;
  }
  async function upload(files: File[], selectedCategory = category) {
    if (!files.length) return;
    setBusy("upload");
    setError("");
    setUploadReport(null);
    try {
      setUploadReport(
        await app.uploadDocuments(
          files,
          selectedCategory,
          isInsuranceCategory(selectedCategory) ? uploadExpiry || null : null,
        ),
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy("");
      if (fileInput.current) fileInput.current.value = "";
      if (wizardInput.current) wizardInput.current.value = "";
    }
  }
  const uploadSummary = uploadReport ? (
    <section
      className="notice"
      role={uploadReport.failed.length ? "alert" : "status"}
      aria-label="Upload results"
    >
      <div>
        <h3>Upload results</h3>
        {uploadReport.failed.length > 0 && (
          <p>
            {uploadReport.saved.length} document
            {uploadReport.saved.length === 1 ? " was" : "s were"} saved. Check
            your library before uploading again.
          </p>
        )}
        <p>
          <strong>Saved ({uploadReport.saved.length})</strong>
        </p>
        {uploadReport.saved.length ? (
          <ul>
            {uploadReport.saved.map((name, index) => (
              <li key={`${name}-${index}`}>{name}</li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No new files saved.</p>
        )}
        {uploadReport.failed.length > 0 && (
          <>
            <p>
              <strong>Failed ({uploadReport.failed.length})</strong>
            </p>
            <ul>
              {uploadReport.failed.map((item, index) => (
                <li key={`${item.name}-${index}`}>
                  <strong>{item.name}</strong>: {item.reason}
                </li>
              ))}
            </ul>
          </>
        )}
        {uploadReport.skipped.length > 0 && (
          <>
            <p>
              <strong>Skipped ({uploadReport.skipped.length})</strong>
            </p>
            <ul>
              {uploadReport.skipped.map((item, index) => (
                <li key={`${item.name}-${index}`}>
                  <strong>{item.name}</strong>: {item.reason}
                </li>
              ))}
            </ul>
            <p className="small muted">
              Duplicate checks compare file name, size and type. A different
              version with the same details can be uploaded after you rename it.
              Renamed copies are not detected.
            </p>
          </>
        )}
      </div>
    </section>
  ) : null;
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
    setError("");
    try {
      const draft = await app.runAI(
        {
          action: "profile",
          text: history,
          documentIds: selected,
        },
        (stage) => setProfileStage(stage),
        profileReview,
      );
      if (activeDraftScope.current !== draftScope) return;
      if (!draft.profile)
        throw new Error("A profile draft was not returned. Please try again.");
      let nextProfile = draft.profile;
      const preservedChecks: ReviewCheck[] = [];
      if (org?.verification_status === "approved") {
        const saved: Profile = {
          ...org.profile,
          name: org.name,
          description: org.description,
          abn: org.abn ?? "",
          type: org.type,
          state: org.state,
          focus_areas: org.focus_areas,
          website: org.website ?? "",
        };
        const merged = mergeReviewedProfile(saved, draft.profile);
        nextProfile = merged.profile;
        preservedChecks.push(...merged.checks);
        if (Array.isArray(saved.review_notes)) {
          preservedChecks.push(
            ...saved.review_notes.filter(
              (note): note is ReviewCheck =>
                !!note &&
                typeof note === "object" &&
                typeof note.field === "string" &&
                typeof note.issue === "string",
            ),
          );
        }
      }
      const completedReview: ProfileReviewResult = {
        profile: draft.profile,
        sourceFingerprint: draft.sourceFingerprint,
        message: draft.message,
        checks: [
          ...new Map(
            [...(draft.checks ?? []), ...preservedChecks].map((check) => [
              JSON.stringify(check),
              check,
            ]),
          ).values(),
        ],
        evidence: [
          ...new Map(
            [
              ...(org?.verification_status === "approved" &&
              Array.isArray(org.profile.source_evidence)
                ? org.profile.source_evidence
                : []),
              ...(draft.evidence ?? []),
            ].map((item) => [JSON.stringify(item), item]),
          ).values(),
        ],
      };
      const editableProfile = profileValues(nextProfile);
      delete editableProfile.grant_setup;
      const nextFocusText = (editableProfile.focus_areas ?? []).join(", ");
      setResult(completedReview);
      setProfile(editableProfile);
      setFocusText(nextFocusText);
      setChecksConfirmed(false);
      setApproveConfirmed(false);
      setStep("review");
      void persistProfileDraft({
        version: 1,
        profile: editableProfile,
        focusText: nextFocusText,
        result: completedReview,
        selected,
        includeInsurance,
      });
    } catch (e) {
      if (activeDraftScope.current === draftScope) setError(errorMessage(e));
    } finally {
      if (activeDraftScope.current === draftScope) {
        setBusy("");
        setProfileStage(null);
      }
    }
  }
  async function approveProfile() {
    if (!profile.name.trim() || !String(profile.description ?? "").trim()) {
      setError(
        "Add the organisation name and a short description before approving.",
      );
      return;
    }
    if (!approveConfirmed || (reviewChecks.length > 0 && !checksConfirmed)) {
      setError(
        "Please review and confirm the organisation details and any differences first.",
      );
      return;
    }
    setBusy("approve");
    setError("");
    try {
      const reviewedProfile = {
        ...org?.profile,
        ...profile,
        ...(org?.profile.grant_setup !== undefined
          ? { grant_setup: org.profile.grant_setup }
          : {}),
        beneficiaries: profile.beneficiaries
          ?.map((value) => value.trim())
          .filter(Boolean),
        service_locations: profile.service_locations
          ?.map((value) => value.trim())
          .filter(Boolean),
        ...(result?.evidence ? { source_evidence: result.evidence } : {}),
        review_notes: reviewChecks,
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
        type: typeof profile.type === "string" ? profile.type.trim() : "",
        state: String(profile.state ?? ""),
        focus_areas: reviewedProfile.focus_areas,
        website: typeof profile.website === "string" ? profile.website : null,
        verification_status: "approved",
      };
      await app.updateOrg(patch);
      if (activeDraftScope.current !== draftScope) return;
      let cleanupFailed = false;
      if (result && draftOrgId && draftActorId) {
        currentDraft.current = null;
        setProfileDraft(null);
        try {
          await removeSetupReviewDraft(draftOrgId, draftActorId, "profile");
        } catch {
          cleanupFailed = true;
        }
      }
      if (activeDraftScope.current === draftScope) {
        closeWizard();
        app.notify("Organisation details approved and saved.");
        if (cleanupFailed)
          setError(
            "Your details were approved. The old profile draft could not be cleared.",
          );
      }
    } catch (e) {
      if (activeDraftScope.current === draftScope) setError(errorMessage(e));
    } finally {
      if (activeDraftScope.current === draftScope) setBusy("");
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
      if (selected.includes(removeId)) profileReview.current = null;
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
      {!wizard && uploadSummary}
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
              <ProfileDetailsSummary profile={org.profile} />
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
                <button
                  className="button primary"
                  onClick={() => setGrantSetupOpen(true)}
                >
                  <Sparkles size={18} />
                  Set up for grants
                </button>
                <button
                  className="button secondary"
                  disabled={loadingProfileDraft}
                  onClick={openWizard}
                >
                  <Sparkles size={18} />
                  {currentProfileDraft
                    ? "Resume profile draft"
                    : "Update with AI"}
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
              {failedDraftScope === draftScope && !!draftScope && (
                <p className="small muted">
                  Couldn’t check for a saved profile draft.{" "}
                  <button
                    className="button secondary"
                    onClick={() => {
                      setFailedDraftScope("");
                      setLoadedDraftScope("");
                      setDraftLoadAttempt((attempt) => attempt + 1);
                    }}
                  >
                    Retry loading profile draft
                  </button>
                </p>
              )}
            </section>
            <div className="stack">
              <section className="card card-soft">
                <span className="icon-tile">
                  <Sparkles size={23} />
                </span>
                <h2>Build reusable grant answers</h2>
                <p>
                  Work through registration, services, governance and other
                  common grant questions using sources already in your library.
                </p>
                <ol className="simple-steps">
                  <li>Find answers one source at a time</li>
                  <li>Compare any disagreements</li>
                  <li>Review answers and see what evidence is missing</li>
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
                  disabled={busy === "upload"}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setUploadExpiry("");
                  }}
                >
                  {categories.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {isInsuranceCategory(category) && (
                <label className="form-field">
                  Insurance expiry date
                  <input
                    type="date"
                    value={uploadExpiry}
                    disabled={busy === "upload"}
                    onChange={(event) => setUploadExpiry(event.target.value)}
                  />
                  <span className="small muted">
                    Required before drafting a grant that requires insurance.
                  </span>
                </label>
              )}
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
                          ` · ${documentExpiryStatus(document.expires_on) === "expired" ? "Expired" : "Expires"} ${date(document.expires_on)}`}
                        {isInsuranceCategory(document.category) &&
                          !document.expires_on &&
                          " · Expiry not recorded"}
                      </span>
                    </div>
                    <Badge tone={document.verified ? "green" : "neutral"}>
                      {document.verified ? "Reviewed" : "Uploaded"}
                    </Badge>
                    <button
                      className="icon-button"
                      aria-label={`Edit expiry for ${document.name}`}
                      onClick={() => {
                        setEditingExpiry(document);
                        setExpiryValue(document.expires_on ?? "");
                        setError("");
                      }}
                    >
                      <CalendarDays size={18} />
                    </button>
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
      {editingExpiry && (
        <Modal
          title="Document expiry"
          onClose={() => {
            if (busy !== "expiry") {
              setEditingExpiry(null);
              setError("");
            }
          }}
        >
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy("expiry");
              setError("");
              try {
                await app.updateDocumentExpiry(
                  editingExpiry.id,
                  expiryValue || null,
                );
                setEditingExpiry(null);
              } catch (issue) {
                setError(errorMessage(issue));
              } finally {
                setBusy("");
              }
            }}
          >
            <p>{editingExpiry.name}</p>
            <label className="form-field">
              Expiry date
              <input
                type="date"
                value={expiryValue}
                disabled={busy === "expiry"}
                onChange={(event) => setExpiryValue(event.target.value)}
              />
            </label>
            <Notice>
              Check the date against the original document. Insurance without a
              recorded current expiry date cannot satisfy a mandatory insurance
              requirement.
            </Notice>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy === "expiry"}>
              {busy === "expiry" ? <Busy label="Saving…" /> : "Save expiry"}
            </button>
          </form>
        </Modal>
      )}
      {grantSetupOpen && org && (
        <GrantSetupWizard
          key={org.id}
          organisation={org}
          onClose={() => setGrantSetupOpen(false)}
        />
      )}
      {wizard && (
        <Modal
          title={
            step === "sources"
              ? "Let’s get to know your organisation"
              : "Review your organisation details"
          }
          onClose={() => !busy && leaveWizard()}
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
          {uploadSummary}
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
                  onChange={(e) => {
                    changeProfileSources();
                    setHistory(e.target.value);
                  }}
                  placeholder="What does your organisation do? Who do you support? You can paste information from your website, annual report or past applications."
                />
              </label>
              <div>
                <h3>Choose source documents</h3>
                <p className="small muted">
                  Use registration documents and public background information.
                  Financial statements stay in your document library.
                </p>
                {insuranceDocuments.length > 0 && (
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={includeInsurance}
                      disabled={!!busy}
                      onChange={(event) => {
                        changeProfileSources();
                        setIncludeInsurance(event.target.checked);
                        if (!event.target.checked)
                          setSelected((ids) =>
                            ids.filter(
                              (id) =>
                                !insuranceDocuments.some(
                                  (document) => document.id === id,
                                ),
                            ),
                          );
                      }}
                    />
                    <span>
                      Show insurance documents for optional AI extraction. I
                      authorise selected insurance documents to be sent to
                      Gemini.
                    </span>
                  </label>
                )}
                <p className="small muted">
                  Choose up to 8 documents, totalling no more than 15 MB.
                  Uncheck a document to make room for another.
                </p>
                <p className="small">
                  <strong>
                    {selected.length} of {sourceDocuments.length} selected
                  </strong>{" "}
                  · {(selectedBytes / (1024 * 1024)).toFixed(1)} MB of 15 MB
                </p>
                {sourceDocuments.length ? (
                  <div className="source-document-list">
                    {sourceDocuments.map((document) => (
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
                          onChange={(e) => {
                            changeProfileSources();
                            setSelected((ids) =>
                              e.target.checked
                                ? [...ids, document.id]
                                : ids.filter((id) => id !== document.id),
                            );
                          }}
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
                library and are not selected for this profile step. Insurance
                documents are included only when you choose to show them and
                select the individual files.
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
                  onClick={closeWizard}
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
              {result && currentProfileDraft && (
                <p className="small muted" role="status">
                  {currentProfileDraft.status === "unsaved"
                    ? "This draft couldn’t be saved for later. Your edits are still here. Try saving again before leaving this page."
                    : currentProfileDraft.status === "saving" ||
                        currentProfileDraft.review.profile !== profile ||
                        currentProfileDraft.review.focusText !== focusText
                      ? "Saving your draft…"
                      : "Draft saved. You can return to finish reviewing before you approve it."}
                </p>
              )}
              {reviewChecks.length > 0 && (
                <section className="review-differences">
                  <h3>These details need your attention</h3>
                  {reviewChecks.map((check, index) => (
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
                    {ORGANISATION_TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
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
              <ProfileDetailsForm profile={profile} onChange={setProfile} />
              {!!sourceEvidence.length && (
                <details>
                  <summary>View source references</summary>
                  <ul className="evidence-list">
                    {sourceEvidence.map((source, index) => (
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
                  onClick={() => {
                    if (result) {
                      void saveCurrentProfileDraft();
                      setStep("sources");
                    } else closeWizard();
                  }}
                >
                  {result ? "Back to sources" : "Cancel"}
                </button>
                {result && draftScope && (
                  <button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={saveProfileDraftAndClose}
                  >
                    {busy === "save-draft" ? (
                      <Busy label="Saving draft…" />
                    ) : (
                      "Save draft and close"
                    )}
                  </button>
                )}
                <button
                  className="button primary"
                  disabled={
                    !!busy ||
                    !approveConfirmed ||
                    (reviewChecks.length > 0 && !checksConfirmed)
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
