import { describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  extractDocumentText,
  MAX_EXTRACTED_TEXT_CHARS,
} from "../netlify/functions/lib/document-text";
import { resolveDocumentFormat } from "../src/lib/document-formats";
const format = (name: string) => resolveDocumentFormat({ name })!;
const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rels = "http://schemas.openxmlformats.org/package/2006/relationships";
function zip(files: Record<string, string>) {
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, value]) => [name, strToU8(value)]),
      ),
    ),
  );
}
function docxFiles(text = "Community Club Incorporated") {
  return {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>ABN</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>51824753556</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
  };
}
function xlsxFiles(
  cells = '<row r="1"><c r="A1" t="inlineStr"><is><t>Program</t></is></c><c r="B1" t="inlineStr"><is><t>Budget</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Workshops</t></is></c><c r="B2"><f>SUM(B3:B4)</f><v>1250.50</v></c></row><row r="3"><c r="A3" t="str"><f>CONCAT(A1,A2)</f></c><c r="B3"><f>SUM(B4:B5)</f></c></row>',
) {
  return {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${main}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget &amp; costs" sheetId="1" r:id="rId1"/><sheet name="History" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${main}"><sheetData>${cells}</sheetData></worksheet>`,
    "xl/worksheets/sheet2.xml": `<worksheet xmlns="${main}"><sheetData><row r="2"><c r="C2" t="inlineStr"><is><t>Founded 1990</t></is></c></row></sheetData></worksheet>`,
  };
}

describe("bounded Office and text extraction", () => {
  it("reads actual DOCX paragraphs and table text with layout-loss notice", async () => {
    const result = await extractDocumentText(
      zip(docxFiles()),
      format("registration.docx"),
    );
    expect(result).toContain("Community Club Incorporated");
    expect(result).toContain("51824753556");
    expect(result).toContain(
      "formatting, drawings, embedded objects and images are not preserved",
    );
  });
  it("preserves XLSX sheets/cell coordinates and cached/missing formula results without recalculation", async () => {
    const original = zip(xlsxFiles());
    const unchanged = Buffer.from(original);
    const result = await extractDocumentText(original, format("budget.xlsx"));
    expect(result).toContain("SHEET: Budget & costs");
    expect(result).toContain("B2: 1250.50");
    expect(result).toContain("A3: [Formula result unavailable");
    expect(result).toContain("B3: [Formula result unavailable");
    expect(result).toContain("C2: Founded 1990");
    expect(result).toContain("not recalculated or verified");
    expect(result).not.toContain("CONCAT(");
    expect(original).toEqual(unchanged);
  });
  it("labels empty cached formulas and spreadsheet errors while preserving cached zero", async () => {
    const cells =
      '<row r="1"><c r="A1"><f>SUM(B1)</f><v/></c><c r="B1"><f>SUM(B2)</f><v></v></c><c r="C1" t="e"><f>1/0</f><v>#DIV/0!</v></c><c r="D1"><f>1-1</f><v>0</v></c></row>';
    const result = await extractDocumentText(
      zip(xlsxFiles(cells)),
      format("budget.xlsx"),
    );
    expect(result).toContain("A1: [Formula result unavailable");
    expect(result).toContain("B1: [Formula result unavailable");
    expect(result).toContain("C1: [Saved spreadsheet error: #DIV/0!]");
    expect(result).toContain("D1: 0");
  });
  it("decodes UTF-8 and BOM-marked UTF-16 while keeping HTML/XML as evidence text", async () => {
    expect(
      await extractDocumentText(
        Buffer.from("<p>Organisation &amp; history</p>"),
        format("history.html"),
      ),
    ).toBe("<p>Organisation &amp; history</p>");
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("Community support", "utf16le"),
    ]);
    expect(await extractDocumentText(utf16, format("history.txt"))).toBe(
      "Community support",
    );
    await expect(
      extractDocumentText(
        Buffer.from([0xff, 0x80, 0x11]),
        format("history.txt"),
      ),
    ).rejects.toMatchObject({ status: 415 });
  });
  it("rejects oversize text rather than silently truncating evidence", async () => {
    await expect(
      extractDocumentText(
        Buffer.from("x".repeat(MAX_EXTRACTED_TEXT_CHARS + 1)),
        format("history.txt"),
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("includes the DOCX extraction notice in the full output character limit", async () => {
    // The raw text fits the limit, but adding the required conversion notice
    // would exceed it. Reject the whole document rather than truncating it.
    await expect(
      extractDocumentText(
        zip(docxFiles("x".repeat(MAX_EXTRACTED_TEXT_CHARS - 100))),
        format("history.docx"),
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("rejects missing/mislabelled, malformed and encrypted Office documents with safe errors", async () => {
    await expect(
      extractDocumentText(
        Buffer.from("not an Office file"),
        format("file.docx"),
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      extractDocumentText(zip(xlsxFiles()), format("file.docx")),
    ).rejects.toMatchObject({ status: 422 });
    const encrypted = zip(docxFiles());
    encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6);
    const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    encrypted.writeUInt16LE(
      encrypted.readUInt16LE(central + 8) | 1,
      central + 8,
    );
    await expect(
      extractDocumentText(encrypted, format("file.docx")),
    ).rejects.toMatchObject({ status: 415 });
  });
  it("rejects ZIP bombs, excessive entries, lying inflation sizes and unsafe paths", async () => {
    await expect(
      extractDocumentText(
        zip({ ...docxFiles(), "word/media/bomb": "a".repeat(2 * 1024 * 1024) }),
        format("file.docx"),
      ),
    ).rejects.toMatchObject({ status: 413 });
    const many = Object.fromEntries(
      Array.from({ length: 513 }, (_, index) => [`file${index}`, "a"]),
    );
    await expect(
      extractDocumentText(
        zip({ ...docxFiles(), ...many }),
        format("file.docx"),
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      extractDocumentText(
        zip({ ...docxFiles(), "../outside": "bad" }),
        format("file.docx"),
      ),
    ).rejects.toMatchObject({ status: 422 });
    const lying = zip(docxFiles("A".repeat(100_000)));
    let central = lying.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    while (central >= 0) {
      const length = lying.readUInt16LE(central + 28);
      if (
        lying.subarray(central + 46, central + 46 + length).toString() ===
        "word/document.xml"
      ) {
        lying.writeUInt32LE(20, central + 24);
        break;
      }
      central = lying.indexOf(
        Buffer.from([0x50, 0x4b, 0x01, 0x02]),
        central + 4,
      );
    }
    await expect(
      extractDocumentText(lying, format("file.docx")),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("rejects external entities, macros and excessive spreadsheet coordinates before parser allocation", async () => {
    const external = docxFiles();
    external["word/document.xml"] =
      '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///private-secret">]><x>&secret;</x>';
    await expect(
      extractDocumentText(zip(external), format("file.docx")),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      extractDocumentText(
        zip({ ...docxFiles(), "word/vbaProject.bin": "macro" }),
        format("file.docx"),
      ),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      extractDocumentText(
        zip(xlsxFiles('<row r="1048576"><c r="XFD1048576"><v>1</v></c></row>')),
        format("file.xlsx"),
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("rejects worksheet relationship target bypasses and excessive declared sheets before library parsing", async () => {
    const custom = xlsxFiles();
    custom["xl/_rels/workbook.xml.rels"] = custom[
      "xl/_rels/workbook.xml.rels"
    ].replace("worksheets/sheet1.xml", "custom.xml");
    const files = {
      ...custom,
      "xl/custom.xml": `<worksheet xmlns="${main}"><sheetData><row r="1048576"><c r="XFD1048576"><v>1</v></c></row></sheetData></worksheet>`,
    };
    await expect(
      extractDocumentText(zip(files), format("file.xlsx")),
    ).rejects.toMatchObject({ status: 422 });
    const repeated = xlsxFiles();
    repeated["xl/workbook.xml"] =
      `<workbook xmlns="${main}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${Array.from({ length: 21 }, (_, index) => `<sheet name="Sheet${index}" sheetId="${index}" r:id="rId${index}"/>`).join("")}</sheets></workbook>`;
    await expect(
      extractDocumentText(zip(repeated), format("file.xlsx")),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("rejects repeated large shared strings before materializing oversized row output", async () => {
    const files: Record<string, string> = xlsxFiles(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>0</v></c></row>',
    );
    const largeString = "x".repeat(110_000);
    files["xl/sharedStrings.xml"] =
      `<sst xmlns="${main}"><si><t>${largeString}</t></si></sst>`;
    files["xl/_rels/workbook.xml.rels"] = files[
      "xl/_rels/workbook.xml.rels"
    ].replace(
      "</Relationships>",
      `<Relationship Id="shared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    );
    await expect(
      extractDocumentText(zip(files), format("file.xlsx")),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("never follows external document links or exposes parser payloads", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected external call"));
    const files = {
      ...docxFiles(),
      "word/_rels/document.xml.rels": `<Relationships xmlns="${rels}"><Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://outside.example/private" TargetMode="External"/></Relationships>`,
    };
    await extractDocumentText(zip(files), format("file.docx"));
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
    const broken = docxFiles();
    broken["word/document.xml"] = "<SECRET-PRIVATE-DATA><broken>";
    await expect(
      extractDocumentText(zip(broken), format("file.docx")),
    ).rejects.not.toThrow("SECRET-PRIVATE-DATA");
  });
});
