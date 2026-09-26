import { NextResponse } from 'next/server';
import { parseRepoUrl } from '@/lib/github';

/**
 * Which monitoring/alerting channels this deployment has configured. Reports
 * presence only — never the secrets themselves.
 */
export async function GET() {
  const monitored = (process.env.MONITORED_REPOS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      try {
        const { owner, repo } = parseRepoUrl(entry);
        return [`https://github.com/${owner}/${repo}`.toLowerCase()];
      } catch {
        return [];
      }
    });

  return NextResponse.json({
    webhook: !!process.env.GITHUB_WEBHOOK_SECRET,
    telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    cron: !!process.env.CRON_SECRET,
    monitoredRepos: monitored,
    ai: process.env.OPENROUTER_API_KEY ? 'OpenRouter' : process.env.GEMINI_API_KEY ? 'Gemini' : null,
    github: !!process.env.GITHUB_TOKEN,
  });
}
