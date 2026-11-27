import { describe, expect, it, vi } from "vitest";
import mcp from "../netlify/functions/mcp";
import { HttpError } from "../netlify/functions/lib/core";
import { authenticateWork } from "../netlify/functions/lib/work-oauth";
import { callWorkTool } from "../netlify/functions/lib/work-tools";

const identity = vi.hoisted(() => ({
  db: {},
  orgId: "test-org",
  userId: "test-user",
  role: "viewer",
}));
vi.mock("../netlify/functions/lib/work-oauth", () => ({
  authenticateWork: vi.fn(),
  workChallenge: () =>
    'Bearer resource_metadata="https://grants.example/.well-known/oauth-protected-resource/api/mcp", scope="simple-grants"',
}));
vi.mock("../netlify/functions/lib/work-tools", () => ({
  workToolDefinitions: [
    { name: "get_organisation" },
    { name: "save_application_draft" },
  ],
  callWorkTool: vi.fn(),
}));

const url = "https://grants.example/api/mcp";
function rpc(method: string, params?: object, id: number | null = 1) {
  return new Request(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-scoped-token",
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...(id === null ? {} : { id }),
      method,
      params,
    }),
  });
}

describe("Simple Grants MCP transport", () => {
  it("returns an OAuth discovery challenge without passing requests to tools", async () => {
    vi.mocked(authenticateWork).mockRejectedValueOnce(
      new HttpError(401, "Missing token."),
    );
    const response = await mcp(new Request(url));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "https://grants.example/.well-known/oauth-protected-resource/api/mcp",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("negotiates a supported version and supports stateless tool discovery", async () => {
    vi.mocked(authenticateWork).mockResolvedValue(identity as never);
    const init = await mcp(
      rpc("initialize", { protocolVersion: "2025-06-18" }),
    );
    expect(await init.json()).toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "simple-grants" },
      },
    });
    expect(init.headers.get("MCP-Session-Id")).toBeNull();
    const notice = await mcp(rpc("notifications/initialized", undefined, null));
    expect(notice.status).toBe(202);
    expect(await notice.text()).toBe("");
    const list = await mcp(rpc("tools/list"));
    expect(await list.json()).toMatchObject({
      result: {
        tools: [
          { name: "get_organisation" },
          { name: "save_application_draft" },
        ],
      },
    });
  });

  it("passes the authorised identity and returns readable and structured results", async () => {
    vi.mocked(authenticateWork).mockResolvedValue(identity as never);
    vi.mocked(callWorkTool).mockResolvedValueOnce({ name: "Sample Community" });
    const response = await mcp(
      rpc("tools/call", { name: "get_organisation" }, 7),
    );
    expect(callWorkTool).toHaveBeenLastCalledWith(
      "get_organisation",
      {},
      identity,
    );
    const data = await response.json();
    expect(data).toMatchObject({
      id: 7,
      result: { structuredContent: { name: "Sample Community" } },
    });
    expect(JSON.parse(data.result.content[0].text)).toEqual(
      data.result.structuredContent,
    );
  });

  it("reports tool denials without exposing unexpected backend text", async () => {
    vi.mocked(authenticateWork).mockResolvedValue(identity as never);
    vi.mocked(callWorkTool)
      .mockRejectedValueOnce(new HttpError(403, "Viewers cannot save drafts."))
      .mockRejectedValueOnce(new Error("private database detail"));
    const request = () => rpc("tools/call", { name: "save_application_draft" });
    const denied = await mcp(request());
    expect(await denied.json()).toMatchObject({
      result: {
        isError: true,
        content: [{ text: "Viewers cannot save drafts." }],
      },
    });
    const unavailable = await mcp(request());
    expect(await unavailable.text()).not.toContain("private database detail");
  });

  it("rejects an unrecognised Origin and an unsupported protocol header", async () => {
    const foreign = await mcp(
      new Request(url, { headers: { Origin: "https://another-site.invalid" } }),
    );
    expect(foreign.status).toBe(403);
    vi.mocked(authenticateWork).mockResolvedValue(identity as never);
    const old = rpc("tools/list");
    old.headers.set("MCP-Protocol-Version", "2024-11-05");
    expect((await mcp(old)).status).toBe(400);
  });

  it("limits the body independently of Content-Length", async () => {
    vi.mocked(authenticateWork).mockResolvedValue(identity as never);
    const oversized = rpc("tools/call", {
      name: "save_application_draft",
      arguments: { application_text: "a".repeat(256 * 1024) },
    });
    expect((await mcp(oversized)).status).toBe(413);
  });
});
