import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// New Supabase API keys: publishable (sb_publishable_...) replaces anon,
// secret (sb_secret_...) replaces service_role. Legacy names still work as a fallback.
function getCredentials(type: 'admin' | 'anon'): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    type === 'admin'
      ? (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)
      : (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!url || !key) {
    const missing = [
      !url && 'NEXT_PUBLIC_SUPABASE_URL',
      !key && (type === 'admin' ? 'SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY' : 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    ]
      .filter(Boolean)
      .join(', ');

    throw new Error(
      `[Supabase Configuration Error] Missing environment variable(s): ${missing}. Please configure your .env.local file.`
    );
  }

  return { url, key };
}

/**
 * Wraps a Supabase client in a Proxy so `createClient()` — and therefore the
 * `getCredentials()` validation above — only runs on first actual property
 * access (e.g. `.from(...)`), not at module import time. This is what lets
 * `next build`, and every route that doesn't touch Supabase, succeed even
 * when Supabase env vars are missing or wrong; only the specific request
 * that actually uses the client sees the descriptive error above, instead
 * of the whole module throwing an unhandled TypeError at import time.
 */
function createLazySupabaseClient(type: 'admin' | 'anon'): SupabaseClient {
  let instance: SupabaseClient | null = null;

  return new Proxy({} as SupabaseClient, {
    get(_target, prop) {
      if (!instance) {
        const { url, key } = getCredentials(type);
        instance = createClient(url, key);
      }
      const value = Reflect.get(instance, prop, instance);
      return typeof value === 'function' ? value.bind(instance) : value;
    },
  });
}

// Lazy instances — safe to import at build time or with missing env vars.
export const supabaseAdmin = createLazySupabaseClient('admin');
export const supabase = createLazySupabaseClient('anon');
