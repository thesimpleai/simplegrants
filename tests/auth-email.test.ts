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
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
function request(
  body: unknown = { email: "member@example.com" },
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
  vi.stubEnv("AUTH_ALLOW_SIGNUPS", "false");
  vi.stubEnv("RESEND_API_KEY", "test-private-resend-key");
  fetchMock = vi.fn<typeof fetch>(async () => {
    throw new Error("Unexpected external request in sign-in test");
  });
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
  it("rejects oversized UTF-8 bodies, malformed JSON, invalid email and invalid honeypot input", async () => {
    expect(
      (
        await call({
          email: "member@example.com",
          junk: "🎉".repeat(5000),
        })
      ).status,
    ).toBe(413);
    expect((await call("{not-json")).status).toBe(400);
    expect((await call({ email: "not-an-email" })).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect(
      (await call({ email: "member@example.com", website: 123 })).status,
    ).toBe(400);
    expect(
      (await call({ email: "member@example.com", website: "x".repeat(301) }))
        .status,
    ).toBe(400);
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
    noDelivery();
  });
});

describe("durable anti-abuse checks without external CAPTCHA", () => {
  it("accepts a plain email-only request and sends the app-specific link without a challenge or verification fetch", async () => {
    const response = await call({ email: "member@example.com" });
    expect(response.status).toBe(202);
    expect(mocks.generateLink).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("quietly accepts a filled honeypot without database, auth or mail provider access", async () => {
    const response = await call({
      email: "member@example.com",
      website: "https://automated-form.example",
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      accepted: true,
      message: AUTH_EMAIL_ACCEPTED,
    });
    expect(mocks.serviceDb).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    noDelivery();
  });
  it.each(["claim-error", "claim-throws", "invalid-claim", "lookup-error"])(
    "fails closed without sending when durable auth control is unavailable: %s",
    async (failure) => {
      if (failure === "claim-error")
        mocks.rpc.mockResolvedValueOnce({
          data: null,
          error: { message: "RPC missing" },
        });
      if (failure === "claim-throws")
        mocks.rpc.mockRejectedValueOnce(new Error("Database unavailable"));
      if (failure === "invalid-claim")
        mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
      if (failure === "lookup-error")
        mocks.rpc.mockImplementation(async (name: string) =>
          name === "claim_auth_email"
            ? { data: claimId, error: null }
            : { data: null, error: { message: "Lookup unavailable" } },
        );
      expect((await call()).status).toBe(503);
      noDelivery();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it("stores domain-separated HMACs rather than email or IP and claims before lookup", async () => {
    await call({
      email: "  MEMBER@EXAMPLE.COM  ",
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
