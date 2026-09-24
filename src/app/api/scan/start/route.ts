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
  // force: user asked for a deep rescan, so skip the cache and run every scanner.
  const { repoUrl, force } = body;
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

  // Check cache first (6-hour TTL), unless a deep rescan was requested
  const { data: cached } = force === true
    ? { data: null }
    : await supabaseAdmin
      .from('scan_cache')
      .select('*')
      .eq('repo_url', normalizedUrl)
      .gt('expires_at', new Date().toISOString())
      .single();

  if (cached) {
    const row = {
      repo_url: normalizedUrl,
      repo_owner: owner,
      repo_name: repo,
      status: 'completed',
      threat_score: cached.threat_score,
    };
    let { data: existingScan, error } = await supabaseAdmin
      .from('scans')
      .insert({ ...row, from_cache: true })
      .select()
      .single();
    // Databases not yet migrated lack from_cache; still serve the cached scan.
    if (error) {
      ({ data: existingScan, error } = await supabaseAdmin.from('scans').insert(row).select().single());
    }
    if (error || !existingScan) {
      return NextResponse.json({ error: error?.message ?? 'Failed to create scan' }, { status: 500 });
    }
    return NextResponse.json({ scanId: existingScan.id });
  }

  const result = await createAndRunScan(owner, repo, appOrigin(req.nextUrl?.origin));
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ scanId: result.scanId });
}