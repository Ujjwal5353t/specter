import { createClient } from "@supabase/supabase-js";

// New Supabase API keys: publishable (sb_publishable_...) replaces anon,
// secret (sb_secret_...) replaces service_role. Legacy names still work as a fallback.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const secretKey = (process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY)!;

export const supabaseAdmin = createClient(url, secretKey);

export const supabase = createClient(url, publishableKey);
