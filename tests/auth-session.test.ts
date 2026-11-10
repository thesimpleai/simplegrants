import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAuthStorageKey,
  signOutFromSimpleGrant,
} from "../src/lib/auth-session";

const projectUrl = "https://shared-project.supabase.co";
const defaultKey = "sb-shared-project-auth-token";
function session(label: string) {
  return {
    access_token: `${label}-test-access-token`,
    refresh_token: `${label}-test-refresh-token`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: `${label}-user`,
      email: `${label}@example.com`,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}
function memoryStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}
function client(
  storage: ReturnType<typeof memoryStorage>,
  fetch: typeof globalThis.fetch,
) {
  return createClient(projectUrl, "test-public-key", {
    auth: {
      storageKey: getAuthStorageKey(projectUrl),
      storage,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: true,
    },
    global: { fetch },
  });
}
afterEach(() => vi.restoreAllMocks());

describe("Simple Grant browser session isolation", () => {
  it("uses a deterministic app/project namespace without embedding URL credentials or keys", () => {
    expect(getAuthStorageKey(projectUrl)).toBe(
      "simple-grants-auth-v1-shared-project.supabase.co",
    );
    expect(getAuthStorageKey(`${projectUrl}/`)).toBe(
      getAuthStorageKey(projectUrl),
    );
    expect(getAuthStorageKey("https://another-project.supabase.co")).not.toBe(
      getAuthStorageKey(projectUrl),
    );
    expect(getAuthStorageKey("http://localhost:54321")).not.toBe(
      getAuthStorageKey("http://localhost:54322"),
    );
    expect(
      getAuthStorageKey(
        "https://ignored-user:ignored-password@shared-project.supabase.co/path?ignored-key=value",
      ),
    ).toBe(getAuthStorageKey(projectUrl));
  });
  it("the real SDK ignores an existing default-key session and preserves it", async () => {
    const oldSession = JSON.stringify(session("other-app"));
    const storage = memoryStorage({ [defaultKey]: oldSession });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error("No network call should be needed.");
    });
    const supabase = client(storage, fetch);
    const result = await supabase.auth.getSession();
    expect(result.error).toBeNull();
    expect(result.data.session).toBeNull();
    expect(storage.getItem.mock.calls.some(([key]) => key === defaultKey)).toBe(
      false,
    );
    expect(storage.getItem(defaultKey)).toBe(oldSession);
    expect(storage.removeItem).not.toHaveBeenCalledWith(defaultKey);
    expect(fetch).not.toHaveBeenCalled();
    await supabase.auth.stopAutoRefresh();
  });
  it("loads only its own session and logs out with scope=local while preserving the old key", async () => {
    const oldSession = JSON.stringify(session("other-app"));
    const ownSession = session("simple-grant");
    const storage = memoryStorage({
      [defaultKey]: oldSession,
      [getAuthStorageKey(projectUrl)]: JSON.stringify(ownSession),
    });
    const requests: Request[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(null, { status: 204 });
    });
    const supabase = client(storage, fetch);
    expect((await supabase.auth.getSession()).data.session?.user.id).toBe(
      ownSession.user.id,
    );
    await signOutFromSimpleGrant(supabase);
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).pathname).toBe("/auth/v1/logout");
    expect(new URL(requests[0].url).searchParams.get("scope")).toBe("local");
    expect(requests[0].headers.get("authorization")).toBe(
      `Bearer ${ownSession.access_token}`,
    );
    expect((await supabase.auth.getSession()).data.session).toBeNull();
    expect(storage.getItem(defaultKey)).toBe(oldSession);
    expect(storage.removeItem).not.toHaveBeenCalledWith(defaultKey);
    await supabase.auth.stopAutoRefresh();
  });
  it("propagates a provider logout error instead of reporting success", async () => {
    const oldSession = JSON.stringify(session("other-app"));
    const storage = memoryStorage({
      [defaultKey]: oldSession,
      [getAuthStorageKey(projectUrl)]: JSON.stringify(session("simple-grant")),
    });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({
            message: "Logout unavailable",
            code: "unexpected_failure",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
    );
    const supabase = client(storage, fetch);
    await expect(signOutFromSimpleGrant(supabase)).rejects.toMatchObject({
      message: "Logout unavailable",
    });
    expect(storage.getItem(defaultKey)).toBe(oldSession);
    await supabase.auth.stopAutoRefresh();
  });
});
