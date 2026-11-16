import { describe, expect, it } from "vitest";
import handler from "../netlify/functions/ai";
// Netlify calls v2 handlers with (Request, Context), including background and
// scheduled functions. This must exercise the public export, not executeAI.
const context = {
  requestId: "runtime-boundary",
  account: { id: "test-account" },
  deploy: { id: "test-deploy" },
  site: { id: "test-site", url: "https://simplegrants.com.au" },
};
const orgId = "e00418c4-03ed-436f-8e2b-8095af7667af";
const invoke = (request: Request): Promise<Response> =>
  Reflect.apply(handler, undefined, [request, context]);
describe("Netlify public AI handler boundary", () => {
  it("returns JSON for an unsupported method with Netlify's context argument", async () => {
    const response = await invoke(
      new Request("https://simplegrants.com.au/api/ai"),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: "Use POST for this endpoint.",
    });
  });
  it.each([
    { action: "profile", profileStage: "extract" },
    { action: "discover", discoveryStage: "search" },
  ])(
    "authenticates $action with Netlify's context argument instead of crashing",
    async (payload) => {
      const response = await invoke(
        new Request("https://simplegrants.com.au/api/ai", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Simple-Grants-Async": "1",
          },
          body: JSON.stringify({ ...payload, orgId }),
        }),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "Please sign in to continue.",
      });
    },
  );
  it("returns a readable JSON validation error with the runtime context", async () => {
    const response = await invoke(
      new Request("https://simplegrants.com.au/api/ai", {
        method: "POST",
        body: "invalid json",
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The request could not be read.",
    });
  });
});
