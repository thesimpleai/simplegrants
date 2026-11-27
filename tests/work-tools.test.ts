import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  callWorkTool,
  workToolDefinitions,
} from "../netlify/functions/lib/work-tools";
import type { WorkIdentity } from "../netlify/functions/lib/work-oauth";

const orgId = "77777777-7111-4111-a111-777777777777";
const otherOrg = "88888888-8111-4111-a111-888888888888";
const docId = "dddddddd-d111-4111-a111-dddddddddddd";
const grantId = "eeeeeeee-e111-4111-a111-eeeeeeeeeeee";
const appId = "aaaaaaaa-a111-4111-a111-aaaaaaaaaaaa";
const initialRevision = "2026-10-01T00:00:00.123456+00:00";
const nextRevision = "2026-10-02T00:00:00.123456+00:00";

type Row = Record<string, unknown>;

function harness(role: WorkIdentity["role"] = "member") {
  const rows: Record<string, Row[]> = {
    organizations: [
      {
        id: orgId,
        name: "Community Centre",
        verification_status: "approved",
        profile: {},
      },
    ],
    documents: [],
    document_text_extracts: [],
    opportunities: [],
    applications: [],
  };
  const files = new Map<string, string>();
  const errors = {
    failNextDocumentInsert: false,
    beforeApplicationUpdate: false,
  };
  const requests = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      if (url.pathname.startsWith("/storage/v1/object/")) {
        const path = url.pathname.slice(
          "/storage/v1/object/simple-grant-documents/".length,
        );
        expect(path.startsWith(`${orgId}/`)).toBe(true);
        if (req.method === "POST") {
          if (files.has(path))
            return Response.json(
              { statusCode: "409", error: "Duplicate", message: "Exists" },
              { status: 400 },
            );
          files.set(path, await req.text());
          return Response.json({ Key: path, Id: "generated" });
        }
        return files.has(path)
          ? new Response(files.get(path))
          : new Response(null, { status: 404 });
      }
      const table = url.pathname.split("/").at(-1)!;
      const collection = rows[table];
      expect(collection).toBeDefined();
      const selects = url.searchParams.get("select")?.split(",");
      const projection = (row: Row) =>
        selects && !selects.includes("*")
          ? Object.fromEntries(selects.map((key) => [key, row[key]]))
          : row;
      const selected = () =>
        collection.filter((row) =>
          [...url.searchParams].every(([key, value]) => {
            if (value.startsWith("eq."))
              return String(row[key]) === value.slice(3);
            if (value.startsWith("in.("))
              return value.slice(4, -1).split(",").includes(String(row[key]));
            return true;
          }),
        );
      if (req.method === "GET") {
        if (table === "organizations")
          expect(url.searchParams.get("id")).toBe(`eq.${orgId}`);
        else expect(url.searchParams.get("org_id")).toBe(`eq.${orgId}`);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 1_000);
        return Response.json(
          selected()
            .slice(offset, offset + limit)
            .map(projection),
        );
      }
      const inputRows = await req.json();
      if (req.method === "POST") {
        if (table === "documents" && errors.failNextDocumentInsert) {
          errors.failNextDocumentInsert = false;
          return Response.json(
            { message: "Injected DB outage" },
            { status: 503 },
          );
        }
        const saved = (
          Array.isArray(inputRows) ? inputRows : [inputRows]
        ).flatMap((row: Row) => {
          expect(row.org_id).toBe(orgId);
          if (collection.some((existing) => existing.id === row.id)) return [];
          const created = { ...row, updated_at: initialRevision };
          collection.push(created);
          return [projection(created)];
        });
        return Response.json(
          Array.isArray(inputRows) ? saved : (saved[0] ?? null),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      expect(req.method).toBe("PATCH");
      expect(url.searchParams.get("org_id")).toBe(`eq.${orgId}`);
      expect(url.searchParams.get("updated_at")).toBe(`eq.${initialRevision}`);
      if (errors.beforeApplicationUpdate)
        collection[0].updated_at = nextRevision;
      const updates = selected().map((row) => {
        Object.assign(row, inputRows, { updated_at: nextRevision });
        return projection(row);
      });
      return Response.json(updates);
    },
  );
  const db = createClient("https://supabase.example.com", "fake-service-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: requests },
    db: { schema: "simple_grant" },
  });
  const identity: WorkIdentity = { db, orgId, role, userId: "work-user" };
  return {
    rows,
    files,
    errors,
    requests,
    call: (name: string, args: unknown = {}) =>
      callWorkTool(name, args, identity),
  };
}

function doc(fields: Row = {}) {
  return {
    id: docId,
    org_id: orgId,
    name: "Strategy.txt",
    category: "mission",
    mime_type: "text/plain",
    size_bytes: 40,
    storage_path: `${orgId}/${docId}/Strategy.txt`,
    verified: false,
    ...fields,
  };
}

function grant(fields: Row = {}) {
  return {
    id: grantId,
    org_id: orgId,
    title: "Community Grants",
    funder: "State Agency",
    status: "open",
    source_url: "https://grants.example.org/community",
    focus_areas: [],
    requirements: [],
    provenance: {},
    ...fields,
  };
}

function app(fields: Row = {}) {
  return {
    id: appId,
    org_id: orgId,
    opportunity_id: grantId,
    title: "Community Grants",
    status: "review",
    draft: {
      sections: [{ question: "Purpose", answer: "Existing answer" }],
      readiness: { score: 82 },
    },
    project_details: { approved_detail: "keep" },
    updated_at: initialRevision,
    ...fields,
  };
}

const newDraft = {
  opportunity_id: grantId,
  application_text: "Purpose\nA community food garden.",
  approved: true,
};
const updateDraft = {
  ...newDraft,
  application_id: appId,
  expected_updated_at: initialRevision,
};

describe("ChatGPT Work tools", () => {
  it("exposes reads and three specific approved writes, with no generic data access", async () => {
    const writes = workToolDefinitions.filter(
      ({ annotations }) => !annotations.readOnlyHint,
    );
    expect(writes.map(({ name }) => name)).toEqual([
      "save_source_note",
      "save_opportunity",
      "save_application_draft",
    ]);
    expect(writes[2].annotations.destructiveHint).toBe(true);
    const viewer = harness("viewer");
    const editor = harness();
    await expect(
      viewer.call("save_application_draft", newDraft),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      editor.call("save_application_draft", { ...newDraft, approved: false }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      editor.call("save_opportunity", {
        title: "Unsafe link",
        source_url: "https://127.0.0.1/file",
        approved: true,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      editor.call("get_organisation", { org_id: otherOrg }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(editor.call("__proto__")).rejects.toMatchObject({
      status: 400,
    });
    expect(viewer.requests).not.toHaveBeenCalled();
    expect(editor.requests).not.toHaveBeenCalled();
  });

  it("returns reviewed profile facts without private fields or raw secrets", async () => {
    const { rows, call } = harness();
    rows.organizations[0].profile = {
      name: "Community Centre",
      mission: "Give meals. Password: rosebud",
      bank_details: "sensitive",
      registration_number: "RG123",
    };
    expect(await call("get_organisation")).toMatchObject({
      approved_profile: {
        name: "Community Centre",
        mission: "Give meals. [redacted]",
        registration_number: "RG123",
      },
    });
    expect(JSON.stringify(await call("get_organisation"))).not.toMatch(
      /rosebud|bank_details/,
    );
    rows.organizations[0].verification_status = "review";
    expect(await call("get_organisation")).toMatchObject({
      approved_profile: null,
      profile_status: "review",
    });
  });

  it("filters individual records by organisation and hides private storage paths", async () => {
    const { rows, call, requests } = harness();
    rows.documents.push(
      doc({
        org_id: otherOrg,
        storage_path: `${otherOrg}/${docId}/Strategy.txt`,
      }),
    );
    rows.opportunities.push(grant({ org_id: otherOrg }));
    rows.applications.push(app({ org_id: otherOrg }));
    await expect(
      call("read_document", { document_id: docId }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      call("get_opportunity", { opportunity_id: grantId }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      call("get_application", { application_id: appId }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await call("list_documents")).toMatchObject({ documents: [] });
    rows.documents.push(doc({ name: "Bank Statement.txt", category: "other" }));
    const privateList = await call("list_documents");
    expect(privateList).toMatchObject({ documents: [], restricted_count: 1 });
    expect(JSON.stringify(privateList)).not.toMatch(
      /storage_path|Bank Statement.txt/,
    );
    await expect(
      call("read_document", { document_id: docId }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      requests.mock.calls.map(([path]) => String(path)).join(),
    ).not.toContain("/storage/v1/");
  });

  it("rejects ambiguous or redirected document paths before requesting Storage", async () => {
    const { rows, files, call, requests } = harness();
    files.set(`${otherOrg}/Strategy.txt`, "Confidential");
    for (const path of [
      `${orgId}/../${otherOrg}/Strategy.txt`,
      `${orgId}/${docId}/..`,
      `${orgId}/${docId}/..\n`,
      `${orgId}/${docId}/%2e%2e`,
      `${orgId}/${docId}/..\\Strategy.txt`,
      `${orgId}/${docId}//Strategy.txt`,
      `${orgId}/${docId}/Strategy.txt?path=/other`,
      `${orgId}/${grantId}/Strategy.txt`,
    ]) {
      rows.documents[0] = doc({ storage_path: path });
      await expect(
        call("read_document", { document_id: docId }),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(
      requests.mock.calls.map(([path]) => String(path)).join(),
    ).not.toContain("/storage/v1/");
  });

  it("returns bounded excerpts and uses only matching cached scans", async () => {
    const { rows, files, call } = harness();
    rows.documents.push(doc());
    files.set(`${orgId}/${docId}/Strategy.txt`, "Hello 😀 world. BSB 123456");
    expect(
      await call("read_document", { document_id: docId, offset: 6, limit: 2 }),
    ).toMatchObject({ text: "😀 ", offset: 6, next_offset: 8 });
    expect(
      await call("read_document", { document_id: docId, offset: 8 }),
    ).toMatchObject({ text: "world. [redacted]", next_offset: null });
    rows.documents[0] = doc({
      name: "Mission.pdf",
      mime_type: "application/pdf",
    });
    const bytes = "%PDF sample";
    files.set(`${orgId}/${docId}/Strategy.txt`, bytes);
    rows.document_text_extracts.push({
      org_id: orgId,
      document_id: docId,
      extraction_version: 1,
      source_sha256: "different version",
      text: "Unrelated transcript",
    });
    expect(await call("read_document", { document_id: docId })).toMatchObject({
      text_available: false,
    });
    rows.document_text_extracts.push({
      org_id: orgId,
      document_id: docId,
      extraction_version: 1,
      source_sha256: createHash("sha256").update(bytes).digest("hex"),
      text: "[Page 1] Approved mission",
      method: "ocr",
    });
    expect(await call("read_document", { document_id: docId })).toMatchObject({
      text_available: true,
      text: "[Page 1] Approved mission",
      method: "ocr",
    });
  });

  it("recovers a partially saved source note and returns a single private document", async () => {
    const { errors, rows, files, call } = harness();
    const args = {
      title: "Community research",
      text: "Notes reviewed by the user.",
      source_url: "https://council.example.org/program",
      approved: true,
    };
    errors.failNextDocumentInsert = true;
    await expect(call("save_source_note", args)).rejects.toMatchObject({
      status: 502,
    });
    expect(files.size).toBe(1);
    expect(rows.documents).toHaveLength(0);
    const saved = await call("save_source_note", args);
    const retried = await call("save_source_note", args);
    expect(retried).toMatchObject({
      document_id: saved.document_id,
      saved: true,
      created: false,
    });
    expect(rows.documents).toHaveLength(1);
    expect(rows.documents[0]).toMatchObject({ org_id: orgId, verified: false });
    expect(
      await call("read_document", { document_id: saved.document_id }),
    ).toMatchObject({
      text: "Source: https://council.example.org/program\n\nNotes reviewed by the user.\n",
    });
  });

  it("preserves an existing archived grant round", async () => {
    const { rows, call } = harness();
    rows.opportunities.push(
      grant({ status: "archived", provenance: { source_verified: true } }),
    );
    const result = await call("save_opportunity", {
      title: "Community Grants",
      funder: "State Agency",
      approved: true,
    });
    expect(result).toMatchObject({ duplicate_count: 1, imported_count: 0 });
    expect(rows.opportunities).toEqual([
      grant({ status: "archived", provenance: { source_verified: true } }),
    ]);
  });

  it("records new grant leads as unverified and keeps date-only deadlines", async () => {
    const { rows, call } = harness();
    const result = await call("save_opportunity", {
      title: "Community Garden Fund",
      funder: "Local Council",
      source_url: "https://council.example.org/grants/garden",
      closing_date: "2026-12-15",
      approved: true,
    });
    expect(result).toMatchObject({ imported_count: 1, duplicate_count: 0 });
    expect(rows.opportunities).toMatchObject([
      {
        title: "Community Garden Fund",
        closes_at: null,
        provenance: {
          method: "user_import",
          source_verified: false,
          eligibility_verified: false,
          date_review_required: true,
          closing_date: "2026-12-15",
        },
      },
    ]);
  });

  it("creates a draft once and refuses to overwrite it without its revision", async () => {
    const { rows, call } = harness();
    rows.opportunities.push(grant());
    const created = await call("save_application_draft", newDraft);
    expect(created).toMatchObject({
      saved: true,
      created: true,
      status: "draft",
    });
    expect(await call("save_application_draft", newDraft)).toMatchObject({
      id: created.id,
      saved: true,
      created: false,
    });
    expect(
      await call("save_application_draft", {
        ...newDraft,
        application_text: "A replacement",
      }),
    ).toMatchObject({
      id: created.id,
      saved: false,
      requires_current_revision: true,
    });
    expect(rows.applications).toHaveLength(1);
    expect(
      new URL(String(created.review_url)).searchParams.get("application"),
    ).toBe(created.id);
    expect(
      await call("get_application", { application_id: created.id }),
    ).toMatchObject({
      application_text: newDraft.application_text,
      readiness_stale: true,
      updated_at: initialRevision,
    });
  });

  it("preserves draft evidence metadata, blocks stale overwrites and checks revisions when a write races", async () => {
    const { rows, errors, call } = harness();
    rows.applications.push(app());
    const args = {
      ...updateDraft,
      project_summary: "Community garden",
      application_questions: "Purpose?",
    };
    errors.beforeApplicationUpdate = true;
    await expect(call("save_application_draft", args)).rejects.toMatchObject({
      status: 409,
    });
    expect(rows.applications[0].draft).not.toHaveProperty("application_text");
    rows.applications[0].updated_at = initialRevision;
    errors.beforeApplicationUpdate = false;
    await expect(call("save_application_draft", args)).resolves.toMatchObject({
      saved: true,
      status: "review",
      updated_at: nextRevision,
    });
    expect(rows.applications[0]).toMatchObject({
      draft: {
        application_text: newDraft.application_text,
        readiness: { score: 82 },
        readiness_stale: true,
        human_review_required: true,
      },
      project_details: {
        approved_detail: "keep",
        summary: "Community garden",
        application_questions: "Purpose?",
      },
    });
    expect(await call("save_application_draft", args)).toMatchObject({
      saved: true,
      updated_at: nextRevision,
    });
    await expect(
      call("save_application_draft", {
        ...args,
        application_text: "An outdated edit",
      }),
    ).rejects.toMatchObject({ status: 409 });
    rows.applications[0].status = "submitted";
    await expect(
      call("save_application_draft", {
        ...args,
        expected_updated_at: nextRevision,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
