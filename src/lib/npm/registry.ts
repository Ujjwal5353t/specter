import type { CVE, RiskSignal, Severity } from '@/types';
import { typosquatMatch, type Packument } from '@/lib/scanners/deprisk';

// Network helpers for the npm registry, npm downloads API and OSV. Shared by the
// repo scanner (scanners/depchain.ts) and the package verdict engine
// (packages/analyze.ts), so neither needs the GitHub client to reach them.

const REGISTRY_BASE = 'https://registry.npmjs.org';
const DOWNLOADS_API = 'https://api.npmjs.org/downloads/point/last-week';
const OSV_API = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_API = 'https://api.osv.dev/v1/vulns';
// A lookalike name with this much real usage is an established package, not a typosquat
const TYPOSQUAT_MAX_WEEKLY_DOWNLOADS = 10_000;

export const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

interface OSVSeverity { type?: string; score: number | string; }
interface OSVEvent { introduced?: string; fixed?: string; last_affected?: string; limit?: string; }
interface OSVAffected { ranges?: { events?: OSVEvent[] }[]; }
interface OSVVuln {
  id: string;
  summary?: string;
  details?: string;
  severity?: OSVSeverity[];
  database_specific?: { severity?: string };
  affected?: OSVAffected[];
}

function severityFromScore(score: number): Severity {
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'medium';
  if (score > 0) return 'low';
  return 'info';
}

/** Runs registry requests through a small queue so a wide tree can't open hundreds of sockets. */
export function createLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) {
      // The finishing task hands its slot straight to the next waiter
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active++;
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

export async function fetchPackument(name: string): Promise<Packument | null> {
  try {
    const res = await fetch(`${REGISTRY_BASE}/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as Packument;
  } catch {
    return null;
  }
}

export async function weeklyDownloads(name: string): Promise<number | null> {
  try {
    // Scoped names keep their slash: @scope/name
    const path = name.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${DOWNLOADS_API}/${path}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.downloads === 'number' ? data.downloads : null;
  } catch {
    return null;
  }
}

/** Typosquat signal for a package whose name looks like a misspelling of a popular one, else null. */
export async function checkTyposquat(name: string): Promise<RiskSignal | null> {
  const match = typosquatMatch(name);
  if (!match) return null;
  const { target, exact } = match;
  const downloads = await weeklyDownloads(name);
  if (downloads !== null && downloads >= TYPOSQUAT_MAX_WEEKLY_DOWNLOADS) return null;
  // Without download data an edit-distance match alone is too weak to flag
  if (downloads === null && !exact) return null;
  return {
    type: 'typosquat',
    severity: 'high',
    title: `Possible typosquat of "${target}"`,
    detail: `"${name}" ${exact ? 'differs from' : 'is one typo away from'} the popular package "${target}"` +
      (exact ? ' only in punctuation' : '') +
      (downloads !== null ? ` but has only ${downloads.toLocaleString()} downloads a week.` : '.') +
      ' Check this is the package you meant to install.',
  };
}

/**
 * Severity label for an OSV advisory. GitHub-reviewed advisories carry one in
 * database_specific; OSV's CVSS entries are vector strings with no base score,
 * so a numeric score is only used when present.
 */
function osvScore(v: OSVVuln): number {
  const dbSev = v.database_specific?.severity?.toLowerCase();
  if (dbSev) return dbSev === 'critical' ? 9.5 : dbSev === 'high' ? 7.5 : dbSev === 'moderate' || dbSev === 'medium' ? 5.0 : 2.0;
  const numeric = v.severity?.find((s) => typeof s.score === 'number');
  return numeric ? (numeric.score as number) : 5.0;
}

async function fetchOSVVuln(id: string): Promise<OSVVuln | null> {
  try {
    const res = await fetch(`${OSV_VULN_API}/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as OSVVuln) : null;
  } catch {
    return null;
  }
}

/**
 * Advisories per `name@version`. A failed OSV batch is skipped rather than thrown;
 * `onError` lets a caller that cares (the verdict engine) record it.
 */
export async function queryOSV(
  packages: { name: string; version: string }[],
  onProgress?: (detail: string) => void,
  onError?: (message: string) => void,
): Promise<Map<string, CVE[]>> {
  const idsByPkg = new Map<string, string[]>();
  const batchSize = 50;

  // querybatch only returns { id, modified } per advisory — no summary or
  // severity — so collect ids here and hydrate the full records below.
  for (let i = 0; i < packages.length; i += batchSize) {
    const batch = packages.slice(i, i + batchSize);
    try {
      const res = await fetch(OSV_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queries: batch.map((p) => ({
            package: { name: p.name, ecosystem: 'npm' },
            version: p.version,
          })),
        }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      (data.results ?? []).forEach((result: { vulns?: { id: string }[] }, idx: number) => {
        const ids = (result.vulns ?? []).map((v) => v.id);
        if (ids.length > 0) idsByPkg.set(`${batch[idx].name}@${batch[idx].version}`, ids);
      });
    } catch (err) {
      onError?.(`OSV query failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const uniqueIds = [...new Set([...idsByPkg.values()].flat())];
  const vulns = new Map<string, OSVVuln>();
  const concurrency = 10;
  for (let i = 0; i < uniqueIds.length; i += concurrency) {
    onProgress?.(`fetching advisories ${i}/${uniqueIds.length}...`);
    const chunk = uniqueIds.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map(fetchOSVVuln));
    results.forEach((v, j) => { if (v) vulns.set(chunk[j], v); });
  }

  const cveMap = new Map<string, CVE[]>();
  for (const [key, ids] of idsByPkg) {
    const cves: CVE[] = ids.map((id) => {
      // A failed hydration still reports the advisory, at the old default.
      const v = vulns.get(id) ?? { id };
      const score = osvScore(v);
      const summary =
        (v.summary && v.summary.trim()) ||
        (v.details && v.details.trim().split('\n')[0].substring(0, 120)) ||
        v.id;
      return {
        id: v.id,
        severity: severityFromScore(score),
        score,
        summary,
        fixed_in: v.affected?.[0]?.ranges?.[0]?.events?.find((e) => e.fixed)?.fixed,
      };
    });
    cveMap.set(key, cves);
  }
  return cveMap;
}
