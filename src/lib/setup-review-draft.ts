import { supabase } from "./supabase";

export type SetupReviewDraftKind = "profile" | "grant-setup";
type Draft = { updatedAt: number; data: Record<string, unknown> };
type Method = "GET" | "PUT" | "DELETE";

const pendingWrites = new Map<string, Promise<unknown>>();
const errors: Record<Method, string> = {
  GET: "Couldn’t open your saved draft. Close this form and try again.",
  PUT: "Couldn’t save your draft. Your answers are still open here. Try saving again.",
  DELETE: "Your answers were approved, but the old draft couldn’t be cleared.",
};

async function request(
  orgId: string,
  actorId: string,
  kind: SetupReviewDraftKind,
  method: Method,
  data?: Record<string, unknown>,
) {
  const session = (await supabase?.auth.getSession())?.data.session;
  if (session?.user.id !== actorId)
    throw new Error("Sign in again to access your saved draft.");
  const response = await fetch(
    `/api/setup-review-drafts?${new URLSearchParams({ orgId, kind })}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(data && { "Content-Type": "application/json" }),
      },
      body: data ? JSON.stringify({ data }) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  ).catch(() => {
    throw new Error(errors[method]);
  });
  if (!response.ok) {
    if (response.status === 413)
      throw new Error("This review is too large to save as a draft.");
    throw new Error(errors[method]);
  }
  return response.json().catch(() => {
    throw new Error(errors[method]);
  });
}

function afterPending<T>(
  orgId: string,
  actorId: string,
  kind: SetupReviewDraftKind,
  operation: () => Promise<T>,
): Promise<T> {
  const key = `${orgId}/${actorId}/${kind}`;
  const previous = pendingWrites.get(key);
  const next = (previous?.catch(() => {}) ?? Promise.resolve()).then(operation);
  pendingWrites.set(key, next);
  return next.finally(() => {
    if (pendingWrites.get(key) === next) pendingWrites.delete(key);
  });
}

export function loadSetupReviewDraft(
  orgId: string,
  actorId: string,
  kind: SetupReviewDraftKind,
): Promise<Draft | null> {
  return afterPending(orgId, actorId, kind, async () => {
    const { draft } = await request(orgId, actorId, kind, "GET");
    if (draft === null) return null;
    if (!Number.isFinite(draft?.updatedAt) || !draft.data)
      throw new Error(errors.GET);
    return draft;
  });
}

export function saveSetupReviewDraft(
  orgId: string,
  actorId: string,
  kind: SetupReviewDraftKind,
  data: Record<string, unknown>,
): Promise<number> {
  return afterPending(orgId, actorId, kind, async () => {
    const { updatedAt } = await request(orgId, actorId, kind, "PUT", data);
    if (!Number.isFinite(updatedAt)) throw new Error(errors.PUT);
    return updatedAt;
  });
}

export function removeSetupReviewDraft(
  orgId: string,
  actorId: string,
  kind: SetupReviewDraftKind,
): Promise<void> {
  return afterPending(orgId, actorId, kind, async () => {
    const { removed } = await request(orgId, actorId, kind, "DELETE");
    if (removed !== true) throw new Error(errors.DELETE);
  });
}
