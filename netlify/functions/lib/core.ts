import type {
  DocumentRecord,
  Opportunity,
  Organisation,
} from "../../../src/types";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export function env(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new HttpError(
      503,
      `The ${name} integration is not configured. Please ask the portal administrator to finish setup.`,
    );
  return value;
}
export function normaliseEmail(value: string) {
  return (value.match(/<([^>]+)>/)?.[1] ?? value).trim().toLowerCase();
}
export function safePublicReply(
  org: Pick<Organisation, "name" | "abn">,
  portalUrl: string,
) {
  // Deliberately no generative AI, private documents, ledger or original message in email replies.
  return `Thanks for your email to Simple Grant. We have received it for ${org.name}${org.abn ? ` (ABN ${org.abn})` : ""}. An authorised member can review the message and any attachments securely in the portal: ${portalUrl}\n\nFor questions about documents, finances, applications or project progress, please sign in. Email attachments are unverified until reviewed.`;
}
export type PublicEmailIntent = "org_name" | "abn" | "grants" | "help";
export function publicEmailAnswer(
  intent: PublicEmailIntent,
  org: Pick<Organisation, "name" | "abn">,
  grants: Pick<
    Opportunity,
    "id" | "title" | "funder" | "source_url" | "closes_at" | "provenance"
  >[],
  portalUrl: string,
) {
  if (intent === "org_name")
    return `The organisation name saved in Simple Grant is ${org.name}. Review public organisation details in your secure portal: ${portalUrl}`;
  if (intent === "abn")
    return org.abn
      ? `The ABN saved for ${org.name} is ${org.abn}. Confirm its current registration on the Australian Business Register. Portal: ${portalUrl}`
      : `There is no ABN saved for ${org.name}. An authorised person can review the organisation profile in the portal: ${portalUrl}`;
  if (intent === "grants") {
    const eligible = grants
      .filter(
        (grant) =>
          grant.provenance?.method === "google_search_grounding" &&
          safeHttpsUrl(grant.source_url) &&
          (!grant.closes_at || new Date(grant.closes_at) >= new Date()),
      )
      .slice(0, 5);
    const lines = eligible.map((grant) => {
      const link = new URL(portalUrl);
      link.searchParams.set("view", "opportunities");
      link.searchParams.set("grant", grant.id);
      return `${grant.title} — ${grant.funder}\nPublic source: ${grant.source_url}\nReview in your portal: ${link.href}`;
    });
    return lines.length
      ? `Here are saved, source-backed grant opportunities. Eligibility, current status and deadlines must be checked with each provider.\n\n${lines.join("\n\n")}\n\nFor private application or financial questions, please sign in: ${portalUrl}`
      : `There are no current source-backed opportunities saved that I can share by email. Sign in to run a new search: ${portalUrl}`;
  }
  return `I can help by email with the organisation name, saved ABN, and public grant opportunities. For private documents, financial records, application decisions or project progress, please sign in: ${portalUrl}\n\nAny evidence you email is stored as unverified information for an authorised person to review.`;
}
export function requiredDocumentCategories(requirements: string[]) {
  const requirementsText = requirements.join(" ").toLowerCase();
  const needed = new Set<string>();
  if (
    /audit(ed)?\s+(financial|statement|report)|financial\s+audit/.test(
      requirementsText,
    )
  )
    needed.add("audit");
  else if (/financial\s+(statement|report)/.test(requirementsText))
    needed.add("financial");
  if (/public liability|insurance/.test(requirementsText))
    needed.add("insurance");
  if (
    /registration certificate|incorporation certificate/.test(requirementsText)
  )
    needed.add("registration");
  if (/acnc\s+(certificate|document|registration)/.test(requirementsText))
    needed.add("acnc");
  return [...needed];
}
export function draftBlockers(
  org: Organisation,
  grant: Opportunity,
  documents: DocumentRecord[],
  now = new Date(),
) {
  const blockers: string[] = [];
  if (org.verification_status !== "approved")
    blockers.push("Review and approve your organisation profile first.");
  if (grant.guidelines_text.trim().length < 80)
    blockers.push(
      "Upload or paste the official program guidelines before drafting.",
    );
  for (const category of requiredDocumentCategories(grant.requirements)) {
    const found = documents.some(
      (d) =>
        (d.category === category ||
          (category === "audit" && d.category === "audit_report") ||
          (category === "financial" &&
            ["audit", "audit_report", "financial_statement"].includes(
              d.category,
            ))) &&
        (!d.expires_on || new Date(`${d.expires_on}T23:59:59Z`) >= now),
    );
    if (!found)
      blockers.push(
        `Upload a current ${category} document required by this grant, or review the grant checklist if this requirement is incorrect.`,
      );
  }
  return blockers;
}
export function periodKey(frequency: string, now = new Date()): string | null {
  if (frequency === "never") return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  if (frequency === "monthly") return `monthly:${date.slice(0, 7)}`;
  if (frequency !== "weekly") return null;
  const monday = new Date(`${date}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return `weekly:${monday.toISOString().slice(0, 10)}`;
}
export function safeHttpsUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname.includes(".") ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export function sourceDeadline(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match || Number.isNaN(Date.parse(value))) return null;
  const [, year, month, day, hour, minute, second] = match;
  const daysInMonth = new Date(
    Date.UTC(Number(year), Number(month), 0),
  ).getUTCDate();
  if (
    Number(year) < 1 ||
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > daysInMonth ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second || 0) > 59
  )
    return null;
  return new Date(value).toISOString();
}
export function validABN(raw: string) {
  const digits = raw.replace(/\s/g, "");
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  return (
    [...digits].reduce(
      (total, digit, index) =>
        total + (Number(digit) - (index === 0 ? 1 : 0)) * weights[index],
      0,
    ) %
      89 ===
    0
  );
}
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
export function stripSensitive<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripSensitive) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/bank|bsb|account.?number|credit.?card|tax.?file|tfn|password|secret|token/i.test(
              key,
            ),
        )
        .map(([key, val]) => [key, stripSensitive(val)]),
    ) as T;
  return value;
}
export function errorResponse(error: unknown) {
  if (error instanceof HttpError)
    return json({ error: error.message }, error.status);
  // Do not log upstream payloads, organisation records, credentials or document contents.
  console.error(
    "Simple Grant function failed:",
    error instanceof Error ? error.name : "unknown error",
  );
  return json(
    {
      error:
        "The service could not complete this request. Please try again. Your saved information has not been deleted.",
    },
    502,
  );
}
