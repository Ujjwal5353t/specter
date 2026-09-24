import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRepoAccess, parseRepoUrl } from '@/lib/github';
import { rateLimit } from '@/lib/rateLimit';
import { appOrigin, createAndRunScan } from '@/lib/scanTrigger';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!rateLimit(ip)) {
    return NextResponse.json({ error: 'Rate limit: 5 scans per hour' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const { repoUrl } = body;
  if (!repoUrl) return NextResponse.json({ error: 'repoUrl required' }, { status: 400 });

  let owner: string, repo: string;
  try {
    ({ owner, repo } = parseRepoUrl(repoUrl));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Invalid GitHub URL';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Reject private/missing repos up front, before the cache can serve a stale
  // result for them. /run repeats this check in case access changes mid-flight.
  const access = await checkRepoAccess(owner, repo);
  if (!access.ok) {
    return NextResponse.json({ error: access.reason }, { status: 422 });
  }

  // Normalize the URL to lowercase to prevent case-sensitive cache misses
  const normalizedUrl = `https://github.com/${owner}/${repo}`.toLowerCase();

  // Check cache first (6-hour TTL)
  const { data: cached } = await supabaseAdmin
    .from('scan_cache')
    .select('*')
    .eq('repo_url', normalizedUrl)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (cached) {
    const { data: existingScan } = await supabaseAdmin
      .from('scans')
      .insert({
        repo_url: normalizedUrl,
        repo_owner: owner,
        repo_name: repo,
        status: 'completed',
        threat_score: cached.threat_score,
      })
      .select()
      .single();
    return NextResponse.json({ scanId: existingScan?.id });
  }

  const result = await createAndRunScan(owner, repo, appOrigin(req.nextUrl?.origin));
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ scanId: result.scanId });
}