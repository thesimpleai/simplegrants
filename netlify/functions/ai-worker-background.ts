import type { Config } from "@netlify/functions";
import { executeAI } from "./ai";
import { createAIRequestBudget, aiFailureResponse } from "./lib/ai-runtime";
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
  let prefix: string | undefined;
  let claimed = false;
  const budget = createAIRequestBudget(120000, 90000);
  try {
    const ids = jobIds.parse(await request.json());
    ({ prefix } = await authorizedJob(request, ids));
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
    if (prefix && claimed) {
      const response = aiFailureResponse(error, budget, "background");
      await writeJobFile(prefix, "result.json", {
        status: response.status,
        body: await response.json(),
      });
    }
  } finally {
    budget.close();
  }
};
