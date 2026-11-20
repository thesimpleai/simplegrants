import type { Config } from "@netlify/functions";
import { executeAI } from "./ai";
import {
  createAIRequestBudget,
  aiFailureResponse,
  type AIRequestBudget,
} from "./lib/ai-runtime";
import { aiJobTiming } from "../../src/lib/ai-job-timing";
import {
  authorizedJob,
  jobIds,
  jobStorage,
  readJobFile,
  writeJobFile,
} from "./lib/ai-jobs";
export const config: Config = { background: true };
export default async (request: Request) => {
  if (request.method !== "POST") return;
  const startedAt = Date.now();
  let prefix: string | undefined;
  let claimed = false;
  let budget: AIRequestBudget | undefined;
  try {
    const ids = jobIds.parse(await request.json());
    const job = await authorizedJob(request, ids);
    prefix = job.prefix;
    const timing = aiJobTiming(job.metadata.profileVerification);
    budget = createAIRequestBudget(
      Math.max(1, timing.workerMs - (Date.now() - startedAt)),
      timing.modelMs,
    );
    const payload = await readJobFile(prefix, "payload.json");
    if (
      !payload ||
      typeof payload !== "object" ||
      !("orgId" in payload) ||
      payload.orgId !== ids.orgId
    )
      return;
    // Storage INSERT with upsert=false is atomic. Netlify retries/double delivery
    // cannot execute this job or charge its model stage more than once.
    const claim = await jobStorage().upload(
      `${prefix}/claim.json`,
      JSON.stringify({ startedAt: Date.now() }),
      { contentType: "application/json", cacheControl: "0", upsert: false },
    );
    if (claim.error) return;
    claimed = true;
    const response = await executeAI(
      new Request(request.url, {
        method: "POST",
        headers: {
          Authorization: request.headers.get("authorization")!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }),
      budget,
    );
    await writeJobFile(prefix, "result.json", {
      status: response.status,
      body: await response.json(),
    });
    // Original evidence is no longer needed once a result has been saved.
    await jobStorage().remove([`${prefix}/payload.json`]);
  } catch (error) {
    if (prefix && claimed && budget) {
      const response = aiFailureResponse(error, budget, "background");
      await writeJobFile(prefix, "result.json", {
        status: response.status,
        body: await response.json(),
      });
    }
  } finally {
    budget?.close();
  }
};
