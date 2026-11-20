import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DOCUMENT_BUCKET } from "../../../src/lib/constants";
import { isProfileVerification } from "../../../src/lib/ai-job-timing";
import { authenticatedDb, serviceDb } from "./db";
import { authAppOrigin } from "./auth-email";
import { HttpError, json } from "./core";

export const jobIds = z.object({ orgId: z.uuid(), jobId: z.uuid() });
const metadataSchema = jobIds.extend({
  actorId: z.string().min(1),
  createdAt: z.number(),
  expiresAt: z.number(),
  profileVerification: z.boolean().default(false),
});
export type JobMetadata = z.infer<typeof metadataSchema>;
export const JOB_LIFETIME_MS = 15 * 60 * 1000;
export const JOB_FILES = [
  "metadata.json",
  "payload.json",
  "claim.json",
  "result.json",
];
// Non-UUID first path component: existing restrictive Storage policies deny ALL
// authenticated/anonymous clients. Only the server's service client can access jobs.
export function jobPrefix(orgId: string, jobId: string) {
  return `.ai-jobs/${orgId}/${jobId}`;
}
export function jobStorage() {
  return serviceDb().storage.from(DOCUMENT_BUCKET);
}
export async function writeJobFile(
  prefix: string,
  name: string,
  value: unknown,
  upsert = false,
) {
  const result = await jobStorage().upload(
    `${prefix}/${name}`,
    JSON.stringify(value),
    { contentType: "application/json", cacheControl: "0", upsert },
  );
  if (result.error)
    throw new HttpError(
      503,
      "The AI step could not be queued or saved. Please try again.",
    );
}
export async function readJobFile(
  prefix: string,
  name: string,
): Promise<unknown | null> {
  const { data, error } = await jobStorage().download(`${prefix}/${name}`);
  if (error) {
    if (
      ["404", "400"].includes(String(error.statusCode)) &&
      /not found/i.test(error.message)
    )
      return null;
    throw new HttpError(
      503,
      "The AI step could not be retrieved. Please try again.",
    );
  }
  return data ? JSON.parse(await data.text()) : null;
}
export async function authorizedJob(
  request: Request,
  ids: z.infer<typeof jobIds>,
) {
  const { user } = await authenticatedDb(request, ids.orgId, true);
  const prefix = jobPrefix(ids.orgId, ids.jobId);
  const parsed = metadataSchema.safeParse(
    await readJobFile(prefix, "metadata.json"),
  );
  if (
    !parsed.success ||
    parsed.data.actorId !== user.id ||
    parsed.data.orgId !== ids.orgId ||
    parsed.data.jobId !== ids.jobId
  )
    throw new HttpError(404, "This AI step is not available for your account.");
  if (parsed.data.expiresAt <= Date.now())
    throw new HttpError(410, "This AI step has expired. Start it again.");
  return { metadata: parsed.data, prefix };
}
export async function queueAIJob(
  request: Request,
  body: { orgId: string },
  actorId: string,
) {
  const jobId = randomUUID();
  const prefix = jobPrefix(body.orgId, jobId);
  const createdAt = Date.now();
  await writeJobFile(prefix, "metadata.json", {
    orgId: body.orgId,
    jobId,
    actorId,
    createdAt,
    expiresAt: createdAt + JOB_LIFETIME_MS,
    profileVerification: isProfileVerification(body),
  });
  await writeJobFile(prefix, "payload.json", body);
  // Never store session tokens. Forward only to the configured application origin.
  // A launch error is ambiguous: return this job for polling instead of launching
  // a second job and potentially consuming quota twice.
  try {
    const response = await fetch(
      `${authAppOrigin()}/.netlify/functions/ai-worker-background`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: request.headers.get("authorization")!,
        },
        body: JSON.stringify({ orgId: body.orgId, jobId }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (response.status !== 202) {
      await writeJobFile(prefix, "result.json", {
        status: 503,
        body: {
          error: "The AI worker is unavailable. Please try again.",
          code: "SG_AI_UNAVAILABLE",
        },
      });
    }
    await response.body?.cancel();
  } catch {
    // Polling will report an unclaimed job after 15 seconds. No automatic rerun.
  }
  return json({ jobId, orgId: body.orgId }, 202);
}
export function jobError(error: unknown) {
  return json(
    {
      error:
        error instanceof HttpError
          ? error.message
          : "This AI step is temporarily unavailable.",
    },
    error instanceof HttpError ? error.status : 503,
  );
}
