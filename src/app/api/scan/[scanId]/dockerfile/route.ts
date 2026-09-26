import { NextRequest, NextResponse } from 'next/server';
import { getFileContent } from '@/lib/github';
import { parseDockerfile, SECRET_RE } from '@/lib/scanners/layerscan';
import { cached, loadScanContext } from '@/lib/console/server';

// Same lookup order as runLayerScan() in src/lib/scanners/layerscan.ts.
const CANDIDATES = ['Dockerfile', 'dockerfile', 'Dockerfile.prod', 'docker/Dockerfile', 'deploy/Dockerfile'];

/**
 * The scanned repo's Dockerfile as the instruction list LayerScan parsed, so
 * the infrastructure view can draw the real layer stack. Values that the
 * scanner itself would redact (secret-looking ENV/ARG/RUN) are redacted here.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;
  const ctx = await loadScanContext(scanId);
  if (!ctx) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
  const { repo_owner: owner, repo_name: repo } = ctx.scan;

  try {
    const found = await cached(`dockerfile:${owner}/${repo}`, 5 * 60 * 1000, async () => {
      const contents = await Promise.all(CANDIDATES.map((c) => getFileContent(owner, repo, c)));
      const i = contents.findIndex((c) => c);
      return i === -1 ? null : { path: CANDIDATES[i], content: contents[i]! };
    });
    if (!found) return NextResponse.json({ path: null, instructions: [] });

    const instructions = parseDockerfile(found.content).map((ins) => {
      let args = ins.args;
      if ((ins.instr === 'ENV' || ins.instr === 'ARG') && SECRET_RE.test(args)) {
        args = args.replace(/([A-Za-z0-9_]+)(\s*=\s*|\s+)("[^"]*"|'[^']*'|\S+)/g, (m, k: string, sep: string) =>
          SECRET_RE.test(k) ? `${k}${sep}[REDACTED]` : m);
      } else if (ins.instr === 'RUN' && SECRET_RE.test(args) && /=["']?[A-Za-z0-9+/=_\-]{8,}/.test(args)) {
        args = '[REDACTED]';
      }
      return { ...ins, args };
    });
    return NextResponse.json({ path: found.path, instructions });
  } catch {
    return NextResponse.json({ error: 'Could not read the Dockerfile from GitHub' }, { status: 502 });
  }
}
