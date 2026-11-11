export const MAX_UPLOAD_FILES = 10;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_AI_DOCUMENTS = 8;
export const MAX_AI_DOCUMENT_BYTES = 15 * 1024 * 1024;

export type DocumentFormat = {
  extension: string;
  mimeType: string;
  kind: "pdf" | "image" | "text" | "docx" | "xlsx";
  label: string;
};

const formats: (Omit<DocumentFormat, "extension"> & {
  extensions: string[];
  aliases?: string[];
})[] = [
  {
    extensions: ["pdf"],
    mimeType: "application/pdf",
    kind: "pdf",
    label: "PDF",
  },
  {
    extensions: ["jpg", "jpeg"],
    mimeType: "image/jpeg",
    aliases: ["image/jpg", "image/pjpeg"],
    kind: "image",
    label: "JPEG",
  },
  {
    extensions: ["png"],
    mimeType: "image/png",
    aliases: ["image/x-png"],
    kind: "image",
    label: "PNG",
  },
  {
    extensions: ["webp"],
    mimeType: "image/webp",
    kind: "image",
    label: "WebP",
  },
  {
    extensions: ["txt"],
    mimeType: "text/plain",
    kind: "text",
    label: "plain text",
  },
  {
    extensions: ["csv"],
    mimeType: "text/csv",
    aliases: ["text/plain", "application/csv", "application/vnd.ms-excel"],
    kind: "text",
    label: "CSV",
  },
  {
    extensions: ["tsv"],
    mimeType: "text/tab-separated-values",
    aliases: ["text/plain"],
    kind: "text",
    label: "TSV",
  },
  {
    extensions: ["md"],
    mimeType: "text/markdown",
    aliases: ["text/plain", "text/x-markdown"],
    kind: "text",
    label: "Markdown",
  },
  {
    extensions: ["json"],
    mimeType: "application/json",
    aliases: ["text/plain", "text/json"],
    kind: "text",
    label: "JSON",
  },
  {
    extensions: ["html", "htm"],
    mimeType: "text/html",
    aliases: ["text/plain"],
    kind: "text",
    label: "HTML text",
  },
  {
    extensions: ["xml"],
    mimeType: "application/xml",
    aliases: ["text/plain", "text/xml"],
    kind: "text",
    label: "XML text",
  },
  {
    extensions: ["docx"],
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "docx",
    label: "Word DOCX",
  },
  {
    extensions: ["xlsx"],
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "xlsx",
    label: "Excel XLSX",
  },
];

export const DOCUMENT_ACCEPT = formats
  .flatMap((format) => format.extensions.map((extension) => `.${extension}`))
  .join(",");
export const SUPPORTED_DOCUMENT_MIME_TYPES = formats.map(
  (format) => format.mimeType,
);
export const SUPPORTED_DOCUMENT_LABEL =
  "PDF, Word DOCX, Excel XLSX, JPG, PNG, WebP, TXT, CSV, TSV, Markdown, JSON, HTML or XML";
export const DOCUMENT_FORMAT_LABEL = SUPPORTED_DOCUMENT_LABEL;

export function resolveDocumentFormat(file: {
  name: string;
  type?: string;
}): DocumentFormat | null {
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const format = formats.find((candidate) =>
    candidate.extensions.includes(extension ?? ""),
  );
  if (!format || !extension) return null;
  const type = (file.type ?? "").split(";")[0].trim().toLowerCase();
  const generic =
    !type || ["application/octet-stream", "binary/octet-stream"].includes(type);
  const officeZip =
    ["docx", "xlsx"].includes(format.kind) &&
    ["application/zip", "application/x-zip-compressed"].includes(type);
  if (
    !generic &&
    !officeZip &&
    type !== format.mimeType &&
    !format.aliases?.includes(type)
  )
    return null;
  return {
    extension,
    mimeType: format.mimeType,
    kind: format.kind,
    label: format.label,
  };
}

export function unsupportedDocumentMessage(name: string): string {
  if (/\.(?:doc|xls|docm|xlsm|xltm|dotm)$/i.test(name))
    return "Please save older or macro-enabled Word and Excel files as DOCX, XLSX or PDF before uploading.";
  return `Please use ${SUPPORTED_DOCUMENT_LABEL}. The file extension and document type must match.`;
}
