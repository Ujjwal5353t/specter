import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Scan history for the Reports archive, the Monitoring view and the console
 * shell (latest scan, alert count). Every value comes from the scans /
 * findings / scan_cache tables.
 *
 * Cache replays (/start served from scan_cache) insert no findings rows, so a
 * replay reports the counts of the fresh run it replays (`source_scan_id`).
 */
export async function GET(req: NextRequest) {
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit')) || 150, 1), 400);

  const { data: rows, error } = await supabaseAdmin
    .from('scans')
    .select('*, findings(count)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Same rule as /status: a run still in flight past this was orphaned (/run caps at 60s).
  const STALE_SCAN_MS = 3 * 60 * 1000;
  const stale = (s: { status: string; created_at: string }) =>
    (s.status === 'scanning' || s.status === 'pending') && Date.now() - new Date(s.created_at).getTime() > STALE_SCAN_MS;

  const scans = (rows ?? []).map((s) => ({
    id: s.id as string,
    repo_url: s.repo_url as string,
    status: (stale(s) ? 'failed' : s.status) as string,
    error_message: (stale(s) ? 'Scan timed out' : s.error_message ?? null) as string | null,
    threat_score: s.threat_score as number | null,
    created_at: s.created_at as string,
    completed_at: (s.completed_at ?? null) as string | null,
    from_cache: !!s.from_cache,
    findings: (s.findings?.[0]?.count ?? 0) as number,
  }));

  const ids = scans.filter((s) => s.status === 'completed' && !s.from_cache).map((s) => s.id);
  const critical = new Map<string, number>();
  if (ids.length) {
    const { data: crit } = await supabaseAdmin
      .from('findings')
      .select('scan_id')
      .in('scan_id', ids)
      .eq('severity', 'critical');
    for (const f of crit ?? []) critical.set(f.scan_id, (critical.get(f.scan_id) ?? 0) + 1);
  }

  // Newest-first, so walking backwards leaves each repo's most recent fresh run in `lastFresh`.
  const lastFresh = new Map<string, string>();
  const source = new Map<string, string>();
  for (let i = scans.length - 1; i >= 0; i--) {
    const s = scans[i];
    if (s.status !== 'completed') continue;
    if (!s.from_cache) lastFresh.set(s.repo_url, s.id);
    else if (lastFresh.has(s.repo_url)) source.set(s.id, lastFresh.get(s.repo_url)!);
  }
  const byId = new Map(scans.map((s) => [s.id, s]));

  const { data: fresh } = await supabaseAdmin
    .from('scan_cache')
    .select('repo_url, expires_at')
    .gt('expires_at', new Date().toISOString());
  const freshRepos = new Set((fresh ?? []).map((c) => c.repo_url as string));

  const latestPerRepo = new Set<string>();
  const out = scans.map((s) => {
    const src = s.status !== 'completed' ? null : s.from_cache ? source.get(s.id) ?? null : s.id;
    const srcRow = src ? byId.get(src) : undefined;
    let report: 'ready' | 'superseded' | 'expired' | 'scanning' | 'failed';
    if (s.status === 'failed') report = 'failed';
    else if (s.status !== 'completed') report = 'scanning';
    else if (latestPerRepo.has(s.repo_url)) report = 'superseded';
    else report = freshRepos.has(s.repo_url) ? 'ready' : 'expired';
    if (s.status === 'completed') latestPerRepo.add(s.repo_url);
    return {
      ...s,
      source_scan_id: src,
      findings: srcRow ? srcRow.findings : null,
      critical: srcRow ? critical.get(srcRow.id) ?? 0 : null,
      report,
    };
  });

  return NextResponse.json({ scans: out });
}
