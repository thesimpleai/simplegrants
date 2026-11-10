import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  generateLink: vi.fn(),
  send: vi.fn(),
  serviceDb: vi.fn(),
}));
vi.mock("../netlify/functions/lib/db", () => ({ serviceDb: mocks.serviceDb }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));
import handler from "../netlify/functions/auth-email";
import {
  AUTH_EMAIL_ACCEPTED,
  authRateHash,
} from "../netlify/functions/lib/auth-email";

const origin = "https://simplegrants.com.au";
const ip = "203.0.113.25";
const claimId = "6a03978d-6266-46b6-b35e-bf8069e50743";
const tokenHash =
  "64a6ffef3259512b383ac34e91dedc6ae3a1d36b4e1763df08ba259812ff8891";
const secret =
  "2d8646cfa93ef187c255e62184ab7f76c7d12e867cad427db9ba1fe59a48b102";
let captcha: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
function request(
  body: unknown = { email: "member@example.com", captchaToken: "widget-token" },
  headers: Record<string, string> = {},
  method = "POST",
) {
  return new Request(`${origin}/api/auth-email`, {
    method,
    headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    ...(method === "POST"
      ? { body: typeof body === "string" ? body : JSON.stringify(body) }
      : {}),
  });
}
const call = (body?: unknown, headers?: Record<string, string>) =>
  handler(request(body, headers), { ip });
function generated(verificationType = "magiclink") {
  return {
    data: {
      properties: {
        hashed_token: tokenHash,
        verification_type: verificationType,
        action_link:
          "https://other-application.example/auth/verify?token=DO-NOT-SEND-NATIVE-LINK",
        email_otp: "DO-NOT-SEND-OTP",
      },
      user: { id: "shared-auth-user" },
    },
    error: null,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("AUTH_APP_URL", origin);
  vi.stubEnv("AUTH_EMAIL_FROM", "Simple Grants <login@simplegrants.com.au>");
  vi.stubEnv("AUTH_RATE_LIMIT_SECRET", secret);
  vi.stubEnv("AUTH_TURNSTILE_SECRET_KEY", "test-private-turnstile-key");
  vi.stubEnv("AUTH_ALLOW_SIGNUPS", "false");
  vi.stubEnv("RESEND_API_KEY", "test-private-resend-key");
  captcha = {
    success: true,
    hostname: "simplegrants.com.au",
    action: "simple-grants-sign-in",
  };
  fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(captcha), {
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "claim_auth_email" ? claimId : true,
    error: null,
  }));
  mocks.serviceDb.mockReturnValue({
    rpc: mocks.rpc,
    auth: { admin: { generateLink: mocks.generateLink } },
  });
  mocks.generateLink.mockResolvedValue(generated());
  mocks.send.mockResolvedValue({ data: { id: "sent-email" }, error: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function noDelivery() {
  expect(mocks.generateLink).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
}

describe("public auth email request boundaries", () => {
  it("rejects non-POST and off-origin requests without provider access", async () => {
    expect((await handler(request(undefined, {}, "GET"), { ip })).status).toBe(
      405,
    );
    expect(
      (await call(undefined, { Origin: "https://other-application.example" }))
        .status,
    ).toBe(403);
    expect((await call(undefined, { Origin: "null" })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    noDelivery();
  });
  it("requires a trusted context IP and ignores spoofed forwarding headers", async () => {
    const response = await handler(
      request(undefined, { "X-Forwarded-For": ip }),
      { ip: "" },
    );
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    noDelivery();
  });
  it("rejects oversized UTF-8 bodies, malformed JSON, invalid email and missing CAPTCHA", async () => {
    expect(
      (
        await call({
          email: "member@example.com",
          captchaToken: "widget-token",
          junk: "🎉".repeat(5000),
        })
      ).status,
    ).toBe(413);
    expect((await call("{not-json")).status).toBe(400);
    expect(
      (await call({ email: "not-an-email", captchaToken: "widget-token" }))
        .status,
    ).toBe(400);
    expect((await call({ email: "member@example.com" })).status).toBe(400);
    expect(
      (await call(undefined, { "Content-Type": "text/plain" })).status,
    ).toBe(415);
    noDelivery();
  });
  it.each([
    "http://simplegrants.com.au",
    `${origin}/other-app`,
    `${origin}/?next=evil`,
    `${origin}/#fragment`,
    "https://user:password@simplegrants.com.au",
    "https://simplegrants.com.au:8443",
  ])(
    "fails closed for non-canonical configured origin %s",
    async (configured) => {
      vi.stubEnv("AUTH_APP_URL", configured);
      expect((await call()).status).toBe(503);
      expect(fetchMock).not.toHaveBeenCalled();
      noDelivery();
    },
  );
  it("requires a strong configured rate secret and dedicated sender domain", async () => {
    for (const value of [
      "",
      "short",
      "REPLACE_ME_WITH_A_STRONG_RANDOM_SECRET_1234",
      "a".repeat(64),
    ]) {
      vi.stubEnv("AUTH_RATE_LIMIT_SECRET", value);
      expect((await call()).status).toBe(503);
    }
    vi.stubEnv("AUTH_RATE_LIMIT_SECRET", secret);
    vi.stubEnv("AUTH_EMAIL_FROM", "Other App <login@other-app.example>");
    expect((await call()).status).toBe(503);
    noDelivery();
  });
  it("fails closed until the provider keys are configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect((await call()).status).toBe(503);
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("AUTH_TURNSTILE_SECRET_KEY", "");
    expect((await call()).status).toBe(503);
    noDelivery();
  });
});

describe("Turnstile and durable anti-abuse checks", () => {
  it.each([
    { success: false },
    {
      success: true,
      hostname: "other-app.example",
      action: "simple-grants-sign-in",
    },
    { success: true, hostname: "simplegrants.com.au", action: "other-action" },
  ])(
    "rejects invalid CAPTCHA result before quota/user lookup: %j",
    async (result) => {
      captcha = result;
      expect((await call()).status).toBe(400);
      expect(mocks.rpc).not.toHaveBeenCalled();
      noDelivery();
    },
  );
  it("validates with the fixed official endpoint, trusted IP and short timeout", async () => {
    await call();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(options?.method).toBe("POST");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    const values = options?.body as URLSearchParams;
    expect(values.get("remoteip")).toBe(ip);
    expect(values.get("response")).toBe("widget-token");
  });
  it("does not weaken CAPTCHA when validation is unavailable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network unavailable"));
    expect((await call()).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
    noDelivery();
  });
  it("stores domain-separated HMACs rather than email or IP and claims before lookup", async () => {
    await call({
      email: "  MEMBER@EXAMPLE.COM  ",
      captchaToken: "widget-token",
    });
    expect(mocks.rpc.mock.calls[0]).toEqual([
      "claim_auth_email",
      {
        p_email_hash: authRateHash(secret, "email", "member@example.com"),
        p_ip_hash: authRateHash(secret, "ip", ip),
      },
    ]);
    const args = JSON.stringify(mocks.rpc.mock.calls[0]);
    expect(args).not.toContain("member@example.com");
    expect(args).not.toContain(ip);
    expect(mocks.rpc.mock.calls[1]).toEqual([
      "auth_email_user_exists",
      { p_email: "member@example.com" },
    ]);
    expect(mocks.generateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: "member@example.com",
    });
  });
  it("returns the same generic acceptance for rate suppression, unknown address and healthy delivery", async () => {
    const healthy = await call();
    const body = await healthy.json();
    mocks.generateLink.mockClear();
    mocks.send.mockClear();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    const limited = await call();
    expect(limited.status).toBe(202);
    expect(await limited.json()).toEqual(body);
    noDelivery();
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "claim_auth_email" ? claimId : false,
      error: null,
    }));
    const unknown = await call();
    expect(unknown.status).toBe(202);
    expect(await unknown.json()).toEqual(body);
    noDelivery();
    expect(body).toEqual({ accepted: true, message: AUTH_EMAIL_ACCEPTED });
  });
  it("requires an explicit signup opt-in rather than silently creating unknown shared users", async () => {
    vi.stubEnv("AUTH_ALLOW_SIGNUPS", "true");
    await call();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.generateLink).toHaveBeenCalledTimes(1);
  });
});

describe("app-specific sign-in email", () => {
  it("sends only its own canonical callback with token in fragment and validated portal target", async () => {
    const next =
      "/?view=opportunities&org=6a03978d-6266-46b6-b35e-bf8069e50743&grant=6a03978d-6266-46b6-b35e-bf8069e50744";
    const response = await call({
      email: "member@example.com",
      captchaToken: "widget-token",
      next,
    });
    expect(response.status).toBe(202);
    const [message, options] = mocks.send.mock.calls[0];
    expect(message.from).toBe("Simple Grants <login@simplegrants.com.au>");
    expect(message.subject).toBe("Your Simple Grants sign-in link");
    expect(message.to).toBe("member@example.com");
    const linkText = (message.text as string)
      .split("\n")
      .find((line) => line.startsWith("https://"))!;
    const link = new URL(linkText);
    expect(link.origin).toBe(origin);
    expect(link.pathname).toBe("/auth/confirm");
    expect(link.search).toBe("");
    const fragment = new URLSearchParams(link.hash.slice(1));
    expect(fragment.get("token_hash")).toBe(tokenHash);
    expect(fragment.get("next")).toBe(next);
    expect(message.html).not.toContain("other-application.example");
    expect(message.text).not.toContain("DO-NOT-SEND-OTP");
    expect(options.idempotencyKey).toBe(`simple-grants-auth-${claimId}`);
    expect(JSON.stringify(await response.json())).not.toContain(tokenHash);
  });
  it("never accepts an arbitrary external return URL", async () => {
    await call({
      email: "member@example.com",
      captchaToken: "widget-token",
      next: "https://other-application.example",
    });
    const link = new URL(
      (mocks.send.mock.calls[0][0].text as string)
        .split("\n")
        .find((line) => line.startsWith("https://"))!,
    );
    expect(new URLSearchParams(link.hash.slice(1)).get("next")).toBe("/");
  });
  it("rejects non-sign-in token types rather than allowing a recovery or invite flow", async () => {
    mocks.generateLink.mockResolvedValueOnce(generated("recovery"));
    expect((await call()).status).toBe(202);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each([
    "generate-throws",
    "send-throws",
    "send-error",
    "missing-properties",
    "short-token",
  ])(
    "returns unknown-account-equivalent acceptance for downstream %s",
    async (failure) => {
      if (failure === "generate-throws")
        mocks.generateLink.mockRejectedValueOnce(
          new Error(`SECRET ${tokenHash}`),
        );
      if (failure === "send-throws")
        mocks.send.mockRejectedValueOnce(new Error(`SECRET ${tokenHash}`));
      if (failure === "send-error")
        mocks.send.mockResolvedValueOnce({
          error: { message: `SECRET ${tokenHash}` },
        });
      if (failure === "missing-properties")
        mocks.generateLink.mockResolvedValueOnce({ data: {}, error: null });
      if (failure === "short-token")
        mocks.generateLink.mockResolvedValueOnce({
          data: {
            properties: {
              verification_type: "magiclink",
              hashed_token: "a".repeat(19),
            },
          },
          error: null,
        });
      const failed = await call();
      expect(failed.status).toBe(202);
      const body = await failed.json();
      mocks.rpc.mockImplementation(async (name: string) => ({
        data: name === "claim_auth_email" ? claimId : false,
        error: null,
      }));
      const unknown = await call();
      expect(unknown.status).toBe(202);
      expect(await unknown.json()).toEqual(body);
      expect(body).toEqual({ accepted: true, message: AUTH_EMAIL_ACCEPTED });
    },
  );
  it("never exposes or logs provider token payloads on failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.generateLink.mockResolvedValueOnce({
      data: null,
      error: { message: `SECRET ${tokenHash} member@example.com` },
    });
    const response = await call();
    expect(response.status).toBe(202);
    expect(JSON.stringify(await response.json())).not.toContain(tokenHash);
    expect(JSON.stringify(log.mock.calls)).not.toContain(tokenHash);
    expect(JSON.stringify(log.mock.calls)).not.toContain("member@example.com");
    expect(mocks.send).not.toHaveBeenCalled();
    mocks.send.mockResolvedValueOnce({
      error: { message: `SECRET ${tokenHash}` },
    });
    const sendFailure = await call();
    expect(sendFailure.status).toBe(202);
    expect(JSON.stringify(await sendFailure.json())).not.toContain(tokenHash);
  });
});
