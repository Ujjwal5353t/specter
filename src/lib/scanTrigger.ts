import { createHash, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase';

// Context a monitored scan carries through to /run, so the alert can say
// what changed. Manual scans from the UI pass none and never alert.
export interface MonitorContext {
  source: 'github-push' | 'cron';
  commitSha?: string;
  commitMessage?: string;
  pusher?: string;
  ref?: string;
}

const isProd = () => process.env.NODE_ENV === 'production';

/**
 * Shared secret for the start → run hop. Returns null when production has no
 * INTERNAL_SECRET, so callers fail closed instead of using a public default.
 * Development keeps a fallback so local runs work without configuration.
 */
export function getInternalSecret(): string | null {
  const secret = process.env.INTERNAL_SECRET;
  if (secret) return secret;
  return isProd() ? null : 'specter-internal';
}

/** Constant-time string compare. Hashing first hides length differences. */
export function safeEqual(a: string | null | undefined, b: string): boolean {
  if (typeof a !== 'string') return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Origin that /run is called on, which also receives x-internal-secret. The
 * request's own origin comes from the Host header, so it is attacker-controlled
 * and only used outside production.
 */
export function appOrigin(requestOrigin?: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (!isProd()) return requestOrigin || 'http://localhost:3000';
  return 'https://specter-seven.vercel.app';
}

/**
 * Creates a scan row and triggers /run for it. Always a fresh scan: callers
 * that want the 6h cache check it themselves before calling this.
 */
export async function createAndRunScan(
  owner: string,
  repo: string,
  origin: string,
  monitor?: MonitorContext,
): Promise<{ scanId: string } | { error: string }> {
  // Checked before the insert so a misconfigured server leaves no orphan row
  const internalSecret = getInternalSecret();
  if (!internalSecret) {
    console.error('INTERNAL_SECRET is not set in production; refusing to start a scan');
    return { error: 'Server misconfigured' };
  }

  const normalizedUrl = `https://github.com/${owner}/${repo}`.toLowerCase();

  const { data: scan, error } = await supabaseAdmin
    .from('scans')
    .insert({ repo_url: normalizedUrl, repo_owner: owner, repo_name: repo, status: 'scanning' })
    .select()
    .single();

  if (error || !scan) {
    console.error('Supabase insert failed:', error);
    return { error: error?.message ?? 'Failed to create scan' };
  }

  // Trigger the run route — AWAITED with a short timeout.
  // This guarantees the request actually leaves before this function
  // terminates. We don't wait for the full scan, just for /run to
  // accept the trigger (it runs the real work independently afterward).
  try {
    await fetch(`${origin}/api/scan/${scan.id}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalSecret,
      },
      body: JSON.stringify({ monitor: monitor ?? null }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    console.error('Failed to trigger run route:', err);
    // Don't fail the whole request — the scan row exists, the frontend
    // can still poll it. But this log line is how we'll catch this
    // happening again in Vercel logs.
  }

  return { scanId: scan.id };
}
