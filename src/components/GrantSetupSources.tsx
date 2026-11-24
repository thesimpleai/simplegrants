import { useId, useRef } from "react";
import { Plus } from "lucide-react";
import { DOCUMENT_ACCEPT, MAX_AI_DOCUMENTS } from "../lib/document-formats";
import { isInsuranceCategory } from "../lib/grant-requirements";
import type { DocumentRecord } from "../types";

const sourceSlots = [
  {
    category: "registration",
    label: "ASIC or incorporation documents",
    hint: "Registration certificate or ABN Lookup extract",
  },
  {
    category: "acnc",
    label: "ACNC registration",
    hint: "Charity registration certificate or register extract",
  },
  {
    category: "financial_summary",
    label: "Financial reports",
    hint: "Annual report or redacted financial summary",
  },
  {
    category: "insurance",
    label: "Insurance certificates",
    hint: "Certificate of currency or redacted cover summary",
  },
  {
    category: "mission",
    label: "Mission or strategy documents",
    hint: "Mission statement, strategic plan or constitution",
  },
  {
    category: "background",
    label: "Organisation background",
    hint: "About us, programs, policies or impact reports",
  },
] as const;

type SourceSlot = (typeof sourceSlots)[number];
type SourceCategory = SourceSlot["category"];

export function setupSourceCategory(
  category: string,
): SourceCategory | undefined {
  if (category === "other") return "background";
  if (isInsuranceCategory(category)) return "insurance";
  return sourceSlots.find((slot) => slot.category === category)?.category;
}

function FilePicker({
  slot,
  disabled,
  onUpload,
}: {
  slot: SourceSlot;
  disabled: boolean;
  onUpload: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const uploadLabel = `Upload ${slot.label.replace(/^[A-Z](?=[a-z])/, (initial) => initial.toLowerCase())}`;
  return (
    <>
      <button
        className="button secondary grant-setup-upload"
        type="button"
        aria-label={uploadLabel}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Plus size={16} aria-hidden="true" />
        Upload
      </button>
      <input
        ref={input}
        aria-label={uploadLabel}
        type="file"
        accept={DOCUMENT_ACCEPT}
        multiple
        hidden
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          onUpload(files);
        }}
      />
    </>
  );
}

export default function GrantSetupSources({
  documents,
  selected,
  completed,
  busy,
  demo,
  onUpload,
  onSelect,
}: {
  documents: DocumentRecord[];
  selected: string[];
  completed: string[];
  busy: boolean;
  demo: boolean;
  onUpload: (category: SourceCategory, files: File[]) => void;
  onSelect: (id: string, checked: boolean) => void;
}) {
  const insuranceConsent = useId();
  const selectedCount = documents.filter(
    ({ id }) => selected.includes(id) && !completed.includes(id),
  ).length;
  return (
    <>
      <div
        className="grant-setup-slots"
        role="group"
        aria-label="Optional document uploads"
      >
        {sourceSlots.map((slot) => {
          const sources = documents.filter(
            ({ category }) => setupSourceCategory(category) === slot.category,
          );
          return (
            <section className="grant-setup-slot" key={slot.category}>
              <div className="grant-setup-slot-header">
                <div>
                  <h3>{slot.label}</h3>
                  <p className="small muted">{slot.hint}</p>
                </div>
                <FilePicker
                  slot={slot}
                  disabled={busy || demo}
                  onUpload={(files) => onUpload(slot.category, files)}
                />
              </div>
              {sources.length > 0 && (
                <>
                  {slot.category === "insurance" && (
                    <p className="small muted" id={insuranceConsent}>
                      Select a certificate below to include it in AI analysis.
                    </p>
                  )}
                  <ul className="grant-setup-slot-files">
                    {sources.map(({ id, name }) => {
                      if (completed.includes(id))
                        return (
                          <li className="grant-setup-read" key={id}>
                            <span>{name}</span>
                            <small>Analysed</small>
                          </li>
                        );
                      return (
                        <li key={id}>
                          <label className="checkbox-row">
                            <input
                              type="checkbox"
                              aria-describedby={
                                slot.category === "insurance"
                                  ? insuranceConsent
                                  : undefined
                              }
                              checked={selected.includes(id)}
                              disabled={
                                busy ||
                                demo ||
                                (!selected.includes(id) &&
                                  selectedCount >= MAX_AI_DOCUMENTS)
                              }
                              onChange={(event) =>
                                onSelect(id, event.currentTarget.checked)
                              }
                            />
                            <span>{name}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>
          );
        })}
      </div>
      {selectedCount >= MAX_AI_DOCUMENTS && (
        <p className="small muted" role="status">
          You can analyse {MAX_AI_DOCUMENTS} documents at a time. Run this group
          before selecting more.
        </p>
      )}
    </>
  );
}
