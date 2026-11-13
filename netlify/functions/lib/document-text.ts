import mammoth from "mammoth";
import readXlsxFile from "read-excel-file/node";
import { Inflate, zipSync } from "fflate";
import { Parser } from "saxen";
import { HttpError } from "./core";
import {
  MAX_DOCUMENT_BYTES,
  type DocumentFormat,
} from "../../../src/lib/document-formats";

export const MAX_EXTRACTED_TEXT_CHARS = 200_000;
export const MAX_OFFICE_ENTRIES = 512;
export const MAX_OFFICE_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
export const MAX_SPREADSHEET_SHEETS = 20;
export const MAX_SPREADSHEET_CELLS = 20_000;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_XML_CHARS = 4 * 1024 * 1024;
const MAX_EXPANDED_MATRIX_CELLS = 100_000;
const tooLarge = () =>
  new HttpError(
    413,
    "This document is too large or complex for AI reading. Split it into smaller files or export the relevant pages as PDF.",
  );
const spreadsheetLimit = (limit: "sheets" | "cells") =>
  new HttpError(
    413,
    limit === "sheets"
      ? "This workbook exceeds the limit of 20 sheets for AI reading. Choose fewer sheets or export the relevant sheets as PDF."
      : "This workbook exceeds the limit of 20,000 populated cells for AI reading. Split it into smaller workbooks or export the relevant sheets as PDF.",
  );
const unreadable = () =>
  new HttpError(
    422,
    "This document could not be read safely. Open it in Word or Excel and save a fresh DOCX/XLSX copy, or export it as PDF.",
  );
const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function decodeText(buffer: Buffer): string {
  try {
    let text: string;
    if (buffer[0] === 0xff && buffer[1] === 0xfe)
      text = new TextDecoder("utf-16le", { fatal: true }).decode(buffer);
    else if (buffer[0] === 0xfe && buffer[1] === 0xff)
      text = new TextDecoder("utf-16be", { fatal: true }).decode(buffer);
    else text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (text.includes("\0")) throw unreadable();
    return text;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      415,
      "Please save text documents with UTF-8 or UTF-16 encoding, or export them as PDF.",
    );
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++)
    n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

/** Check both declared and actual inflation before handing untrusted ZIPs to Office parsers. */
function officeArchive(buffer: Buffer): Record<string, Uint8Array> {
  if (buffer.length > MAX_DOCUMENT_BYTES) throw tooLarge();
  if (buffer.readUInt32LE(0) !== 0x04034b50)
    throw new HttpError(
      415,
      "This is not a readable DOCX or XLSX file. Older, password-protected or encrypted files should be exported as PDF or a new unprotected DOCX/XLSX copy.",
    );
  let end = -1;
  for (
    let i = buffer.length - 22;
    i >= Math.max(0, buffer.length - 65_557);
    i--
  ) {
    if (
      buffer.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + buffer.readUInt16LE(i + 20) === buffer.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) throw unreadable();
  const count = buffer.readUInt16LE(end + 10),
    directorySize = buffer.readUInt32LE(end + 12),
    directoryOffset = buffer.readUInt32LE(end + 16);
  if (
    buffer.readUInt16LE(end + 4) ||
    buffer.readUInt16LE(end + 6) ||
    buffer.readUInt16LE(end + 8) !== count ||
    count === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  )
    throw unreadable();
  if (count > MAX_OFFICE_ENTRIES) throw tooLarge();
  if (directoryOffset + directorySize !== end) throw unreadable();
  let offset = directoryOffset,
    declaredTotal = 0,
    actualTotal = 0;
  const files: Record<string, Uint8Array> = Object.create(null);
  const ranges: [number, number][] = [];
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50)
      throw unreadable();
    const flags = buffer.readUInt16LE(offset + 8),
      method = buffer.readUInt16LE(offset + 10),
      crc = buffer.readUInt32LE(offset + 16),
      compressed = buffer.readUInt32LE(offset + 20),
      expanded = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28),
      extraLength = buffer.readUInt16LE(offset + 30),
      commentLength = buffer.readUInt16LE(offset + 32),
      localOffset = buffer.readUInt32LE(offset + 42);
    if (flags & 1)
      throw new HttpError(
        415,
        "Password-protected or encrypted Office documents cannot be read. Upload an unprotected copy or export the relevant pages as PDF.",
      );
    if (
      ![0, 8].includes(method) ||
      nameLength > 1024 ||
      offset + 46 + nameLength + extraLength + commentLength > end
    )
      throw unreadable();
    const name = decodeText(
      buffer.subarray(offset + 46, offset + 46 + nameLength),
    );
    if (
      !name ||
      name.includes("\\") ||
      name.startsWith("/") ||
      name.split("/").includes("..") ||
      Object.hasOwn(files, name)
    )
      throw unreadable();
    if (/vbaProject|macroEnabled/i.test(name))
      throw new HttpError(
        415,
        "Macro-enabled documents are not supported. Save a macro-free DOCX/XLSX copy or export as PDF.",
      );
    declaredTotal += expanded;
    if (
      expanded > MAX_ENTRY_BYTES ||
      declaredTotal > MAX_OFFICE_UNCOMPRESSED_BYTES ||
      (expanded > 1024 * 1024 && expanded > Math.max(compressed, 1) * 200)
    )
      throw tooLarge();
    if (
      localOffset + 30 > directoryOffset ||
      buffer.readUInt32LE(localOffset) !== 0x04034b50 ||
      buffer.readUInt16LE(localOffset + 6) !== flags ||
      buffer.readUInt16LE(localOffset + 8) !== method
    )
      throw unreadable();
    const localNameLength = buffer.readUInt16LE(localOffset + 26),
      localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength,
      stop = start + compressed;
    if (
      stop > directoryOffset ||
      start < localOffset ||
      !buffer
        .subarray(localOffset + 30, localOffset + 30 + localNameLength)
        .equals(buffer.subarray(offset + 46, offset + 46 + nameLength))
    )
      throw unreadable();
    if (ranges.some(([from, to]) => localOffset < to && stop > from))
      throw unreadable();
    ranges.push([localOffset, stop]);
    let actual = 0,
      checksum = 0xffffffff;
    const chunks: Buffer[] = [];
    const consume = (chunk: Uint8Array) => {
      actual += chunk.length;
      actualTotal += chunk.length;
      if (
        actual > expanded ||
        actual > MAX_ENTRY_BYTES ||
        actualTotal > MAX_OFFICE_UNCOMPRESSED_BYTES
      )
        throw tooLarge();
      for (const byte of chunk)
        checksum = crcTable[(checksum ^ byte) & 255] ^ (checksum >>> 8);
      chunks.push(Buffer.from(chunk));
    };
    if (method === 0) consume(buffer.subarray(start, stop));
    else {
      const inflater = new Inflate((chunk) => consume(chunk));
      // Small chunks bound a single inflation allocation even when ZIP sizes lie.
      for (let cursor = start; cursor < stop; cursor += 1024)
        inflater.push(
          buffer.subarray(cursor, Math.min(stop, cursor + 1024)),
          cursor + 1024 >= stop,
        );
      if (compressed === 0) throw unreadable();
    }
    if (actual !== expanded || (checksum ^ 0xffffffff) >>> 0 !== crc)
      throw unreadable();
    files[name] = Buffer.concat(chunks);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== end || !files["[Content_Types].xml"]) throw unreadable();
  return files;
}

type XmlHooks = {
  open?: (name: string, attributes: Record<string, string>) => void;
  close?: (name: string) => void;
  text?: (value: string) => void;
};
function readXml(xml: string, hooks: XmlHooks = {}) {
  if (xml.length > MAX_XML_CHARS) throw tooLarge();
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw unreadable();
  const parser = new Parser();
  let depth = 0,
    nodes = 0;
  parser.on("error", () => {
    throw unreadable();
  });
  parser.on("warn", () => {
    throw unreadable();
  });
  parser.on(
    "openTag",
    (
      name: string,
      getAttributes: () => Record<string, string>,
      decode: (value: string) => string,
    ) => {
      if (++depth > 128 || ++nodes > 100_000) throw tooLarge();
      const attributes: Record<string, string> = Object.create(null);
      for (const [key, value] of Object.entries(getAttributes()))
        attributes[key] = decode(value);
      hooks.open?.(name, attributes);
    },
  );
  parser.on("closeTag", (name: string) => {
    hooks.close?.(name);
    depth--;
  });
  parser.on("text", (value: string, decode: (value: string) => string) =>
    hooks.text?.(decode(value)),
  );
  parser.on("cdata", (value: string) => hooks.text?.(value));
  parser.parse(xml);
  if (depth !== 0) throw unreadable();
}

const localName = (name: string) => name.split(":").at(-1)!;
function columnNumber(letters: string) {
  return [...letters].reduce(
    (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
    0,
  );
}
function columnName(value: number): string {
  let result = "";
  for (; value > 0; value = Math.floor((value - 1) / 26))
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

/** Replace unavailable formula results only in the extraction copy, never the original. */
function inspectSheet(xml: string): {
  xml: string;
  changed: boolean;
  cells: number;
  matrix: number;
} {
  let cell: {
    attributes: Record<string, string>;
    parts: string[];
    formula: boolean;
    inValue: boolean;
    value: string;
  } | null = null;
  let cells = 0,
    rows = 0,
    maxRow = 0,
    maxColumn = 0,
    changed = false;
  const output: string[] = [];
  const append = (value: string) => (cell ? cell.parts : output).push(value);
  readXml(xml, {
    open(name, attributes) {
      const local = localName(name);
      if (local === "row") {
        rows++;
        const row = attributes.r ? Number(attributes.r) : rows;
        if (!Number.isInteger(row) || row < 1 || row > 5000 || rows > 5000)
          throw tooLarge();
        maxRow = Math.max(maxRow, row);
      }
      if (local === "c") {
        if (cell) throw unreadable();
        if (++cells > MAX_SPREADSHEET_CELLS) throw spreadsheetLimit("cells");
        const address = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(attributes.r ?? "");
        if (!address) throw unreadable();
        const column = columnNumber(address[1]),
          row = Number(address[2]);
        if (column > 256 || row > 5000) throw tooLarge();
        maxRow = Math.max(maxRow, row);
        maxColumn = Math.max(maxColumn, column);
        if (maxRow * maxColumn > MAX_EXPANDED_MATRIX_CELLS) throw tooLarge();
        cell = {
          attributes,
          parts: [],
          formula: false,
          inValue: false,
          value: "",
        };
      }
      if (cell && local === "f") cell.formula = true;
      if (cell && local === "v") cell.inValue = true;
      append(
        `<${name}${Object.entries(attributes)
          .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
          .join("")}>`,
      );
    },
    close(name) {
      append(`</${name}>`);
      if (cell && localName(name) === "v") cell.inValue = false;
      if (localName(name) === "c" && cell) {
        const complete = cell;
        cell = null;
        if (
          (complete.formula && !complete.value.trim()) ||
          complete.attributes.t === "e"
        ) {
          changed = true;
          const marker =
            complete.attributes.t === "e"
              ? `[Saved spreadsheet error: ${complete.value.trim() || "result unavailable"}]`
              : "[Formula result unavailable: recalculate and save the workbook]";
          output.push(
            `<c r="${escapeXml(complete.attributes.r)}" t="inlineStr"><is><t>${escapeXml(marker)}</t></is></c>`,
          );
        } else output.push(complete.parts.join(""));
      }
    },
    text(value) {
      if (cell?.inValue) {
        if (cell.value.length + value.length > MAX_EXTRACTED_TEXT_CHARS)
          throw tooLarge();
        cell.value += value;
      }
      append(escapeXml(value));
    },
  });
  return { xml: output.join(""), changed, cells, matrix: maxRow * maxColumn };
}

/** The downstream reader follows relationship targets; validate those exact parts. */
function spreadsheetTargets(files: Record<string, Uint8Array>): string[] {
  const ids: string[] = [];
  const names = new Set<string>();
  readXml(decodeText(Buffer.from(files["xl/workbook.xml"])), {
    open(name, attributes) {
      if (localName(name) !== "sheet") return;
      const id = Object.entries(attributes).find(([key]) =>
        key.endsWith(":id"),
      )?.[1];
      if (
        !id ||
        ["__proto__", "prototype", "constructor"].includes(id) ||
        ids.includes(id) ||
        !attributes.name ||
        attributes.name.length > 300 ||
        names.has(attributes.name.toLowerCase())
      )
        throw unreadable();
      ids.push(id);
      names.add(attributes.name.toLowerCase());
      if (ids.length > MAX_SPREADSHEET_SHEETS) throw spreadsheetLimit("sheets");
    },
  });
  if (!ids.length || !files["xl/_rels/workbook.xml.rels"]) throw unreadable();
  const targets = new Map<string, string>();
  const relationIds = new Set<string>();
  readXml(decodeText(Buffer.from(files["xl/_rels/workbook.xml.rels"])), {
    open(name, attributes) {
      if (localName(name) !== "Relationship") return;
      if (!attributes.Id || relationIds.has(attributes.Id)) throw unreadable();
      relationIds.add(attributes.Id);
      if (
        !/^http:\/\/(?:schemas\.openxmlformats\.org\/officeDocument\/2006|purl\.oclc\.org\/ooxml\/officeDocument)\/relationships\/worksheet$/.test(
          attributes.Type ?? "",
        )
      )
        return;
      if (
        attributes.TargetMode?.toLowerCase() === "external" ||
        !attributes.Target
      )
        throw unreadable();
      const target = attributes.Target.startsWith("/")
        ? attributes.Target.slice(1)
        : `xl/${attributes.Target}`;
      if (!/^xl\/worksheets\/[^/]+\.xml$/i.test(target) || !files[target])
        throw unreadable();
      targets.set(attributes.Id, target);
    },
  });
  const paths = ids.map((id) => targets.get(id));
  if (paths.some((path) => !path) || new Set(paths).size !== paths.length)
    throw unreadable();
  return paths as string[];
}

function boundedText(value: string) {
  if (value.length > MAX_EXTRACTED_TEXT_CHARS) throw tooLarge();
  if (!value.trim())
    throw new HttpError(
      422,
      "No readable text was found. Scanned images or embedded objects should be exported as PDF, or upload their original images.",
    );
  return value;
}

export async function extractDocumentText(
  buffer: Buffer,
  format: DocumentFormat,
): Promise<string> {
  try {
    if (buffer.length > MAX_DOCUMENT_BYTES) throw tooLarge();
    if (format.kind === "text") return boundedText(decodeText(buffer));
    if (!["docx", "xlsx"].includes(format.kind))
      throw new HttpError(415, "This format is not a text document.");
    if (buffer.length < 22) throw unreadable();
    const files = officeArchive(buffer);
    for (const [name, content] of Object.entries(files))
      if (/\.(?:xml|rels)$/i.test(name))
        readXml(decodeText(Buffer.from(content)));
    const contentTypes = new Map<string, string>();
    readXml(decodeText(Buffer.from(files["[Content_Types].xml"])), {
      open(name, attributes) {
        if (/macroEnabled|vbaProject/i.test(attributes.ContentType ?? ""))
          throw new HttpError(
            415,
            "Macro-enabled documents are not supported. Save a macro-free DOCX/XLSX copy or export as PDF.",
          );
        if (
          localName(name) === "Override" &&
          attributes.PartName &&
          attributes.ContentType
        ) {
          if (contentTypes.has(attributes.PartName)) throw unreadable();
          contentTypes.set(attributes.PartName, attributes.ContentType);
        }
      },
    });
    if (format.kind === "docx") {
      if (
        !files["word/document.xml"] ||
        contentTypes.get("/word/document.xml") !==
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
      )
        throw unreadable();
      const result = await mammoth.extractRawText({ buffer });
      if (result.messages.some((message) => message.type === "error"))
        throw unreadable();
      return boundedText(
        `WORD TEXT EXTRACT (unverified). Text and table contents are included; original formatting, drawings, embedded objects and images are not preserved. Use the original document/PDF for layout and visual evidence.\n\n${boundedText(result.value)}`,
      );
    }
    if (
      !files["xl/workbook.xml"] ||
      contentTypes.get("/xl/workbook.xml") !==
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
    )
      throw unreadable();
    const sheets = spreadsheetTargets(files);
    let cells = 0,
      matrix = 0,
      changed = false;
    for (const name of sheets) {
      const inspected = inspectSheet(decodeText(Buffer.from(files[name])));
      cells += inspected.cells;
      matrix += inspected.matrix;
      if (cells > MAX_SPREADSHEET_CELLS) throw spreadsheetLimit("cells");
      if (matrix > MAX_EXPANDED_MATRIX_CELLS) throw tooLarge();
      if (inspected.changed) {
        files[name] = Buffer.from(inspected.xml);
        changed = true;
      }
    }
    const extractionCopy = changed
      ? Buffer.from(zipSync(files, { level: 1 }))
      : buffer;
    const workbook = await readXlsxFile(extractionCopy, {
      trim: false,
      parseNumber: (number) => number,
    });
    if (workbook.length > MAX_SPREADSHEET_SHEETS)
      throw spreadsheetLimit("sheets");
    const output = [
      "EXCEL TEXT EXTRACT (unverified). Sheet names and cell addresses identify saved values. Formula results are cached values from the last save, are not recalculated or verified, and may be stale. Unavailable formula results are labelled. Formatting, charts, images and embedded objects are not included.",
    ];
    let size = output[0].length,
      useful = false;
    for (const sheet of workbook) {
      const heading = `\nSHEET: ${sheet.sheet}`;
      output.push(heading);
      size += heading.length;
      for (let row = 0; row < sheet.data.length; row++) {
        const values: string[] = [];
        let rowSize = 16;
        for (let column = 0; column < sheet.data[row].length; column++) {
          const value = sheet.data[row][column];
          if (value === null || value === undefined) continue;
          const text =
            value instanceof Date ? value.toISOString() : String(value);
          if (size + rowSize + text.length + 16 > MAX_EXTRACTED_TEXT_CHARS)
            throw tooLarge();
          rowSize += text.length + 16;
          values.push(`${columnName(column + 1)}${row + 1}: ${text}`);
        }
        if (!values.length) continue;
        useful = true;
        const line = `Row ${row + 1} | ${values.join(" | ")}`;
        size += line.length + 1;
        if (size > MAX_EXTRACTED_TEXT_CHARS) throw tooLarge();
        output.push(line);
      }
    }
    if (!useful)
      throw new HttpError(
        422,
        "No readable spreadsheet values were found. Recalculate and save the workbook, or export the relevant sheets as PDF.",
      );
    return boundedText(output.join("\n"));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw unreadable();
  }
}
