import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRepoAccess, clearFileCache } from '@/lib/github';
import { runDepChain } from '@/lib/scanners/depchain';
import { runGhostCommit } from '@/lib/scanners/ghostcommit';
import { runLayerScan } from '@/lib/scanners/layerscan';
import { runAPIBleed } from '@/lib/scanners/apibleed';
import { runEnvTrace } from '@/lib/scanners/envtrace';
import { appOrigin, type MonitorContext } from '@/lib/scanTrigger';
import { formatAlert, sendTelegram, shouldAlert } from '@/lib/alerts';
import type {
  DepChainResult, GhostCommitResult, LayerScanResult, APIBleedResult, EnvTraceResult, Severity,
} from '@/types';

export const maxDuration = 60;

interface ScanResults {
  depchain: DepChainResult | null;
  ghostcommit: GhostCommitResult | null;
  layerscan: LayerScanResult | null;
  apibleed: APIBleedResult | null;
  envtrace: EnvTraceResult | null;
}

function calcThreatScore(r: ScanResults): number {
  const sevWeight: Record<Severity, number> = {
    critical: 15, high: 8, medium: 4, low: 1, info: 0,
  };

  const envFindings = r.envtrace?.findings ?? [];
  const layerFindings = r.layerscan?.findings ?? [];
  const envScore = envFindings.reduce((acc, f) => acc + (sevWeight[f.severity] ?? 0), 0);
  const layerScore = layerFindings.reduce((acc, f) => acc + (sevWeight[f.severity] ?? 0), 0);

  const vulnDeps = r.depchain?.vulnCount ?? 0;
  const riskyDeps = r.depchain?.riskCount ?? 0;
  const secrets = r.ghostcommit?.findings?.length ?? 0;
  const unsecuredApis = r.apibleed?.unsecuredCount ?? 0;

  return Math.min(
    Math.min(envScore + layerScore, 40) +
    Math.min(vulnDeps * 8 + riskyDeps * 4, 30) +
    Math.min(secrets * 10, 20) +
    Math.min(unsecuredApis * 5, 10),
    100
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ scanId: string }> }
) {
  const secret = req.headers.get('x-internal-secret');
  if (secret !== (process.env.INTERNAL_SECRET ?? 'specter-internal')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { scanId } = await params;

  // Set only when a webhook or cron triggered this scan; manual scans never alert
  const body = await req.json().catch(() => ({}));
  const monitor: MonitorContext | null = body?.monitor ?? null;

  const { data: scan } = await supabaseAdmin
    .from('scans')
    .select('*')
    .eq('id', scanId)
    .single();

  if (!scan) {
    return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
  }

  const { repo_owner: owner, repo_name: repo, repo_url: repoUrl } = scan;

  clearFileCache();

  const failScan = async (reason: string, status: number) => {
    await supabaseAdmin
      .from('scans')
      .update({ status: 'failed', error_message: reason })
      .eq('id', scanId);
    return NextResponse.json({ error: reason }, { status });
  };

  const access = await checkRepoAccess(owner, repo);
  if (!access.ok) return failScan(access.reason, 422);

  try {
    const settled = await Promise.allSettled([
      runDepChain(owner, repo),
      runGhostCommit(owner, repo),
      runLayerScan(owner, repo),
      runAPIBleed(owner, repo),
      runEnvTrace(owner, repo),
    ]);
    const [dep, ghost, layer, api, env] = settled;

    // A scanner that errored produced no findings, which would score the repo
    // as safer than it is. Fail the whole scan instead of saving a partial one.
    const scannerNames = ['DepChain', 'GhostCommit', 'LayerScan', 'APIBleed', 'EnvTrace'];
    const failed = scannerNames.filter((_, i) => settled[i].status === 'rejected');
    if (failed.length > 0) {
      settled.forEach((s, i) => {
        if (s.status === 'rejected') console.error(`${scannerNames[i]} failed:`, s.reason);
      });
      // Most likely cause: the repo went private or was deleted mid-scan
      const recheck = await checkRepoAccess(owner, repo);
      if (!recheck.ok) return failScan(recheck.reason, 422);
      return failScan(
        `${failed.join(', ')} could not finish, so results would be incomplete. Please try again.`,
        502
      );
    }

    const results: ScanResults = {
      depchain:    dep.status    === 'fulfilled' ? dep.value    : null,
      ghostcommit: ghost.status  === 'fulfilled' ? ghost.value  : null,
      layerscan:   layer.status  === 'fulfilled' ? layer.value  : null,
      apibleed:    api.status    === 'fulfilled' ? api.value    : null,
      envtrace:    env.status    === 'fulfilled' ? env.value    : null,
    };

    const threatScore = calcThreatScore(results);

    const allFindings = [
      ...(results.depchain?.nodes?.filter((n) => n.cves?.length > 0).flatMap((n) =>
        n.cves.map((c) => ({
          scan_id: scanId, scanner: 'depchain', severity: c.severity,
          title: `Vulnerable: ${n.name}@${n.version}`, detail: c.summary,
          package_name: n.name, metadata: { cve_id: c.id, score: c.score, fixed_in: c.fixed_in },
        }))
      ) ?? []),
      ...(results.depchain?.nodes?.flatMap((n) =>
        (n.signals ?? []).map((s) => ({
          scan_id: scanId, scanner: 'depchain', severity: s.severity,
          title: `${s.title}: ${n.name}@${n.version}`, detail: s.detail,
          package_name: n.name, metadata: { signal: s.type },
        }))
      ) ?? []),
      ...(results.ghostcommit?.findings?.map((f) => ({
        scan_id: scanId, scanner: 'ghostcommit', severity: 'critical' as const,
        title: `${f.type} in commit`, detail: `${f.file}:${f.line} — entropy ${f.entropy.toFixed(2)}`,
        file_path: f.file, line_number: f.line, commit_sha: f.commit_sha,
        metadata: { author: f.author, preview: f.preview },
      })) ?? []),
      ...(results.layerscan?.findings?.map((f) => ({
        scan_id: scanId, scanner: 'layerscan', severity: f.severity,
        title: f.issue.substring(0, 100), detail: f.fix, metadata: { layer: f.layer },
      })) ?? []),
      ...(results.apibleed?.endpoints?.filter((e) => e.issues.length > 0).map((e) => ({
        scan_id: scanId, scanner: 'apibleed', severity: e.severity,
        title: `${e.method} ${e.path}`, detail: e.issues.join(' | '),
        file_path: e.file, metadata: { hasAuth: e.hasAuth },
      })) ?? []),
      ...(results.envtrace?.findings?.map((f) => ({
        scan_id: scanId, scanner: 'envtrace', severity: f.severity,
        title: f.type.replace(/_/g, ' '), detail: f.detail,
        file_path: f.file, line_number: f.line,
      })) ?? []),
    ];

    if (allFindings.length > 0) {
      await supabaseAdmin.from('findings').insert(allFindings);
    }

    // Baseline for the alert diff: the latest completed scan of this repo
    // before this one (cache replays carry the cached score, so they count too)
    let previousScore: number | null = null;
    if (monitor) {
      const { data: prev } = await supabaseAdmin
        .from('scans')
        .select('threat_score')
        .eq('repo_url', repoUrl)
        .eq('status', 'completed')
        .neq('id', scanId)
        .not('threat_score', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      previousScore = prev?.threat_score ?? null;
    }

    // Write the cache before flipping to completed, so a status poll never
    // sees a completed scan without its result data
    await supabaseAdmin.from('scan_cache').upsert({
      repo_url: repoUrl,
      dep_data: results.depchain,
      secret_data: results.ghostcommit,
      docker_data: results.layerscan,
      api_data: results.apibleed,
      env_data: results.envtrace,
      threat_score: threatScore,
      expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    });

    await supabaseAdmin
      .from('scans')
      .update({ status: 'completed', threat_score: threatScore, completed_at: new Date().toISOString() })
      .eq('id', scanId);

    if (monitor && shouldAlert(previousScore, threatScore)) {
      await sendTelegram(formatAlert({
        repoUrl, scanId, previousScore, newScore: threatScore,
        findings: allFindings, monitor, origin: appOrigin(req.nextUrl?.origin),
      }));
    }

    return NextResponse.json({ ok: true, threatScore, previousScore });

  } catch (err) {
    console.error('Run route error:', err);
    return failScan('Scan failed due to an internal error. Please try again.', 500);
  }
}