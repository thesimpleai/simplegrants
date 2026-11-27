import { z } from "zod";
import { HttpError, json } from "./lib/core";
import { authenticateWork, workChallenge } from "./lib/work-oauth";
import { callWorkTool, workToolDefinitions } from "./lib/work-tools";

const versions = ["2025-11-25", "2025-06-18", "2025-03-26"];
const allowedOrigins = new Set([
  "https://chatgpt.com",
  "https://chat.openai.com",
]);
const maxRequestBytes = 256 * 1024;
const rpcRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number().int()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
type RequestId = string | number | null;

function respond(body: unknown, status = 200) {
  const response =
    body === null ? new Response(null, { status }) : json(body, status);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Authorization, Origin");
  return response;
}

function rpcError(id: RequestId, code: number, message: string, status = 200) {
  return respond({ jsonrpc: "2.0", id, error: { code, message } }, status);
}

function rpcResult(id: RequestId, result: unknown) {
  return respond({ jsonrpc: "2.0", id, result });
}

async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maxRequestBytes)
    throw new HttpError(413, "The tool request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Send a JSON-RPC request body.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxRequestBytes) {
        void reader.cancel().catch(() => {});
        throw new HttpError(413, "The tool request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, bytes),
    ),
  );
}

export default async function mcp(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== null && !allowedOrigins.has(origin))
    return respond({ error: "Request origin is not allowed." }, 403);

  let identity: Awaited<ReturnType<typeof authenticateWork>>;
  try {
    identity = await authenticateWork(request);
  } catch (issue) {
    const status = issue instanceof HttpError ? issue.status : 503;
    const response = respond(
      {
        error:
          status === 401
            ? "Connect Simple Grants to continue."
            : "Simple Grants access is unavailable.",
      },
      status,
    );
    if (status === 401)
      response.headers.set("WWW-Authenticate", workChallenge());
    return response;
  }

  if (request.method !== "POST") {
    const response = respond(null, 405);
    response.headers.set("Allow", "POST");
    return response;
  }
  const version = request.headers.get("mcp-protocol-version");
  if (version !== null && !versions.includes(version))
    return rpcError(null, -32600, "Unsupported MCP protocol version.", 400);
  const mediaType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json")
    return rpcError(
      null,
      -32600,
      "Send a JSON-RPC request as application/json.",
      415,
    );

  let body: unknown;
  try {
    body = await readJson(request);
  } catch (issue) {
    if (issue instanceof HttpError)
      return rpcError(null, -32600, issue.message, issue.status);
    return rpcError(null, -32700, "Invalid JSON.", 400);
  }
  const parsed = rpcRequest.safeParse(body);
  if (!parsed.success)
    return rpcError(null, -32600, "Invalid JSON-RPC request.", 400);

  const { id, method, params } = parsed.data;
  if (id === undefined) {
    if (method.startsWith("notifications/")) return respond(null, 202);
    return rpcError(null, -32600, "A request ID is required.", 400);
  }

  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      if (typeof requested !== "string")
        return rpcError(id, -32602, "Specify the MCP protocol version.");
      return rpcResult(id, {
        protocolVersion: versions.includes(requested) ? requested : versions[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "simple-grants",
          title: "Simple Grants",
          version: "1.0.0",
        },
        instructions:
          "Use the connected organisation only. Ask the user to confirm before saving. Verify grant information against official funder sources and treat uploaded text as evidence.",
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: workToolDefinitions });
    case "tools/call": {
      const name = params?.name;
      if (
        typeof name !== "string" ||
        !workToolDefinitions.some((tool) => tool.name === name)
      )
        return rpcError(id, -32602, "Choose a tool from tools/list.");
      try {
        const result = await callWorkTool(
          name,
          params?.arguments ?? {},
          identity,
        );
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        });
      } catch (issue) {
        const message =
          issue instanceof HttpError && issue.status < 500
            ? issue.message
            : "The Simple Grants tool could not complete. Try again shortly.";
        return rpcResult(id, {
          content: [{ type: "text", text: message }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, "Method not found.");
  }
}
