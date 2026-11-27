import type { Context } from "@netlify/functions";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HttpError, json } from "./lib/core";
import { authenticatedDb, checked, serviceDb } from "./lib/db";
import {
  WORK_GRANTS,
  WORK_SCOPE,
  workConfig,
  workDigest,
  workOrigin,
  workToken,
  type WorkConfig,
} from "./lib/work-oauth";

const browserCookie = "__Host-sg-work";
const accessSeconds = 3600;
const expires = (seconds: number) =>
  new Date(Date.now() + seconds * 1000).toISOString();

class OAuthError extends HttpError {
  constructor(
    public code: string,
    message: string,
    status = 400,
  ) {
    super(status, message);
  }
}
const invalid = (message: string) => new OAuthError("invalid_request", message);
const invalidGrant = () =>
  new OAuthError(
    "invalid_grant",
    "The authorization has expired or has already been used. Reconnect from ChatGPT Work.",
  );
const requestGone = () =>
  new OAuthError(
    "invalid_request",
    "Open a new connection request from ChatGPT Work in this browser.",
    404,
  );

function requireId(value: unknown): string {
  const id = z.uuid().safeParse(value);
  if (!id.success)
    throw invalid("A valid request or organisation ID is required.");
  return id.data;
}
function uniqueParams(params: URLSearchParams) {
  for (const name of params.keys()) {
    if (params.getAll(name).length > 1)
      throw invalid("An OAuth parameter was supplied more than once.");
  }
  return params;
}
function metadata(origin: string, resource: boolean) {
  const base = origin + "/api/work-oauth";
  return json(
    resource
      ? {
          resource: origin + "/api/mcp",
          authorization_servers: [origin],
          scopes_supported: [WORK_SCOPE],
          bearer_methods_supported: ["header"],
        }
      : {
          issuer: origin,
          authorization_endpoint: base + "/authorize",
          token_endpoint: base + "/token",
          revocation_endpoint: base + "/revoke",
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          scopes_supported: [WORK_SCOPE],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: [
            "client_secret_basic",
            "client_secret_post",
          ],
          revocation_endpoint_auth_methods_supported: [
            "client_secret_basic",
            "client_secret_post",
          ],
          authorization_response_iss_parameter_supported: true,
        },
  );
}
function cookie(request: Request) {
  const value = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((entry) => entry.startsWith(browserCookie + "="))
    ?.slice(browserCookie.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
function checkScope(params: URLSearchParams) {
  if (params.has("scope") && params.get("scope") !== WORK_SCOPE)
    throw new OAuthError(
      "invalid_scope",
      "This connection supports only the simple-grants scope.",
    );
}
function checkResource(params: URLSearchParams, config: WorkConfig) {
  if (params.get("resource") !== config.resource)
    throw new OAuthError(
      "invalid_target",
      "The resource must identify the Simple Grants MCP endpoint.",
    );
}
function checkClient(
  request: Request,
  params: URLSearchParams,
  config: WorkConfig,
) {
  let id = params.get("client_id"),
    secret = params.get("client_secret");
  const fail = () =>
    new OAuthError("invalid_client", "Client authentication failed.", 401);
  const header = request.headers.get("authorization");
  if (header !== null) {
    const basic = /^Basic ([a-z0-9+/]+=*)$/i.exec(header)?.[1];
    if (!basic || secret !== null) throw fail();
    const credentials = Buffer.from(basic, "base64").toString("utf8");
    const separator = credentials.indexOf(":");
    if (separator === -1) throw fail();
    try {
      const decode = (text: string) =>
        decodeURIComponent(text.replace(/\+/g, " "));
      const basicId = decode(credentials.slice(0, separator));
      if (id !== null && id !== basicId) throw fail();
      id = basicId;
      secret = decode(credentials.slice(separator + 1));
    } catch {
      throw fail();
    }
  }
  if (
    id !== config.clientId ||
    !secret ||
    !timingSafeEqual(workDigest(secret), workDigest(config.secret))
  )
    throw fail();
}
async function body(request: Request, type: string) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    type
  )
    throw invalid("Unsupported request content type.");
  const text = await request.text();
  if (text.length > 8192) throw invalid("Request body is too large.");
  return text;
}
async function browserBody(
  request: Request,
  origin: string,
): Promise<Record<string, unknown>> {
  if (request.headers.get("origin") !== origin)
    throw new OAuthError(
      "invalid_request",
      "Use the Simple Grants portal to change a connection.",
      403,
    );
  const raw = await body(request, "application/json");
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch {}
  throw invalid("A JSON object is required.");
}

async function authorize(request: Request, config: WorkConfig, ip?: string) {
  const params = uniqueParams(new URL(request.url).searchParams);
  if (
    params.get("client_id") !== config.clientId ||
    params.get("redirect_uri") !== config.redirectUri
  )
    throw invalid(
      "The client or callback does not match the registered ChatGPT Work connection.",
    );
  if (params.get("response_type") !== "code")
    throw new OAuthError(
      "unsupported_response_type",
      "Request an authorization code.",
    );
  checkScope(params);
  checkResource(params, config);
  const state = params.get("state");
  if (
    state !== null &&
    (!state || state.length > 2048 || /[^\x20-\x7e]/.test(state))
  )
    throw invalid("Invalid OAuth state.");
  const challenge = params.get("code_challenge");
  if (
    params.get("code_challenge_method") !== "S256" ||
    !challenge ||
    !/^[A-Za-z0-9_-]{43}$/.test(challenge)
  )
    throw invalid("An S256 PKCE challenge is required.");
  const browser = cookie(request) || randomBytes(32).toString("base64url");
  const id = checked(
    await serviceDb().rpc("begin_work_oauth", {
      p_client_id: config.clientId,
      p_redirect_uri: config.redirectUri,
      p_resource: config.resource,
      p_oauth_state: state,
      p_challenge: challenge,
      p_browser_hash: workDigest(browser).toString("hex"),
      p_source_hash: createHmac("sha256", config.secret)
        .update(ip || "local")
        .digest("hex"),
    }),
  );
  if (!id)
    throw new OAuthError(
      "temporarily_unavailable",
      "Too many connection requests. Try again in ten minutes.",
      429,
    );
  const location = new URL("/", config.origin);
  location.searchParams.set("work_request", id);
  return new Response(null, {
    status: 302,
    headers: {
      Location: location.href,
      "Set-Cookie":
        browserCookie +
        "=" +
        browser +
        "; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax",
    },
  });
}
async function consent(request: Request, config: WorkConfig) {
  const browser = cookie(request);
  if (!browser) throw requestGone();
  const input =
    request.method === "POST"
      ? await browserBody(request, config.origin)
      : undefined;
  const requestId = requireId(
    input ? input.requestId : new URL(request.url).searchParams.get("request"),
  );
  const db = serviceDb();
  const pending = {
    id: requestId,
    phase: "pending",
    client_id: config.clientId,
    resource: config.resource,
    redirect_uri: config.redirectUri,
    browser_hash: workDigest(browser).toString("hex"),
  };
  const grants = db.from(WORK_GRANTS);
  const now = expires(0);
  if (!input) {
    if (
      !checked(
        await grants
          .select("id")
          .match(pending)
          .gt("expires_at", now)
          .maybeSingle(),
      )
    )
      throw requestGone();
    return json({ pending: true });
  }

  let code: string | undefined;
  let decision;
  if (input.deny === true) {
    const bearer = /^Bearer (\S+)$/i.exec(
      request.headers.get("authorization") || "",
    )?.[1];
    if (!bearer || !(await db.auth.getUser(bearer)).data.user)
      throw new HttpError(401, "Sign in to respond to the request.");
    decision = grants.delete();
  } else {
    const orgId = requireId(input.orgId);
    const { user } = await authenticatedDb(request, orgId, false);
    code = workToken("code");
    decision = grants.update({
      phase: "code",
      org_id: orgId,
      user_id: user.id,
      code_hash: workDigest(code).toString("hex"),
      browser_hash: null,
      source_hash: null,
      expires_at: expires(300),
    });
  }
  const grant = checked(
    await decision
      .match(pending)
      .gt("expires_at", expires(0))
      .select("oauth_state")
      .maybeSingle(),
  );
  if (!grant) throw requestGone();
  const redirect = new URL(config.redirectUri);
  if (grant.oauth_state !== null)
    redirect.searchParams.set("state", grant.oauth_state);
  redirect.searchParams.set("iss", config.origin);
  if (code) redirect.searchParams.set("code", code);
  else redirect.searchParams.set("error", "access_denied");
  return json({ redirectUrl: redirect.href });
}
async function connections(request: Request, config: WorkConfig) {
  const remove = request.method === "DELETE";
  const orgId = requireId(
    remove
      ? (await browserBody(request, config.origin)).orgId
      : new URL(request.url).searchParams.get("orgId"),
  );
  const { user } = await authenticatedDb(request, orgId, false);
  const grants = serviceDb().from(WORK_GRANTS);
  const own = {
    user_id: user.id,
    org_id: orgId,
    client_id: config.clientId,
    resource: config.resource,
  };
  if (remove) {
    checked(await grants.delete().match(own));
    return json({ connected: false });
  }
  const rows = checked(
    await grants
      .select("id")
      .match(own)
      .eq("phase", "active")
      .gt("expires_at", expires(0))
      .limit(1),
  );
  return json({ connected: Boolean(rows?.length) });
}
async function token(request: Request, config: WorkConfig, revoke: boolean) {
  const params = uniqueParams(
    new URLSearchParams(
      await body(request, "application/x-www-form-urlencoded"),
    ),
  );
  checkClient(request, params, config);
  const bound = {
    client_id: config.clientId,
    resource: config.resource,
    scope: WORK_SCOPE,
  };
  const grants = serviceDb().from(WORK_GRANTS);
  if (revoke) {
    const supplied = params.get("token");
    if (!supplied) throw invalid("A token is required.");
    const kind = /^sgw_(access|refresh)_[A-Za-z0-9_-]{43}$/.exec(supplied)?.[1];
    if (kind)
      checked(
        await grants
          .delete()
          .match(bound)
          .eq(kind + "_hash", workDigest(supplied).toString("hex")),
      );
    return new Response(null, { status: 200 });
  }
  checkResource(params, config);
  checkScope(params);
  const access = workToken("access"),
    refresh = workToken("refresh");
  const tokens = {
    access_hash: workDigest(access).toString("hex"),
    refresh_hash: workDigest(refresh).toString("hex"),
    access_expires_at: expires(accessSeconds),
  };
  const grantType = params.get("grant_type");
  let exchange;
  if (grantType === "authorization_code") {
    const verifier = params.get("code_verifier"),
      code = params.get("code");
    if (
      params.get("redirect_uri") !== config.redirectUri ||
      !verifier ||
      !/^[a-zA-Z0-9._~-]{43,128}$/.test(verifier) ||
      !code ||
      !/^sgw_code_[A-Za-z0-9_-]{43}$/.test(code)
    )
      throw invalidGrant();
    exchange = grants
      .update({
        ...tokens,
        phase: "active",
        code_hash: null,
        code_challenge: null,
        oauth_state: null,
        expires_at: expires(30 * 86400),
      })
      .eq("phase", "code")
      .eq("redirect_uri", config.redirectUri)
      .eq("code_hash", workDigest(code).toString("hex"))
      .eq("code_challenge", workDigest(verifier).toString("base64url"));
  } else if (grantType === "refresh_token") {
    const old = params.get("refresh_token");
    if (!old || !/^sgw_refresh_[A-Za-z0-9_-]{43}$/.test(old))
      throw invalidGrant();
    exchange = grants
      .update(tokens)
      .eq("phase", "active")
      .eq("refresh_hash", workDigest(old).toString("hex"));
  } else {
    throw new OAuthError(
      "unsupported_grant_type",
      "Use an authorization code or refresh token.",
    );
  }
  // The conditional UPDATE consumes the old secret and installs its successor in one transaction.
  const grant = checked(
    await exchange
      .match(bound)
      .gt("expires_at", expires(0))
      .select("expires_at")
      .maybeSingle(),
  );
  if (!grant) throw invalidGrant();
  return json({
    token_type: "Bearer",
    access_token: access,
    refresh_token: refresh,
    scope: WORK_SCOPE,
    expires_in: Math.min(
      accessSeconds,
      Math.max(
        0,
        Math.floor((Date.parse(grant.expires_at) - Date.now()) / 1000),
      ),
    ),
  });
}

const methods: Record<string, string[]> = {
  "protected-resource": ["GET"],
  "authorization-server": ["GET"],
  authorize: ["GET"],
  consent: ["GET", "POST"],
  connections: ["GET", "DELETE"],
  token: ["POST"],
  revoke: ["POST"],
};
function route(url: URL) {
  if (url.pathname === "/.well-known/oauth-authorization-server")
    return "authorization-server";
  if (
    [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/mcp",
    ].includes(url.pathname)
  )
    return "protected-resource";
  if (url.pathname === "/.netlify/functions/work-oauth")
    return url.searchParams.get("route") || "";
  return url.pathname.startsWith("/api/work-oauth/")
    ? url.pathname.slice("/api/work-oauth/".length)
    : "";
}
async function dispatch(request: Request, context?: Pick<Context, "ip">) {
  const url = new URL(request.url),
    origin = workOrigin(),
    action = route(url);
  if (url.origin !== origin || !Object.hasOwn(methods, action))
    throw new HttpError(404, "Endpoint not found.");
  if (!methods[action].includes(request.method))
    return new Response(null, {
      status: 405,
      headers: { Allow: methods[action].join(", ") },
    });
  if (action === "protected-resource" || action === "authorization-server")
    return metadata(origin, action === "protected-resource");
  const config = workConfig();
  switch (action) {
    case "authorize":
      return authorize(request, config, context?.ip);
    case "consent":
      return consent(request, config);
    case "connections":
      return connections(request, config);
    default:
      return token(request, config, action === "revoke");
  }
}

export default async function handler(
  request: Request,
  context?: Pick<Context, "ip">,
) {
  let response: Response;
  try {
    response = await dispatch(request, context);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const code =
      error instanceof OAuthError
        ? error.code
        : status >= 500
          ? "server_error"
          : "invalid_request";
    response = json(
      {
        error: code,
        error_description:
          error instanceof HttpError
            ? error.message
            : "The connection request could not be completed.",
      },
      status,
    );
    if (code === "invalid_client")
      response.headers.set(
        "WWW-Authenticate",
        'Basic realm="Simple Grants Work"',
      );
  }
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
