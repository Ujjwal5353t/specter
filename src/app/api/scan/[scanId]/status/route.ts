import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Must match the TTL /run writes into scan_cache.expires_at.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;
  const { data: scan } = await supabaseAdmin.from('scans').select('*').eq('id', scanId).single();
  if (!scan) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });

  const [{ data: cache }, { data: progress }] = await Promise.all([
    supabaseAdmin
      .from('scan_cache')
      .select('*')
      .eq('repo_url', scan.repo_url)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle(),
    // Live per-scanner state for the loader; null if the table isn't migrated yet.
    supabaseAdmin
      .from('scan_progress')
      .select('scanner, status, detail, finding_count, started_at, duration_ms')
      .eq('scan_id', scanId),
  ]);

  // Results are only served while the cache is fresh. Past that, the repo may
  // have gone private or changed, so the old link stops showing its data.
  if (scan.status === 'completed' && !cache) {
    return NextResponse.json({
      scan: {
        ...scan,
        status: 'failed',
        error_message: 'This scan result has expired. Run a new scan to see current results.',
      },
      cache: null,
      progress: progress ?? null,
    });
  }

  // expires_at is rewritten on every fresh run, so it dates the results
  // (created_at is not: upserts keep the original row's value).
  const scannedAt = cache ? new Date(new Date(cache.expires_at).getTime() - CACHE_TTL_MS).toISOString() : null;

  return NextResponse.json({ scan, cache, progress: progress ?? null, scannedAt });
}
