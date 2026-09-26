import { NextRequest, NextResponse } from 'next/server';
import { octokit } from '@/lib/github';
import { cached, loadScanContext } from '@/lib/console/server';

/**
 * Lightweight scan header for the console HUD: the scan row's timing, when
 * its results were produced, and the repo's default branch + head commit.
 * Branch/head come from GitHub and are best-effort (null on any error).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;
  const ctx = await loadScanContext(scanId);
  if (!ctx) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
  const { scan, scannedAt } = ctx;

  const head = await cached(`head:${scan.repo_owner}/${scan.repo_name}`, 5 * 60 * 1000, async () => {
    try {
      const repo = await octokit.repos.get({ owner: scan.repo_owner, repo: scan.repo_name });
      const branch = repo.data.default_branch;
      const b = await octokit.repos.getBranch({ owner: scan.repo_owner, repo: scan.repo_name, branch });
      return { branch, sha: b.data.commit.sha };
    } catch {
      return null;
    }
  });

  return NextResponse.json({
    scan: {
      id: scan.id,
      repo_url: scan.repo_url,
      status: scan.status,
      threat_score: scan.threat_score,
      created_at: scan.created_at,
      completed_at: scan.completed_at,
      from_cache: !!scan.from_cache,
      error_message: scan.error_message,
    },
    scannedAt,
    resultsAvailable: !!ctx.result,
    head,
  });
}
