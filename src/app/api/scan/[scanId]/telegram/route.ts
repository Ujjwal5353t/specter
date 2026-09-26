import { NextRequest, NextResponse } from 'next/server';
import { sendTelegram } from '@/lib/alerts';
import { rateLimit } from '@/lib/rateLimit';
import { appOrigin } from '@/lib/scanTrigger';
import { clientIp, loadScanContext } from '@/lib/console/server';
import { allFindings, ENGINE_NAME, engineCounts, type Engine } from '@/lib/console/derive';
import { band, repoSlug } from '@/lib/console/theme';

/**
 * Sends the intelligence brief for a scan to the configured Telegram chat.
 * The message is composed here from stored results — the client only names
 * the scan — so this can't be used to relay arbitrary text.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return NextResponse.json({ error: 'Telegram is not configured on this server' }, { status: 503 });
  }
  if (!rateLimit(`telegram:${clientIp(req.headers)}`, 5)) {
    return NextResponse.json({ error: 'Rate limit: 5 briefs per hour' }, { status: 429 });
  }
  const { scanId } = await params;
  const ctx = await loadScanContext(scanId);
  if (!ctx) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
  if (!ctx.result) return NextResponse.json({ error: 'Scan results have expired' }, { status: 410 });

  const r = ctx.result;
  const counts = engineCounts(r);
  const top = allFindings(r).filter((f) => f.severity === 'critical' || f.severity === 'high').slice(0, 5);
  const lines = [
    `🛰 SPECTER brief · ${repoSlug(r.repoUrl)}`,
    `Threat score ${r.threatScore}/100 (${band(r.threatScore).label})`,
    '',
    (Object.keys(counts) as Engine[]).map((e) => `${ENGINE_NAME[e]} ${counts[e]}`).join(' · '),
  ];
  if (top.length) {
    lines.push('', 'Top findings:');
    for (const f of top) lines.push(`• [${f.severity.toUpperCase()}] ${ENGINE_NAME[f.engine].toLowerCase()}: ${f.title}`.slice(0, 160));
  }
  lines.push('', `${appOrigin(req.nextUrl?.origin)}/scan/${scanId}/brief`);

  const sent = await sendTelegram(lines.join('\n'));
  if (!sent) return NextResponse.json({ error: 'Telegram rejected the message' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
