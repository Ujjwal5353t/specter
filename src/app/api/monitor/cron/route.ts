import { NextRequest, NextResponse } from 'next/server';
import { parseRepoUrl } from '@/lib/github';
import { appOrigin, createAndRunScan, safeEqual } from '@/lib/scanTrigger';

export const maxDuration = 60;

// Each trigger waits up to 3s for /run to accept, so a few at a time keeps
// MAX_REPOS well inside maxDuration.
const CONCURRENCY = 4;
const MAX_REPOS = 20;

// Rescans every repo in MONITORED_REPOS (comma-separated URLs or owner/repo),
// for repos you can't install a webhook on. Vercel Cron sends
// "Authorization: Bearer $CRON_SECRET"; any external cron can do the same.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get('authorization'), `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const all = (process.env.MONITORED_REPOS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const entries = all.slice(0, MAX_REPOS);
  const skipped = all.slice(MAX_REPOS);

  const origin = appOrigin(req.nextUrl?.origin);
  const results: Array<{ repo: string; scanId?: string; error?: string }> = new Array(entries.length);

  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const i = next++;
      const entry = entries[i];
      try {
        const { owner, repo } = parseRepoUrl(entry);
        const result = await createAndRunScan(owner, repo, origin, { source: 'cron' });
        results[i] = { repo: `${owner}/${repo}`, ...result };
      } catch (e) {
        results[i] = { repo: entry, error: e instanceof Error ? e.message : 'Invalid repo' };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));

  return NextResponse.json({ ok: true, triggered: results, skipped });
}
