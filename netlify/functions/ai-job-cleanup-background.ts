import type { Config } from "@netlify/functions";
import {
  JOB_FILES,
  JOB_LIFETIME_MS,
  jobStorage,
  readJobFile,
} from "./lib/ai-jobs";
export const config: Config = { background: true, schedule: "17 * * * *" };
export default async () => {
  const storage = jobStorage();
  const stopAt = Date.now() + 120000;
  // Snapshot each directory before deletion so offsets never skip entries.
  async function entries(prefix: string) {
    const all = [];
    for (let offset = 0; Date.now() < stopAt; offset += 1000) {
      const { data, error } = await storage.list(prefix, {
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw Error("AI job cleanup listing failed");
      all.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return all;
  }
  for (const org of await entries(".ai-jobs")) {
    for (const job of await entries(`.ai-jobs/${org.name}`)) {
      if (Date.now() >= stopAt) return;
      const prefix = `.ai-jobs/${org.name}/${job.name}`;
      const metadata = await readJobFile(prefix, "metadata.json");
      let expired =
        !!metadata &&
        typeof metadata === "object" &&
        "expiresAt" in metadata &&
        typeof metadata.expiresAt === "number" &&
        metadata.expiresAt <= Date.now();
      if (!metadata) {
        const files = await entries(prefix);
        expired =
          files.length > 0 &&
          files.every(
            (file) =>
              file.created_at &&
              Date.parse(file.created_at) + JOB_LIFETIME_MS < Date.now(),
          );
      }
      if (expired) {
        const { error } = await storage.remove(
          JOB_FILES.map((name) => `${prefix}/${name}`),
        );
        if (error) throw Error("AI job cleanup removal failed");
      }
    }
  }
};
