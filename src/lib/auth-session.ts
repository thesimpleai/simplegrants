import type { SupabaseClient } from "@supabase/supabase-js";

/** Keep this app's browser session separate from other apps on the same Auth project. */
export function getAuthStorageKey(supabaseUrl: string): string {
  const projectHost = new URL(supabaseUrl).host.toLowerCase();
  return `simple-grants-auth-v1-${projectHost}`;
}

/** Revoke only the current session, preserving other app/device sessions. */
export async function signOutFromSimpleGrant(client: {
  auth: Pick<SupabaseClient["auth"], "signOut">;
}): Promise<void> {
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw error;
}
