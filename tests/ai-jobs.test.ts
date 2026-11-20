import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  serviceDb: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("../netlify/functions/lib/db", () => ({
  authenticatedDb: mocks.auth,
  serviceDb: mocks.serviceDb,
}));
vi.mock("../netlify/functions/ai", () => ({ executeAI: mocks.execute }));
import {
  authorizedJob,
  jobPrefix,
  queueAIJob,
  JOB_LIFETIME_MS,
} from "../netlify/functions/lib/ai-jobs";
import status from "../netlify/functions/ai-jobs";
import worker from "../netlify/functions/ai-worker-background";
import cleanup from "../netlify/functions/ai-job-cleanup-background";
import { HttpError, json } from "../netlify/functions/lib/core";
const orgId = "e00418c4-03ed-436f-8e2b-8095af7667af";
const files = new Map<string, { text: string; created_at: string }>();
let actor: string;
const storage = {
  upload: vi.fn(
    async (path: string, text: string, options: { upsert: boolean }) => {
      if (files.has(path) && !options.upsert)
        return { error: { statusCode: "409" } };
      files.set(path, { text, created_at: new Date().toISOString() });
      return { error: null };
    },
  ),
  download: vi.fn(async (path: string) =>
    files.has(path)
      ? { data: new Blob([files.get(path)!.text]), error: null }
      : {
          data: null,
          error: { statusCode: "404", message: "Object not found" },
        },
  ),
  remove: vi.fn(async (paths: string[]) => {
    paths.forEach((path) => files.delete(path));
    return { error: null };
  }),
  list: vi.fn(
    async (
      prefix: string,
      { offset, limit }: { offset: number; limit: number },
    ) => {
      const children = new Map<string, { name: string; created_at?: string }>();
      for (const [path, value] of files)
        if (path.startsWith(prefix + "/")) {
          const rest = path.slice(prefix.length + 1),
            name = rest.split("/")[0];
          children.set(name, {
            name,
            ...(!rest.includes("/") ? { created_at: value.created_at } : {}),
          });
        }
      return {
        data: [...children.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(offset, offset + limit),
        error: null,
      };
    },
  ),
};
const request = (path = "/api/ai", body?: unknown) =>
  new Request(`https://simplegrants.com.au${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer secret-session-canary" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
async function queue(profileStage = "extract") {
  const response = await queueAIJob(
    request(),
    {
      orgId,
      action: "profile",
      profileStage,
      text: "private-source-canary",
    } as {
      orgId: string;
    },
    actor,
  );
  expect(response.status).toBe(202);
  return (await response.json()) as { orgId: string; jobId: string };
}
beforeEach(() => {
  files.clear();
  vi.clearAllMocks();
  actor = "actor-a";
  mocks.auth.mockImplementation(async (_request, requestedOrg) => {
    if (requestedOrg !== orgId) throw new HttpError(403, "Forbidden");
    return { user: { id: actor } };
  });
  mocks.serviceDb.mockReturnValue({ storage: { from: () => storage } });
  mocks.execute.mockResolvedValue(json({ profile: { name: "Creekside" } }));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 202 })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("background AI jobs", () => {
  it("queues privately without storing tokens, forwards to the configured origin, and claims exactly once", async () => {
    const ids = await queue();
    const prefix = jobPrefix(orgId, ids.jobId);
    expect(prefix.startsWith(".ai-jobs/")).toBe(true);
    expect(JSON.stringify([...files.values()])).not.toContain(
      "secret-session-canary",
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://simplegrants.com.au/.netlify/functions/ai-worker-background",
      expect.objectContaining({ redirect: "error" }),
    );
    await Promise.all([
      worker(request("/worker", ids)),
      worker(request("/worker", ids)),
    ]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const [forwarded, budget] = mocks.execute.mock.calls[0];
    expect(forwarded.headers.get("authorization")).toBe(
      "Bearer secret-session-canary",
    );
    expect(forwarded.headers.has("x-simple-grants-async")).toBe(false);
    expect(budget.modelTimeoutMs).toBe(90000);
    expect(files.has(`${prefix}/payload.json`)).toBe(false);
    const first = await status(
      request(`/api/ai-jobs?${new URLSearchParams(ids)}`),
    );
    const second = await status(
      request(`/api/ai-jobs?${new URLSearchParams(ids)}`),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it("does not reveal a result to a different actor or organisation", async () => {
    const ids = await queue();
    actor = "actor-b";
    expect(
      (await status(request(`/api/ai-jobs?${new URLSearchParams(ids)}`)))
        .status,
    ).toBe(404);
    await worker(request("/worker", ids));
    expect(mocks.execute).not.toHaveBeenCalled();
    await expect(
      authorizedJob(request(), {
        ...ids,
        orgId: "e00418c4-03ed-436f-8e2b-8095af7667aa",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("returns the original phase error without rerunning the model", async () => {
    const ids = await queue();
    mocks.execute.mockResolvedValue(
      json({ blockers: ["Evidence of need is missing"] }, 422),
    );
    await worker(request("/worker", ids));
    const result = await status(
      request(`/api/ai-jobs?${new URLSearchParams(ids)}`),
    );
    expect(result.status).toBe(422);
    expect(await result.json()).toEqual({
      blockers: ["Evidence of need is missing"],
    });
  });
  it.each([
    ["verify", 120000, 225000],
    ["extract", 90000, 135000],
  ])(
    "uses the recorded worker and status deadlines for profile %s",
    async (stage, modelMs, statusMs) => {
      vi.useFakeTimers();
      const start = Date.now();
      const ids = await queue(stage);
      const statusRequest = request(`/api/ai-jobs?${new URLSearchParams(ids)}`);
      let complete!: (response: Response) => void;
      const execution = new Promise<Response>((resolve) => {
        complete = resolve;
      });
      mocks.execute.mockImplementationOnce(() => execution);
      const pendingWorker = worker(request("/worker", ids));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.execute.mock.calls[0][1].modelTimeoutMs).toBe(modelMs);
      vi.setSystemTime(start + statusMs);
      expect((await status(statusRequest)).status).toBe(202);
      vi.setSystemTime(start + statusMs + 1);
      const expired = await status(statusRequest);
      expect(expired.status).toBe(504);
      expect((await expired.json()).code).toBe("SG_AI_TIMEOUT");
      complete(json({ profile: { name: "Creekside" } }));
      await pendingWorker;
    },
  );
  it("rejects expired jobs and cleans up only expired server job files", async () => {
    vi.useFakeTimers();
    const ids = await queue();
    const prefix = jobPrefix(orgId, ids.jobId);
    files.set(`${orgId}/evidence/original.txt`, {
      text: "keep",
      created_at: "2020-01-01",
    });
    vi.setSystemTime(Date.now() + JOB_LIFETIME_MS + 1);
    expect(
      (await status(request(`/api/ai-jobs?${new URLSearchParams(ids)}`)))
        .status,
    ).toBe(410);
    await worker(request("/worker", ids));
    expect(mocks.execute).not.toHaveBeenCalled();
    await cleanup();
    expect([...files.keys()].some((path) => path.startsWith(prefix))).toBe(
      false,
    );
    expect(files.has(`${orgId}/evidence/original.txt`)).toBe(true);
  });
  it("keeps active jobs and reports a worker that never started", async () => {
    vi.useFakeTimers();
    const ids = await queue();
    await cleanup();
    expect(files.size).toBe(2);
    vi.setSystemTime(Date.now() + 16000);
    expect(
      (await status(request(`/api/ai-jobs?${new URLSearchParams(ids)}`)))
        .status,
    ).toBe(503);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
