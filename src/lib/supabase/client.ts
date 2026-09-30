// ============================================================
// OATH — Supabase Client (Browser)
// ============================================================

import { createBrowserClient } from "@supabase/ssr";

const PLACEHOLDER_URL = "https://missing-project.supabase.co";
const PLACEHOLDER_KEY = "missing-supabase-anon-key";

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && key && !url.includes("placeholder") && !key.includes("placeholder"));
}

export function createClient() {
  // A non-working client lets public routes render without secrets. Callers must
  // check isSupabaseConfigured before making requests; never use a service key here.
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PLACEHOLDER_KEY,
  );
}
