import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { expect } from "@playwright/test";

const swift = String.raw`
import Foundation
import PDFKit
import Vision

func transcript(_ path: String) throws -> String {
    guard let document = PDFDocument(url: URL(fileURLWithPath: path)) else {
        throw CocoaError(.fileReadCorruptFile)
    }
    return try (0..<document.pageCount).map { number in
        guard let page = document.page(at: number) else { return "" }
        if let text = page.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return text
        }
        let image = page.thumbnail(of: NSSize(width: 1800, height: 2400), for: .mediaBox)
        guard let pixels = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            return ""
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        try VNImageRequestHandler(cgImage: pixels).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }.joined(separator: "\n")
}

let documents = try CommandLine.arguments.dropFirst().map(transcript)
FileHandle.standardOutput.write(try JSONEncoder().encode(documents))
`;

const registrations = [
  "MSC PDF Files/ASIC cert.pdf",
  "MSC PDF Files/Summary of registrations.pdf",
];
const files = [
  ...registrations.map((path) => ({
    path,
    category: "registration",
    label: "Upload ASIC or incorporation documents",
  })),
  {
    path: "ACNC cert.pdf",
    category: "acnc",
    label: "Upload ACNC registration",
  },
  {
    path: "MSC Program Rationale, Outcomes & Evaluation Framework.pdf",
    category: "background",
    label: "Upload organisation background",
  },
  {
    path: "ACNC Application/MSC business plan.docx",
    category: "mission",
    label: "Upload mission or strategy documents",
  },
];

const numberPattern =
  /\b(?:A\.?\s*C\.?\s*N\.?|Australian Company Number)\b[\s:#.-]*(\d(?:[\s.-]*\d){8})(?!\d)/i;
const digits = (text) => text.replace(/\D/g, "");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function loadSafeCircle(directory, publicPdfsOnly = false) {
  const selected = publicPdfsOnly
    ? files.filter(({ path }) => path.endsWith(".pdf"))
    : files;
  const documents = selected.map(({ path, ...details }) => ({
    ...details,
    path: resolve(directory, path),
    name: basename(path),
  }));
  const pdfs = documents.filter(({ path }) => path.endsWith(".pdf"));
  const { stdout } = await promisify(execFile)(
    "/usr/bin/swift",
    ["-e", swift, ...pdfs.map(({ path }) => path)],
    { maxBuffer: 1024 * 1024 },
  );
  const transcriptions = JSON.parse(stdout);
  for (const [index, doc] of pdfs.entries()) {
    const transcript = transcriptions[index];
    assert.ok(transcript.trim(), "Offline OCR should find text in each PDF");
    doc.transcript = transcript;
    doc.suggestions = [];
    if (index === 0) {
      const match = transcript.match(numberPattern);
      assert.ok(
        match,
        "Offline OCR should read the public company number from the ASIC certificate",
      );
      doc.suggestions.push({
        questionKey: "registration_number",
        textValue: match[1].trim(),
        quote: match[0],
        locator: "Page 1",
      });
      doc.registrationNumber = digits(match[1]);
    }
  }
  await Promise.all(
    documents.map(async (doc) => {
      doc.sha256 = sha(await readFile(doc.path));
    }),
  );
  return documents;
}

export function fixtureDocumentFromBytes(documents, inlineData) {
  const digest = sha(Buffer.from(inlineData.data, "base64"));
  return documents?.find(({ sha256 }) => sha256 === digest);
}

export function compactRegistrationExcerpt(documents) {
  return `Australian Company Number ${documents[0].registrationNumber}`;
}

export async function runSafeCircleRounds({
  page,
  url,
  directory,
  documents,
  rows,
  extracts,
  setupEvents,
  transcriptions,
  currentOrg,
  live,
}) {
  const setup = page.getByRole("button", {
    name: "Set up for grants",
    exact: true,
  });
  const wizard = page.getByRole("dialog");
  const registration = wizard.getByRole("group", {
    name: "What is your public incorporation or registration number?",
  });
  const analyse = wizard.getByRole("button", {
    name: "Suggest answers",
  });
  const usingEvidence = setupEvents.length;
  const alreadyTranscribed = transcriptions.length;
  const original = structuredClone(currentOrg());
  async function uploadFile(label, path) {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      wizard.getByRole("button", { name: label, exact: true }).click(),
    ]);
    await chooser.setFiles(path);
  }
  await page.goto(url);
  await setup.click();
  await expect(wizard).toHaveAccessibleName(
    "Set up your organisation for grants",
  );
  if (!live) {
    await uploadFile(
      documents[0].label,
      resolve(directory, "mysafecircleatoletter.pdf"),
    );
    await expect(wizard.getByText(/Maximum file size is 10 MB/)).toBeVisible();
    await expect(analyse).toBeDisabled();
    assert.equal(rows.length, 0);
    assert.equal(setupEvents.length, usingEvidence);
    assert.equal(transcriptions.length, alreadyTranscribed);
    console.log(
      "PASS: The oversized Safe Circle PDF was rejected before storage or AI analysis.",
    );
  }
  const batches = [
    [documents[0], documents[2]],
    [documents[1], ...documents.slice(3)],
  ];
  for (const [index, batch] of batches.entries()) {
    for (const doc of batch) {
      await uploadFile(doc.label, doc.path);
      const selection = wizard.getByRole("checkbox", {
        name: doc.name,
        exact: true,
      });
      await expect(selection).toBeChecked();
      assert.equal(
        rows.find(({ name }) => name === doc.name)?.category,
        doc.category,
      );
    }
    console.log(`Safe Circle round ${index + 1} uploaded its optional files.`);
    if (index === 1) {
      await wizard
        .getByText("Paste public or redacted text", { exact: true })
        .click();
      await wizard
        .getByRole("textbox", { name: "Paste a public or redacted excerpt" })
        .fill(compactRegistrationExcerpt(documents));
    }
    await analyse.click();
    await expect(wizard).toHaveAccessibleName("Review grant setup answers", {
      timeout: live ? 300000 : 30000,
    });
    if (!(await registration.isVisible()))
      await wizard
        .getByText("Legal identity and eligibility", { exact: true })
        .click();
    await expect(registration.getByRole("textbox")).toHaveValue(/\d/);
    assert.ok(
      digits(await registration.getByRole("textbox").inputValue()) ===
        documents[0].registrationNumber,
      "The review should prefill the public company number found on the ASIC certificate",
    );
    await expect(
      registration.getByRole("button", { name: "Use this answer" }),
    ).toHaveCount(0);
    if (index === 0) {
      console.log("PASS: First upload round prefilled the company number.");
      await wizard.getByRole("button", { name: "Back to sources" }).click();
    }
  }
  await registration.getByText("View sources", { exact: true }).click();
  await expect(
    registration.getByText(documents[0].name),
    "The original citation should appear even when it has a page locator",
  ).toBeVisible();
  await expect(
    registration.getByText("Pasted information"),
    "The compact public number should retain its pasted citation",
  ).toBeVisible();
  assert.ok(
    JSON.stringify(currentOrg()) === JSON.stringify(original),
    "The profile should await human approval",
  );
  assert.equal(
    setupEvents
      .slice(usingEvidence)
      .filter(
        ([status, action]) => status === "queued" && action === "setup-source",
      ).length,
    documents.length + 1,
  );
  if (!live)
    assert.equal(
      setupEvents
        .slice(usingEvidence)
        .filter(([, action]) => action === "setup-conflicts").length,
      0,
    );
  assert.equal(transcriptions.length - alreadyTranscribed, 4);
  assert.ok(
    documents.every((doc) =>
      extracts.some(
        (row) => row.source_sha256 === doc.sha256 && row.text.length > 0,
      ),
    ),
    "Read text from all uploaded source files should be retained",
  );
  await wizard
    .getByRole("checkbox", { name: /I’ve checked the answers/ })
    .check();
  await wizard.getByRole("button", { name: "Save reviewed answers" }).click();
  await expect(wizard).toHaveCount(0);
  const saved = currentOrg().profile.grant_setup;
  const answer = saved.answers.registration_number;
  assert.ok(digits(answer.value) === documents[0].registrationNumber);
  const originalId = rows.find(({ name }) => name === documents[0].name)?.id;
  assert.ok(
    answer.sources.some(({ documentId }) => documentId === originalId),
    "The saved answer should retain the uploaded certificate citation",
  );
  assert.ok(
    answer.sources.some(
      ({ sourceLabel }) => sourceLabel === "Pasted information",
    ),
    "The saved answer should retain the pasted citation",
  );
  console.log(
    `PASS: Two Safe Circle browser upload rounds saved ${documents.length} originals and their text, merged equivalent ACNs and retained both sources after review.`,
  );
  if (live) {
    const keysFrom = (category) => {
      const ids = rows
        .filter((row) => row.category === category)
        .map(({ id }) => id);
      return [
        ...new Set(
          saved.evidence
            .filter(({ documentId }) => ids.includes(documentId))
            .map(({ questionKey }) => questionKey),
        ),
      ];
    };
    const charity = keysFrom("acnc");
    const program = keysFrom("background");
    console.log(
      `Live charity certificate fields: ${charity.join(", ") || "none"}.`,
    );
    console.log(
      `Live program framework fields: ${program.join(", ") || "none"}.`,
    );
    assert.ok(
      charity.some((key) =>
        ["acnc_registered", "charity_registration_date"].includes(key),
      ),
      "The ACNC certificate should establish a supported charity answer",
    );
    assert.ok(
      program.some((key) =>
        [
          "mission",
          "description",
          "current_programs",
          "community_need",
          "beneficiaries",
          "focus_areas",
          "evaluation_approach",
        ].includes(key),
      ),
      "The program framework should establish a supported purpose or service answer",
    );
  }
}
