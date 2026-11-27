import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import handler from "../netlify/functions/work-oauth";
import mcp from "../netlify/functions/mcp";
import {
  authenticateWork,
  workChallenge,
} from "../netlify/functions/lib/work-oauth";

const origin = "https://grants.example";
const resource = origin + "/api/mcp";
const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
const clientId = "ChatGPT Work";
const clientSecret = "example-secret/+";
const org = randomUUID(),
  otherOrg = randomUUID(),
  user = randomUUID(),
  otherUser = randomUUID();
const verifier = "v".repeat(50);
const members = new Map<string, string>();
type Row = Record<string, string | null>;
const grants = new Map<string, Row>();
const calls: Request[] = [];
const response = (value: unknown) => Response.json(value);
const authUser = (id: string) => ({
  id,
  aud: "authenticated",
  role: "authenticated",
  email: "person@example.org",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
});
beforeEach(() => {
  grants.clear();
  calls.length = 0;
  members.clear();
  members.set(org + user, "admin");
  members.set(otherOrg + user, "viewer");
  members.set(org + otherUser, "owner");
  for (const [name, value] of Object.entries({
    WORK_MCP_ENABLED: "true",
    AUTH_APP_URL: origin,
    WORK_OAUTH_CLIENT_ID: clientId,
    WORK_OAUTH_CLIENT_SECRET: clientSecret,
    WORK_OAUTH_REDIRECT_URI: redirect,
    SUPABASE_URL: "https://backend.example",
    SUPABASE_ANON_KEY: "test-anon",
    SUPABASE_SERVICE_ROLE_KEY: "test-service",
  }))
    vi.stubEnv(name, value);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      calls.push(request.clone());
      const url = new URL(request.url);
      expect(url.origin).toBe("https://backend.example");
      const bearer = request.headers.get("authorization");
      if (url.pathname === "/auth/v1/user") {
        const id =
          bearer === "Bearer app-session"
            ? user
            : bearer === "Bearer other-session"
              ? otherUser
              : undefined;
        return id
          ? response(authUser(id))
          : Response.json({ message: "Unverified session" }, { status: 401 });
      }
      const filters = url.searchParams;
      expect(
        request.headers.get(
          request.method === "GET" ? "Accept-Profile" : "Content-Profile",
        ),
      ).toBe("simple_grant");
      if (url.pathname === "/rest/v1/organization_members") {
        const role = members.get(
          filters.get("org_id")?.slice(3) +
            String(filters.get("user_id")?.slice(3)),
        );
        return response(role ? [{ role }] : []);
      }
      expect(bearer).toBe("Bearer test-service");
      if (url.pathname === "/rest/v1/organizations") {
        expect(filters.get("id")).toBe("eq." + org);
        return response([
          { name: "Pilot Community", verification_status: "draft" },
        ]);
      }
      if (url.pathname === "/rest/v1/rpc/begin_work_oauth") {
        const data = await request.json();
        const id = randomUUID();
        grants.set(id, {
          id,
          phase: "pending",
          client_id: data.p_client_id,
          resource: data.p_resource,
          redirect_uri: data.p_redirect_uri,
          scope: "simple-grants",
          browser_hash: data.p_browser_hash,
          source_hash: data.p_source_hash,
          oauth_state: data.p_oauth_state,
          code_challenge: data.p_challenge,
          expires_at: new Date(Date.now() + 600000).toISOString(),
        });
        return response(id);
      }
      expect(url.pathname).toBe("/rest/v1/work_oauth_grants");
      const patch =
        request.method === "PATCH" ? await request.json() : undefined;
      const rows = [...grants.values()].filter((row) =>
        [...filters.entries()].every(([key, condition]) => {
          if (key === "select" || key === "limit") return true;
          if (condition.startsWith("eq."))
            return row[key] === condition.slice(3);
          if (condition.startsWith("gt."))
            return row[key] !== null && row[key] > condition.slice(3);
          throw new Error("Unhandled fixture filter " + key);
        }),
      );
      for (const row of rows) {
        if (patch) Object.assign(row, patch);
        if (request.method === "DELETE") grants.delete(row.id!);
      }
      return response(rows);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const authParams = () =>
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    state: "ChatGPT state / with symbols=+",
    scope: "simple-grants",
    resource,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    response_type: "code",
  });
const base = origin + "/api/work-oauth/";
async function start() {
  const res = await handler(new Request(base + "authorize?" + authParams()), {
    ip: "192.0.2.1",
  });
  expect(res.status).toBe(302);
  const set = res.headers.get("set-cookie")!;
  expect(set).toContain("Secure; HttpOnly; SameSite=Lax");
  const location = new URL(res.headers.get("location")!);
  expect(location.origin).toBe(origin);
  return {
    requestId: location.searchParams.get("work_request")!,
    cookie: set.split(";")[0],
  };
}
function browser(
  action: string,
  method: string,
  input: object,
  cookie: string,
  session = "app-session",
  source = origin,
) {
  return handler(
    new Request(base + action, {
      method,
      headers: {
        cookie,
        origin: source,
        "content-type": "application/json",
        authorization: "Bearer " + session,
      },
      body: JSON.stringify(input),
    }),
  );
}
async function approve(orgId = org, session = "app-session") {
  const { requestId, cookie } = await start();
  const r = await browser(
    "consent",
    "POST",
    { requestId, orgId },
    cookie,
    session,
  );
  expect(r.status).toBe(200);
  const callback = new URL((await r.json()).redirectUrl);
  expect(callback.origin + callback.pathname).toBe(redirect);
  expect(callback.searchParams.get("iss")).toBe(origin);
  expect(callback.searchParams.get("state")).toBe(authParams().get("state"));
  return callback.searchParams.get("code")!;
}
const basic =
  "Basic " +
  Buffer.from(
    encodeURIComponent(clientId) + ":" + encodeURIComponent(clientSecret),
  ).toString("base64");
function form(
  action: string,
  fields: Record<string, string>,
  authorization: string | null = basic,
) {
  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded",
  });
  if (authorization !== null) headers.set("authorization", authorization);
  return handler(
    new Request(base + action, {
      method: "POST",
      headers,
      body: new URLSearchParams(fields),
    }),
  );
}
const exchange = (code: string, extra: Record<string, string> = {}) =>
  form("token", {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
    resource,
    code_verifier: verifier,
    ...extra,
  });
const refresh = (token: string) =>
  form("token", {
    grant_type: "refresh_token",
    refresh_token: token,
    resource,
  });
const identity = (token: string) =>
  authenticateWork(
    new Request(resource, { headers: { authorization: "Bearer " + token } }),
  );
const connected = async (orgId: string, session = "app-session") =>
  (
    await handler(
      new Request(base + "connections?orgId=" + orgId, {
        headers: { authorization: "Bearer " + session },
      }),
    )
  ).json();

it("uses the OAuth grant to discover and call real MCP tools for the chosen applicant", async () => {
  const token = (await (await exchange(await approve())).json()).access_token;
  const request = (method: string, params?: object) =>
    mcp(
      new Request(resource, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
  const listing = await (await request("tools/list")).json();
  expect(listing.result.tools).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "get_organisation" }),
      expect.objectContaining({ name: "save_application_draft" }),
    ]),
  );
  const orgResult = await (
    await request("tools/call", { name: "get_organisation" })
  ).json();
  expect(orgResult.result.structuredContent).toMatchObject({
    id: org,
    name: "Pilot Community",
    profile_status: "draft",
  });
  members.delete(org + user);
  expect((await request("tools/list")).status).toBe(401);
});

it("publishes canonical discovery and the MCP challenge before client setup, with an off switch", async () => {
  vi.stubEnv("WORK_OAUTH_REDIRECT_URI", "");
  const issuer = await (
    await handler(
      new Request(origin + "/.well-known/oauth-authorization-server"),
    )
  ).json();
  expect(issuer).toMatchObject({
    issuer: origin,
    token_endpoint: base + "token",
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  });
  for (const path of [
    "/.well-known/oauth-protected-resource/api/mcp",
    "/.well-known/oauth-protected-resource",
    "/.netlify/functions/work-oauth?route=protected-resource",
  ]) {
    expect(
      await (await handler(new Request(origin + path))).json(),
    ).toMatchObject({ resource, authorization_servers: [origin] });
  }
  expect(workChallenge()).toContain(
    origin + "/.well-known/oauth-protected-resource/api/mcp",
  );
  await expect(authenticateWork(new Request(resource))).rejects.toMatchObject({
    status: 401,
  });
  expect(
    (await handler(new Request(base + "authorize?" + authParams()))).status,
  ).toBe(503);
  vi.stubEnv("WORK_MCP_ENABLED", "false");
  expect(
    (
      await handler(
        new Request(origin + "/.well-known/oauth-protected-resource"),
      )
    ).status,
  ).toBe(404);
  expect(calls).toHaveLength(0);
});
it("rejects unregistered and duplicated authorization inputs before writing pending requests", async () => {
  for (const [key, bad] of [
    ["redirect_uri", redirect + "/wrong"],
    ["client_id", "other"],
    ["resource", resource + "/other"],
    ["scope", "admin"],
    ["code_challenge_method", "plain"],
    ["code_challenge", "short"],
    ["response_type", "token"],
  ]) {
    const params = authParams();
    params.set(key, bad);
    const r = await handler(new Request(base + "authorize?" + params));
    expect(r.status).toBe(400);
    expect(r.headers.get("location")).toBeNull();
  }
  expect(
    (
      await handler(
        new Request(
          base + "authorize?" + authParams() + "&scope=simple-grants",
        ),
      )
    ).status,
  ).toBe(400);
  vi.stubEnv("WORK_OAUTH_REDIRECT_URI", "https://other.example/callback");
  expect(
    (await handler(new Request(base + "authorize?" + authParams()))).status,
  ).toBe(503);
  expect(calls).toHaveLength(0);
});
it("binds consent to the browser and verified member and returns an issuer-bound denial", async () => {
  const { requestId, cookie } = await start();
  const pending = base + "consent?request=" + requestId;
  const get = (value: string) =>
    handler(new Request(pending, { headers: { cookie: value } }));
  expect(await (await get(cookie)).json()).toEqual({ pending: true });
  expect((await get("")).status).toBe(404);
  expect((await get((await start()).cookie)).status).toBe(404);
  expect(
    (
      await browser(
        "consent",
        "POST",
        { requestId, orgId: org },
        cookie,
        "app-session",
        "https://other.example",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await browser(
        "consent",
        "POST",
        { requestId, orgId: otherOrg },
        cookie,
        "other-session",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await browser(
        "consent",
        "POST",
        { requestId, deny: true },
        cookie,
        "bad-session",
      )
    ).status,
  ).toBe(401);
  const declined = await browser(
    "consent",
    "POST",
    { requestId, deny: true },
    cookie,
  );
  const target = new URL((await declined.json()).redirectUrl);
  expect(target.searchParams.get("error")).toBe("access_denied");
  expect(target.searchParams.get("iss")).toBe(origin);
  expect(target.searchParams.get("state")).toBe(authParams().get("state"));
  expect(target.searchParams.has("code")).toBe(false);
  expect((await get(cookie)).status).toBe(404);
});
it("allows only a single PKCE exchange and refresh, checks current membership and invalidates expired tokens", async () => {
  const code = await approve();
  for (const extra of [
    { code_verifier: "x".repeat(50) },
    { resource: resource + "/other" },
    { redirect_uri: redirect + "/other" },
  ] as Record<string, string>[]) {
    expect((await exchange(code, extra)).status).toBe(400);
  }
  expect(
    (
      await form(
        "token",
        { grant_type: "authorization_code", resource },
        "Basic d3Jvbmc6d3Jvbmc=",
      )
    ).status,
  ).toBe(401);
  const race = await Promise.all([exchange(code), exchange(code)]);
  expect(race.map((r) => r.status).sort()).toEqual([200, 400]);
  const tokens = await race.find((r) => r.ok)!.json();
  expect(tokens).toMatchObject({
    scope: "simple-grants",
    token_type: "Bearer",
    expires_in: 3600,
  });
  expect(await identity(tokens.access_token)).toMatchObject({
    orgId: org,
    userId: user,
    role: "member",
  });
  await expect(identity("app-session")).rejects.toMatchObject({ status: 401 });
  await expect(identity(tokens.refresh_token)).rejects.toMatchObject({
    status: 401,
  });
  const row = [...grants.values()][0];
  expect(JSON.stringify(row)).not.toContain(code);
  expect(JSON.stringify(row)).not.toContain(tokens.access_token);
  expect(JSON.stringify(row)).not.toContain(tokens.refresh_token);
  const rotations = await Promise.all([
    refresh(tokens.refresh_token),
    refresh(tokens.refresh_token),
  ]);
  expect(rotations.map((r) => r.status).sort()).toEqual([200, 400]);
  const next = await rotations.find((r) => r.ok)!.json();
  await expect(identity(tokens.access_token)).rejects.toMatchObject({
    status: 401,
  });
  members.set(org + user, "viewer");
  expect(await identity(next.access_token)).toMatchObject({ role: "viewer" });
  members.delete(org + user);
  await expect(identity(next.access_token)).rejects.toMatchObject({
    status: 401,
  });
  members.set(org + user, "member");
  row.access_expires_at = new Date(Date.now() - 1000).toISOString();
  await expect(identity(next.access_token)).rejects.toMatchObject({
    status: 401,
  });
  row.expires_at = row.access_expires_at;
  expect((await refresh(next.refresh_token)).status).toBe(400);
});
it("disconnects only the caller’s organisation, authenticates revocation and can use client_secret_post", async () => {
  const a = await (await exchange(await approve())).json();
  const b = await (await exchange(await approve(otherOrg))).json();
  const other = await (
    await exchange(await approve(org, "other-session"))
  ).json();
  expect(await connected(org)).toEqual({ connected: true });
  expect(
    (
      await browser(
        "connections",
        "DELETE",
        { orgId: org },
        "",
        "app-session",
        "https://other.example",
      )
    ).status,
  ).toBe(403);
  expect(
    await (await browser("connections", "DELETE", { orgId: org }, "")).json(),
  ).toEqual({ connected: false });
  expect(await connected(org)).toEqual({ connected: false });
  await expect(identity(a.access_token)).rejects.toMatchObject({ status: 401 });
  expect((await refresh(a.refresh_token)).status).toBe(400);
  expect(await identity(other.access_token)).toMatchObject({
    orgId: org,
    userId: otherUser,
  });
  expect(await identity(b.access_token)).toMatchObject({
    orgId: otherOrg,
    userId: user,
  });
  expect(
    (
      await form(
        "revoke",
        { token: b.access_token, client_id: clientId, client_secret: "wrong" },
        null,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await form(
        "revoke",
        {
          token: b.refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
        },
        null,
      )
    ).status,
  ).toBe(200);
  expect(await connected(otherOrg)).toEqual({ connected: false });
  await expect(identity(b.access_token)).rejects.toMatchObject({ status: 401 });
});
it("requires unexpired pending requests and codes", async () => {
  const request = await start();
  grants.get(request.requestId)!.expires_at = new Date(0).toISOString();
  expect(
    (
      await browser(
        "consent",
        "POST",
        { requestId: request.requestId, orgId: org },
        request.cookie,
      )
    ).status,
  ).toBe(404);
  const code = await approve();
  for (const row of grants.values()) row.expires_at = new Date(0).toISOString();
  expect((await exchange(code)).status).toBe(400);
});
