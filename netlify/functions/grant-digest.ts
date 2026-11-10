import { schedule } from "@netlify/functions";
import { Resend } from "resend";
import { checked, serviceDb } from "./lib/db";
import { env, periodKey } from "./lib/core";
import { discoverOpportunities } from "./lib/gemini";
import type { Organisation } from "../../src/types";

// Netlify scheduled functions are not publicly invocable in production.
// This service-role worker claims each organisation/period atomically in Postgres.
export const handler = schedule("0 * * * *", async () => {
  const db = serviceDb();
  const resend = new Resend(env("RESEND_API_KEY"));
  const siteUrl = env("URL");
  const sender = env("EMAIL_FROM");
  // A bounded hourly pilot queue prevents one invocation monopolising the model budget.
  // New periods are prioritised over retries; failed attempts cool down for 6 hours.
  const orgs = checked(
    await db
      .from("organizations")
      .select("*")
      .in("notification_frequency", ["weekly", "monthly"])
      .eq("verification_status", "approved")
      .order("created_at")
      .limit(500),
  ) as Organisation[];
  const keys = [periodKey("weekly"), periodKey("monthly")].filter(
    (key): key is string => !!key,
  );
  const priorRuns =
    checked(
      await db
        .from("notification_runs")
        .select("org_id,period_key,status,started_at")
        .in("period_key", keys),
    ) || [];
  const prior = new Map(
    priorRuns.map((run) => [`${run.org_id}:${run.period_key}`, run]),
  );
  const pending = orgs
    .filter((org) => {
      const run = prior.get(
        `${org.id}:${periodKey(org.notification_frequency)}`,
      );
      if (!run) return true;
      if (run.status === "sent") return false;
      const age = Date.now() - new Date(run.started_at).getTime();
      return run.status === "failed"
        ? age >= 6 * 60 * 60 * 1000
        : age >= 15 * 60 * 1000;
    })
    .sort((a, b) => {
      const last = (org: Organisation) => {
        const run = prior.get(
          `${org.id}:${periodKey(org.notification_frequency)}`,
        );
        return run ? new Date(run.started_at).getTime() : 0;
      };
      return last(a) - last(b);
    });
  let attempted = 0;
  let sent = 0;
  for (const org of pending) {
    const period = periodKey(org.notification_frequency);
    if (!period) continue;
    const claimed = checked(
      await db.rpc("claim_notification_run", {
        p_org_id: org.id,
        p_period_key: period,
      }),
    );
    if (!claimed) continue;
    attempted++;
    try {
      const members =
        checked(
          await db
            .from("organization_members")
            .select("user_id")
            .eq("org_id", org.id),
        ) || [];
      const recipients: string[] = [];
      for (const member of members) {
        const {
          data: { user },
          error,
        } = await db.auth.admin.getUserById(member.user_id);
        if (!error && user?.email && user.email_confirmed_at)
          recipients.push(user.email);
      }
      if (!recipients.length)
        throw new Error("No verified member email available.");
      const { opportunities } = await discoverOpportunities(db, org);
      const publicLines = opportunities.map((grant) => {
        const deepLink = new URL(
          `/?org=${org.id}&view=opportunities&grant=${grant.id}`,
          siteUrl,
        ).href;
        // No private profile text, attached evidence, application or ledger details in email.
        return `${grant.title}\nProvider: ${grant.funder}\n${grant.closes_at ? `Listed deadline: ${new Date(grant.closes_at).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })} (Melbourne time)` : "Deadline: check the official program guidelines"}\nReview in your secure portal: ${deepLink}\nOfficial search source: ${grant.source_url}`;
      });
      const currentOrg = checked(
        await db
          .from("organizations")
          .select("notification_frequency,verification_status")
          .eq("id", org.id)
          .single(),
      );
      if (
        !currentOrg ||
        currentOrg.notification_frequency !== org.notification_frequency ||
        currentOrg.verification_status !== "approved"
      )
        throw new Error("Notification preferences changed before delivery.");
      const portal = new URL(`/?org=${org.id}&view=organisation`, siteUrl).href;
      const text = `Your ${org.notification_frequency} Simple Grant search\n\n${publicLines.length ? publicLines.join("\n\n") : "No current source-backed opportunities were established in this search. You can add a grant from its official guidelines in your portal."}\n\nEligibility and dates need confirmation with each provider.\n\nTo change or stop these searches, sign in and choose weekly, monthly or never under your organisation preferences: ${portal}`;
      const send = await resend.emails.send(
        {
          from: sender,
          to: [...new Set(recipients)],
          subject: `Your ${org.notification_frequency} grant opportunities`,
          text,
        },
        { idempotencyKey: `digest-${org.id}-${period}` },
      );
      if (send.error) throw new Error("Provider rejected the digest.");
      checked(
        await db
          .from("notification_runs")
          .update({
            status: "sent",
            provider_message_id: send.data?.id,
            completed_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("org_id", org.id)
          .eq("period_key", period),
      );
      sent++;
    } catch {
      await db
        .from("notification_runs")
        .update({
          status: "failed",
          last_error:
            "Discovery or delivery failed; this period can be retried.",
          completed_at: new Date().toISOString(),
        })
        .eq("org_id", org.id)
        .eq("period_key", period);
    }
    if (attempted >= 1) break;
  }
  return { statusCode: 200, body: JSON.stringify({ attempted, sent }) };
});
