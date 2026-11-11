import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { authRateSecret } from "./auth-email";
import { HttpError } from "./core";
const MAX_AGE = 15 * 60 * 1000;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function aiOriginalFingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
function signature(
  actor: string,
  orgId: string,
  action: "discover" | "draft",
  original: string,
  state: unknown,
  issuedAt: number,
) {
  return createHmac("sha256", authRateSecret())
    .update(
      JSON.stringify(
        canonical({
          purpose: "simple-grants-ai-stage-v1",
          actor,
          orgId,
          action,
          stage: action === "discover" ? "search" : "preflight",
          original,
          state,
          issuedAt,
        }),
      ),
    )
    .digest("hex");
}
export function issueAIReceipt(
  actor: string,
  orgId: string,
  action: "discover" | "draft",
  original: string,
  state: unknown,
) {
  const stageIssuedAt = Date.now();
  return {
    sourceFingerprint: signature(
      actor,
      orgId,
      action,
      original,
      state,
      stageIssuedAt,
    ),
    stageIssuedAt,
  };
}
export function verifyAIReceipt(
  actor: string,
  orgId: string,
  action: "discover" | "draft",
  original: string,
  state: unknown,
  fingerprint: string | undefined,
  issuedAt: number | undefined,
) {
  if (
    !fingerprint ||
    !/^[0-9a-f]{64}$/.test(fingerprint) ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt! > Date.now() ||
    Date.now() - issuedAt! > MAX_AGE
  )
    throw new HttpError(
      409,
      "This AI source check has expired or changed. Restart this action to check the current sources.",
    );
  const expected = signature(actor, orgId, action, original, state, issuedAt!);
  if (
    !timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(fingerprint, "hex"),
    )
  )
    throw new HttpError(
      409,
      "The source information or AI check changed. Restart this action before continuing.",
    );
}
