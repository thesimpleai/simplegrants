import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ generateJSON: vi.fn() }));
vi.mock("../netlify/functions/lib/gemini", () => ({
  generateJSON: mocked.generateJSON,
}));
import { applicationPreflight } from "../netlify/functions/lib/preflight";
beforeEach(() => mocked.generateJSON.mockReset());
afterEach(() => vi.restoreAllMocks());
const source =
  "If the activity involves children, public liability insurance is required.";
describe("compact preflight rule expansion", () => {
  it.each([
    {
      rule: "required",
      mandatory: true,
      conditional: false,
      condition_applies: true,
    },
    {
      rule: "conditional_applies",
      mandatory: true,
      conditional: true,
      condition_applies: true,
    },
    {
      rule: "conditional_unknown",
      mandatory: true,
      conditional: true,
      condition_applies: null,
    },
    {
      rule: "not_applicable",
      mandatory: true,
      conditional: true,
      condition_applies: false,
    },
    {
      rule: "optional",
      mandatory: false,
      conditional: false,
      condition_applies: true,
    },
  ])(
    "preserves the signed requirement meaning for $rule",
    async ({ rule, ...flags }) => {
      mocked.generateJSON.mockResolvedValue({
        documents: [
          {
            category: "insurance",
            label: "public liability insurance",
            source_quote: source,
            rule,
          },
        ],
        information: [],
      });
      const result = await applicationPreflight(
        source,
        { application_questions: "Describe the activity" },
        "",
        [],
      );
      expect(result.requirements.documents[0]).toMatchObject(flags);
      expect(result.blockers.length).toBe(
        ["optional", "not_applicable"].includes(rule) ? 0 : 1,
      );
      expect(mocked.generateJSON.mock.calls[0][3].maxOutputTokens).toBe(6144);
    },
  );
  it("retains critical and missing flags rather than turning supplied facts into blockers", async () => {
    mocked.generateJSON.mockResolvedValue({
      documents: [],
      information: [
        {
          field: "budget",
          label: "project budget",
          source_quote: "A project budget is mandatory.",
          rule: "required",
          critical: true,
          missing: false,
        },
      ],
    });
    const result = await applicationPreflight(
      "A project budget is mandatory.",
      {
        application_questions: "Provide the budget",
        budget_notes: "Tools: $1,000",
      },
      "",
      [],
    );
    expect(result.blockers).toEqual([]);
    expect(result.requirements.information[0]).toMatchObject({
      critical: true,
      missing: false,
      mandatory: true,
    });
  });
});
