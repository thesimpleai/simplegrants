import { z } from "zod";
import { authenticatedDb, checked } from "./lib/db";
import { HttpError, json } from "./lib/core";
import { isGroundingRedirect, resolveSourceLink } from "./lib/source-links";
import type { Opportunity } from "../../src/types";
export default async (request: Request) => {
  if (request.method !== "POST")
    return json({ error: "Use POST for this endpoint." }, 405);
  try {
    if (Number(request.headers.get("content-length") || 0) > 1024)
      throw new HttpError(413, "The request is too large.");
    const raw = await request.text();
    if (raw.length > 1024)
      throw new HttpError(413, "The request is too large.");
    const parsed = z.object({ orgId: z.uuid() }).safeParse(JSON.parse(raw));
    if (!parsed.success) return json({ error: "Choose an organisation." }, 400);
    const { db } = await authenticatedDb(request, parsed.data.orgId, true);
    const rows = checked(
      await db
        .from("opportunities")
        .select("id,org_id,source_url,provenance")
        .eq("org_id", parsed.data.orgId)
        .like(
          "source_url",
          "https://vertexaisearch.cloud.google.com/grounding-api-redirect/%",
        )
        .order("id")
        .limit(21),
    ) as Pick<Opportunity, "id" | "org_id" | "source_url" | "provenance">[];
    const candidates = rows
      .filter((row) => isGroundingRedirect(row.source_url))
      .slice(0, 20);
    let repaired = 0,
      unresolved = 0;
    // Four batches of five keep redirects bounded and below synchronous limits.
    for (let i = 0; i < candidates.length; i += 5) {
      await Promise.all(
        candidates.slice(i, i + 5).map(async (row) => {
          const canonical = await resolveSourceLink(row.source_url);
          if (!canonical || isGroundingRedirect(canonical)) {
            unresolved++;
            return;
          }
          const sources = Array.isArray(row.provenance?.sources)
            ? row.provenance.sources.map((source) =>
                source &&
                typeof source === "object" &&
                "uri" in source &&
                source.uri === row.source_url
                  ? { ...source, uri: canonical, grounding_uri: row.source_url }
                  : source,
              )
            : [];
          const result = checked(
            await db
              .from("opportunities")
              .update({
                source_url: canonical,
                provenance: {
                  ...row.provenance,
                  sources,
                  previous_source_url: row.source_url,
                  source_link_repaired_at: new Date().toISOString(),
                },
              })
              .eq("org_id", parsed.data.orgId)
              .eq("id", row.id)
              .eq("source_url", row.source_url)
              .eq("provenance", JSON.stringify(row.provenance))
              .select("id"),
          );
          if (result?.length) repaired++;
          else unresolved++;
        }),
      );
    }
    return json({ repaired, unresolved, hasMore: rows.length > 20 });
  } catch (error) {
    return json(
      {
        error:
          error instanceof HttpError
            ? error.message
            : "Saved source links could not be refreshed. Please try again.",
      },
      error instanceof HttpError ? error.status : 503,
    );
  }
};
