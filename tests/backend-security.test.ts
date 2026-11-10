import { describe, expect, it } from "vitest";
import {
  draftBlockers,
  periodKey,
  publicEmailAnswer,
  requiredDocumentCategories,
  safeHttpsUrl,
  safePublicReply,
  sourceDeadline,
  stripSensitive,
  validABN,
} from "../netlify/functions/lib/core";
import type { DocumentRecord, Opportunity, Organisation } from "../src/types";
import ai from "../netlify/functions/ai";
import inbound from "../netlify/functions/inbound-email";

const org = {
  id: "6a03978d-6266-46b6-b35e-bf8069e50743",
  name: "Community Example",
  abn: "12345678901",
  verification_status: "approved",
} as Organisation;
const grant = {
  guidelines_text:
    "Official program guidelines. Eligibility and assessment criteria for the program must be read before drafting applications.",
  requirements: [],
} as unknown as Opportunity;
const document = (category: string, expires_on: string | null = null) =>
  ({ category, expires_on }) as DocumentRecord;

describe("draft evidence gates", () => {
  it("blocks absent program guidelines and unapproved organisation facts", () => {
    const blocked = draftBlockers(
      { ...org, verification_status: "review" },
      { ...grant, guidelines_text: "" },
      [],
    );
    expect(blocked).toHaveLength(2);
    expect(blocked.join(" ")).toContain("program guidelines");
  });
  it("does not universally require financial audits", () => {
    expect(
      requiredDocumentCategories([
        "Community impact narrative and project budget",
      ]),
    ).toEqual([]);
    expect(draftBlockers(org, grant, [])).toEqual([]);
  });
  it("requires an audit only where specified, not a plain financial statement", () => {
    const auditGrant = {
      ...grant,
      requirements: ["Audited financial statements are required"],
    };
    expect(
      draftBlockers(org, auditGrant, [document("financial_statement")]),
    ).toHaveLength(1);
    expect(draftBlockers(org, auditGrant, [document("audit_report")])).toEqual(
      [],
    );
  });
  it("checks expiration and accepts audit for a financial statement requirement", () => {
    const insuranceGrant = {
      ...grant,
      requirements: ["Current public liability insurance"],
    };
    expect(
      draftBlockers(
        org,
        insuranceGrant,
        [document("insurance", "2020-01-01")],
        new Date("2026-11-10"),
      ),
    ).toHaveLength(1);
    expect(
      draftBlockers(org, { ...grant, requirements: ["Financial statements"] }, [
        document("audit_report"),
      ]),
    ).toEqual([]);
  });
});

describe("source facts", () => {
  it("never invents a timezone or midnight from incomplete closing dates", () => {
    expect(sourceDeadline("2026-12-01")).toBeNull();
    expect(sourceDeadline("2026-12-01T17:00")).toBeNull();
    expect(sourceDeadline("2026-02-31T17:00:00Z")).toBeNull();
    expect(sourceDeadline("2026-02-29T17:00:00+11:00")).toBeNull();
    expect(sourceDeadline("2028-02-29T17:00:00+11:00")).toBe(
      "2028-02-29T06:00:00.000Z",
    );
    expect(sourceDeadline("2026-12-01T17:00:00+11:00")).toBe(
      "2026-12-01T06:00:00.000Z",
    );
  });
  it("checks the ABN checksum independently of model confidence", () => {
    expect(validABN("51 824 753 556")).toBe(true);
    expect(validABN("12345678901")).toBe(false);
  });
});

describe("scheduled notifications", () => {
  it("uses Melbourne calendar boundaries and stable weekly keys across DST", () => {
    expect(periodKey("monthly", new Date("2026-10-31T14:01:00Z"))).toBe(
      "monthly:2026-11",
    );
    expect(periodKey("weekly", new Date("2026-11-01T13:01:00Z"))).toBe(
      "weekly:2026-11-02",
    );
    expect(periodKey("weekly", new Date("2026-11-08T12:59:00Z"))).toBe(
      "weekly:2026-11-02",
    );
    expect(periodKey("never")).toBeNull();
    expect(periodKey("invalid")).toBeNull();
  });
});

describe("public email and link boundaries", () => {
  it("includes only explicitly supplied public organisation fields in acknowledgements", () => {
    const text = safePublicReply(
      {
        ...org,
        profile: { name: "Community Example", bank_account: "TOPSECRET" },
        confidential: "PRIVATE",
      } as Organisation,
      "https://example.com/portal",
    );
    expect(text).toContain("Community Example");
    expect(text).toContain("12345678901");
    expect(text).not.toContain("TOPSECRET");
    expect(text).not.toContain("PRIVATE");
  });
  it("public email answers exclude private imports, closed grants and all other org fields", () => {
    const grants = [
      {
        id: "public",
        title: "Public opportunity",
        funder: "Public funder",
        source_url: "https://www.grants.gov.au/example",
        closes_at: "2099-01-01T00:00:00Z",
        provenance: { method: "google_search_grounding" },
        private_notes: "TOPSECRET",
      },
      {
        id: "private",
        title: "PRIVATE IMPORT",
        funder: "Hidden",
        source_url: "https://example.com",
        closes_at: null,
        provenance: { method: "user_import" },
      },
      {
        id: "old",
        title: "EXPIRED",
        funder: "Old",
        source_url: "https://example.com",
        closes_at: "2020-01-01T00:00:00Z",
        provenance: { method: "google_search_grounding" },
      },
    ];
    const text = publicEmailAnswer(
      "grants",
      org,
      grants,
      "https://example.com/?org=ORG&view=inbox",
    );
    expect(text).toContain("Public opportunity");
    expect(text).toContain("org=ORG");
    expect(text).toContain("grant=public");
    expect(text).not.toContain("TOPSECRET");
    expect(text).not.toContain("PRIVATE IMPORT");
    expect(text).not.toContain("EXPIRED");
    expect(publicEmailAnswer("help", org, [], "https://example.com")).toContain(
      "please sign in",
    );
  });
  it("strips sensitive keys recursively", () => {
    expect(
      stripSensitive({
        name: "Public",
        nested: {
          bank_account: "secret",
          abn: "public",
          credit_card: "secret",
        },
      }),
    ).toEqual({ name: "Public", nested: { abn: "public" } });
  });
  it("allows source links only, never private-address or script URLs", () => {
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("http://example.com")).toBeNull();
    expect(safeHttpsUrl("https://user:secret@example.com")).toBeNull();
    expect(safeHttpsUrl("https://127.0.0.1")).toBeNull();
    expect(safeHttpsUrl("https://www.grants.gov.au/")).toBe(
      "https://www.grants.gov.au/",
    );
  });
});

describe("endpoint security before integration access", () => {
  it("rejects AI calls without authentication before calling any model", async () => {
    const response = await ai(
      new Request("https://example.com/api/ai", {
        method: "POST",
        body: JSON.stringify({ orgId: org.id, action: "discover" }),
      }),
    );
    expect(response.status).toBe(401);
  });
  it("rejects unsigned inbound messages before reading Resend or Supabase", async () => {
    const response = await inbound(
      new Request("https://example.com/api/inbound-email", {
        method: "POST",
        body: JSON.stringify({
          type: "email.received",
          data: { email_id: "fake" },
        }),
      }),
    );
    expect(response.status).toBe(401);
  });
  it("rejects mutation endpoints called by GET", async () => {
    expect((await ai(new Request("https://example.com/api/ai"))).status).toBe(
      405,
    );
    expect(
      (await inbound(new Request("https://example.com/api/inbound-email")))
        .status,
    ).toBe(405);
  });
});
