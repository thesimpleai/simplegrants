import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), service: vi.fn() }));
vi.mock("../netlify/functions/lib/db", () => ({
  authenticatedDb: mocks.auth,
  serviceDb: mocks.service,
}));
import handler from "../netlify/functions/setup-review-drafts";
import { HttpError } from "../netlify/functions/lib/core";

const orgId = "e00418c4-03ed-436f-8e2b-8095af7667af";
const otherOrg = "e00418c4-03ed-436f-8e2b-8095af7667ab";
const actorId = "02ce9446-8d6e-4b72-909a-106e7ce124ba";
const otherActor = "02ce9446-8d6e-4b72-909a-106e7ce124bb";
const profilePath = `.setup-review-drafts/${orgId}/${actorId}/profile.json`;
const files = new Map<string, string>();
const storage = {
  upload: vi.fn(async (path: string, text: string) => {
    files.set(path, text);
    return { error: null };
  }),
  download: vi.fn(async (path: string) =>
    files.has(path)
      ? { data: new Blob([files.get(path)!]), error: null }
      : {
          data: null,
          error: {
            status: 400,
            statusCode: "NoSuchKey",
            message: "Object not found",
          },
        },
  ),
  remove: vi.fn(async (paths: string[]) => {
    paths.forEach((path) => files.delete(path));
    return { error: null };
  }),
};
const bucket = vi.fn(() => storage);

function call(
  method = "GET",
  {
    org = orgId,
    actor = actorId,
    kind = "profile",
    body,
    extra = "",
    headers = {},
  }: {
    org?: string;
    actor?: string;
    kind?: string;
    body?: string;
    extra?: string;
    headers?: Record<string, string>;
  } = {},
) {
  return handler(
    new Request(
      `https://simplegrants.com.au/api/setup-review-drafts?${new URLSearchParams({ orgId: org, kind })}${extra}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${actor}`,
          "Content-Type": "application/json",
          ...headers,
        },
        body,
      },
    ),
  );
}

beforeEach(() => {
  files.clear();
  vi.clearAllMocks();
  mocks.auth.mockImplementation(
    async (request: Request, org: string, write: boolean) => {
      const session = request.headers
        .get("authorization")
        ?.replace(/^Bearer /, "");
      if (!session) throw new HttpError(401, "Please sign in to continue.");
      if (session === "viewer" || (org !== orgId && org !== otherOrg))
        throw new HttpError(403, "Permission denied.");
      expect(write).toBe(true);
      return { user: { id: session } };
    },
  );
  mocks.service.mockReturnValue({ storage: { from: bucket } });
});

describe("private setup review draft storage", () => {
  it("reads, replaces and deletes a separate draft without caching or touching the document library", async () => {
    const empty = await call();
    expect(await empty.json()).toEqual({ draft: null });
    const content = {
      step: "review",
      text: "Information from the original",
      nested: { answers: [1, "two"] },
    };
    const saved = await call("PUT", {
      org: orgId.toUpperCase(),
      body: JSON.stringify({ data: content }),
    });
    expect(saved.status).toBe(200);
    const { updatedAt } = await saved.json();
    expect(updatedAt).toEqual(expect.any(Number));
    expect(bucket).toHaveBeenCalledWith("simple-grant-documents");
    expect(storage.upload).toHaveBeenCalledWith(
      profilePath,
      JSON.stringify({ updatedAt, data: content }),
      {
        upsert: true,
        contentType: "application/json",
        cacheControl: "0",
      },
    );
    expect([...files.keys()]).toEqual([profilePath]);
    const fetched = await call();
    expect(await fetched.json()).toEqual({
      draft: { updatedAt, data: content },
    });
    for (const response of [empty, saved, fetched]) {
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Vary")).toBe("Authorization");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }

    const changed = { ...content, step: "sources" };
    const replacement = await call("PUT", {
      body: JSON.stringify({ data: changed }),
    });
    expect(replacement.status).toBe(200);
    expect((await (await call()).json()).draft.data).toEqual(changed);
    const original = `${orgId}/document/source.pdf`;
    files.set(original, "untouched");
    expect(await (await call("DELETE")).json()).toEqual({ removed: true });
    expect(await (await call("DELETE")).json()).toEqual({ removed: true });
    expect(await (await call()).json()).toEqual({ draft: null });
    expect([...files.entries()]).toEqual([[original, "untouched"]]);
  });

  it("isolates same-organisation actors, other tenant memberships and the two draft kinds", async () => {
    expect(
      (await call("PUT", { body: '{"data":{"private":"Fictional draft"}}' }))
        .status,
    ).toBe(200);
    expect(await (await call("GET", { actor: otherActor })).json()).toEqual({
      draft: null,
    });
    expect(await (await call("GET", { org: otherOrg })).json()).toEqual({
      draft: null,
    });
    expect(await (await call("GET", { kind: "grant-setup" })).json()).toEqual({
      draft: null,
    });
    expect((await call("DELETE", { actor: otherActor })).status).toBe(200);
    expect(files.has(profilePath)).toBe(true);
    const calls = mocks.service.mock.calls.length;
    expect((await call("GET", { actor: "viewer" })).status).toBe(403);
    expect((await call("PUT", { actor: "", body: '{"data":{}}' })).status).toBe(
      401,
    );
    expect((await call("GET", { actor: "../different-person" })).status).toBe(
      401,
    );
    expect(mocks.service).toHaveBeenCalledTimes(calls);
  });

  it("rejects unsupported routes, methods, media types and malformed envelopes before storage access", async () => {
    const unsupported = await call("POST");
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("Allow")).toBe("GET, PUT, DELETE");
    expect((await call("GET", { kind: "../profile" })).status).toBe(400);
    expect((await call("GET", { extra: `&kind=grant-setup` })).status).toBe(
      400,
    );
    expect(
      (await call("GET", { extra: `&actorId=${otherActor}` })).status,
    ).toBe(400);
    expect(
      (
        await call("PUT", {
          body: '{"data":{}}',
          headers: { "Content-Type": "application/jsonp" },
        })
      ).status,
    ).toBe(415);
    for (const body of [
      "{ invalid",
      '{"data":[]}',
      '{"data":{},"updatedAt":1}',
    ])
      expect((await call("PUT", { body })).status).toBe(400);
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it("caps announced and streamed request bytes before storing private data", async () => {
    const limit = 2 * 1024 * 1024;
    expect(
      (
        await call("PUT", {
          body: '{"data":{}}',
          headers: { "Content-Length": String(limit + 1) },
        })
      ).status,
    ).toBe(413);
    const body = JSON.stringify({ data: { text: "é".repeat(limit / 2) } });
    expect(body.length).toBeLessThan(limit);
    expect((await call("PUT", { body })).status).toBe(413);
    const compactNumbers = `{"data":{"numbers":[${"1e20,".repeat(110_000)}1e20]}}`;
    expect(compactNumbers.length).toBeLessThan(limit);
    expect((await call("PUT", { body: compactNumbers })).status).toBe(413);
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it.each([
    { status: 400, statusCode: "NoSuchKey" },
    { status: 400, statusCode: "400" },
    { status: 404, statusCode: "404" },
  ])(
    "treats missing objects as a blank draft ($status / $statusCode)",
    async (status) => {
      storage.download.mockResolvedValueOnce({
        data: null,
        error: { ...status, message: "Object not found" },
      });
      const response = await call();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ draft: null });
    },
  );

  it("returns a safe retryable error for unreadable stored drafts or private storage failures", async () => {
    const canary = "storage credential path private-contents-canary";
    files.set(profilePath, `broken ${canary}`);
    const unreadable = await call();
    expect(unreadable.status).toBe(503);
    expect(await unreadable.text()).not.toContain(canary);
    storage.download.mockResolvedValueOnce({
      data: null,
      error: {
        status: 404,
        statusCode: "NoSuchBucket",
        message: `Bucket not found ${canary}`,
      },
    });
    const missingBucket = await call();
    expect(missingBucket.status).toBe(503);
    expect(await missingBucket.text()).not.toContain(canary);
  });
});
