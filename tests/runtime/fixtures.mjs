import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
export const orgId = "e00418c4-03ed-436f-8e2b-8095af7667af";
export const actorId = "02ce9446-8d6e-4b72-909a-106e7ce124ba";
export const grantId = "7b766b0e-4e32-4e3e-b0a5-75b1ee07b59e";
export const appId = "47d7c7ee-0452-44e5-a8db-fde758371aed";
export const sourceText =
  "Runtime Community Association is a fictional incorporated association based in Victoria. It serves local families through community gardening workshops. It is not a registered charity and no ABN is supplied. Community served: local families in Victoria. 服務維多利亞州家庭。";
export const profile = {
  name: "Runtime Community Association",
  type: "Incorporated association",
  state: "VIC",
  description: "Community gardening workshops for local families in Victoria.",
  focus_areas: ["Community"],
};
export const org = {
  id: orgId,
  ...profile,
  abn: null,
  profile: {
    ...profile,
    mission: "Help local families build confidence through gardening.",
  },
  verification_status: "approved",
  notification_frequency: "never",
  inbox_alias: "runtime-test",
  created_at: "2026-11-01T00:00:00Z",
};
export const grant = {
  id: grantId,
  org_id: orgId,
  title: "Fictional runtime grant",
  funder: "Fictional test provider",
  amount_min: null,
  amount_max: 2000,
  opens_on: null,
  closes_at: null,
  source_url: "",
  guidelines_text:
    "Applicants must describe their organisation and the community served, explain the evidence of project need, describe the activity plan and supply a project budget. Answer the project description question in no more than 80 words. All facts and figures must be supplied by the applicant.",
  summary: "A fictional program used only for software testing.",
  location: "VIC",
  focus_areas: ["Community"],
  requirements: [],
  status: "open",
  match_score: null,
  provenance: { method: "user_import" },
};
export const application = {
  id: appId,
  org_id: orgId,
  opportunity_id: grantId,
  title: "Two gardening workshops",
  status: "draft",
  draft: {},
  updated_at: "2026-11-01T00:00:00Z",
  project_details: {
    summary:
      "Two gardening workshops for 20 local families. In a fictional survey of 20 families, 15 requested gardening activities. Staff will run two workshops in the community garden, with attendance recorded. This is supplied fictional project evidence, not independently verified.",
    application_questions:
      "Describe the project, its need and the activity plan (maximum 80 words).",
    budget_notes:
      "Two workshop kits at $500 each, total $1,000 requested. Budget!D2 is the supplied saved total. FormulaChecks contains deliberately broken optional examples; these are not part of the project budget.",
    source_document_ids: [],
  },
};
const docx = zipSync(
  Object.fromEntries(
    Object.entries({
      "[Content_Types].xml":
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "_rels/.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${sourceText}</w:t></w:r></w:p></w:body></w:document>`,
    }).map(([path, text]) => [path, strToU8(text)]),
  ),
);
const xlsx = zipSync(
  Object.fromEntries(
    Object.entries({
      "[Content_Types].xml":
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      "_rels/.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      "xl/workbook.xml":
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="FormulaChecks" sheetId="2" r:id="rId2"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
      "xl/worksheets/sheet1.xml":
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Workshop kits</t></is></c><c r="B1" t="inlineStr"><is><t>Quantity</t></is></c><c r="C1" t="inlineStr"><is><t>Unit cost</t></is></c><c r="D1" t="inlineStr"><is><t>Saved total</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Kits</t></is></c><c r="B2"><v>2</v></c><c r="C2"><v>500</v></c><c r="D2"><f>B2*C2</f><v>1000</v></c></row></sheetData></worksheet>',
      "xl/worksheets/sheet2.xml":
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Optional formula checks, excluded from the project budget</t></is></c></row><row r="2"><c r="A2"><f>1+2</f></c><c r="B2" t="e"><f>1/0</f><v>#DIV/0!</v></c></row></sheetData></worksheet>',
    }).map(([path, text]) => [path, strToU8(text)]),
  ),
);
const publicHistoryParts = unzipSync(xlsx);
publicHistoryParts["xl/workbook.xml"] = strToU8(
  strFromU8(publicHistoryParts["xl/workbook.xml"]).replace(
    'name="Budget"',
    'name="PublicHistory"',
  ),
);
publicHistoryParts["xl/worksheets/sheet1.xml"] = strToU8(
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Organisation</t></is></c><c r="B1" t="inlineStr"><is><t>State</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Runtime Community Association</t></is></c><c r="B2" t="inlineStr"><is><t>VIC</t></is></c></row></sheetData></worksheet>',
);
const publicHistory = zipSync(publicHistoryParts);
function sourcePDF() {
  const lines = [
    "Runtime Community Association",
    "Fictional incorporated association in Victoria.",
    "Community gardening workshops for local families.",
  ];
  const content = `BT /F1 12 Tf 50 740 Td ${lines.map((line, index) => `${index ? "0 -20 Td " : ""}(${line}) Tj`).join(" ")} ET`;
  const parts = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  parts.forEach((part, index) => {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${part}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(text);
}
export const evidence = [
  {
    id: "78cb3d4b-7498-43b2-9be2-38bbd14d3981",
    name: "PublicHistory.xlsx",
    mime_type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: publicHistory,
  },
  {
    id: "e38cb8af-9e8c-4465-ac27-3069941bdfca",
    name: "Charter.pdf",
    mime_type: "application/pdf",
    bytes: sourcePDF(),
  },
  {
    id: "7046bed6-1610-4834-9d06-430bda956fcc",
    name: "History.txt",
    mime_type: "text/plain",
    bytes: strToU8(sourceText),
  },
  {
    id: "cb9934ea-4ac7-4c85-b2aa-a55aec00c392",
    name: "Charter.docx",
    mime_type:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: docx,
  },
  {
    id: "e34fd8d7-c910-4b92-895f-eb1ce4fad72f",
    name: "Budget.xlsx",
    mime_type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: xlsx,
  },
].map((doc) => ({
  ...doc,
  record: {
    id: doc.id,
    org_id: orgId,
    name: doc.name,
    mime_type: doc.mime_type,
    size_bytes: doc.bytes.length,
    category: doc.name === "Budget.xlsx" ? "financial_statement" : "other",
    storage_path: `${orgId}/${doc.id}/${doc.name}`,
    verified: false,
    created_at: "2026-11-01T00:00:00Z",
    expires_on: null,
  },
}));
export function providerReply(body) {
  const properties = body.generationConfig?.responseSchema?.properties;
  let text, groundingMetadata;
  if (body.tools) {
    text =
      "Fictional runtime search opportunity. Confirm dates and eligibility with the provider.";
    groundingMetadata = {
      groundingChunks: [
        {
          web: {
            title: "Fictional source fixture",
            uri: "https://www.grants.gov.au/runtime-test",
          },
        },
      ],
    };
  } else if (properties?.profile)
    text = JSON.stringify({
      profile,
      checks: [],
      evidence: [],
    });
  else if (properties?.recovered_profile)
    text = JSON.stringify({
      checks: [],
      recovered_profile: {},
      evidence: [],
    });
  else if (properties?.documents)
    text = JSON.stringify({ documents: [], information: [] });
  else if (properties?.sections)
    text = JSON.stringify({
      title: "Two gardening workshops",
      sections: [
        {
          question: application.project_details.application_questions,
          answer:
            "Two community gardening workshops will serve 20 local families. A supplied fictional survey found 15 of 20 families requested these activities. Staff will deliver the workshops and record attendance. The requested $1,000 covers two workshop kits at $500 each, using the unverified saved total at Budget!D2.",
          word_limit: 80,
          evidence: [
            "Budget.xlsx Budget!D2: unverified saved formula value 1000",
          ],
          needs_review: true,
        },
      ],
      budget: [
        {
          item: "Workshop kits",
          amount: 1000,
          notes: "Budget!D2 saved value; human review required",
        },
      ],
      missing_information: [
        "FormulaChecks!A2 has no saved value; FormulaChecks!B2 has a formula error. Optional examples excluded from the project budget.",
      ],
      submission_checklist: ["Authorised review of all facts and figures"],
      human_review_required: true,
    });
  else if (properties?.opportunities)
    text = JSON.stringify({
      opportunities: [
        {
          title: "Fictional runtime search opportunity",
          funder: "Fictional source fixture",
          summary:
            "Fictional fixture. Dates and eligibility need confirmation with the provider.",
          source_index: 0,
          amount_min: null,
          amount_max: null,
          opens_on: null,
          closes_at: null,
          location: "VIC",
          focus_areas: ["Community"],
          requirements: [],
        },
      ],
    });
  else throw Error("Unexpected provider schema in runtime test");
  return {
    candidates: [
      {
        content: { role: "model", parts: [{ text }] },
        finishReason: "STOP",
        ...(groundingMetadata ? { groundingMetadata } : {}),
      },
    ],
  };
}
