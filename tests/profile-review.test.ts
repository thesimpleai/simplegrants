import { describe, expect, it } from "vitest";
import { completeProfileReview } from "../netlify/functions/lib/profile-review";
import {
  ORGANISATION_TYPES,
  organisationType,
  profileValues,
} from "../src/lib/profile-values";
const extracted = {
  name: "社區協會 Community Association",
  abn: "51824753556",
  state: "Victoria",
  description: "Supports local Chinese and English speaking community members.",
  focus_areas: ["Community support"],
  type: "Incorporated Association",
};
describe("profile source coverage and correction omissions", () => {
  it("preserves populated extraction values omitted without a finding, with explicit review checks", () => {
    const result = completeProfileReview(
      extracted,
      {
        name: extracted.name,
        abn: "",
        state: "",
        description: "",
        focus_areas: [],
      },
      [{ field: "website", issue: "No website in the source" }],
      [],
    );
    expect(result.profile).toMatchObject({
      ...extracted,
      state: "VIC",
      type: "Incorporated association",
    });
    for (const field of ["abn", "state", "description", "focus_areas"])
      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field,
            issue: expect.stringContaining("unconfirmed draft"),
          }),
        ]),
      );
  });
  it("does not restore facts rejected by verification and keeps the finding when correction omits it", () => {
    const result = completeProfileReview(
      extracted,
      { name: extracted.name },
      [{ field: "ABN", issue: "ABN is unsupported by these originals" }],
      [],
    );
    expect(result.profile.abn).toBeUndefined();
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "ABN",
          issue: expect.stringContaining("unsupported"),
        }),
      ]),
    );
  });
  it("flags every absent field instead of returning an apparently complete sparse profile", () => {
    const result = completeProfileReview(
      { name: "Community" },
      { name: "Community" },
      [],
      [],
    );
    for (const field of [
      "abn",
      "state",
      "description",
      "focus_areas",
      "website",
    ])
      expect(result.checks.some((check) => check.field === field)).toBe(true);
  });
  it("honours combined and general findings when a correction removes values", () => {
    for (const field of ["ABN and state", "profile"]) {
      const result = completeProfileReview(
        extracted,
        { name: extracted.name },
        [
          {
            field,
            issue: "These values cannot be supported from the originals",
          },
        ],
        [],
      );
      expect(result.profile.abn).toBeUndefined();
      expect(result.profile.state).toBeUndefined();
    }
  });
  it("does not restore a rejected nested field path or bypass an unknown finding scope", () => {
    const nested = completeProfileReview(
      extracted,
      { name: extracted.name },
      [{ field: "profile.abn", issue: "Unsupported" }],
      [],
    );
    expect(nested.profile.abn).toBeUndefined();
    const unknown = completeProfileReview(
      extracted,
      { name: extracted.name },
      [
        {
          field: "unmapped source finding",
          issue: "Source evidence remains disputed",
        },
      ],
      [],
    );
    expect(unknown.profile.abn).toBeUndefined();
    expect(unknown.profile.description).toBeUndefined();
  });
  it.each([
    "Incorporated Association",
    " incorporated association ",
    "Incorporated Assn",
  ])("maps %s to one fixed entity option", (type) => {
    expect(organisationType(type)).toBe("Incorporated association");
    expect(
      ORGANISATION_TYPES.filter(
        (value) => value.toLowerCase() === "incorporated association",
      ),
    ).toHaveLength(1);
  });
  it("does not infer charity status from an unknown entity type or a blank value", () => {
    expect(organisationType("")).toBe("");
    expect(organisationType("Unlisted legal structure")).toBe("Other");
    expect(profileValues({ name: "Community", state: "NSW" }).state).toBe(
      "NSW",
    );
  });
});
