import { describe, expect, it } from "vitest";
import {
  resolveDocumentFormat,
  SUPPORTED_DOCUMENT_MIME_TYPES,
  DOCUMENT_ACCEPT,
  unsupportedDocumentMessage,
} from "../src/lib/document-formats";

describe("shared document format policy", () => {
  it("normalises missing/generic Office MIME values and common text aliases", () => {
    expect(
      resolveDocumentFormat({ name: "Registration.DOCX", type: "" }),
    ).toMatchObject({
      kind: "docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(
      resolveDocumentFormat({
        name: "Budget.xlsx",
        type: "application/octet-stream",
      }),
    ).toMatchObject({ kind: "xlsx" });
    expect(
      resolveDocumentFormat({ name: "Budget.xlsx", type: "application/zip" }),
    ).toMatchObject({ kind: "xlsx" });
    expect(
      resolveDocumentFormat({
        name: "Budget.csv",
        type: "application/vnd.ms-excel",
      }),
    ).toMatchObject({ mimeType: "text/csv" });
    expect(
      resolveDocumentFormat({
        name: "History.xml",
        type: "text/xml; charset=utf-8",
      }),
    ).toMatchObject({ mimeType: "application/xml" });
  });
  it("rejects conflicting names/types, unknown extensions, executable and legacy/macro files", () => {
    for (const file of [
      { name: "registration.docx", type: "application/pdf" },
      { name: "archive.zip", type: "application/zip" },
      { name: "run.exe", type: "text/plain" },
      { name: "budget.xls", type: "application/vnd.ms-excel" },
      {
        name: "budget.xlsm",
        type: "application/vnd.ms-excel.sheet.macroEnabled.12",
      },
    ])
      expect(resolveDocumentFormat(file)).toBeNull();
    expect(unsupportedDocumentMessage("budget.xls")).toContain(
      "save older or macro-enabled",
    );
  });
  it("keeps the picker and canonical bucket types explicit", () => {
    expect(DOCUMENT_ACCEPT).toContain(".docx");
    expect(DOCUMENT_ACCEPT).toContain(".xlsx");
    expect(DOCUMENT_ACCEPT).toContain(".webp");
    expect(SUPPORTED_DOCUMENT_MIME_TYPES).toHaveLength(13);
    expect(new Set(SUPPORTED_DOCUMENT_MIME_TYPES).size).toBe(13);
  });
});
