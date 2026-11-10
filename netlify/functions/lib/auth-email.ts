import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { env, escapeHtml, HttpError } from "./core";

export const AUTH_EMAIL_ACCEPTED =
  "If this address can sign in, we’ll email a secure Simple Grants link. Check your inbox and spam folder.";

export function authAppOrigin(): string {
  try {
    const url = new URL(
      process.env.AUTH_APP_URL || "https://simplegrants.com.au",
    );
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !url.hostname.includes(".") ||
      isIP(url.hostname.replace(/^\[|\]$/g, ""))
    )
      throw new Error("Invalid origin");
    return url.origin;
  } catch {
    throw new HttpError(
      503,
      "Simple Grants sign-in is not configured with a valid HTTPS application origin.",
    );
  }
}

export function authEmailSender(): string {
  const raw =
    process.env.AUTH_EMAIL_FROM || "Simple Grants <login@simplegrants.com.au>";
  const match = /^(?:[^<>\r\n]+<([^<>\r\n]+)>|([^<>\r\n]+))$/.exec(raw);
  const address = (match?.[1] || match?.[2] || "").trim();
  const parsed = z.email().safeParse(address);
  const domain = address.split("@")[1]?.toLowerCase();
  if (
    !parsed.success ||
    (domain !== "simplegrants.com.au" &&
      !domain?.endsWith(".simplegrants.com.au"))
  )
    throw new HttpError(
      503,
      "Simple Grants sign-in needs a verified sender on simplegrants.com.au.",
    );
  return raw;
}

export function authRateSecret(): string {
  const value = env("AUTH_RATE_LIMIT_SECRET");
  if (
    value.length < 32 ||
    /replace[ _-]?me|your[_ -]|change[ _-]?me|placeholder|example/i.test(
      value,
    ) ||
    /^(.)\1+$/.test(value)
  )
    throw new HttpError(
      503,
      "Simple Grants sign-in needs a securely generated rate-limit secret of at least 32 characters.",
    );
  return value;
}
export function authRateHash(
  secret: string,
  kind: "email" | "ip",
  value: string,
): string {
  return createHmac("sha256", secret)
    .update(`simple-grants-auth-v1:${kind}:${value}`)
    .digest("hex");
}
export function trustedAuthIp(ip: string | undefined): string {
  if (!ip || isIP(ip) === 0)
    throw new HttpError(
      503,
      "The sign-in request could not be verified. Please try again from the Simple Grants website.",
    );
  return ip.toLowerCase();
}

export function authEmailContent(link: string) {
  const escaped = escapeHtml(link);
  return {
    subject: "Your Simple Grants sign-in link",
    text: `Sign in to Simple Grants\n\nOpen your secure Simple Grants sign-in page:\n${link}\n\nChoose “Sign in to Simple Grants” on that page to continue. This link can be used once. Do not forward it.\n\nIf you did not request this email, you can ignore it.`,
    html: `<!doctype html><html lang="en-AU"><body style="margin:0;background:#f7f7f2;font-family:Arial,sans-serif;color:#20392f"><div style="max-width:560px;margin:32px auto;padding:36px;background:#fff;border-radius:12px"><p style="font-size:22px;font-weight:bold;color:#244c3f">Simple Grants</p><h1 style="font-size:28px;line-height:1.25">Your workspace is one step away.</h1><p style="font-size:17px;line-height:1.6">Use this secure link to open Simple Grants. You’ll confirm that you want to sign in on the next page.</p><p style="margin:28px 0"><a href="${escaped}" style="display:inline-block;background:#244c3f;color:#fff;padding:15px 22px;border-radius:7px;text-decoration:none;font-size:17px">Open Simple Grants</a></p><p style="font-size:14px;line-height:1.6">This link can be used once. Do not forward it. If you did not request this email, you can ignore it.</p></div></body></html>`,
  };
}
