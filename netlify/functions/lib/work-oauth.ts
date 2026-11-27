import { createHash, randomBytes } from "node:crypto";
import { authAppOrigin } from "./auth-email";
import { env, HttpError } from "./core";
import { checked, serviceDb, type AppDb } from "./db";

export const WORK_SCOPE = "simple-grants";
export const WORK_GRANTS = "work_oauth_grants";
export type WorkIdentity = {
  db: AppDb;
  orgId: string;
  userId: string;
  role: "owner" | "member" | "viewer";
};

export function workOrigin() {
  if (process.env.WORK_MCP_ENABLED !== "true")
    throw new HttpError(404, "The ChatGPT Work connection is unavailable.");
  env("AUTH_APP_URL");
  return authAppOrigin();
}

export function workConfig() {
  const origin = workOrigin();
  const redirectUri = env("WORK_OAUTH_REDIRECT_URI");
  const redirect = URL.canParse(redirectUri) ? new URL(redirectUri) : null;
  if (
    !redirect ||
    !["https://chatgpt.com", "https://chat.openai.com"].includes(
      redirect.origin,
    ) ||
    redirect.username ||
    redirect.password ||
    redirect.hash ||
    ["code", "state", "error", "iss"].some((key) =>
      redirect.searchParams.has(key),
    )
  )
    throw new HttpError(
      503,
      "The ChatGPT Work callback is not configured correctly.",
    );
  return {
    origin,
    resource: origin + "/api/mcp",
    clientId: env("WORK_OAUTH_CLIENT_ID"),
    secret: env("WORK_OAUTH_CLIENT_SECRET"),
    redirectUri,
  };
}
export type WorkConfig = ReturnType<typeof workConfig>;

export function workDigest(value: string) {
  return createHash("sha256").update(value).digest();
}
export function workToken(kind: "code" | "access" | "refresh") {
  return "sgw_" + kind + "_" + randomBytes(32).toString("base64url");
}
export function workChallenge() {
  return (
    'Bearer resource_metadata="' +
    workOrigin() +
    '/.well-known/oauth-protected-resource/api/mcp", scope="' +
    WORK_SCOPE +
    '"'
  );
}

export async function authenticateWork(
  request: Request,
): Promise<WorkIdentity> {
  const origin = workOrigin();
  const token = /^Bearer (sgw_access_[A-Za-z0-9_-]{43})$/i.exec(
    request.headers.get("authorization") || "",
  )?.[1];
  const unauthorized = () =>
    new HttpError(401, "A valid Simple Grants Work access token is required.");
  if (new URL(request.url).origin !== origin || !token) throw unauthorized();
  const config = workConfig();
  const db = serviceDb();
  const now = new Date().toISOString();
  const grant = checked(
    await db
      .from(WORK_GRANTS)
      .select("org_id,user_id")
      .eq("phase", "active")
      .eq("client_id", config.clientId)
      .eq("resource", config.resource)
      .eq("scope", WORK_SCOPE)
      .eq("access_hash", workDigest(token).toString("hex"))
      .gt("access_expires_at", now)
      .gt("expires_at", now)
      .maybeSingle(),
  );
  if (!grant) throw unauthorized();
  const member = checked(
    await db
      .from("organization_members")
      .select("role")
      .eq("org_id", grant.org_id)
      .eq("user_id", grant.user_id)
      .maybeSingle(),
  );
  const role = member?.role === "admin" ? "member" : member?.role;
  if (role !== "owner" && role !== "member" && role !== "viewer")
    throw unauthorized();
  return { db, orgId: grant.org_id, userId: grant.user_id, role };
}
