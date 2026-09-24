import type { Severity } from '@/types';
import type { MonitorContext } from '@/lib/scanTrigger';

export interface AlertFinding {
  scanner: string;
  severity: Severity;
  title?: string;
}

interface ScoreChange {
  repoUrl: string;
  scanId: string;
  previousScore: number | null;
  newScore: number;
  findings: AlertFinding[];
  monitor: MonitorContext;
  origin: string;
}

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** Only alert when the risk went up, or on the first scan so setup is confirmed. */
export function shouldAlert(previousScore: number | null, newScore: number): boolean {
  return previousScore === null || newScore > previousScore;
}

export function formatAlert(c: ScoreChange): string {
  const repo = c.repoUrl.replace('https://github.com/', '');
  const lines: string[] = [];

  if (c.previousScore === null) {
    lines.push(`👁 SPECTER now monitoring ${repo}`);
    lines.push(`Baseline threat score: ${c.newScore}/100`);
  } else {
    lines.push(`🚨 SPECTER: threat score rose on ${repo}`);
    lines.push(`${c.previousScore} → ${c.newScore}/100 (+${c.newScore - c.previousScore})`);
  }

  const m = c.monitor;
  if (m.source === 'github-push' && m.commitSha) {
    const msg = m.commitMessage?.split('\n')[0].slice(0, 80) ?? '';
    lines.push('', `Push ${m.commitSha.slice(0, 7)}${m.pusher ? ` by ${m.pusher}` : ''}${m.ref ? ` to ${m.ref.replace('refs/heads/', '')}` : ''}`);
    if (msg) lines.push(`"${msg}"`);
  } else if (m.source === 'cron') {
    lines.push('', 'Scheduled rescan');
  }

  const top = [...c.findings]
    .filter((f) => f.severity === 'critical' || f.severity === 'high')
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])
    .slice(0, 5);
  if (top.length > 0) {
    lines.push('', 'Top findings:');
    for (const f of top) lines.push(`• [${f.severity.toUpperCase()}] ${f.scanner}: ${f.title ?? ''}`.slice(0, 160));
  }

  lines.push('', `${c.origin}/scan/${c.scanId}`);
  return lines.join('\n');
}

/** Sends a plain-text Telegram message. No-op if the bot isn't configured. */
export async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('Telegram alert skipped: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set');
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error('Telegram alert failed:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Telegram alert failed:', err);
    return false;
  }
}
