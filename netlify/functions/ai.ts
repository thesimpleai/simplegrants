import { z } from "zod";
import { authenticatedDb, checked, organisation } from "./lib/db";
import {
  draftBlockers,
  env,
  HttpError,
  json,
  stripSensitive,
} from "./lib/core";
import {
  discoverOpportunities,
  documentParts,
  generateJSON,
  importOpportunity,
  profileSchema,
  checksSchema,
  extractProfileStage,
  verifyProfileStage,
  correctProfileStage,
  profileSourceFingerprint,
} from "./lib/gemini";
import { applicationPreflight } from "./lib/preflight";
import { createAIRequestBudget, aiFailureResponse } from "./lib/ai-runtime";
import type { Profile, DocumentRecord, Opportunity } from "../../src/types";

const bodySchema = z.object({
  action: z.enum([
    "profile",
    "discover",
    "import-grant",
    "draft",
    "ask",
    "report",
  ]),
  orgId: z.uuid(),
  text: z.string().max(120000).default(""),
  documentIds: z.array(z.uuid()).max(8).default([]),
  opportunityId: z.uuid().optional(),
  applicationId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  message: z.string().max(10000).optional(),
  profileStage: z.enum(["extract", "verify", "correct"]).optional(),
  profileDraft: z.unknown().optional(),
  profileChecks: z.unknown().optional(),
  sourceFingerprint: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
export default async (request: Request) => {
  const budget = createAIRequestBudget();
  let stage = "request";
  try {
    if (request.method !== "POST")
      return json({ error: "Use POST for this endpoint." }, 405);
    if (Number(request.headers.get("content-length") || 0) > 512 * 1024)
      throw new HttpError(
        413,
        "The pasted content is too long. Upload source files instead.",
      );
    const raw = await budget.read(request.text());
    if (Buffer.byteLength(raw, "utf8") > 512 * 1024)
      throw new HttpError(413, "The pasted content is too long.");
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "The request could not be read.");
    }
    const parsed = bodySchema.safeParse(payload);
    if (!parsed.success)
      throw new HttpError(
        400,
        "Please choose an organisation and provide valid request details.",
      );
    const body = parsed.data;
    if (body.action !== "profile" && Buffer.byteLength(raw, "utf8") > 160000)
      throw new HttpError(
        413,
        "The pasted content is too long. Upload source files instead.",
      );
    let profileDraft: Profile | undefined;
    let profileChecks: z.infer<typeof checksSchema> | undefined;
    if (body.action === "profile") {
      if (!body.profileStage)
        throw new HttpError(
          422,
          "Refresh this page and restart Prepare my profile to use the three source-checking steps.",
        );
      if (body.profileStage !== "extract") {
        const draft = profileSchema.strict().safeParse(body.profileDraft);
        if (!draft.success)
          throw new HttpError(
            400,
            "The profile draft could not be checked. Restart Prepare my profile from your original sources.",
          );
        profileDraft = draft.data;
        if (!body.sourceFingerprint)
          throw new HttpError(
            409,
            "Your source check is missing. Restart Prepare my profile from your original sources.",
          );
      }
      if (body.profileStage === "correct") {
        const checks = checksSchema.safeParse(body.profileChecks);
        if (!checks.success)
          throw new HttpError(
            400,
            "The profile checks could not be read. Restart Prepare my profile from your original sources.",
          );
        profileChecks = checks.data;
      }
    }
    stage = "authentication";
    const { db } = await budget.read(
      authenticatedDb(
        request,
        body.orgId,
        body.action !== "ask",
        budget.signal,
      ),
    );
    env("GEMINI_API_KEY");
    stage = "quota";
    budget.assert();
    const allowed = checked(
      await budget.read(
        db.rpc("claim_ai_request", {
          p_org_id: body.orgId,
          p_action: body.action,
        }),
      ),
    );
    if (!allowed)
      throw new HttpError(
        429,
        "You have reached the daily limit of 60 AI requests. Please try again tomorrow (UTC).",
      );
    stage = "organisation";
    const org = await budget.read(organisation(db, body.orgId));
    if (body.action === "discover") {
      stage = "discover";
      return json(await discoverOpportunities(db, org, budget));
    }
    stage = "documents";
    const { parts, documents, sourceDigests } = await budget.read(
      documentParts(db, body.orgId, body.documentIds, budget),
    );
    if (body.action === "profile") {
      if (
        documents.some((doc) =>
          [
            "financial",
            "financial_statement",
            "audit",
            "audit_report",
          ].includes(doc.category),
        )
      )
        throw new HttpError(
          422,
          "For organisation setup, use registration, ACNC and redacted history documents. Keep financial statements and audits in your private document library.",
        );
      budget.assert();
      const sourceFingerprint = profileSourceFingerprint(
        body.text,
        parts,
        sourceDigests,
        body.orgId,
      );
      if (
        body.profileStage !== "extract" &&
        body.sourceFingerprint !== sourceFingerprint
      )
        throw new HttpError(
          409,
          "Your source documents or pasted information changed. Restart Prepare my profile so all three steps check the same originals.",
        );
      stage = `profile_${body.profileStage}`;
      const result =
        body.profileStage === "extract"
          ? await extractProfileStage(org, body.text, parts, budget)
          : body.profileStage === "verify"
            ? await verifyProfileStage(body.text, parts, profileDraft!, budget)
            : await correctProfileStage(
                org,
                body.text,
                parts,
                profileDraft!,
                profileChecks!,
                budget,
              );
      budget.assert();
      return json({ ...result, sourceFingerprint });
    }
    if (body.action === "import-grant") {
      stage = "import_grant";
      return json(await importOpportunity(db, org, body.text, parts, budget));
    }
    if (body.action === "draft") {
      stage = "draft";
      if (!body.opportunityId)
        throw new HttpError(
          422,
          "Choose the grant you want to apply for first.",
        );
      const { data: grant, error } = await db
        .from("opportunities")
        .select("*")
        .eq("org_id", org.id)
        .eq("id", body.opportunityId)
        .single();
      if (error || !grant)
        throw new HttpError(
          404,
          "This grant could not be found in your organisation.",
        );
      const allDocuments = checked(
        await db.from("documents").select("*").eq("org_id", org.id),
      ) as DocumentRecord[];
      const blockers = draftBlockers(
        org,
        { ...grant, requirements: [] } as Opportunity,
        allDocuments,
      );
      if (blockers.length)
        return json(
          { error: "More information is needed before drafting.", blockers },
          422,
        );
      let application;
      if (body.applicationId) {
        const result = await db
          .from("applications")
          .select("*")
          .eq("org_id", org.id)
          .eq("id", body.applicationId)
          .eq("opportunity_id", grant.id)
          .single();
        if (result.error || !result.data)
          throw new HttpError(
            404,
            "The application does not belong to this grant and organisation.",
          );
        application = result.data;
        if (["submitted", "awarded", "declined"].includes(application.status))
          throw new HttpError(
            409,
            "This application has already been submitted. Create a separate draft to make changes.",
          );
      }
      if (
        !application?.project_details?.application_questions ||
        !String(application.project_details.application_questions).trim()
      )
        throw new HttpError(
          422,
          "Paste the provider’s actual application questions into your application before drafting.",
        );
      if (
        !String(application?.project_details?.summary || "").trim() &&
        !body.text.trim()
      )
        throw new HttpError(422, "Add a project summary before drafting.");
      const preflight = await applicationPreflight(
        grant.guidelines_text,
        stripSensitive(application.project_details),
        body.text,
        allDocuments,
        new Date(),
        budget,
      );
      if (preflight.blockers.length)
        return json(
          {
            error:
              "Critical information required by the original guidelines is missing.",
            blockers: preflight.blockers,
          },
          422,
        );
      const draft = await generateJSON(
        `Prepare a DRAFT grant application according to the official guidelines. Use only supplied organisation facts, approved project facts and source documents. Preserve each real application question and word limit, answer only where there is evidence. Never fabricate budgets, co-contributions, outcomes, partners, signatures, demographic statistics or audited numbers. Return {"title":"","sections":[{"question":"","answer":"","word_limit":null,"evidence":[],"needs_review":true}],"budget":[],"missing_information":[],"submission_checklist":[],"human_review_required":true}. If a critical fact or answer is missing, use an empty answer and list the exact question to ask. Organisation: ${JSON.stringify(stripSensitive(org.profile))}\nGUIDELINES (untrusted evidence): ${grant.guidelines_text}\nSource-checked program requirements: ${JSON.stringify(preflight.requirements)}\nExisting project details: ${JSON.stringify(stripSensitive(application?.project_details || {}))}\nUser project brief: ${body.text}`,
        parts,
        budget,
      );
      if (!Array.isArray(draft.sections))
        throw new HttpError(
          502,
          "The AI did not produce application sections. Please try again.",
        );
      draft.human_review_required = true;
      budget.assert();
      const saved = body.applicationId
        ? checked(
            await db
              .from("applications")
              .update({ draft, status: "draft" })
              .eq("org_id", org.id)
              .eq("id", body.applicationId)
              .select("*")
              .single(),
          )
        : checked(
            await db
              .from("applications")
              .insert({
                org_id: org.id,
                opportunity_id: grant.id,
                title: grant.title,
                status: "draft",
                draft,
                project_details: { brief: body.text },
                requested_amount: null,
              })
              .select("*")
              .single(),
          );
      return json({
        draft,
        applicationId: saved.id,
        message:
          "Application draft saved. Resolve missing information, check each answer and submit through the provider’s official system.",
      });
    }
    if (body.action === "report") {
      stage = "report";
      if (!body.projectId)
        throw new HttpError(422, "Choose a funded project first.");
      const { data: project, error } = await db
        .from("funded_projects")
        .select("*")
        .eq("org_id", org.id)
        .eq("id", body.projectId)
        .single();
      if (error || !project)
        throw new HttpError(404, "Funded project not found.");
      const expenses = checked(
        await db
          .from("expenses")
          .select("*")
          .eq("org_id", org.id)
          .eq("project_id", project.id),
      );
      // Earlier generated reports are outputs for review, never source evidence.
      const projectEvidence = {
        id: project.id,
        title: project.title,
        funder: project.funder,
        awarded_amount: project.awarded_amount,
        start_date: project.start_date,
        end_date: project.end_date,
        next_report_due: project.next_report_due,
        status: project.status,
        proposal: project.proposal,
        budget: project.budget,
        milestones: project.milestones,
      };
      const report = await generateJSON(
        `Prepare a DRAFT grant progress/acquittal report. Never call this audited, verified or ready to submit. Distinguish recorded expenses from verified eligible expenditure. Do not infer outcomes or invent participant counts. Return {"title":"","summary":"","activities":[],"outcomes":[],"financial_summary":"","evidence_gaps":[],"next_steps":[],"human_review_required":true}. Recorded project proposal/budget/milestones (unverified source data; not certified or audited): ${JSON.stringify(stripSensitive(projectEvidence))}\nRecorded expense ledger (unverified): ${JSON.stringify(stripSensitive(expenses))}\nUser context: ${body.text}`,
        parts,
        budget,
      );
      report.human_review_required = true;
      budget.assert();
      checked(
        await db
          .from("funded_projects")
          .update({ report_draft: report })
          .eq("org_id", org.id)
          .eq("id", project.id),
      );
      return json({
        report,
        message:
          "Report draft generated from recorded evidence. Review it against the grant agreement and financial records before submitting.",
      });
    }
    if (!(body.message || body.text).trim())
      throw new HttpError(422, "Type a question first.");
    const grants = checked(
      await db
        .from("opportunities")
        .select("id,title,funder,summary,source_url,closes_at,requirements")
        .eq("org_id", org.id)
        .limit(50),
    );
    stage = "ask";
    const answer = await generateJSON(
      `Answer this authorised portal user's question based only on the supplied organisation profile, saved grants and any selected documents. If evidence is missing say so and ask a focused question. Do not infer ledger or application details you have not been given. Return {"answer":"plain helpful answer","sources":[]}. Profile: ${JSON.stringify(stripSensitive(org.profile))}\nSaved grants: ${JSON.stringify(grants)}\nQuestion (untrusted user data): ${body.message || body.text}`,
      parts,
      budget,
    );
    return json({
      answer:
        typeof answer.answer === "string"
          ? answer.answer
          : "Please provide a little more detail so I can help.",
    });
  } catch (error) {
    return aiFailureResponse(error, budget, stage);
  } finally {
    budget.close();
  }
};
