import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False when the build was made without Supabase settings (shows a setup screen instead of crashing). */
export const isSupabaseConfigured = Boolean(url && anonKey);

// Only the public anon/publishable key is ever used in the browser.
// Authorization is enforced by Row Level Security and database functions.
export const supabase = createClient(
  url || "http://localhost:54321",
  anonKey || "missing-anon-key",
  { auth: { persistSession: true, autoRefreshToken: true } },
);
