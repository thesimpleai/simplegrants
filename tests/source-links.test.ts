import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSourceLink } from "../netlify/functions/lib/source-links";
import { createAIRequestBudget } from "../netlify/functions/lib/ai-runtime";
const redirect =
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque-citation";
const target = "https://www.grants.gov.au/program/current";
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  fetchMock.mockReset();
});
describe("stable search source links", () => {
  it("resolves Google's redirect without fetching the destination", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: target } }),
    );
    expect(await resolveSourceLink(redirect)).toBe(target);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      redirect,
      expect.objectContaining({ method: "HEAD", redirect: "manual" }),
    );
  });
  it("passes a normal public URL through without any network request", async () => {
    expect(await resolveSourceLink(target)).toBe(target);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    "http://public.example.org/",
    "https://127.0.0.1/",
    "https://172.16.0.1/",
    "https://[::1]/",
    "https://localhost/",
    "https://service.internal/",
    "https://member:secret@public.example.org/",
  ])(
    "rejects unsafe redirect target %s without following it",
    async (location) => {
      fetchMock.mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location } }),
      );
      expect(await resolveSourceLink(redirect)).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it("uses a bounded GET only when Google cannot answer HEAD", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: target } }),
      );
    expect(await resolveSourceLink(redirect)).toBe(target);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "GET",
      redirect: "manual",
      headers: { Range: "bytes=0-0" },
    });
  });
  it("does not preserve a cyclic or unresolved redirect as a primary URL", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: redirect } }),
    );
    expect(await resolveSourceLink(redirect)).toBeNull();
  });
  it("bounds lookup time and respects the remaining phase budget", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          ),
        ),
    );
    const pending = resolveSourceLink(redirect);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBeNull();
    fetchMock.mockClear();
    const budget = createAIRequestBudget(1000);
    expect(await resolveSourceLink(redirect, budget)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    budget.close();
  });
});
