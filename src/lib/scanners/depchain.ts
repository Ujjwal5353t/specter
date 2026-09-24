import type { DepNode, DepEdge, CVE, Severity } from '@/types';
import { getFileContent } from '@/lib/github';

const REGISTRY_BASE = 'https://registry.npmjs.org';
const OSV_API = 'https://api.osv.dev/v1/querybatch';
const npmCache = new Map<string, { dependencies: Record<string, string>; scripts?: Record<string, string> }>();
// name -> version->ISO-publish-date map (or null on fetch failure), from the
// *unversioned* packument endpoint — the only place npm's registry exposes
// per-version publish timestamps. Cached per package name since one fetch
// covers every version of that package.
const packumentTimeCache = new Map<string, Record<string, string> | null>();

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

function cleanVersion(v: string): string {
  return v.replace(/[\^~>=<]/g, '').split(' ')[0].split('||')[0].trim() || 'latest';
}

// ── Zero-day supply-chain heuristics (Issue #6) ─────────────────────────
// OSV/NVD only catalog *disclosed* CVEs — real compromises like event-stream
// (2018) and node-ipc (2022) shipped as ordinary-looking version bumps and
// weren't cataloged for days to weeks afterward. These two checks flag
// active risk signals from npm registry metadata instead of passive lookups.

const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall'] as const;
// Not prone to catastrophic backtracking — a single bounded alternation over
// short, non-adjacent-unbounded-class patterns, run against a short
// package.json script string (never attacker-controlled diff-sized input).
const NETWORK_EXEC_RE = /\b(curl|wget|node\s+-e|node\s+--eval|sh\s+-c|bash\s+-c|eval\()/i;

/**
 * Lifecycle scripts (preinstall/install/postinstall) run automatically the
 * moment `npm install` touches a package — before any of your own code
 * executes — making them the #1 delivery mechanism for supply-chain
 * malware. `scripts` is already present in the same per-version registry
 * response `getNpmDeps()` fetches for the dependency graph; this costs zero
 * additional network calls.
 */
function detectSuspiciousScripts(scripts: Record<string, string> | undefined, name: string, version: string): CVE[] {
  if (!scripts) return [];
  const findings: CVE[] = [];
  for (const scriptName of LIFECYCLE_SCRIPTS) {
    const command = scripts[scriptName];
    if (!command) continue;
    const isNetworkExec = NETWORK_EXEC_RE.test(command);
    const preview = command.length > 100 ? `${command.substring(0, 100)}...` : command;
    findings.push({
      id: `SPECTER-INSTALL-SCRIPT-${scriptName.toUpperCase()}`,
      severity: isNetworkExec ? 'critical' : 'high',
      score: isNetworkExec ? 9.5 : 7.5,
      summary: `Suspicious Install Script: ${name}@${version} executes "${scriptName}" during npm install — "${preview}". Lifecycle scripts run unattended at install time, before any of your own code runs.`,
    });
  }
  return findings;
}

const FRESH_RELEASE_DAYS = 14;

async function getPackumentTimes(name: string): Promise<Record<string, string> | null> {
  if (packumentTimeCache.has(name)) return packumentTimeCache.get(name)!;
  try {
    const url = `${REGISTRY_BASE}/${encodeURIComponent(name)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) { packumentTimeCache.set(name, null); return null; }
    const data = await res.json();
    const time = (data.time && typeof data.time === 'object' ? data.time : null) as Record<string, string> | null;
    packumentTimeCache.set(name, time);
    return time;
  } catch {
    packumentTimeCache.set(name, null);
    return null;
  }
}

/**
 * Flags a version published within the last 14 days. This needs a *second*
 * registry fetch — the per-version endpoint `getNpmDeps()` already calls has
 * no publish-timestamp field at all; only the unversioned packument does
 * (confirmed live: `registry.npmjs.org/<name>/<version>` has no `time`
 * field, `registry.npmjs.org/<name>` does, as `time[version]`). That
 * packument can be tens to hundreds of KB for a popular package, so this
 * check is scoped to *direct* dependencies only (see call site in
 * `buildTree`) rather than the full transitive tree, to keep the added cost
 * bounded — a deliberate scope tradeoff, not an oversight.
 */
async function detectFreshRelease(name: string, version: string): Promise<CVE | null> {
  const times = await getPackumentTimes(name);
  const publishedAt = times?.[version];
  if (!publishedAt) return null;
  const ageDays = (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < 0 || ageDays >= FRESH_RELEASE_DAYS) return null;
  return {
    id: 'SPECTER-FRESH-RELEASE',
    severity: 'medium',
    score: 5.5,
    summary: `Recent Release (Day-0 Window): ${name}@${version} was published ${Math.max(0, Math.floor(ageDays))} day(s) ago. A very fresh release on a widely-used package deserves extra scrutiny even with a clean OSV result — cataloging typically lags a real compromise by days to weeks.`,
  };
}

async function getNpmDeps(name: string, version: string): Promise<{ dependencies: Record<string, string>; scripts?: Record<string, string> }> {
  const key = `${name}@${cleanVersion(version)}`;
  if (npmCache.has(key)) return npmCache.get(key)!;
  try {
    const clean = cleanVersion(version);
    const url = `${REGISTRY_BASE}/${encodeURIComponent(name)}/${clean}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) { const empty = { dependencies: {} }; npmCache.set(key, empty); return empty; }
    const data = await res.json();
    const result = { dependencies: (data.dependencies ?? {}) as Record<string, string>, scripts: data.scripts as Record<string, string> | undefined };
    npmCache.set(key, result);
    return result;
  } catch {
    const empty = { dependencies: {} };
    npmCache.set(key, empty);
    return empty;
  }
}

async function buildTree(
  name: string,
  version: string,
  nodes: Map<string, DepNode>,
  edges: DepEdge[],
  depth: number,
  parentId: string | null
): Promise<void> {
  if (depth > 3) return;
  const id = `${name}@${cleanVersion(version)}`;
  if (nodes.has(id)) {
    if (parentId) edges.push({ from: parentId, to: id });
    return;
  }
  const node: DepNode = {
    id,
    name,
    version: cleanVersion(version),
    cves: [],
    ecosystem: 'npm',
    isDirect: depth === 1,
  };
  nodes.set(id, node);
  if (parentId) edges.push({ from: parentId, to: id });

  const { dependencies: deps, scripts } = await getNpmDeps(name, version);
  node.cves.push(...detectSuspiciousScripts(scripts, name, node.version));

  if (depth === 1) {
    const freshFinding = await detectFreshRelease(name, node.version);
    if (freshFinding) node.cves.push(freshFinding);
  }

  await Promise.allSettled(
    Object.entries(deps)
      .slice(0, 10)
      .map(([n, v]) => buildTree(n, v, nodes, edges, depth + 1, id))
  );
}

async function queryOSV(packages: { name: string; version: string }[]): Promise<Map<string, CVE[]>> {
  const cveMap = new Map<string, CVE[]>();
  const batchSize = 50;

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
      (data.results ?? []).forEach(
        (result: { vulns?: OSVVuln[] }, idx: number) => {
          const pkg = batch[idx];
          const cves: CVE[] = (result.vulns ?? []).map((v) => {
            // OSV returns severity as an array of objects with type and score
            // CVSS score can be nested under severity[].score (numeric)
            // or as a string in database_specific or ecosystem_specific
            let score = 5.0;
            if (v.severity && v.severity.length > 0) {
              // Try numeric score first
              const numericSev = v.severity.find((s) => typeof s.score === 'number');
              if (numericSev) {
                score = numericSev.score as number;
              } else {
                // CVSS string score — parse the base score from the vector
                const stringSev = v.severity.find((s) => typeof s.score === 'string');
                if (stringSev?.score) {
                  const match = (stringSev.score as string).match(/\/(\d+\.\d+)$/);
                  if (match) score = parseFloat(match[1]);
                }
              }
            }
            // database_specific fallback
            if (score === 5.0 && v.database_specific?.severity) {
              const dbSev = v.database_specific.severity.toLowerCase();
              score = dbSev === 'critical' ? 9.5 : dbSev === 'high' ? 7.5 : dbSev === 'moderate' ? 5.0 : 2.0;
            }

            // Summary fallback chain
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
          if (cves.length > 0) cveMap.set(`${pkg.name}@${pkg.version}`, cves);
        }
      );
    } catch {}
  }
  return cveMap;
}

export async function runDepChain(owner: string, repo: string) {
  const pkgContent = await getFileContent(owner, repo, 'package.json');
  if (!pkgContent) return { nodes: [], edges: [], vulnCount: 0 };

  let parsed: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try { parsed = JSON.parse(pkgContent); } catch { return { nodes: [], edges: [], vulnCount: 0 }; }

  const allDeps = { ...parsed.dependencies, ...parsed.devDependencies };
  const nodes = new Map<string, DepNode>();
  const edges: DepEdge[] = [];
  const rootId = `${owner}/${repo}@root`;

  nodes.set(rootId, {
    id: rootId,
    name: `${owner}/${repo}`,
    version: 'root',
    isRoot: true,
    cves: [],
    ecosystem: 'npm',
  });

  await Promise.allSettled(
    Object.entries(allDeps)
      .slice(0, 25)
      .map(([name, version]) => buildTree(name, version, nodes, edges, 1, rootId))
  );

  const pkgList = Array.from(nodes.values())
    .filter((n) => !n.isRoot)
    .map((n) => ({ name: n.name, version: n.version }));

  const cveMap = await queryOSV(pkgList);

  let vulnCount = 0;
  nodes.forEach((node) => {
    // Merge, don't overwrite — buildTree() may have already attached
    // heuristic findings (install scripts / fresh release) to node.cves,
    // and a plain reassignment here would silently discard them.
    const osvCves = cveMap.get(`${node.name}@${node.version}`) ?? [];
    node.cves = [...node.cves, ...osvCves];
    if (node.cves.length > 0) vulnCount++;
  });

  return { nodes: Array.from(nodes.values()), edges, vulnCount };
}
