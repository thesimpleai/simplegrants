import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { env, HttpError } from "./core";

export function serviceDb() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function authenticatedDb(
  request: Request,
  orgId: string,
  write = true,
): Promise<{ db: SupabaseClient; user: User }> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    throw new HttpError(401, "Please sign in to continue.");
  const key =
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!key) throw new HttpError(503, "Supabase is not configured.");
  const db = createClient(env("SUPABASE_URL"), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const {
    data: { user },
    error,
  } = await db.auth.getUser(authorization.slice(7));
  if (error || !user)
    throw new HttpError(401, "Your session has expired. Please sign in again.");
  const { data: member, error: membershipError } = await db
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError || !member || (write && member.role === "viewer"))
    throw new HttpError(
      403,
      "You do not have permission to perform this action for this organisation.",
    );
  return { db, user };
}
export function checked<T>(result: {
  data: T;
  error: { message: string } | null;
}): T {
  if (result.error)
    throw new HttpError(
      502,
      "Your information could not be saved. Please try again.",
    );
  return result.data;
}
export async function organisation(db: SupabaseClient, id: string) {
  const { data, error } = await db
    .from("organizations")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) throw new HttpError(404, "Organisation not found.");
  return data;
}
