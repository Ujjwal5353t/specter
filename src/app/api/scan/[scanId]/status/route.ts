import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;
  const { data: scan } = await supabaseAdmin.from('scans').select('*').eq('id', scanId).single();
  if (!scan) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });

  const { data: cache } = await supabaseAdmin
    .from('scan_cache')
    .select('*')
    .eq('repo_url', scan.repo_url)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

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
    });
  }

  return NextResponse.json({ scan, cache });
}
