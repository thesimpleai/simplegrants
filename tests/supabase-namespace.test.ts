import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedDb, serviceDb } from "../netlify/functions/lib/db";
import { documentParts } from "../netlify/functions/lib/gemini";
import { DB_SCHEMA, DOCUMENT_BUCKET } from "../src/lib/constants";

const orgId = "6a03978d-6266-46b6-b35e-bf8069e50743";
const documentId = "6a03978d-6266-46b6-b35e-bf8069e50744";
const document = {
  id: documentId,
  org_id: orgId,
  name: "History.txt",
  category: "other",
  storage_path: `${orgId}/${documentId}/history.txt`,
  mime_type: "text/plain",
  size_bytes: 18,
  verified: false,
  expires_on: null,
};
let requests: Request[];

beforeEach(() => {
  requests = [];
  vi.stubEnv("SUPABASE_URL", "https://shared.example.supabase.co");
  vi.stubEnv("SUPABASE_ANON_KEY", "test-public-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-server-only-key");
  // Exercise the actual Supabase SDK request transport. No network or credentials.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const path = new URL(request.url).pathname;
      const headers = { "Content-Type": "application/json" };
      if (path === "/auth/v1/user")
        return new Response(
          JSON.stringify({
            id: "verified-member-id",
            aud: "authenticated",
            role: "authenticated",
            email: "member@example.com",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-01-01T00:00:00Z",
          }),
          { headers },
        );
      if (path === "/rest/v1/organization_members")
        return new Response(JSON.stringify([{ role: "member" }]), { headers });
      if (path === "/rest/v1/documents")
        return new Response(JSON.stringify([document]), { headers });
      if (path.startsWith("/rest/v1/rpc/"))
        return new Response("true", { headers });
      if (path.startsWith("/rest/v1/")) return new Response("[]", { headers });
      if (
        path ===
        `/storage/v1/object/${DOCUMENT_BUCKET}/${document.storage_path}`
      )
        return new Response("Community history.", {
          headers: { "Content-Type": "text/plain" },
        });
      throw new Error(`Unexpected SDK route: ${path}`);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

for (const mode of ["authenticated", "service"] as const) {
  describe(`${mode} Supabase namespace isolation`, () => {
    it("sends read, write and RPC schema headers and downloads only from the dedicated bucket", async () => {
      const client =
        mode === "service"
          ? serviceDb()
          : (
              await authenticatedDb(
                new Request("https://portal.example.com/api/ai", {
                  headers: { Authorization: "Bearer test-user-jwt" },
                }),
                orgId,
              )
            ).db;
      const tableRead = await client.from("organizations").select("id");
      expect(tableRead.error).toBeNull();
      const tableWrite = await client
        .from("applications")
        .insert({ org_id: orgId, title: "Local transport test" });
      expect(tableWrite.error).toBeNull();
      const rpc = await client.rpc(
        mode === "service" ? "claim_notification_run" : "claim_ai_request",
        { p_org_id: orgId },
      );
      expect(rpc.error).toBeNull();
      const parts = await documentParts(client, orgId, [documentId]);
      expect(parts.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: "Community history." }),
        ]),
      );
      const rest = requests.filter((request) =>
        new URL(request.url).pathname.startsWith("/rest/v1/"),
      );
      expect(rest.length).toBeGreaterThanOrEqual(4);
      for (const request of rest) {
        const profile = request.headers.get(
          request.method === "GET" || request.method === "HEAD"
            ? "Accept-Profile"
            : "Content-Profile",
        );
        expect(profile).toBe(DB_SCHEMA);
        expect(profile).not.toBe("public");
        expect(request.headers.get("apikey")).toBe(
          mode === "service" ? "test-server-only-key" : "test-public-key",
        );
        expect(request.headers.get("authorization")).toBe(
          mode === "service"
            ? "Bearer test-server-only-key"
            : "Bearer test-user-jwt",
        );
      }
      const writes = rest.filter((request) => request.method === "POST");
      expect(
        writes.some((request) =>
          new URL(request.url).pathname.includes("/rpc/"),
        ),
      ).toBe(true);
      expect(
        writes.some(
          (request) =>
            new URL(request.url).pathname === "/rest/v1/applications",
        ),
      ).toBe(true);
      const downloads = requests.filter((request) =>
        new URL(request.url).pathname.startsWith("/storage/"),
      );
      expect(downloads).toHaveLength(1);
      expect(new URL(downloads[0].url).pathname).toBe(
        `/storage/v1/object/${DOCUMENT_BUCKET}/${document.storage_path}`,
      );
      expect(downloads[0].headers.get("authorization")).toBe(
        mode === "service"
          ? "Bearer test-server-only-key"
          : "Bearer test-user-jwt",
      );
      expect(
        requests.some((request) =>
          new URL(request.url).pathname.includes(
            "/object/authenticated/documents/",
          ),
        ),
      ).toBe(false);
    });
  });
}

describe("browser Supabase namespace isolation", () => {
  it("targets the app schema for real SDK table reads and writes and organisation creation RPC", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://shared.example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-browser-public-key");
    vi.resetModules();
    const { supabase, configured } = await import("../src/lib/supabase");
    expect(configured).toBe(true);
    expect(supabase).not.toBeNull();
    expect(
      (await supabase!.from("organizations").select("id")).error,
    ).toBeNull();
    expect(
      (
        await supabase!
          .from("documents")
          .insert({ org_id: orgId, name: "Browser upload metadata" })
      ).error,
    ).toBeNull();
    expect(
      (
        await supabase!.rpc("create_organization", {
          p_name: "Transport-only test",
          p_frequency: "never",
        })
      ).error,
    ).toBeNull();
    const download = await supabase!.storage
      .from(DOCUMENT_BUCKET)
      .download(document.storage_path);
    expect(download.error).toBeNull();
    const rest = requests.filter((request) =>
      new URL(request.url).pathname.startsWith("/rest/v1/"),
    );
    expect(rest).toHaveLength(3);
    for (const request of rest) {
      expect(
        request.headers.get(
          request.method === "GET" ? "Accept-Profile" : "Content-Profile",
        ),
      ).toBe(DB_SCHEMA);
      expect(request.headers.get("apikey")).toBe("test-browser-public-key");
      expect(request.headers.get("authorization")).not.toContain(
        "test-server-only-key",
      );
    }
    const downloads = requests.filter((request) =>
      new URL(request.url).pathname.startsWith("/storage/"),
    );
    expect(downloads).toHaveLength(1);
    expect(new URL(downloads[0].url).pathname).toBe(
      `/storage/v1/object/${DOCUMENT_BUCKET}/${document.storage_path}`,
    );
  });
});
