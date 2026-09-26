import { NextRequest, NextResponse } from 'next/server';
import { getFileContent } from '@/lib/github';
import { cached, loadScanContext, maskTokens } from '@/lib/console/server';

const MAX_LINES = 400;

/**
 * Source of a route handler APIBleed analyzed, for the endpoint inspector.
 * Only files that appear in this scan's APIBleed results can be read, so this
 * is not a general-purpose proxy onto GitHub. Credential-shaped tokens are
 * masked before the text leaves the server.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;
  const path = req.nextUrl.searchParams.get('path') ?? '';
  const ctx = await loadScanContext(scanId);
  if (!ctx) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
  if (!ctx.result) return NextResponse.json({ error: 'Scan results have expired' }, { status: 410 });

  const allowed = new Set((ctx.result.apibleed?.endpoints ?? []).map((e) => e.file));
  if (!allowed.has(path)) return NextResponse.json({ error: 'File is not part of this scan' }, { status: 403 });

  const { repo_owner: owner, repo_name: repo } = ctx.scan;
  try {
    const content = await cached(`src:${owner}/${repo}/${path}`, 5 * 60 * 1000, () => getFileContent(owner, repo, path));
    if (content == null) return NextResponse.json({ error: 'File no longer exists at HEAD' }, { status: 404 });
    const lines = content.split('\n');
    return NextResponse.json({
      path,
      total: lines.length,
      lines: lines.slice(0, MAX_LINES).map((l) => maskTokens(l.replace(/\r$/, ''))),
      url: `https://github.com/${owner}/${repo}/blob/HEAD/${path}`,
    });
  } catch {
    return NextResponse.json({ error: 'Could not read the file from GitHub' }, { status: 502 });
  }
}
