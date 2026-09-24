import { NextRequest, NextResponse } from 'next/server';
import { parseRepoUrl } from '@/lib/github';
import { appOrigin, createAndRunScan } from '@/lib/scanTrigger';

export const maxDuration = 60;

// Rescans every repo in MONITORED_REPOS (comma-separated URLs or owner/repo),
// for repos you can't install a webhook on. Vercel Cron sends
// "Authorization: Bearer $CRON_SECRET"; any external cron can do the same.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const entries = (process.env.MONITORED_REPOS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const origin = appOrigin(req.nextUrl?.origin);
  const results: Array<{ repo: string; scanId?: string; error?: string }> = [];

  for (const entry of entries) {
    try {
      const { owner, repo } = parseRepoUrl(entry);
      const result = await createAndRunScan(owner, repo, origin, { source: 'cron' });
      results.push({ repo: `${owner}/${repo}`, ...result });
    } catch (e) {
      results.push({ repo: entry, error: e instanceof Error ? e.message : 'Invalid repo' });
    }
  }

  return NextResponse.json({ ok: true, triggered: results });
}
