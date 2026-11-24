import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useApp } from "../lib/app-context";
import {
  DOCUMENT_ACCEPT,
  MAX_AI_DOCUMENTS,
  MAX_AI_DOCUMENT_BYTES,
  MAX_DOCUMENT_BYTES,
  SUPPORTED_DOCUMENT_LABEL,
  resolveDocumentFormat,
  unsupportedDocumentMessage,
} from "../lib/document-formats";
import {
  GRANT_RESEARCH_CATEGORY,
  MAX_GRANT_REPORT_CHARS,
  type GrantImportCandidate,
} from "../lib/grant-import";
import {
  Busy,
  ExternalLink,
  Modal,
  date,
  deadline,
  errorMessage,
  money,
} from "./ui";
import "./grant-import.css";

type Review = {
  importCandidates: GrantImportCandidate[];
  importNotes: string[];
  sourceFingerprint: string;
  stageIssuedAt: number;
  selectedIndexes: number[];
};

type ReportDocument = { id: string; name: string; size: number };

function fileLimitError(files: { name: string; size: number }[]) {
  if (files.length > MAX_AI_DOCUMENTS)
    return `Select up to ${MAX_AI_DOCUMENTS} files per import.`;
  const large = files.find((file) => file.size > MAX_DOCUMENT_BYTES);
  if (large) return `${large.name} exceeds the 10 MB file limit.`;
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_AI_DOCUMENT_BYTES)
    return "The selected files exceed 15 MB in total. Use fewer files per import.";
  return "";
}

function GrantPreviewRow({
  grant,
  checked,
  busy,
  onChange,
}: {
  grant: GrantImportCandidate;
  checked: boolean;
  busy: boolean;
  onChange: () => void;
}) {
  const closing = grant.closing_date
    ? `Closes ${date(grant.closing_date)}${grant.closes_at ? "" : " · Time to confirm"}`
    : grant.closes_at
      ? `Closes ${deadline(grant.closes_at)}`
      : "Closing date to confirm";
  let funding: string | null = null;
  if (grant.amount_min !== null && grant.amount_max !== null)
    funding =
      grant.amount_min === grant.amount_max
        ? money(grant.amount_max)
        : `${money(grant.amount_min)} to ${money(grant.amount_max)}`;
  else if (grant.amount_max !== null)
    funding = `Up to ${money(grant.amount_max)}`;
  else if (grant.amount_min !== null)
    funding = `From ${money(grant.amount_min)}`;
  return (
    <li className="grant-import-candidate">
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={onChange}
        />
        <strong>{grant.title}</strong>
      </label>
      <div>
        <p>
          {grant.funder || "Funder to confirm"}
          {grant.location && ` · ${grant.location}`}
        </p>
        {grant.summary && <p>{grant.summary}</p>}
        <p className="muted">
          {[funding, grant.opens_on && `Opens ${date(grant.opens_on)}`, closing]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {grant.source_url ? (
          <ExternalLink href={grant.source_url}>
            Source link in report
          </ExternalLink>
        ) : (
          <span className="small muted">Source link needed</span>
        )}
      </div>
    </li>
  );
}

export default function GrantImportDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const app = useApp();
  const [text, setText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<ReportDocument[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [progress, setProgress] = useState<"upload" | "read" | "save" | null>(
    null,
  );
  const [error, setError] = useState("");
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const reviewing = review !== null;
  useEffect(() => {
    if (reviewing) summaryRef.current?.focus();
  }, [reviewing]);
  const busy = progress !== null;
  const library = new Map<string, ReportDocument>();
  for (const doc of app.data.documents) {
    if (
      doc.org_id === app.org?.id &&
      resolveDocumentFormat({ name: doc.name, type: doc.mime_type })
    )
      library.set(doc.id, { id: doc.id, name: doc.name, size: doc.size_bytes });
  }

  // Keep freshly uploaded files selectable even if the library refresh failed.
  for (const doc of selectedFiles)
    if (!library.has(doc.id)) library.set(doc.id, doc);
  const selectedDocs = selectedFiles.map((doc) => library.get(doc.id)!);

  function selectDocument(doc: ReportDocument, checked: boolean) {
    const next = checked
      ? [...selectedDocs, doc]
      : selectedDocs.filter((item) => item.id !== doc.id);
    const limit = fileLimitError(next);
    setError(limit);
    if (!limit) setSelectedFiles(next);
  }

  async function upload(files: File[]) {
    if (!files.length || busy) return;
    const invalid = files.find((file) => !resolveDocumentFormat(file));
    const empty = files.find((file) => !file.size);
    const problem = invalid
      ? `${invalid.name}: ${unsupportedDocumentMessage(invalid.name)}`
      : empty
        ? `${empty.name} is empty. Choose a file containing grant information.`
        : fileLimitError([...selectedDocs, ...files]);
    setError(problem);
    if (problem) return;
    setProgress("upload");
    try {
      const result = await app.uploadDocuments(files, GRANT_RESEARCH_CATEGORY);
      // The uploader returns names and IDs in matching order, including after partial failures.
      const added = result.savedDocumentIds.map((id, i) => {
        const name = result.saved[i];
        return {
          id,
          name,
          size: Math.max(
            ...files
              .filter((file) => file.name === name)
              .map((file) => file.size),
          ),
        };
      });
      setSelectedFiles((docs) => [...docs, ...added]);
      setLibraryOpen(true);
      const issues = [...result.failed, ...result.skipped].map(
        (item) => `${item.name}: ${item.reason}`,
      );
      if (result.skipped.length)
        issues.push(
          "Select an existing copy from the document library to include it.",
        );
      setError(issues.join(" "));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  }

  async function readReport() {
    setError("");
    setProgress("read");
    try {
      const result = await app.runAI({
        action: "import-grant",
        importStage: "preview",
        text: text.trim(),
        documentIds: selectedDocs.map((doc) => doc.id),
      });
      if (
        !result.importCandidates ||
        !result.sourceFingerprint ||
        result.stageIssuedAt === undefined
      )
        throw new Error("The preview was incomplete. Read the report again.");
      setReview({
        importCandidates: result.importCandidates,
        importNotes: result.importNotes ?? [],
        sourceFingerprint: result.sourceFingerprint,
        stageIssuedAt: result.stageIssuedAt,
        selectedIndexes: result.importCandidates.map((_, i) => i),
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  }

  async function save() {
    if (!review || !review.selectedIndexes.length || busy) return;
    setError("");
    setProgress("save");
    try {
      const {
        importCandidates,
        selectedIndexes,
        sourceFingerprint,
        stageIssuedAt,
      } = review;
      const result = await app.runAI({
        action: "import-grant",
        importStage: "save",
        importCandidates,
        selectedIndexes,
        sourceFingerprint,
        stageIssuedAt,
      });
      app.notify(result.message ?? "Selected opportunities saved.");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  }

  const tooLong = text.length > MAX_GRANT_REPORT_CHARS;
  return (
    <Modal
      title={review ? "Review grant opportunities" : "Import a grant report"}
      onClose={() => !busy && onClose()}
    >
      <div className="stack grant-import">
        {review ? (
          <>
            <p ref={summaryRef} tabIndex={-1} role="status">
              {review.importCandidates.length
                ? "Choose the grants to add to your opportunities. Check dates, eligibility and source links with each funder."
                : "No grant opportunities found. Try a section that names a grant or funding round."}
            </p>
            {review.importNotes.length > 0 && (
              <ul className="grant-import-notes">
                {review.importNotes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}
            {review.importCandidates.length > 0 && (
              <ul
                className="grant-import-list"
                aria-label="Grants found in the report"
              >
                {review.importCandidates.map((grant, i) => (
                  <GrantPreviewRow
                    key={i}
                    grant={grant}
                    busy={busy}
                    checked={review.selectedIndexes.includes(i)}
                    onChange={() =>
                      setReview({
                        ...review,
                        selectedIndexes: review.selectedIndexes.includes(i)
                          ? review.selectedIndexes.filter(
                              (index) => index !== i,
                            )
                          : [...review.selectedIndexes, i].sort(
                              (a, b) => a - b,
                            ),
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <p>
              Paste a newsletter, research notes or a funding list, or upload a
              report. You can review each grant before adding it.
            </p>
            <label className="form-field">
              Report text
              <textarea
                rows={5}
                value={text}
                disabled={busy}
                onChange={(event) => {
                  setText(event.target.value);
                  setError("");
                }}
                aria-invalid={tooLong || undefined}
                aria-describedby={
                  tooLong ? "grant-import-text-limit" : undefined
                }
                placeholder="Paste your grant research here…"
              />
            </label>
            {tooLong && (
              <p
                id="grant-import-text-limit"
                role="alert"
                className="error-box"
              >
                Use up to {MAX_GRANT_REPORT_CHARS.toLocaleString("en-AU")}{" "}
                characters per import. Split longer reports into sections.
              </p>
            )}
            <label className="form-field">
              Upload report files
              <input
                type="file"
                accept={DOCUMENT_ACCEPT}
                multiple
                disabled={busy}
                aria-describedby="grant-import-file-types"
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  void upload(files);
                }}
              />
            </label>
            <p className="small muted" id="grant-import-file-types">
              {SUPPORTED_DOCUMENT_LABEL}. Up to {MAX_AI_DOCUMENTS} files, 10 MB
              each and 15 MB total. Uploads are kept in your organisation’s
              document library.
            </p>
            {progress === "upload" && (
              <div role="status">
                <Busy label="Uploading report files…" />
              </div>
            )}
            {library.size > 0 && (
              <details
                className="grant-import-library"
                open={libraryOpen}
                onToggle={(event) => setLibraryOpen(event.currentTarget.open)}
              >
                <summary>
                  Choose from document library ({selectedDocs.length} selected)
                </summary>
                {Array.from(library.values()).map((doc) => (
                  <label className="checkbox-row" key={doc.id}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={selectedDocs.some(
                        (selected) => selected.id === doc.id,
                      )}
                      onChange={(event) =>
                        selectDocument(doc, event.currentTarget.checked)
                      }
                    />
                    <span>{doc.name}</span>
                  </label>
                ))}
              </details>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              if (review) {
                setReview(null);
                setError("");
              } else onClose();
            }}
          >
            {review ? "Back to report" : "Cancel"}
          </button>
          {review ? (
            review.importCandidates.length > 0 && (
              <button
                className="button primary"
                disabled={busy || !review.selectedIndexes.length}
                onClick={save}
              >
                {progress === "save" ? (
                  <Busy label="Saving opportunities…" />
                ) : (
                  `Save selected (${review.selectedIndexes.length})`
                )}
              </button>
            )
          ) : (
            <button
              className="button primary"
              disabled={
                busy || tooLong || (!text.trim() && !selectedDocs.length)
              }
              onClick={readReport}
            >
              {progress === "read" ? (
                <Busy label="Reading report…" />
              ) : (
                <>
                  <Sparkles size={17} />
                  Read with AI
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
