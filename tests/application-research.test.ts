import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  generateJSON: vi.fn(),
  resolveSourceLink: vi.fn(),
}));
vi.mock("../netlify/functions/lib/gemini", () => ({
  generateContent: mocks.generateContent,
  generateJSON: mocks.generateJSON,
  compatibleThinking: () => ({ thinkingBudget: 0 }),
}));
vi.mock("../netlify/functions/lib/source-links", () => ({
  resolveSourceLink: mocks.resolveSourceLink,
  isGroundingRedirect: (url: string) =>
    url.includes("vertexaisearch.cloud.google.com"),
}));
import { researchApplication } from "../netlify/functions/lib/application-research";
import { isApplicationResearch } from "../src/lib/application-research";
import type { Opportunity } from "../src/types";

const source = "https://www.grants.gov.au/current-community-round";
const grant = {
  title: "Community round",
  funder: "Synthetic funder",
  source_url: source,
} as Opportunity;
const suggestions = {
  summary: "Source notes for human review.",
  guidelines_excerpt: "Applicants must provide a project budget.",
  application_questions: "Describe your project (200 words).",
  eligibility: ["Registered not-for-profits"],
  criteria: ["Community benefit"],
  required_attachments: ["Project budget"],
  deadlines: ["Closing time not established"],
  unresolved_questions: ["What is the project's budget?"],
};
function retrieved(url = source, status = "URL_RETRIEVAL_STATUS_SUCCESS") {
  return {
    text: `Official research containing quoted current guidelines and actual questions.\n${suggestions.guidelines_excerpt}\n${suggestions.application_questions}`,
    candidates: [
      {
        urlContextMetadata: {
          urlMetadata: [{ retrievedUrl: url, urlRetrievalStatus: status }],
        },
      },
    ],
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-17T00:00:00Z"));
  mocks.resolveSourceLink.mockImplementation(async (value: string) => value);
  mocks.generateContent.mockResolvedValue(retrieved());
  mocks.generateJSON.mockResolvedValue({
    ...suggestions,
    source_is_official: true,
    official_source_reason:
      "This page identifies the funder administering the current round.",
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("application source research", () => {
  it("uses public grant facts for search and approved profile only in the separate structured pass", async () => {
    const result = await researchApplication(
      grant,
      {
        name: "Synthetic organisation",
        description: "PRIVATE-PROFILE-CANARY",
        bank_account_number: "PRIVATE-BANK-CANARY",
      },
      { summary: "PRIVATE-PROJECT-CANARY" },
    );
    const search = JSON.stringify(mocks.generateContent.mock.calls[0]);
    expect(search).toContain(source);
    expect(search).toContain("Australia/Melbourne");
    expect(search).toContain("2026-11-17");
    expect(search).not.toContain("PRIVATE-PROFILE-CANARY");
    expect(search).not.toContain("PRIVATE-PROJECT-CANARY");
    const structured = mocks.generateJSON.mock.calls[0][0];
    expect(structured).toContain("PRIVATE-PROFILE-CANARY");
    expect(structured).toContain("PRIVATE-PROJECT-CANARY");
    expect(structured).not.toContain("PRIVATE-BANK-CANARY");
    expect(result.sources).toEqual([
      {
        title: "Retrieved funder source — check the current round",
        uri: source,
      },
    ]);
    expect(result).toMatchObject({
      ...suggestions,
      official_source_url: source,
      needs_guidelines_upload: true,
      retrieved_at: "2026-11-17T00:00:00.000Z",
    });
    expect(isApplicationResearch(result)).toBe(true);
  });

  it.each([
    [
      "https://mirror.example.org/copied-guidelines",
      "URL_RETRIEVAL_STATUS_SUCCESS",
    ],
    [source, "URL_RETRIEVAL_STATUS_ERROR"],
    [source, "URL_RETRIEVAL_STATUS_PAYWALL"],
    ["https://evilgrants.gov.au/copied", "URL_RETRIEVAL_STATUS_SUCCESS"],
  ])(
    "returns the actual saved source and upload guidance when retrieval is not authoritative (%s)",
    async (url, status) => {
      mocks.generateContent.mockResolvedValue(retrieved(url, status));
      const result = await researchApplication(grant, {}, {});
      expect(result.guidelines_excerpt).toBe("");
      expect(result.application_questions).toBe("");
      expect(result.official_source_url).toBe(source);
      expect(result.needs_guidelines_upload).toBe(true);
      expect(mocks.generateJSON).not.toHaveBeenCalled();
    },
  );

  it("does not treat search citations alone as retrieved full guidelines", async () => {
    mocks.generateContent.mockResolvedValue({
      text: "Search snippet",
      candidates: [
        { groundingMetadata: { groundingChunks: [{ web: { uri: source } }] } },
      ],
    });
    const result = await researchApplication(grant, {}, {});
    expect(result.guidelines_excerpt).toBe("");
    expect(result.needs_guidelines_upload).toBe(true);
    expect(mocks.generateJSON).not.toHaveBeenCalled();
  });

  it("does not mix a retrieved mirror into official source evidence", async () => {
    const response = retrieved();
    response.candidates[0].urlContextMetadata.urlMetadata.push({
      retrievedUrl: "https://mirror.example.org/copied",
      urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS",
    });
    mocks.generateContent.mockResolvedValue(response);
    const result = await researchApplication(grant, {}, {});
    expect(result.guidelines_excerpt).toBe("");
    expect(mocks.generateJSON).not.toHaveBeenCalled();
  });

  it("rejects a successfully retrieved aggregator when official administrator status is uncertain", async () => {
    mocks.generateJSON.mockResolvedValue({
      ...suggestions,
      source_is_official: false,
      official_source_reason:
        "This source is a directory listing, not an authorised administrator.",
    });
    const result = await researchApplication(grant, {}, {});
    expect(result.official_source_url).toBe("");
    expect(result.summary).toContain("could not be established");
    expect(result.sources).toEqual([
      {
        title: "Saved grant source — official administrator unconfirmed",
        uri: source,
      },
    ]);
    expect(result.guidelines_excerpt).toBe("");
    expect(result.application_questions).toBe("");
  });

  it("discards questions or excerpts the structured pass cannot quote from the research", async () => {
    mocks.generateJSON.mockResolvedValue({
      ...suggestions,
      source_is_official: true,
      official_source_reason: "Official provider page.",
      application_questions: "Invented application question",
      guidelines_excerpt: "Invented complete guidelines",
    });
    const result = await researchApplication(grant, {}, {});
    expect(result.application_questions).toBe("");
    expect(result.guidelines_excerpt).toBe("");
  });

  it.each([
    "",
    "http://www.grants.gov.au/current",
    "https://127.0.0.1/current",
    "https://user:secret@www.grants.gov.au/current",
    "https://service.internal/current",
  ])(
    "never sends an unsafe or absent source to the URL tool (%s)",
    async (source_url) => {
      const result = await researchApplication(
        { ...grant, source_url },
        {},
        {},
      );
      expect(result.official_source_url).toBe("");
      expect(result.sources).toEqual([]);
      expect(mocks.generateContent).not.toHaveBeenCalled();
    },
  );

  it("preserves provider safety controls without making a second call or returning partial text", async () => {
    mocks.generateContent.mockResolvedValue({
      ...retrieved(),
      promptFeedback: { blockReason: "SAFETY" },
    });
    await expect(researchApplication(grant, {}, {})).rejects.toMatchObject({
      reason: "PROVIDER_BLOCKED",
    });
    expect(mocks.generateJSON).not.toHaveBeenCalled();
  });

  it("rejects truncated source research instead of turning it into application facts", async () => {
    mocks.generateContent.mockResolvedValue({
      ...retrieved(),
      candidates: [
        { ...retrieved().candidates[0], finishReason: "MAX_TOKENS" },
      ],
    });
    await expect(researchApplication(grant, {}, {})).rejects.toMatchObject({
      reason: "MODEL_OUTPUT_LIMIT",
    });
    expect(mocks.generateJSON).not.toHaveBeenCalled();
  });

  it("rejects unsafe result links and malformed project questions at the browser boundary", async () => {
    const result = await researchApplication(grant, {}, {});
    expect(
      isApplicationResearch({
        ...result,
        sources: [{ title: "Unsafe", uri: "javascript:alert(1)" }],
      }),
    ).toBe(false);
    expect(
      isApplicationResearch({ ...result, application_questions: ["Invented"] }),
    ).toBe(false);
  });
});
