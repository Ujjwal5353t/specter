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

export function appOrigin(fallback?: string): string {
  return fallback || process.env.NEXT_PUBLIC_APP_URL || 'https://specter-seven.vercel.app';
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
        'x-internal-secret': process.env.INTERNAL_SECRET ?? 'specter-internal',
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
