import { z } from "zod";
import { authorizedJob, jobIds, readJobFile, jobError } from "./lib/ai-jobs";
import { json } from "./lib/core";
const resultSchema = z.object({
  status: z.number().int().min(200).max(599),
  body: z.unknown(),
});
export default async (request: Request) => {
  if (request.method !== "GET")
    return json({ error: "Use GET for this endpoint." }, 405);
  try {
    const ids = jobIds.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!ids.success) return json({ error: "Choose a valid AI step." }, 400);
    const { prefix, metadata } = await authorizedJob(request, ids.data);
    const result = resultSchema.safeParse(
      await readJobFile(prefix, "result.json"),
    );
    if (result.success) return json(result.data.body, result.data.status);
    if (
      Date.now() - metadata.createdAt > 15000 &&
      !(await readJobFile(prefix, "claim.json"))
    )
      return json(
        {
          error: "The AI worker did not start. Please try again.",
          code: "SG_AI_UNAVAILABLE",
        },
        503,
      );
    if (Date.now() - metadata.createdAt > 135000)
      return json(
        {
          error:
            "This AI step took too long. Your saved information is safe. Please try again.",
          code: "SG_AI_TIMEOUT",
        },
        504,
      );
    return json(
      { jobId: ids.data.jobId, orgId: ids.data.orgId, pending: true },
      202,
    );
  } catch (error) {
    return jobError(error);
  }
};
