import { createClient } from "@supabase/supabase-js";
import { DB_SCHEMA } from "./constants";
import { getAuthStorageKey } from "./auth-session";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(url && key);
export const supabase = configured
  ? createClient(url, key, {
      db: { schema: DB_SCHEMA },
      auth: { storageKey: getAuthStorageKey(url), detectSessionInUrl: false },
    })
  : null;
