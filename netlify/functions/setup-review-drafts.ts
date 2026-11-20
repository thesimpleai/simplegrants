import { z } from "zod";
import { DOCUMENT_BUCKET } from "../../src/lib/constants";
import { HttpError, json } from "./lib/core";
import { authenticatedDb, serviceDb } from "./lib/db";

const maxRequestBytes = 2 * 1024 * 1024;
const maxStoredBytes = maxRequestBytes + 64;
const methods = ["GET", "PUT", "DELETE"];
const uuid = z.uuid();
const draftTarget = z.strictObject({
  orgId: uuid,
  kind: z.enum(["profile", "grant-setup"]),
});
const draftData = z.record(z.string(), z.unknown());
const input = z.strictObject({ data: draftData });
const storedDraft = input.extend({ updatedAt: z.number().int().nonnegative() });
const unavailable =
  "Your setup review draft could not be accessed. Please try again.";
const draftTooLarge = () =>
  new HttpError(413, "The setup review draft exceeds 2 MiB.");

function respond(data: unknown, status = 200) {
  const response = json(data, status);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Authorization");
  return response;
}

function missingObject(error: {
  status?: number;
  statusCode?: string;
  message: string;
}) {
  const status = error.status ?? Number(error.statusCode);
  return (
    !/\bbucket\b/i.test(error.message) &&
    !/bucket/i.test(error.statusCode ?? "") &&
    (status === 404 ||
      error.statusCode === "NoSuchKey" ||
      (status === 400 && /\bnot found\b/i.test(error.message)))
  );
}

async function readDraftData(request: Request) {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json")
    throw new HttpError(415, "Send the setup review draft as JSON.");
  if (Number(request.headers.get("content-length")) > maxRequestBytes)
    throw draftTooLarge();

  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Send a valid setup review draft.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxRequestBytes) {
        void reader.cancel().catch(() => {});
        throw draftTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, size),
    );
    return input.parse(JSON.parse(text)).data;
  } catch {
    throw new HttpError(400, "Send a valid setup review draft.");
  }
}

export default async function setupReviewDrafts(request: Request) {
  if (!methods.includes(request.method)) {
    const response = respond(
      { error: "Use GET, PUT or DELETE for a setup review draft." },
      405,
    );
    response.headers.set("Allow", methods.join(", "));
    return response;
  }

  try {
    const params = new URL(request.url).searchParams;
    const target = draftTarget.safeParse(Object.fromEntries(params));
    if (
      !target.success ||
      params.getAll("orgId").length !== 1 ||
      params.getAll("kind").length !== 1
    )
      throw new HttpError(
        400,
        "Choose a valid organisation and setup review draft type.",
      );

    const orgId = target.data.orgId.toLowerCase();
    const { user } = await authenticatedDb(request, orgId, true);
    const actor = uuid.safeParse(user.id);
    if (!actor.success) throw new HttpError(401, "Please sign in again.");
    // Existing storage RLS denies client access to keys without an org UUID
    // as their first segment. Scope service access to the authenticated actor.
    const path = `.setup-review-drafts/${orgId}/${actor.data.toLowerCase()}/${target.data.kind}.json`;

    if (request.method === "PUT") {
      const data = await readDraftData(request);
      const updatedAt = Date.now();
      const saved = JSON.stringify({ updatedAt, data });
      if (Buffer.byteLength(saved, "utf8") > maxStoredBytes)
        throw draftTooLarge();
      const storage = serviceDb().storage.from(DOCUMENT_BUCKET);
      const result = await storage.upload(path, saved, {
        contentType: "application/json",
        cacheControl: "0",
        upsert: true,
      });
      if (result.error) return respond({ error: unavailable }, 503);
      return respond({ updatedAt });
    }

    const storage = serviceDb().storage.from(DOCUMENT_BUCKET);
    if (request.method === "DELETE") {
      const { error } = await storage.remove([path]);
      if (error && !missingObject(error))
        return respond({ error: unavailable }, 503);
      return respond({ removed: true });
    }

    const { data, error } = await storage.download(path);
    if (error && missingObject(error)) return respond({ draft: null });
    if (error || !data || data.size > maxStoredBytes)
      return respond({ error: unavailable }, 503);
    const draft = storedDraft.parse(JSON.parse(await data.text()));
    return respond({ draft });
  } catch (error) {
    return error instanceof HttpError && error.status < 500
      ? respond({ error: error.message }, error.status)
      : respond({ error: unavailable }, 503);
  }
}
