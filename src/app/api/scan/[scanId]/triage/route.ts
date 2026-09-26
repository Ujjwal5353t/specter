import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { rateLimit } from '@/lib/rateLimit';
import { clientIp, loadScanContext } from '@/lib/console/server';
import { secretItems } from '@/lib/console/derive';

/**
 * Triage state for exposed secrets (the Secrets view's MARK RESOLVED). Keyed
 * per repo + finding fingerprint, so a resolution carries over to later scans
 * of the same repo that still see the same finding. Needs the
 * finding_triage table from supabase/schema.sql; until it exists the view
 * shows triage as unavailable instead of pretending to save.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;
  const ctx = await loadScanContext(scanId);
  if (!ctx) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
  const { data, error } = await supabaseAdmin
    .from('finding_triage')
    .select('fingerprint, status, updated_at')
    .eq('repo_url', ctx.scan.repo_url);
  if (error) return NextResponse.json({ available: false, items: [] });
  return NextResponse.json({ available: true, items: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  if (!rateLimit(`triage:${clientIp(req.headers)}`, 60)) {
    return NextResponse.json({ error: 'Rate limit: 60 triage updates per hour' }, { status: 429 });
  }
  const { scanId } = await params;
  const body = await req.json().catch(() => ({}));
  const { fingerprint, status } = body as { fingerprint?: string; status?: string };
  if (typeof fingerprint !== 'string' || (status !== 'resolved' && status !== 'open')) {
    return NextResponse.json({ error: 'fingerprint and status (resolved|open) required' }, { status: 400 });
  }
  const ctx = await loadScanContext(scanId);
  if (!ctx) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
  if (!ctx.result) return NextResponse.json({ error: 'Scan results have expired' }, { status: 410 });
  // Only fingerprints this scan actually reported can be triaged.
  if (!secretItems(ctx.result).some((s) => s.fp === fingerprint)) {
    return NextResponse.json({ error: 'Unknown finding' }, { status: 404 });
  }

  const { error } = await supabaseAdmin.from('finding_triage').upsert({
    repo_url: ctx.scan.repo_url,
    fingerprint,
    status,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    return NextResponse.json(
      { error: 'Triage storage is not set up. Run supabase/schema.sql to create finding_triage.' },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true });
}
