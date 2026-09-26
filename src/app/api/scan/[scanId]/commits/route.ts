import { NextRequest, NextResponse } from 'next/server';
import { octokit } from '@/lib/github';
import { cached, loadScanContext } from '@/lib/console/server';

/**
 * The commit window GhostCommit walked — the newest 30 commits on the default
 * branch as of when the scan ran (runGhostCommit lists newest-first and scans
 * the first 30). Drives the history timeline around the recovered ghosts.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;
  const ctx = await loadScanContext(scanId);
  if (!ctx) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
  const { repo_owner: owner, repo_name: repo } = ctx.scan;
  const until = ctx.scannedAt ?? ctx.scan.completed_at ?? ctx.scan.created_at;
  const window = ctx.result?.ghostcommit?.totalCommitsScanned ?? 30;

  try {
    const commits = await cached(`commits:${owner}/${repo}@${until}`, 10 * 60 * 1000, async () => {
      const res = await octokit.repos.listCommits({ owner, repo, per_page: Math.min(Math.max(window, 1), 100), until });
      return res.data.map((c) => ({
        sha: c.sha,
        author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
        name: c.commit.author?.name ?? null,
        date: c.commit.author?.date ?? c.commit.committer?.date ?? null,
        message: c.commit.message.split('\n')[0].slice(0, 100),
      }));
    });
    return NextResponse.json({ commits, until });
  } catch {
    return NextResponse.json({ error: 'Could not read commit history from GitHub' }, { status: 502 });
  }
}
