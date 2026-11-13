import { describe, it, expect } from "vitest";
import {
  parseAuthConfirmationHash,
  safeAuthReturnPath,
  opportunityIdFromParams,
} from "../src/lib/auth-links";
const org = "6a03978d-6266-46b6-b35e-bf8069e50743";
const grant = "6a03978d-6266-46b6-b35e-bf8069e50744";
describe("Simple Grants authentication return links", () => {
  it("preserves legacy opportunity links as canonical grant destinations", () => {
    const next = `/?view=opportunities&org=${org}&opportunity=${grant}`;
    expect(safeAuthReturnPath(next)).toBe(
      `/?view=opportunities&org=${org}&grant=${grant}`,
    );
    expect(opportunityIdFromParams(new URLSearchParams(next.slice(2)))).toBe(
      grant,
    );
    const hash = new URLSearchParams({ token_hash: "a".repeat(56), next });
    expect(parseAuthConfirmationHash(`#${hash}`)?.next).toBe(
      `/?view=opportunities&org=${org}&grant=${grant}`,
    );
  });
  it("rejects conflicting or repeated opportunity aliases", () => {
    expect(
      safeAuthReturnPath(
        `/?view=opportunities&org=${org}&grant=${grant}&opportunity=${org}`,
      ),
    ).toBe(`/?view=opportunities&org=${org}`);
    expect(
      opportunityIdFromParams(
        new URLSearchParams(`opportunity=${grant}&opportunity=${grant}`),
      ),
    ).toBeNull();
    expect(
      opportunityIdFromParams(
        new URLSearchParams(`grant=${grant}&opportunity=${grant}`),
      ),
    ).toBe(grant);
    expect(
      opportunityIdFromParams(
        new URLSearchParams("opportunity=//untrusted.invalid"),
      ),
    ).toBeNull();
  });
  it("preserves a grant deep link while dropping credentials and unknown params", () => {
    expect(
      safeAuthReturnPath(
        `/?view=opportunities&org=${org}&grant=${grant}&access_token=secret&redirect_to=https://evil.invalid#refresh_token=secret`,
      ),
    ).toBe(`/?view=opportunities&org=${org}&grant=${grant}`);
  });
  it.each([
    "https://evil.invalid",
    "//evil.invalid",
    "/\\evil.invalid",
    "/auth/confirm?next=//evil.invalid",
    "/../admin",
    "/\n/evil.invalid",
    "javascript:alert(1)",
    null,
  ])("rejects unsafe return target %s", (value) =>
    expect(safeAuthReturnPath(value)).toBe("/"),
  );
  it("drops invalid or ambiguous portal parameters", () => {
    expect(safeAuthReturnPath("/?view=admin&org=not-a-uuid&grant=x")).toBe("/");
    expect(safeAuthReturnPath("/?view=inbox&view=projects")).toBe("/");
  });
  it("parses only a fixed email confirmation fragment and validates its return", () => {
    const token = "a".repeat(56);
    const params = new URLSearchParams({
      token_hash: token,
      next: `/?view=opportunities&org=${org}`,
    });
    expect(parseAuthConfirmationHash("#" + params)).toEqual({
      tokenHash: token,
      next: `/?view=opportunities&org=${org}`,
    });
    expect(
      parseAuthConfirmationHash(
        "#" +
          new URLSearchParams({
            token_hash: token,
            next: "https://evil.invalid",
          }),
      ),
    ).toEqual({ tokenHash: token, next: "/" });
  });
  it.each([
    "#token_hash=short",
    "#token_hash=" + "a".repeat(56) + "&type=recovery",
    "#token_hash=" + "a".repeat(56) + "&token_hash=" + "b".repeat(56),
    "?token_hash=" + "a".repeat(56),
    "#access_token=old-session",
  ])("rejects malformed, ambiguous and other auth flows", (hash) =>
    expect(parseAuthConfirmationHash(hash)).toBeNull(),
  );
});
