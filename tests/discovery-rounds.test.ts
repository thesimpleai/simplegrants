import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
}));
import { discoverOpportunities } from "../netlify/functions/lib/gemini";
import type { AppDb } from "../netlify/functions/lib/db";
import type { Opportunity, Organisation } from "../src/types";
const org = {
  id: "org-1",
  name: "Community Club",
  state: "Victoria",
  description: "Community workshops",
  focus_areas: ["Community"],
} as Organisation;
const sourceUrl = "https://www.grants.gov.au/current-community-round";
let rows: Opportunity[],
  inserts: Record<string, unknown>[],
  updates: Record<string, unknown>[];
function saved(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "saved-round",
    org_id: org.id,
    title: "Community Grants",
    funder: "Provider",
    source_url: sourceUrl,
    summary: "Old summary",
    guidelines_text:
      "Saved original guidelines linked to existing applications",
    opens_on: "2026-01-01",
    closes_at: "2026-01-31T06:00:00.000Z",
    amount_min: 1000,
    amount_max: 5000,
    location: "Victoria",
    focus_areas: [],
    requirements: [],
    match_score: null,
    status: "saved",
    provenance: { reviewed_by_user: true },
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}
function fresh(overrides: Record<string, unknown> = {}) {
  return {
    title: "Community Grants",
    funder: "Current Provider",
    summary: "New source-backed summary",
    source_index: 0,
    opens_on: "2027-01-01",
    closes_at: "2027-01-31T17:00:00+11:00",
    amount_min: 2000,
    amount_max: 10000,
    location: "Victoria",
    focus_areas: ["Community"],
    requirements: [],
    ...overrides,
  };
}
function response(grant: ReturnType<typeof fresh>) {
  mocks.generateContent.mockResolvedValueOnce({
    text: "Current search evidence for Community Grants.",
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: [
            { web: { title: "Official grant page", uri: sourceUrl } },
          ],
        },
      },
    ],
  });
  mocks.generateContent.mockResolvedValueOnce({
    text: JSON.stringify({ opportunities: [grant] }),
  });
}
function db(): AppDb {
  return {
    from(table: string) {
      if (table !== "opportunities") throw new Error("Unexpected table");
      const filters: [string, unknown][] = [];
      let operation: "select" | "insert" | "update" = "select",
        patch: Record<string, unknown> = {};
      const selected = () =>
        rows
          .filter((row) =>
            filters.every(
              ([key, value]) => row[key as keyof Opportunity] === value,
            ),
          )
          .sort((a, b) =>
            String(b.created_at).localeCompare(String(a.created_at)),
          );
      function execute(single: boolean) {
        if (operation === "insert") {
          inserts.push(structuredClone(patch));
          const row = {
            ...patch,
            id: `new-round-${inserts.length}`,
            created_at: new Date().toISOString(),
          } as unknown as Opportunity;
          rows.push(row);
          return { data: structuredClone(single ? row : [row]), error: null };
        }
        const matches = selected();
        if (operation === "update") {
          updates.push(structuredClone(patch));
          rows = rows.map((row) =>
            matches.some((match) => match.id === row.id)
              ? ({ ...row, ...patch } as Opportunity)
              : row,
          );
        }
        const result =
          operation === "update"
            ? rows.filter((row) => matches.some((match) => match.id === row.id))
            : matches;
        return {
          data: structuredClone(single ? result[0] : result),
          error: null,
        };
      }
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        insert: (value: Record<string, unknown>) => {
          operation = "insert";
          patch = value;
          return chain;
        },
        update: (value: Record<string, unknown>) => {
          operation = "update";
          patch = value;
          return chain;
        },
        single: async () => execute(true),
        then: (resolve: (value: ReturnType<typeof execute>) => unknown) =>
          Promise.resolve(execute(false)).then(resolve),
      };
      return chain;
    },
  } as unknown as AppDb;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T00:00:00Z"));
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  rows = [];
  inserts = [];
  updates = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("source-backed discovery round preservation", () => {
  it("creates a new 2027 round instead of rewriting a closed 2026 round, then repeats idempotently", async () => {
    const historical = saved();
    rows = [structuredClone(historical)];
    response(fresh());
    const first = await discoverOpportunities(db(), org);
    expect(first.opportunities).toHaveLength(1);
    const newId = first.opportunities[0].id;
    expect(newId).not.toBe(historical.id);
    expect(first.opportunities[0]).toMatchObject({
      guidelines_text: "",
      status: "open",
      closes_at: "2027-01-31T06:00:00.000Z",
      provenance: {
        previous_round_id: historical.id,
        guidelines_required: true,
      },
    });
    expect(rows.find((row) => row.id === historical.id)).toEqual(historical);
    response(fresh({ summary: "Refreshed current round description" }));
    const second = await discoverOpportunities(db(), org);
    expect(second.opportunities[0].id).toBe(newId);
    expect(second.opportunities[0].summary).toBe(
      "Refreshed current round description",
    );
    expect(rows).toHaveLength(2);
    expect(inserts).toHaveLength(1);
    expect(rows.find((row) => row.id === historical.id)).toEqual(historical);
  });
  it("refreshes same-round public facts while preserving human guidelines, saved status and known dates", async () => {
    const current = saved({
      opens_on: "2027-01-01",
      closes_at: "2027-01-31T06:00:00.000Z",
    });
    rows = [current];
    response(fresh());
    const result = await discoverOpportunities(db(), org);
    expect(result.opportunities[0]).toMatchObject({
      id: current.id,
      summary: "New source-backed summary",
      funder: "Current Provider",
      amount_max: 10000,
      guidelines_text: current.guidelines_text,
      status: "saved",
      opens_on: current.opens_on,
      closes_at: current.closes_at,
    });
    expect(updates[0]).not.toHaveProperty("status");
    expect(updates[0]).not.toHaveProperty("guidelines_text");
    expect(inserts).toHaveLength(0);
  });
  it("does not re-advertise an archived round in returned search results or digest input", async () => {
    const archived = saved({
      opens_on: "2027-01-01",
      closes_at: "2027-01-31T06:00:00.000Z",
      status: "archived",
    });
    rows = [archived];
    response(fresh());
    const result = await discoverOpportunities(db(), org);
    expect(result.opportunities).toEqual([]);
    expect(rows[0].status).toBe("archived");
    expect(rows[0].guidelines_text).toBe(archived.guidelines_text);
    expect(inserts).toHaveLength(0);
  });
  it("preserves a known date and flags an ambiguous overlapping change instead of asserting a new round", async () => {
    const current = saved({
      opens_on: "2027-01-01",
      closes_at: "2027-01-31T06:00:00.000Z",
    });
    rows = [current];
    response(fresh({ closes_at: "2027-02-28T17:00:00+11:00" }));
    const result = await discoverOpportunities(db(), org);
    expect(result.opportunities[0].id).toBe(current.id);
    expect(result.opportunities[0].closes_at).toBe(current.closes_at);
    expect(result.opportunities[0].provenance).toMatchObject({
      date_review_required: true,
      proposed_round_dates: { closes_at: "2027-02-28T06:00:00.000Z" },
    });
    expect(result.message).toContain("need review");
    expect(inserts).toHaveLength(0);
  });
  it("does not invent a midnight UTC opening to split overlapping Australian calendar dates", async () => {
    const current = saved({
      opens_on: "2026-11-01",
      closes_at: "2026-11-10T23:00:00.000Z",
    });
    rows = [current];
    response(fresh({ opens_on: "2026-11-11", closes_at: null }));
    const result = await discoverOpportunities(db(), org);
    expect(inserts).toHaveLength(0);
    expect(result.opportunities[0].id).toBe(current.id);
    expect(result.opportunities[0].provenance.date_review_required).toBe(true);
    expect(rows[0].closes_at).toBe(current.closes_at);
  });
  it.each([false, true])(
    "keeps established dates when new dates are unknown; expired=%s is never advertised as current",
    async (expired) => {
      const current = expired
        ? saved()
        : saved({
            opens_on: "2027-01-01",
            closes_at: "2027-01-31T06:00:00.000Z",
          });
      rows = [current];
      response(fresh({ opens_on: null, closes_at: null }));
      const result = await discoverOpportunities(db(), org);
      expect(rows[0].opens_on).toBe(current.opens_on);
      expect(rows[0].closes_at).toBe(current.closes_at);
      expect(rows[0].guidelines_text).toBe(current.guidelines_text);
      expect(rows[0].status).toBe("saved");
      expect(rows[0].provenance.date_review_required).toBe(true);
      expect(result.opportunities).toHaveLength(expired ? 0 : 1);
      expect(inserts).toHaveLength(0);
    },
  );
});
