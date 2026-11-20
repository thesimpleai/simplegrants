import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestAIPhase } from "../src/lib/ai-transport";
const orgId = "e00418c4-03ed-436f-8e2b-8095af7667af",
  jobId = "7b766b0e-4e32-4e3e-b0a5-75b1ee07b59e";
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("AI phase polling", () => {
  it("waits beyond the old 25-second deadline without another model POST", async () => {
    fetchMock.mockResolvedValueOnce(reply({ orgId, jobId }, 202));
    for (let i = 0; i < 16; i++)
      fetchMock.mockResolvedValueOnce(
        reply({ orgId, jobId, pending: true }, 202),
      );
    fetchMock.mockResolvedValueOnce(
      reply({ draft: "Finished after 34 seconds" }),
    );
    const result = requestAIPhase(
      { action: "draft", orgId },
      "session",
      () => {},
    );
    await vi.advanceTimersByTimeAsync(34000);
    expect((await result).status).toBe(200);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init.method === "POST"),
    ).toHaveLength(1);
    expect(fetchMock.mock.calls[1][0]).toContain("/api/ai-jobs?");
  });
  it("passes phase errors back unchanged", async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ orgId, jobId }, 202))
      .mockResolvedValueOnce(reply({ blockers: ["Missing evidence"] }, 422));
    const result = requestAIPhase({ orgId }, "session", () => {});
    await vi.advanceTimersByTimeAsync(2000);
    expect((await result).status).toBe(422);
  });
  it("polls for profile verification beyond the previous 150-second browser deadline", async () => {
    const startedAt = Date.now();
    fetchMock.mockResolvedValueOnce(reply({ orgId, jobId }, 202));
    fetchMock.mockImplementation(async () =>
      Date.now() - startedAt < 200000
        ? reply({ orgId, jobId, pending: true }, 202)
        : reply({ profileChecks: [] }),
    );
    const result = requestAIPhase(
      { orgId, action: "profile", profileStage: "verify" },
      "session",
      () => {},
    );
    await vi.advanceTimersByTimeAsync(200000);
    expect(await (await result).json()).toEqual({ profileChecks: [] });
    expect(
      fetchMock.mock.calls.filter(([, init]) => init.method === "POST"),
    ).toHaveLength(1);
  });
  it("stops polling when the actor or organisation changes", async () => {
    let changed = false;
    fetchMock.mockResolvedValueOnce(reply({ orgId, jobId }, 202));
    const result = requestAIPhase({ orgId }, "session", () => {
      if (changed) throw Error("Organisation changed");
    });
    const assertion = expect(result).rejects.toThrow("Organisation changed");
    await vi.advanceTimersByTimeAsync(1);
    changed = true;
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects a queued job for another organisation", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ orgId: "another-org", jobId }, 202),
    );
    await expect(
      requestAIPhase({ orgId }, "session", () => {}),
    ).rejects.toThrow("Invalid AI job");
  });
});
