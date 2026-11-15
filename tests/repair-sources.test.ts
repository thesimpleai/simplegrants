import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolve: vi.fn(),
  write: vi.fn(),
}));
vi.mock("../netlify/functions/lib/db", () => ({
  authenticatedDb: mocks.auth,
  checked: (value: any) => {
    if (value.error) throw Error("db failed");
    return value.data;
  },
}));
vi.mock("../netlify/functions/lib/source-links", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../netlify/functions/lib/source-links")
  >()),
  resolveSourceLink: mocks.resolve,
}));
import repair from "../netlify/functions/repair-sources";
import { HttpError } from "../netlify/functions/lib/core";
const orgId = "e00418c4-03ed-436f-8e2b-8095af7667af";
const old =
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/older-link";
const canonical = "https://www.opengardensvictoria.org.au/grants";
let rows: any[], concurrent: boolean;
function database() {
  return {
    from(table: string) {
      expect(table).toBe("opportunities");
      let patch: unknown;
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        like: () => chain,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return chain;
        },
        update: (value: unknown) => {
          patch = value;
          return chain;
        },
        then: (resolve: (value: unknown) => unknown) => {
          if (patch) mocks.write({ patch, filters });
          return Promise.resolve({
            data: patch ? (concurrent ? [] : [{ id: "grant" }]) : rows,
            error: null,
          }).then(resolve);
        },
      };
      return chain;
    },
  };
}
const request = () =>
  new Request("https://simplegrants.com.au/api/repair-sources", {
    method: "POST",
    headers: { Authorization: "Bearer session" },
    body: JSON.stringify({ orgId }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  concurrent = false;
  rows = [
    {
      id: "grant",
      org_id: orgId,
      source_url: old,
      provenance: {
        method: "google_search_grounding",
        sources: [{ uri: old, title: "Original citation" }],
        source_verified: false,
      },
    },
  ];
  mocks.auth.mockResolvedValue({ db: database(), user: { id: "actor" } });
  mocks.resolve.mockResolvedValue(canonical);
});
afterEach(() => vi.restoreAllMocks());
describe("repair saved discovery sources without AI", () => {
  it("updates the canonical URL while retaining citations and original redirect", async () => {
    expect(await (await repair(request())).json()).toEqual({
      repaired: 1,
      unresolved: 0,
      hasMore: false,
    });
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), orgId, true);
    const { patch, filters } = mocks.write.mock.calls[0][0];
    expect(Object.keys(patch).sort()).toEqual(["provenance", "source_url"]);
    expect(patch.source_url).toBe(canonical);
    expect(patch.provenance).toMatchObject({
      source_verified: false,
      previous_source_url: old,
      sources: [
        { uri: canonical, grounding_uri: old, title: "Original citation" },
      ],
    });
    expect(filters).toMatchObject({
      org_id: orgId,
      id: "grant",
      source_url: old,
      provenance: JSON.stringify(rows[0].provenance),
    });
  });
  it("keeps an unresolved link and does not overwrite a concurrent edit", async () => {
    mocks.resolve.mockResolvedValueOnce(null);
    expect(await (await repair(request())).json()).toMatchObject({
      repaired: 0,
      unresolved: 1,
    });
    expect(mocks.write).not.toHaveBeenCalled();
    concurrent = true;
    expect(await (await repair(request())).json()).toMatchObject({
      repaired: 0,
      unresolved: 1,
    });
  });
  it("rejects a viewer or unauthorised organisation before reading or resolving sources", async () => {
    mocks.auth.mockRejectedValue(new HttpError(403, "Forbidden"));
    expect((await repair(request())).status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
