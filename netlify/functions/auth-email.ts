import { z } from "zod";
import { Resend } from "resend";
import type { Context } from "@netlify/functions";
import { safeAuthReturnPath } from "../../src/lib/auth-links";
import { env, HttpError, json } from "./lib/core";
import { serviceDb } from "./lib/db";
import {
  authAppOrigin,
  authEmailSender,
  authRateSecret,
  trustedAuthIp,
  authRateHash,
  authEmailContent,
  AUTH_EMAIL_ACCEPTED,
} from "./lib/auth-email";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  next: z.string().max(2048).optional(),
  website: z.string().max(300).default(""),
});
const accepted = () =>
  json({ accepted: true, message: AUTH_EMAIL_ACCEPTED }, 202);

export default async (request: Request, context: Pick<Context, "ip">) => {
  try {
    if (request.method !== "POST")
      return json({ error: "Use POST for Simple Grants sign-in." }, 405);
    const origin = authAppOrigin();
    if (request.headers.get("origin") !== origin)
      throw new HttpError(
        403,
        "Request a sign-in link from the Simple Grants website.",
      );
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      throw new HttpError(415, "Use a JSON sign-in request.");
    if (Number(request.headers.get("content-length") || 0) > 16384)
      throw new HttpError(413, "The sign-in request is too large.");
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 16384)
      throw new HttpError(413, "The sign-in request is too large.");
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Enter your email to request a sign-in link.");
    }
    const parsed = bodySchema.safeParse(value);
    if (!parsed.success)
      throw new HttpError(
        400,
        "Enter a valid email to request a sign-in link.",
      );
    const email = parsed.data.email.trim().toLowerCase();
    const next = safeAuthReturnPath(parsed.data.next);
    const ip = trustedAuthIp(context?.ip);
    // Fail closed on missing setup. Never fall back to shared-project auth email.
    const rateSecret = authRateSecret();
    const sender = authEmailSender();
    const resendKey = env("RESEND_API_KEY");
    // A quiet honeypot catches some automated form fills; durable quotas remain mandatory.
    if (parsed.data.website.trim()) return accepted();
    const db = serviceDb();
    const claim = await db.rpc("claim_auth_email", {
      p_email_hash: authRateHash(rateSecret, "email", email),
      p_ip_hash: authRateHash(rateSecret, "ip", ip),
    });
    if (claim.error)
      throw new HttpError(
        503,
        "Simple Grants sign-in is temporarily unavailable. Please try again.",
      );
    if (!claim.data) return accepted();
    const requestId = z.uuid().safeParse(claim.data);
    if (!requestId.success)
      throw new HttpError(
        503,
        "Simple Grants sign-in is temporarily unavailable. Please try again.",
      );
    if (process.env.AUTH_ALLOW_SIGNUPS !== "true") {
      const existing = await db.rpc("auth_email_user_exists", {
        p_email: email,
      });
      if (existing.error)
        throw new HttpError(
          503,
          "Simple Grants sign-in is temporarily unavailable. Please try again.",
        );
      if (existing.data !== true) return accepted();
    }
    // Every outcome after account eligibility has the same public response.
    // Provider failures must not become an account-existence oracle.
    try {
      const { data, error } = await db.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      if (error || !data?.properties)
        throw new Error("Link preparation failed");
      const properties = data.properties;
      const allowedType =
        properties.verification_type === "magiclink" ||
        (process.env.AUTH_ALLOW_SIGNUPS === "true" &&
          properties.verification_type === "signup");
      if (
        !allowedType ||
        !/^[A-Za-z0-9_-]{20,2048}$/.test(properties.hashed_token)
      )
        throw new Error("Invalid sign-in link properties");
      const link = new URL("/auth/confirm", origin);
      link.hash = new URLSearchParams({
        token_hash: properties.hashed_token,
        next,
      }).toString();
      const resend = new Resend(resendKey);
      const sent = await resend.emails.send(
        { from: sender, to: email, ...authEmailContent(link.href) },
        { idempotencyKey: `simple-grants-auth-${requestId.data}` },
      );
      if (sent.error) throw new Error("Sign-in delivery failed");
    } catch {
      // Do not log provider payloads, email addresses, tokens or action links.
      console.error(
        "Simple Grants sign-in email could not be prepared or delivered.",
      );
    }
    return accepted();
  } catch (error) {
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    // Auth provider payloads may contain bearer tokens or email addresses. Never log them.
    console.error("Simple Grants sign-in request could not be completed.");
    return json(
      {
        error:
          "Simple Grants sign-in is temporarily unavailable. Please try again.",
      },
      503,
    );
  }
};
