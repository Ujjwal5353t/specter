import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Per-engine / per-severity finding counts for one scan, from the findings
 * table. For a cache replay, pass the fresh run it replays (the archive does
 * this via source_scan_id) — replays write no findings rows of their own.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(scanId)) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
  const { data, error } = await supabaseAdmin.from('findings').select('scanner, severity').eq('scan_id', scanId).limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const engines: Record<string, Record<string, number>> = {};
  for (const f of data ?? []) {
    engines[f.scanner] ??= {};
    engines[f.scanner][f.severity] = (engines[f.scanner][f.severity] ?? 0) + 1;
  }
  return NextResponse.json({ total: data?.length ?? 0, engines });
}
