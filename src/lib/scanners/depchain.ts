import semver from 'semver';
import type { DepNode, DepEdge, CVE, Severity, RiskSignal } from '@/types';
import { getFileContent, getRepoTree } from '@/lib/github';
import { analyzeVersion, youngDependencySignal, typosquatTarget, type Packument } from './deprisk';

const REGISTRY_BASE = 'https://registry.npmjs.org';
const DOWNLOADS_API = 'https://api.npmjs.org/downloads/point/last-week';
const OSV_API = 'https://api.osv.dev/v1/querybatch';
// A lookalike name with this much real usage is an established package, not a typosquat
const TYPOSQUAT_MAX_WEEKLY_DOWNLOADS = 10_000;

/** Per-scan state, so registry data is never stale across scans. */
interface ScanContext {
  now: number;
  packuments: Map<string, Promise<Packument | null>>;
  nodes: Map<string, DepNode>;
  edges: DepEdge[];
  /** Publish time and newly added dependencies, per node id, for the young-dependency pass. */
  releases: Map<string, { publishedAt: number | null; newDeps: string[] }>;
}

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

async function fetchPackument(name: string): Promise<Packument | null> {
  try {
    const res = await fetch(`${REGISTRY_BASE}/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as Packument;
  } catch {
    return null;
  }
}

function getPackument(ctx: ScanContext, name: string): Promise<Packument | null> {
  let p = ctx.packuments.get(name);
  if (!p) {
    p = fetchPackument(name);
    ctx.packuments.set(name, p);
  }
  return p;
}

/** The version a fresh `npm install` would pick for this range. */
function resolveVersion(pk: Packument | null, range: string): string {
  const versions = pk?.versions;
  if (versions) {
    const tags = pk['dist-tags'] ?? {};
    const tagged = tags[range.trim() || 'latest'];
    if (tagged && versions[tagged]) return tagged;
    // npm prefers the `latest` tag whenever it satisfies the range
    if (tags.latest && versions[tags.latest] && semver.satisfies(tags.latest, range)) return tags.latest;
    const best = semver.maxSatisfying(Object.keys(versions), range);
    if (best) return best;
  }
  return cleanVersion(range);
}

async function buildTree(
  ctx: ScanContext,
  name: string,
  range: string,
  depth: number,
  parentId: string | null
): Promise<void> {
  if (depth > 3) return;
  const pk = await getPackument(ctx, name);
  const version = resolveVersion(pk, range);
  const id = `${name}@${version}`;
  if (ctx.nodes.has(id)) {
    if (parentId) ctx.edges.push({ from: parentId, to: id });
    return;
  }

  const analysis = pk ? analyzeVersion(pk, version, ctx.now) : null;
  ctx.nodes.set(id, {
    id,
    name,
    version,
    cves: [],
    signals: analysis?.signals ?? [],
    ecosystem: 'npm',
    isDirect: depth === 1,
  });
  if (analysis) ctx.releases.set(id, { publishedAt: analysis.publishedAt, newDeps: analysis.newDeps });
  if (parentId) ctx.edges.push({ from: parentId, to: id });

  // Explore newly added dependencies first so the cap below never hides them
  const newDeps = new Set(analysis?.newDeps ?? []);
  const deps = Object.entries(pk?.versions?.[version]?.dependencies ?? {})
    .sort(([a], [b]) => Number(newDeps.has(b)) - Number(newDeps.has(a)));
  await Promise.allSettled(
    deps.slice(0, 10).map(([n, v]) => buildTree(ctx, n, v, depth + 1, id))
  );
}

/** Marks dependencies that were brand new when their parent's current release added them. */
async function flagYoungDependencies(ctx: ScanContext): Promise<void> {
  for (const edge of ctx.edges) {
    const release = ctx.releases.get(edge.from);
    const parent = ctx.nodes.get(edge.from);
    const child = ctx.nodes.get(edge.to);
    if (!release?.publishedAt || !parent || !child || !release.newDeps.includes(child.name)) continue;
    const pk = await getPackument(ctx, child.name);
    const signal = pk && youngDependencySignal(pk, parent.id, release.publishedAt);
    if (!signal || child.signals?.some((s) => s.type === 'young_dependency')) continue;
    // The stronger, parent-relative signal replaces the generic "brand-new package" one
    child.signals = [...(child.signals ?? []).filter((s) => s.type !== 'young_package'), signal];
  }
}

async function weeklyDownloads(name: string): Promise<number | null> {
  try {
    const res = await fetch(`${DOWNLOADS_API}/${name}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.downloads === 'number' ? data.downloads : null;
  } catch {
    return null;
  }
}

/** Direct dependencies only: that's where a mistyped name enters the tree. */
async function flagTyposquats(nodes: DepNode[]): Promise<void> {
  await Promise.allSettled(nodes.filter((n) => n.isDirect).map(async (node) => {
    const target = typosquatTarget(node.name);
    if (!target) return;
    const downloads = await weeklyDownloads(node.name);
    if (downloads !== null && downloads >= TYPOSQUAT_MAX_WEEKLY_DOWNLOADS) return;
    const signal: RiskSignal = {
      type: 'typosquat',
      severity: 'high',
      title: `Possible typosquat of "${target}"`,
      detail: `"${node.name}" is one typo away from the popular package "${target}"` +
        (downloads !== null ? ` but has only ${downloads.toLocaleString()} downloads a week.` : '.') +
        ' Check this is the package you meant to install.',
    };
    node.signals = [...(node.signals ?? []), signal];
  }));
}

const RISK_SEVERITIES = new Set<Severity>(['critical', 'high', 'medium']);

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

const MAX_MANIFESTS = 10;
const MAX_MANIFEST_DEPTH = 3;
const MAX_DIRECT_DEPS = 25;

/**
 * Every package.json in the repo, not just the root one, so split layouts
 * (backend/ + frontend/) and monorepos get scanned. Shallowest first.
 */
async function findManifests(owner: string, repo: string): Promise<string[]> {
  const tree = await getRepoTree(owner, repo);
  return tree
    .map((f) => f.path)
    .filter((p) => (p === 'package.json' || p.endsWith('/package.json'))
      && !p.split('/').includes('node_modules')
      && p.split('/').length <= MAX_MANIFEST_DEPTH)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, MAX_MANIFESTS);
}

export async function runDepChain(owner: string, repo: string) {
  const manifests = await findManifests(owner, repo);

  // Collected as [name, range] pairs: the same package can appear in several
  // manifests with different ranges, and each resolves to its own node
  const prodDeps: [string, string][] = [];
  const devDeps: [string, string][] = [];
  for (const path of manifests) {
    const content = await getFileContent(owner, repo, path);
    if (!content) continue;
    let parsed: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try { parsed = JSON.parse(content); } catch { continue; }
    prodDeps.push(...Object.entries(parsed.dependencies ?? {}));
    devDeps.push(...Object.entries(parsed.devDependencies ?? {}));
  }

  // Production deps fill the cap first: they're what actually ships
  const seen = new Set<string>();
  const directDeps = [...prodDeps, ...devDeps].filter(([name, range]) => {
    const key = `${name}@${range}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (directDeps.length === 0) return { nodes: [], edges: [], vulnCount: 0 };

  const ctx: ScanContext = {
    now: Date.now(),
    packuments: new Map(),
    nodes: new Map(),
    edges: [],
    releases: new Map(),
  };
  const { nodes, edges } = ctx;
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
    directDeps
      .slice(0, MAX_DIRECT_DEPS)
      .map(([name, version]) => buildTree(ctx, name, version, 1, rootId))
  );

  const depNodes = Array.from(nodes.values()).filter((n) => !n.isRoot);
  const [cveMap] = await Promise.all([
    queryOSV(depNodes.map((n) => ({ name: n.name, version: n.version }))),
    flagYoungDependencies(ctx),
    flagTyposquats(depNodes),
  ]);

  let vulnCount = 0;
  let riskCount = 0;
  nodes.forEach((node) => {
    const cves = cveMap.get(`${node.name}@${node.version}`) ?? [];
    node.cves = cves;
    if (cves.length > 0) vulnCount++;
    if (node.signals?.some((s) => RISK_SEVERITIES.has(s.severity))) riskCount++;
  });

  return { nodes: Array.from(nodes.values()), edges, vulnCount, riskCount };
}