import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_RECEIPT_MAX_AGE_MS } from "../src/lib/ai-job-timing";
import { grantImportPreviewSchema } from "../src/lib/grant-import";
import { geminiOutputSchema } from "../netlify/functions/lib/gemini-schema";

const mocks = vi.hoisted(() => ({
  authenticatedDb: vi.fn(),
  organisation: vi.fn(),
  documentParts: vi.fn(),
  generateJSON: vi.fn(),
  importOpportunity: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../netlify/functions/lib/db", async (original) => ({
  ...(await original<typeof import("../netlify/functions/lib/db")>()),
  authenticatedDb: mocks.authenticatedDb,
  organisation: mocks.organisation,
}));
vi.mock("../netlify/functions/lib/gemini", async (original) => ({
  ...(await original<typeof import("../netlify/functions/lib/gemini")>()),
  documentParts: mocks.documentParts,
  generateJSON: mocks.generateJSON,
  importOpportunity: mocks.importOpportunity,
}));
import handler from "../netlify/functions/ai";
const orgId = "7ffef246-d7aa-4b32-b537-ae2a5beed290";
const fileId = "77ec10d1-4003-4669-b60b-6204fee143b3";
const otherId = "8cd2fa03-d12d-4b88-882d-51de0248988b";
const fieldDefaults = {
  funder: "",
  summary: "",
  source_url: "",
  amount_min: null,
  amount_max: null,
  opens_on: null,
  closes_at: null,
  closing_date: null,
  location: "",
  focus_areas: [],
  requirements: [],
};
const candidate = (title: string, fields: Record<string, unknown> = {}) => ({
  ...fieldDefaults,
  title,
  ...fields,
});
type Row = Record<string, unknown> & { id: string; org_id: string };
let rows: Row[],
  writes: Row[][],
  actor: string,
  readPages: number[],
  dbReads: string[],
  writeFailures: boolean;
const db = {
  rpc: mocks.rpc,
  from(table: string) {
    expect(table).toBe("opportunities");
    let owner: string;
    const query = {
      select: () => query,
      eq: (key: string, value: string) => {
        expect(key).toBe("org_id");
        owner = value;
        return query;
      },
      order: () => query,
      range: async (start: number, end: number) => {
        dbReads.push(owner);
        readPages.push(start);
        return {
          data: rows
            .filter((row) => row.org_id === owner)
            .slice(start, end + 1),
          error: null,
        };
      },
      upsert: (batch: Row[], options: unknown) => {
        expect(options).toEqual({ onConflict: "id", ignoreDuplicates: true });
        return {
          select: async () => {
            writes.push(batch);
            if (writeFailures)
              return {
                data: null,
                error: { message: "Unable to insert batch" },
              };
            const inserted = batch.filter(
              (row) => !rows.some((existing) => existing.id === row.id),
            );
            rows.push(...inserted);
            return { data: inserted, error: null };
          },
        };
      },
    };
    return query;
  },
};
function call(body: Record<string, unknown>, async = false) {
  return handler(
    new Request("https://portal.example.org/api/ai", {
      method: "POST",
      headers: {
        Authorization: "Bearer example",
        ...(async ? { "X-Simple-Grants-Async": "1" } : {}),
      },
      body: JSON.stringify({ action: "import-grant", orgId, ...body }),
    }),
  );
}
async function preview(
  values: ReturnType<typeof candidate>[],
  options: Record<string, unknown> = {},
) {
  mocks.generateJSON.mockResolvedValueOnce({
    importCandidates: values,
    has_more: false,
  });
  const response = await call({
    importStage: "preview",
    text: "A grant research report.",
    ...options,
  });
  expect(response.status).toBe(200);
  return grantImportPreviewSchema.parse(await response.json());
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GEMINI_API_KEY", "model-key");
  vi.stubEnv(
    "AUTH_RATE_LIMIT_SECRET",
    "a3be6647af5c4d4aa917230e56a11388fa56ef60",
  );
  rows = [];
  writes = [];
  dbReads = [];
  readPages = [];
  actor = "member-one";
  writeFailures = false;
  mocks.authenticatedDb.mockImplementation(async () => ({
    db,
    user: { id: actor },
  }));
  mocks.organisation.mockImplementation(async (_, id) => ({ id }));
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.documentParts.mockResolvedValue({
    parts: [],
    documents: [],
    documentTexts: new Map(),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("authenticated bulk report import", () => {
  it("extracts only the supplied sources into a structured, read-only preview and keeps reported links and deadline uncertainty", async () => {
    const url = "https://funder.org.au/round-2027";
    const text =
      "Reported deadline: 2027-07-19. See " +
      url +
      ". Later round closes on 1 November 2027 at 5 pm AEDT.";
    const file = {
      id: fileId,
      name: "Grant research.txt",
      category: "grant_research",
    };
    const parts = [{ text: "document material" }];
    mocks.documentParts.mockResolvedValue({
      parts,
      documents: [file],
      documentTexts: new Map([[fileId, "document material"]]),
    });
    const result = await preview(
      [
        candidate("Arts grant", {
          source_url: url,
          closes_at: "2027-07-19T23:59:00+10:00",
          closing_date: "2027-07-19",
          deadline_text: "2027-07-19",
          guidelines_document_index: 1,
          guidelines_text: "model-supplied summary",
        }),
        candidate("Arts Grant", { closing_date: "2027-07-19" }),
        candidate("Arts grant", {
          source_url: "https://invented.org.au/",
          closing_date: "2027-11-01",
          closes_at: "2027-11-01T17:00:00+11:00",
          deadline_text: "1 November 2027 at 5 pm AEDT",
        }),
        candidate("Other program", {
          source_url: "javascript:alert(2)",
          opens_on: "2027-02-30",
        }),
      ],
      { text, documentIds: [fileId] },
    );
    expect(mocks.documentParts.mock.calls[0][2]).toEqual([fileId]);
    const [prompt, attached, , config] = mocks.generateJSON.mock.calls[0];
    expect(prompt).toContain(text);
    expect(attached).toEqual(parts);
    expect(geminiOutputSchema(config.schema)).toHaveProperty(
      "properties.importCandidates.items.properties.title",
    );
    expect(result.importCandidates).toHaveLength(3);
    expect(result.importCandidates[0]).toMatchObject({
      source_url: url,
      closes_at: null,
      closing_date: "2027-07-19",
      guidelines_text: "",
      summary: "",
    });
    expect(result.importCandidates[1]).toMatchObject({
      closes_at: "2027-11-01T06:00:00.000Z",
      source_url: "",
    });
    expect(result.importCandidates[2]).toMatchObject({
      opens_on: null,
      source_url: "",
      funder: "",
    });
    expect(result.importNotes?.join(" ")).toMatch(/repeated/i);
    expect(writes).toHaveLength(0);
    expect(dbReads).toHaveLength(0);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("copies full matching guidelines only from readable, explicitly selected guidelines documents", async () => {
    const guideline =
      "Local Creators Grant\nOfficial guidelines\nApplicants must create public art in the council area.";
    const rich = { id: fileId, name: "guidelines.txt", category: "guidelines" };
    mocks.documentParts.mockResolvedValue({
      parts: [{ text: guideline }],
      documents: [rich],
      documentTexts: new Map([[fileId, guideline]]),
    });
    const result = await preview(
      [
        candidate("Local Creators Grant", { guidelines_document_index: 1 }),
        candidate("Regional Cycling Grant", { guidelines_document_index: 1 }),
      ],
      { text: "", documentIds: [fileId] },
    );
    expect(result.importCandidates.map((row) => row.guidelines_text)).toEqual([
      guideline,
      "",
    ]);
  });
  it("bounds previews, reports overflow and supports zero grants", async () => {
    expect((await preview([])).importCandidates).toEqual([]);
    const result = await preview(
      Array.from({ length: 23 }, (_, i) => candidate(`Programme ${i + 1}`)),
    );
    expect(result.importCandidates).toHaveLength(20);
    expect(result.importNotes?.join(" ")).toMatch(/first 20/);
    mocks.generateJSON.mockResolvedValueOnce({
      importCandidates: [candidate("Program")],
      has_more: true,
    });
    expect(
      (await (await call({ importStage: "preview", text: "report" })).json())
        .importNotes[0],
    ).toContain("remaining entries");
  });
  it("rejects missing source material before model access and keeps the old single-import action", async () => {
    expect((await call({ importStage: "preview" })).status).toBe(422);
    expect(
      (await call({ importStage: "preview", text: "x".repeat(40001) })).status,
    ).toBe(413);
    expect(mocks.generateJSON).not.toHaveBeenCalled();
    mocks.importOpportunity.mockResolvedValueOnce({
      opportunities: [{ id: "legacy" }],
    });
    const legacy = await call({
      text: "Full official guidelines for the legacy single-grant workflow.",
    });
    expect(await legacy.json()).toMatchObject({
      opportunities: [{ id: "legacy" }],
    });
  });
  it("binds all candidates to the actor, organisation and issue time, and validates selected indices before writing", async () => {
    const result = await preview([candidate("Arts"), candidate("Play")]);
    const request = { ...result, importStage: "save", selectedIndexes: [0] };
    expect(
      (
        await call({
          ...request,
          importCandidates: [
            { ...result.importCandidates[0], title: "Changed" },
            result.importCandidates[1],
          ],
        })
      ).status,
    ).toBe(409);
    expect((await call({ ...request, orgId: otherId })).status).toBe(409);
    actor = "member-two";
    expect((await call(request)).status).toBe(409);
    actor = "member-one";
    for (const indexes of [[], [0, 0], [2]])
      expect(
        (await call({ ...request, selectedIndexes: indexes })).status,
      ).toBe(422);
    vi.useFakeTimers();
    vi.setSystemTime(result.stageIssuedAt + AI_RECEIPT_MAX_AGE_MS + 1);
    expect((await call(request)).status).toBe(409);
    expect(writes).toEqual([]);
    expect(dbReads).toEqual([]);
  });
  it("saves a selection in one batch, ignores concurrent replays and preserves existing archived grants and rounds", async () => {
    const saved = {
      id: fileId,
      org_id: orgId,
      title: "Arts Fund",
      funder: "State",
      status: "archived",
      source_url: "https://prior.org.au/",
      provenance: {
        method: "google_search_grounding",
        closing_date: "2027-01-12",
      },
      opens_on: null,
      closes_at: null,
    };
    rows = [
      structuredClone(saved),
      { ...saved, id: otherId, org_id: otherId, title: "Other State Program" },
    ];
    const review = await preview([
      candidate("ARTS FUND", { funder: "State", closing_date: "2027-01-12" }),
      candidate("Arts Fund", { funder: "State", closing_date: "2027-06-04" }),
      candidate("Other State Program"),
      candidate("Unchecked grant"),
    ]);
    vi.stubEnv("GEMINI_API_KEY", "");
    const save = () =>
      call(
        { ...review, importStage: "save", selectedIndexes: [0, 1, 2] },
        true,
      );
    const responses = await Promise.all([save(), save()]);
    for (const response of responses) expect(response.status).toBe(200);
    const results = await Promise.all(responses.map((r) => r.json()));
    expect(results.map((r) => r.importedCount).sort()).toEqual([0, 2]);
    expect(results.map((r) => r.duplicateCount).sort()).toEqual([1, 3]);
    expect(rows.find((row) => row.id === fileId)).toEqual(saved);
    expect(rows.map((row) => row.title)).not.toContain("Unchecked grant");
    expect(
      rows.filter((row) => ![otherId, fileId].includes(row.id)),
    ).toMatchObject([
      {
        title: "Arts Fund",
        guidelines_text: "",
        closes_at: null,
        provenance: {
          closing_date: "2027-06-04",
          date_review_required: true,
          method: "user_import",
          source_verified: false,
          eligibility_verified: false,
        },
      },
      { title: "Other State Program", org_id: orgId },
    ]);
    expect(await (await save()).json()).toMatchObject({
      importedCount: 0,
      duplicateCount: 3,
      opportunities: [],
    });
    expect(writes.every((batch) => batch.length === 2)).toBe(true);
    expect(mocks.generateJSON).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.documentParts).toHaveBeenCalledTimes(1);
  });
  it("recognises existing grants beyond the first page and can retry an unsuccessful insert", async () => {
    rows = Array.from({ length: 201 }, (_, i) => ({
      id: `prior-${i}`,
      org_id: orgId,
      title: `Grant ${i}`,
      funder: "",
      provenance: {},
      opens_on: null,
      closes_at: null,
    }));
    const review = await preview([
      candidate("Grant 200"),
      candidate("New grant"),
    ]);
    const save = () =>
      call({ ...review, importStage: "save", selectedIndexes: [0, 1] });
    writeFailures = true;
    const failed = await save();
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(rows).toHaveLength(201);
    writeFailures = false;
    expect(await (await save()).json()).toMatchObject({
      importedCount: 1,
      duplicateCount: 1,
    });
    expect(readPages).toContain(200);
  });
});
