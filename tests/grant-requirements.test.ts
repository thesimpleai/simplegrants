import { describe, expect, it } from "vitest";
import {
  draftEvidenceBlockers,
  explicitlyRequiresInsurance,
} from "../src/lib/grant-requirements";
import { draftBlockers } from "../netlify/functions/lib/core";
import type { Opportunity, Organisation } from "../src/types";

describe("explicit insurance requirements from original guidelines", () => {
  it.each([
    "Applications without current insurance are ineligible.",
    "Applicants must hold current public liability insurance.",
    "Proof of current insurance is required with this application.",
    "No application will be accepted without public liability cover.",
    "Audited statements are optional, but insurance is mandatory.",
  ])("blocks absent insurance before a model call: %s", (guidelines) => {
    expect(draftEvidenceBlockers(guidelines, [])).toHaveLength(1);
  });

  it.each([
    "Insurance is optional. Audits are not required.",
    "We do not require insurance for this program.",
    "No insurance is required.",
    "Insurance is not compulsory.",
    "Insurance is not necessarily required.",
    "Applicants must not upload insurance records.",
    "Insurance must not be submitted with an application.",
    "Insurance is recommended but not mandatory.",
    "If activities involve children, insurance is required.",
    "If activities involve children:\ninsurance is required.",
    "Insurance is required only if activities involve children.",
    "Applicants without insurance are eligible.",
  ])(
    "leaves optional or conditional decisions to preflight: %s",
    (guidelines) => {
      expect(explicitlyRequiresInsurance(guidelines)).toBe(false);
    },
  );

  it("checks insurance presence and local expiry without treating another category as insurance", () => {
    const source = "Current public liability insurance is mandatory.";
    const now = new Date("2026-11-10T13:30:00Z"); // 11 November in Melbourne.
    expect(
      draftEvidenceBlockers(
        source,
        [{ category: "insurance", expires_on: "2026-11-11" }],
        now,
      ),
    ).toEqual([]);
    expect(
      draftEvidenceBlockers(
        source,
        [{ category: "insurance", expires_on: "2026-11-10" }],
        now,
      ),
    ).toHaveLength(1);
    expect(
      draftEvidenceBlockers(
        source,
        [{ category: "financial", expires_on: null }],
        now,
      ),
    ).toHaveLength(1);
    expect(
      draftEvidenceBlockers(
        source,
        [{ category: "insurance", expires_on: "invalid" }],
        now,
      ),
    ).toHaveLength(1);
    expect(
      draftEvidenceBlockers(
        source,
        [{ category: "insurance", expires_on: null }],
        now,
      ),
    ).toEqual([]);
  });

  it("server draft readiness uses the original source even when the imported requirements list is empty", () => {
    const org = { verification_status: "approved" } as Organisation;
    const grant = {
      guidelines_text:
        "The program funds local activities. Applications without current insurance are ineligible. Audited statements are optional.",
      requirements: [],
    } as unknown as Opportunity;
    expect(draftBlockers(org, grant, [])).toEqual([
      "The current guidelines require insurance. Upload a current insurance document before preparing a draft.",
    ]);
  });
});
