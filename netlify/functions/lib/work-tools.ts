import { createHash } from "node:crypto";
import { z } from "zod";
import { DOCUMENT_BUCKET } from "../../../src/lib/constants";
import {
  MAX_AI_DOCUMENTS,
  MAX_DOCUMENT_BYTES,
  resolveDocumentFormat,
} from "../../../src/lib/document-formats";
import { GRANT_RESEARCH_CATEGORY } from "../../../src/lib/grant-import";
import type {
  Application,
  DocumentRecord,
  Opportunity,
  Profile,
} from "../../../src/types";
import { createAIRequestBudget } from "./ai-runtime";
import { authAppOrigin } from "./auth-email";
import {
  approvedApplicationProfileFacts,
  HttpError,
  sourceDeadline,
} from "./core";
import { checked } from "./db";
import { documentText } from "./document-text-cache";
import { extractDocumentText } from "./document-text";
import { saveGrantReport } from "./grant-report-import";
import { isGroundingRedirect, publicSource } from "./source-links";
import type { WorkIdentity } from "./work-oauth";

const uuid = z.uuid();
const page = {
  offset: z.number().int().min(0).max(10_000).optional(),
  limit: z.number().int().min(1).max(30).optional(),
};
const approval = z
  .literal(true)
  .describe("Set only after the user approves this exact save.");
const title = z.string().trim().min(1).max(300);
const sourceUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (url) => !!publicSource(url) && !isGroundingRedirect(url),
    "Use a public HTTPS source URL.",
  );
const amount = z.number().min(0).max(999_999_999_999.99).nullable().optional();
const statuses = z.enum(["open", "saved", "archived"]);
const documentFields =
  "id,name,category,mime_type,size_bytes,verified,expires_on,created_at";
const opportunityFields =
  "id,title,funder,summary,amount_min,amount_max,opens_on,closes_at,source_url,location,focus_areas,requirements,status,provenance,created_at";
const applicationFields =
  "id,opportunity_id,title,status,requested_amount,created_at,updated_at";
const editableStatuses = ["draft", "review"];

const evidenceCategories = new Set([
  "registration",
  "acnc",
  "financial_summary",
  "mission",
  "background",
  "guidelines",
  GRANT_RESEARCH_CATEGORY,
  "other",
]);
const privateDocumentName =
  /\b(?:bank statements?|tax returns?|tax file|payroll|insurance polic(?:y|ies)|passports?)\b/i;
const privateFinanceName =
  /\b(?:financial statements?|audit reports?|financial reports?)\b/i;
const publicFinanceName = /\b(?:annual report|redacted|published|public)\b/i;
const sensitiveDetail =
  /\b(?:BSB|bank account(?: number)?|account number|tax file number|TFN|card number)\s*[:#=-]?\s*\d[\d .\t-]{4,}|\b(?:password|API[ -]?key|secret(?: key)?|access token)\s*[:=]\s*\S+/gi;
const redact = (text: string) =>
  text.replace(/\u0000/g, " ").replace(sensitiveDetail, "[redacted]");

function shareableText(text: string) {
  if (redact(text) !== text)
    throw new HttpError(
      422,
      "Remove sensitive payment details or credentials before saving this text.",
    );
  return text;
}

function textExcerpt(value: unknown, limit: number) {
  const cleaned = typeof value === "string" ? redact(value) : "";
  return { text: cleaned.slice(0, limit), truncated: cleaned.length > limit };
}

function evidenceAllowed(doc: { name: string; category: string }) {
  const name = doc.name.replace(/[_-]+/g, " ");
  return (
    evidenceCategories.has(doc.category) &&
    !privateDocumentName.test(name) &&
    (doc.category === "financial_summary" ||
      !privateFinanceName.test(name) ||
      publicFinanceName.test(name))
  );
}

function portalLink(
  identity: WorkIdentity,
  view: string,
  selection?: { grant: string } | { application: string },
) {
  const url = new URL(authAppOrigin());
  url.searchParams.set("view", view);
  url.searchParams.set("org", identity.orgId);
  for (const [key, value] of Object.entries(selection ?? {}))
    url.searchParams.set(key, value);
  return url.href;
}

function stableId(...fields: string[]) {
  const bytes = createHash("sha256")
    .update(JSON.stringify(fields))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function paged<T>(rows: T[], offset: number, limit: number) {
  return {
    items: rows.slice(0, limit),
    next_offset: rows.length > limit ? offset + limit : null,
  };
}

type WorkApplication = Application & { updated_at: string };

function opportunitySummary(row: Opportunity, identity: WorkIdentity) {
  return {
    id: row.id,
    title: row.title,
    funder: row.funder,
    status: row.status,
    location: row.location,
    summary: textExcerpt(row.summary, 2_000).text,
    amount_min: row.amount_min,
    amount_max: row.amount_max,
    opens_on: row.opens_on,
    closes_at: row.closes_at,
    closing_date:
      typeof row.provenance?.closing_date === "string"
        ? row.provenance.closing_date
        : null,
    focus_areas: row.focus_areas.slice(0, 10),
    requirements: row.requirements.slice(0, 10),
    source_url: publicSource(row.source_url),
    source_verified: row.provenance?.source_verified === true,
    eligibility_verified: row.provenance?.eligibility_verified === true,
    review_url: portalLink(identity, "opportunities", { grant: row.id }),
  };
}

function applicationSummary(row: WorkApplication, identity: WorkIdentity) {
  return {
    id: row.id,
    opportunity_id: row.opportunity_id,
    title: row.title,
    status: row.status,
    requested_amount: row.requested_amount,
    updated_at: row.updated_at,
    review_url: portalLink(identity, "applications", { application: row.id }),
  };
}

async function opportunity(identity: WorkIdentity, id: string) {
  const row = checked(
    await identity.db
      .from("opportunities")
      .select(`${opportunityFields},guidelines_text`)
      .eq("org_id", identity.orgId)
      .eq("id", id)
      .maybeSingle(),
  ) as Opportunity | null;
  if (!row)
    throw new HttpError(
      404,
      "Grant opportunity not found in this organisation.",
    );
  return row;
}

async function application(identity: WorkIdentity, id: string) {
  const row = checked(
    await identity.db
      .from("applications")
      .select(`${applicationFields},draft,project_details`)
      .eq("org_id", identity.orgId)
      .eq("id", id)
      .maybeSingle(),
  ) as WorkApplication | null;
  if (!row)
    throw new HttpError(404, "Application not found in this organisation.");
  return row;
}

async function selectedDocument(identity: WorkIdentity, id: string) {
  const row = checked(
    await identity.db
      .from("documents")
      .select(`${documentFields},storage_path`)
      .eq("org_id", identity.orgId)
      .eq("id", id)
      .maybeSingle(),
  ) as DocumentRecord | null;
  if (!row)
    throw new HttpError(404, "Document not found in this organisation.");
  const [org, folder, filename, ...extra] = row.storage_path.split("/");
  const portalUpload =
    folder === row.id &&
    !!filename &&
    !/[^A-Za-z0-9._-]/.test(filename) &&
    filename !== "." &&
    filename !== "..";
  const workNote = folder === `${row.id}.txt` && filename === undefined;
  if (
    !evidenceAllowed(row) ||
    org !== identity.orgId ||
    extra.length ||
    !(portalUpload || workNote)
  )
    throw new HttpError(
      403,
      "Review this document in the Simple Grants portal. Supply only the relevant approved information in Work.",
    );
  return row;
}

const profileFactKeys = [
  "name",
  "legal_name",
  "abn",
  "type",
  "state",
  "description",
  "focus_areas",
  "website",
  "acnc_registered",
  "mission",
  "beneficiaries",
  "service_locations",
  "history",
  "founded_on",
  "registration_date",
  "registration_authority",
  "registration_number",
  "charity_registration_date",
  "charity_registration_number",
];
const grantFactValue = z.union([
  z.string().max(8_000),
  z.boolean(),
  z.number(),
  z.array(z.string().max(1_000)).max(25),
  z.object({
    value: z.number(),
    unit: z.string().max(30),
    periodStart: z.string().max(30),
    periodEnd: z.string().max(30),
  }),
]);

function cleanFact(value: z.infer<typeof grantFactValue>) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redact);
  return value;
}

function approvedProfile(profile: Profile) {
  const facts = approvedApplicationProfileFacts(profile);
  const answer = z.object({
    question: z.string().max(400),
    answer: grantFactValue,
  });
  const reviewed = Array.isArray(facts.reviewed_grant_answers)
    ? facts.reviewed_grant_answers.slice(0, 25).flatMap((item) => {
        const parsed = answer.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  return Object.fromEntries([
    ...profileFactKeys.flatMap((key) => {
      const parsed = grantFactValue.safeParse(facts[key]);
      return parsed.success ? [[key, cleanFact(parsed.data)] as const] : [];
    }),
    ...(reviewed.length
      ? [
          [
            "reviewed_grant_answers",
            reviewed.map(({ question, answer }) => ({
              question,
              answer: cleanFact(answer),
            })),
          ] as const,
        ]
      : []),
  ]);
}

const saveDraftArgs = z
  .strictObject({
    opportunity_id: uuid,
    application_id: uuid.optional(),
    expected_updated_at: z.iso
      .datetime({ offset: true })
      .optional()
      .describe(
        "Exact updated_at returned by get_application. Required with application_id.",
      ),
    application_text: z.string().trim().min(1).max(60_000),
    document_ids: z.array(uuid).max(MAX_AI_DOCUMENTS).optional(),
    project_summary: z.string().trim().max(12_000).optional(),
    application_questions: z.string().trim().max(24_000).optional(),
    budget_notes: z.string().trim().max(12_000).optional(),
    approved: approval,
  })
  .refine(
    ({ application_id, expected_updated_at }) =>
      !!application_id === !!expected_updated_at,
    {
      path: ["expected_updated_at"],
      message:
        "Provide application_id and expected_updated_at together to edit an application.",
    },
  );

async function saveApplicationDraft(
  args: z.infer<typeof saveDraftArgs>,
  identity: WorkIdentity,
) {
  const { db, orgId } = identity;
  const current = args.application_id
    ? await application(identity, args.application_id)
    : null;
  if (
    current &&
    (current.opportunity_id !== args.opportunity_id ||
      !editableStatuses.includes(current.status))
  )
    throw new HttpError(
      409,
      "Only a draft or in-review application for this opportunity can be edited.",
    );
  if (!current) {
    const existing = checked(
      await db
        .from("applications")
        .select(`${applicationFields},draft,project_details`)
        .eq("org_id", orgId)
        .eq("opportunity_id", args.opportunity_id)
        .order("created_at", { ascending: true })
        .order("id")
        .limit(1)
        .maybeSingle(),
    ) as WorkApplication | null;
    if (existing) {
      const retry =
        existing.id ===
          stableId("work-application", orgId, args.opportunity_id) &&
        draftMatches(existing, args);
      return {
        ...applicationSummary(existing, identity),
        saved: retry,
        created: false,
        requires_current_revision: !retry,
      };
    }
  }
  const draftText = shareableText(args.application_text);
  const docIds =
    args.document_ids === undefined
      ? undefined
      : [...new Set(args.document_ids)];
  const docs = await Promise.all(
    (docIds ?? []).map((id) => selectedDocument(identity, id)),
  );
  const project = {
    ...current?.project_details,
    ...(args.project_summary !== undefined
      ? { summary: shareableText(args.project_summary) }
      : {}),
    ...(args.application_questions !== undefined
      ? { application_questions: shareableText(args.application_questions) }
      : {}),
    ...(args.budget_notes !== undefined
      ? { budget_notes: shareableText(args.budget_notes) }
      : {}),
    ...(docIds !== undefined ? { source_document_ids: docIds } : {}),
  };
  const changedResearchQuestions =
    current?.project_details.application_research &&
    args.application_questions !== undefined &&
    args.application_questions !==
      current.project_details.application_questions;
  const draft = {
    ...current?.draft,
    application_text: draftText,
    human_review_required: true,
    readiness_stale: true,
    ...(docIds !== undefined
      ? { evidence_sources: docs.map(({ id, name }) => ({ id, name })) }
      : {}),
  };
  const values = {
    draft,
    project_details: changedResearchQuestions
      ? { ...project, research_sources_confirmed: false }
      : project,
  };
  if (current) {
    if (draftMatches(current, args))
      return {
        ...applicationSummary(current, identity),
        saved: true,
        created: false,
      };
    if (current.updated_at !== args.expected_updated_at)
      throw new HttpError(
        409,
        "This application changed after it was read. Read the current draft and ask the user to approve any new edit.",
      );
    const saved = checked(
      await db
        .from("applications")
        .update(values)
        .eq("org_id", orgId)
        .eq("id", current.id)
        .eq("opportunity_id", args.opportunity_id)
        .eq("updated_at", args.expected_updated_at)
        .in("status", editableStatuses)
        .select(applicationFields)
        .maybeSingle(),
    ) as WorkApplication | null;
    if (!saved)
      throw new HttpError(
        409,
        "The application changed while you were saving it. Read the current draft before trying again.",
      );
    return {
      ...applicationSummary(saved, identity),
      saved: true,
      created: false,
    };
  }
  const grant = await opportunity(identity, args.opportunity_id);
  if (grant.status === "archived")
    throw new HttpError(
      409,
      "Restore this opportunity in the portal before creating a draft.",
    );
  const id = stableId("work-application", orgId, grant.id);
  const saved = checked(
    await db
      .from("applications")
      .upsert(
        {
          ...values,
          id,
          org_id: orgId,
          opportunity_id: grant.id,
          title: grant.title,
          status: "draft",
        },
        { onConflict: "id", ignoreDuplicates: true },
      )
      .select(applicationFields)
      .maybeSingle(),
  ) as WorkApplication | null;
  if (saved)
    return {
      ...applicationSummary(saved, identity),
      saved: true,
      created: true,
    };
  const existing = await application(identity, id);
  const retry = draftMatches(existing, args);
  return {
    ...applicationSummary(existing, identity),
    saved: retry,
    created: false,
    requires_current_revision: !retry,
  };
}

function draftMatches(
  row: WorkApplication,
  args: z.infer<typeof saveDraftArgs>,
) {
  return (
    editableStatuses.includes(row.status) &&
    row.draft.application_text === args.application_text &&
    (args.project_summary === undefined ||
      row.project_details.summary === args.project_summary) &&
    (args.application_questions === undefined ||
      row.project_details.application_questions ===
        args.application_questions) &&
    (args.budget_notes === undefined ||
      row.project_details.budget_notes === args.budget_notes) &&
    (args.document_ids === undefined ||
      JSON.stringify(row.project_details.source_document_ids) ===
        JSON.stringify([...new Set(args.document_ids)]))
  );
}

type ToolResult = Record<string, unknown>;

function tool<T extends z.ZodType>(
  title: string,
  description: string,
  schema: T,
  run: (args: z.infer<T>, identity: WorkIdentity) => Promise<ToolResult>,
  access: "read" | "create" | "edit" = "read",
) {
  return {
    definition: {
      title,
      description,
      inputSchema: z.toJSONSchema(schema, { unrepresentable: "any" }),
      annotations: {
        title,
        readOnlyHint: access === "read",
        destructiveHint: access === "edit",
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async call(raw: unknown, identity: WorkIdentity) {
      if (access !== "read" && identity.role === "viewer")
        throw new HttpError(
          403,
          "Your Simple Grants role allows viewing only.",
        );
      const inputs = schema.safeParse(raw ?? {});
      if (!inputs.success) {
        const fields = [
          ...new Set(
            inputs.error.issues.map(({ path }) => path[0]).filter(Boolean),
          ),
        ];
        throw new HttpError(
          400,
          fields.length
            ? `Invalid or missing arguments: ${fields.join(", ")}.`
            : "Invalid arguments. Use the fields listed in this tool's schema.",
        );
      }
      return run(inputs.data, identity);
    },
  };
}

const tools = {
  get_organisation: tool(
    "Read organisation profile",
    "Read the connected organisation and the status of its grant profile review. Use approved profile facts as evidence. Review incomplete facts in the portal.",
    z.strictObject({}),
    async (_, identity) => {
      const row = checked(
        await identity.db
          .from("organizations")
          .select(
            "name,abn,type,state,description,focus_areas,website,verification_status,profile",
          )
          .eq("id", identity.orgId)
          .maybeSingle(),
      );
      if (!row) throw new HttpError(404, "Organisation not found.");
      return {
        id: identity.orgId,
        name: row.name,
        profile_status: row.verification_status,
        approved_profile:
          row.verification_status === "approved"
            ? approvedProfile({
                ...row.profile,
                name: row.name,
                abn: row.abn ?? row.profile?.abn,
                type: row.type,
                state: row.state,
                description: row.profile?.description || row.description,
                focus_areas: row.focus_areas,
                website: row.website ?? row.profile?.website,
              })
            : null,
        permission: identity.role === "viewer" ? "read" : "read_write",
        review_url: portalLink(identity, "organisation"),
      };
    },
  ),
  list_opportunities: tool(
    "List saved grant opportunities",
    "Read this organisation's grant library. Review full opportunity details before assessing fit. This tool does not search the web.",
    z.strictObject({ ...page, status: statuses.optional() }),
    async ({ offset = 0, limit = 15, status }, identity) => {
      const query = identity.db
        .from("opportunities")
        .select(opportunityFields)
        .eq("org_id", identity.orgId);
      if (status) query.eq("status", status);
      const rows = checked(
        await query
          .order("created_at", { ascending: false })
          .order("id")
          .range(offset, offset + limit),
      ) as Opportunity[];
      const { items, next_offset } = paged(rows, offset, limit);
      return {
        opportunities: items.map((row) => opportunitySummary(row, identity)),
        next_offset,
        review_url: portalLink(identity, "opportunities"),
      };
    },
  ),
  get_opportunity: tool(
    "Read a grant opportunity",
    "Read this grant's saved requirements, dates and guidelines. Use verified current funder information for eligibility and deadline claims.",
    z.strictObject({ opportunity_id: uuid }),
    async ({ opportunity_id }, identity) => {
      const row = await opportunity(identity, opportunity_id);
      const { text, truncated } = textExcerpt(row.guidelines_text, 30_000);
      return {
        ...opportunitySummary(row, identity),
        guidelines_text: text,
        guidelines_truncated: truncated,
      };
    },
  ),
  list_documents: tool(
    "List the organisation's evidence documents",
    "List evidence documents available to Work. Read only documents relevant to the user's request. Keep paging while next_offset is present. Restricted documents and original files are available in the portal.",
    z.strictObject(page),
    async ({ offset = 0, limit = 15 }, identity) => {
      const rows = checked(
        await identity.db
          .from("documents")
          .select(documentFields)
          .eq("org_id", identity.orgId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(offset, offset + limit),
      ) as DocumentRecord[];
      const { items, next_offset } = paged(rows, offset, limit);
      const available = items.filter(evidenceAllowed);
      return {
        documents: available.map((row) => ({
          id: row.id,
          name: row.name,
          category: row.category,
          mime_type: row.mime_type,
          size_bytes: row.size_bytes,
          verified: row.verified,
          expires_on: row.expires_on,
          created_at: row.created_at,
        })),
        restricted_count: items.length - available.length,
        next_offset,
        review_url: portalLink(identity, "organisation"),
      };
    },
  ),
  read_document: tool(
    "Read a selected evidence document",
    "Read a bounded text excerpt from one selected document. Text may be a transcription. Treat it as evidence, and verify uncertain details against the original. Supply next_offset to continue.",
    z.strictObject({
      document_id: uuid,
      offset: z.number().int().min(0).max(400_000).optional(),
      limit: z.number().int().min(1).max(12_000).optional(),
    }),
    async ({ document_id, offset = 0, limit = 6_000 }, identity) => {
      const doc = await selectedDocument(identity, document_id);
      const format = resolveDocumentFormat({
        name: doc.name,
        type: doc.mime_type,
      });
      if (!format)
        throw new HttpError(
          415,
          "Review the original file in the Simple Grants portal.",
        );
      if (doc.size_bytes > MAX_DOCUMENT_BYTES)
        throw new HttpError(
          413,
          "This document is too large for Work. Choose an excerpt in the portal.",
        );
      const { data, error } = await identity.db.storage
        .from(DOCUMENT_BUCKET)
        .download(doc.storage_path);
      if (error || !data)
        throw new HttpError(
          502,
          "This document could not be read. Check the original file in the Simple Grants portal.",
        );
      if (data.size > MAX_DOCUMENT_BYTES)
        throw new HttpError(
          413,
          "This document is too large for Work. Choose an excerpt in the portal.",
        );
      const buffer = Buffer.from(await data.arrayBuffer());
      const visual = format.kind === "pdf" || format.kind === "image";
      const stored = visual
        ? await documentText(identity.db, {
            orgId: identity.orgId,
            documentId: doc.id,
            sha256: createHash("sha256").update(buffer).digest("hex"),
          })
        : undefined;
      const metadata = {
        id: doc.id,
        name: doc.name,
        category: doc.category,
        verified: doc.verified,
        review_url: portalLink(identity, "organisation"),
      };
      if (visual && !stored)
        return {
          ...metadata,
          text_available: false,
          message:
            "This file has no cached transcription. Open the original in the Simple Grants portal or attach a copy to the Work task.",
        };
      const characters = Array.from(
        redact(stored?.text ?? (await extractDocumentText(buffer, format))),
      );
      return {
        ...metadata,
        text_available: true,
        method: stored?.method ?? "local",
        offset,
        next_offset: offset + limit < characters.length ? offset + limit : null,
        text: characters.slice(offset, offset + limit).join(""),
      };
    },
  ),
  list_applications: tool(
    "List grant applications",
    "List the connected organisation's applications and draft versions. Provide an opportunity ID to find an existing draft for that grant.",
    z.strictObject({ ...page, opportunity_id: uuid.optional() }),
    async ({ offset = 0, limit = 15, opportunity_id }, identity) => {
      const query = identity.db
        .from("applications")
        .select(applicationFields)
        .eq("org_id", identity.orgId);
      if (opportunity_id) query.eq("opportunity_id", opportunity_id);
      const rows = checked(
        await query
          .order("updated_at", { ascending: false })
          .order("id")
          .range(offset, offset + limit),
      ) as WorkApplication[];
      const { items, next_offset } = paged(rows, offset, limit);
      return {
        applications: items.map((row) => applicationSummary(row, identity)),
        next_offset,
        review_url: portalLink(identity, "applications"),
      };
    },
  ),
  get_application: tool(
    "Read a grant application draft",
    "Read a selected saved application and its updated_at revision. Use the exact revision when saving edits. Treat saved drafts as claims that need review.",
    z.strictObject({ application_id: uuid }),
    async ({ application_id }, identity) => {
      const row = await application(identity, application_id);
      const { text, truncated } = textExcerpt(
        row.draft.application_text,
        60_000,
      );
      const structured =
        typeof row.draft.application_text !== "string" &&
        Array.isArray(row.draft.sections)
          ? row.draft.sections
          : [];
      return {
        ...applicationSummary(row, identity),
        application_text: text,
        draft_truncated: truncated || structured.length > 30,
        sections: structured.slice(0, 30).flatMap((item) =>
          item &&
          typeof item.question === "string" &&
          typeof item.answer === "string"
            ? [
                {
                  question: textExcerpt(item.question, 1_000).text,
                  answer: textExcerpt(item.answer, 2_000).text,
                  answer_truncated: item.answer.length > 2_000,
                },
              ]
            : [],
        ),
        project_summary: textExcerpt(row.project_details.summary, 12_000).text,
        application_questions: textExcerpt(
          row.project_details.application_questions,
          24_000,
        ).text,
        budget_notes: textExcerpt(row.project_details.budget_notes, 12_000)
          .text,
        source_document_ids:
          z
            .array(uuid)
            .safeParse(row.project_details.source_document_ids)
            .data?.slice(0, MAX_AI_DOCUMENTS) ?? [],
        readiness_stale: row.draft.readiness_stale === true,
      };
    },
  ),
  save_source_note: tool(
    "Save a reviewed source note",
    "Save the approved note as a private text document in the connected organisation. Include the original source or filename and clearly label quotations, summaries and gaps. Keep sensitive details out.",
    z.strictObject({
      title: title.max(280),
      text: z.string().trim().min(1).max(30_000),
      source_url: sourceUrl.optional(),
      approved: approval,
    }),
    async (args, identity) => {
      const { db, orgId } = identity;
      const name = `${shareableText(args.title).replace(/\.txt$/i, "")}.txt`;
      const content = `${args.source_url ? `Source: ${publicSource(args.source_url)}\n\n` : ""}${shareableText(args.text)}\n`;
      const id = stableId("work-source-note", orgId, name, content);
      const location = {
        document_id: id,
        name,
        review_url: portalLink(identity, "organisation"),
      };
      const existing = checked(
        await db
          .from("documents")
          .select("id")
          .eq("org_id", orgId)
          .eq("id", id)
          .maybeSingle(),
      );
      if (existing) return { ...location, saved: true, created: false };
      const path = `${orgId}/${id}.txt`;
      const { error } = await db.storage
        .from(DOCUMENT_BUCKET)
        .upload(path, content, { contentType: "text/plain", upsert: false });
      if (error && error.statusCode !== "409" && error.status !== 409)
        throw new HttpError(
          502,
          "The source note could not be uploaded. Try again.",
        );
      const row = checked(
        await db
          .from("documents")
          .upsert(
            {
              id,
              org_id: orgId,
              name,
              category: "background",
              storage_path: path,
              mime_type: "text/plain",
              size_bytes: Buffer.byteLength(content),
              verified: false,
            },
            { onConflict: "id", ignoreDuplicates: true },
          )
          .select("id")
          .maybeSingle(),
      );
      return { ...location, saved: true, created: !!row };
    },
    "create",
  ),
  save_opportunity: tool(
    "Save a reviewed grant lead",
    "Save a named user-approved grant lead as an unverified import. Existing opportunities are preserved. Include a grant-specific public HTTPS source when available.",
    z.strictObject({
      title: title.refine((value) => /[\p{L}\p{N}]/u.test(value)),
      funder: z.string().trim().max(300).optional(),
      source_url: sourceUrl.optional(),
      summary: z.string().trim().max(2_000).optional(),
      location: z.string().trim().max(200).optional(),
      amount_min: amount,
      amount_max: amount,
      opens_on: z.iso.date().nullable().optional(),
      closing_date: z.iso.date().nullable().optional(),
      closes_at: z.iso.datetime({ offset: true }).nullable().optional(),
      focus_areas: z
        .array(z.string().trim().min(1).max(100))
        .max(10)
        .optional(),
      requirements: z
        .array(z.string().trim().min(1).max(300))
        .max(10)
        .optional(),
      approved: approval,
    }),
    async (args, identity) => {
      if (
        args.amount_min != null &&
        args.amount_max != null &&
        args.amount_min > args.amount_max
      )
        throw new HttpError(
          422,
          "The minimum grant amount must be at or below the maximum.",
        );
      const instant = sourceDeadline(args.closes_at);
      if (args.closes_at && !instant)
        throw new HttpError(
          422,
          "Use a complete closing time with an explicit time zone.",
        );
      if (
        args.closing_date &&
        args.closes_at &&
        args.closing_date !== args.closes_at.slice(0, 10)
      )
        throw new HttpError(
          422,
          "Use matching calendar date and closing time values.",
        );
      const budget = createAIRequestBudget();
      try {
        const result = await saveGrantReport(
          identity.db,
          identity.orgId,
          [
            {
              title: shareableText(args.title),
              funder: shareableText(args.funder ?? ""),
              summary: shareableText(args.summary ?? ""),
              source_url: args.source_url ? publicSource(args.source_url)! : "",
              guidelines_text: "",
              amount_min: args.amount_min ?? null,
              amount_max: args.amount_max ?? null,
              opens_on: args.opens_on ?? null,
              closes_at: instant,
              closing_date:
                args.closing_date ?? args.closes_at?.slice(0, 10) ?? null,
              location: shareableText(args.location ?? ""),
              focus_areas: (args.focus_areas ?? []).map(shareableText),
              requirements: (args.requirements ?? []).map(shareableText),
            },
          ],
          budget,
        );
        return {
          imported_count: result.importedCount,
          duplicate_count: result.duplicateCount,
          message: result.message,
          opportunities: result.opportunities.map((row) =>
            opportunitySummary(row, identity),
          ),
          review_url: portalLink(identity, "opportunities"),
        };
      } finally {
        budget.close();
      }
    },
    "create",
  ),
  save_application_draft: tool(
    "Save a reviewed grant application draft",
    "Save only the approved grant draft for review in Simple Grants. Include the exact current revision to update an existing draft. Keep proposed and verified information distinct. Grant submissions happen in the funder's portal.",
    saveDraftArgs,
    saveApplicationDraft,
    "edit",
  ),
};

export const workToolDefinitions = Object.entries(tools).map(
  ([name, value]) => ({ name, ...value.definition }),
);

export async function callWorkTool(
  name: string,
  raw: unknown,
  identity: WorkIdentity,
): Promise<ToolResult> {
  if (!Object.hasOwn(tools, name))
    throw new HttpError(400, "Unknown Simple Grants tool.");
  return tools[name as keyof typeof tools].call(raw, identity);
}
