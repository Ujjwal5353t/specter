import semver from 'semver';
import type { DepNode, DepEdge, CVE, Severity, RiskSignal } from '@/types';
import { getFileContent, getRepoTree } from '@/lib/github';
import { analyzeVersion, youngDependencySignal, typosquatMatch, type Packument } from './deprisk';

const REGISTRY_BASE = 'https://registry.npmjs.org';
const DOWNLOADS_API = 'https://api.npmjs.org/downloads/point/last-week';
const OSV_API = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_API = 'https://api.osv.dev/v1/vulns';
// A lookalike name with this much real usage is an established package, not a typosquat
const TYPOSQUAT_MAX_WEEKLY_DOWNLOADS = 10_000;

/** Per-scan state, so registry data is never stale across scans. */
interface ScanContext {
  now: number;
  packuments: Map<string, Promise<Packument | null>>;
  /** Queues registry requests so only MAX_REGISTRY_CONCURRENCY run at once. */
  limit: ReturnType<typeof createLimiter>;
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

// The tree fans out (25 direct deps x 10 children x depth 3) and every node costs a
// full packument, which can run to megabytes. Bound it: at most MAX_TREE_NODES
// packages, MAX_REGISTRY_CONCURRENCY requests in flight, and a wall-clock budget so
// OSV and advisory lookups still fit inside the 60s function limit. The full
// packument is needed (time, _npmUser, attestations), so only the fan-out is capped.
const MAX_TREE_NODES = 300;
const MAX_REGISTRY_CONCURRENCY = 12;
const TREE_BUDGET_MS = 20_000;

const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
// Specs that never come from the registry (or can't be resolved without a lockfile)
const NON_REGISTRY_SPEC = /^(workspace:|file:|link:|portal:|patch:|git[+:]|github:|gitlab:|bitbucket:|gist:|https?:|ssh:|\.{1,2}\/|~\/|\/|[\w.-]+\/[\w.-]+)/i;

/**
 * Registry package and range a dependency spec points at, or null for specs
 * that don't resolve through the npm registry (git urls, local paths, workspaces).
 * `npm:real-name@range` aliases resolve to the real package.
 */
function parseSpec(name: string, spec: string): { name: string; range: string } | null {
  let range = (spec ?? '').trim() || 'latest';
  if (range.startsWith('npm:')) {
    const target = range.slice(4);
    const at = target.lastIndexOf('@');
    name = at > 0 ? target.slice(0, at) : target;
    range = (at > 0 ? target.slice(at + 1) : '').trim() || 'latest';
  }
  if (!PACKAGE_NAME.test(name) || NON_REGISTRY_SPEC.test(range)) return null;
  // A semver range or a dist-tag ("latest", "next"); anything else is not resolvable
  if (semver.validRange(range) === null && !/^[a-z][\w.-]*$/i.test(range)) return null;
  return { name, range };
}

/** Runs registry requests through a small queue so a wide tree can't open hundreds of sockets. */
function createLimiter(max: number) {
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
    p = ctx.limit(() => fetchPackument(name));
    ctx.packuments.set(name, p);
  }
  return p;
}

/** The version a fresh `npm install` would pick for this range, or null if it can't be resolved. */
function resolveVersion(pk: Packument | null, range: string): string | null {
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
  // Registry unreachable: the lowest version the range allows is the best offline guess
  const floor = semver.validRange(range) ? semver.minVersion(range)?.version : undefined;
  return floor && floor !== '0.0.0' ? floor : null;
}

async function buildTree(
  ctx: ScanContext,
  name: string,
  range: string,
  depth: number,
  parentId: string | null
): Promise<void> {
  if (depth > 3) return;
  const spec = parseSpec(name, range);
  if (!spec) return;
  ({ name, range } = spec);
  // Stop fetching once the tree is full or out of time
  if (ctx.nodes.size > MAX_TREE_NODES || Date.now() - ctx.now > TREE_BUDGET_MS) return;
  const pk = await getPackument(ctx, name);
  const version = resolveVersion(pk, range);
  if (!version) return;
  const id = `${name}@${version}`;
  const existing = ctx.nodes.get(id);
  if (existing) {
    // Reaching a package straight from the root makes it direct, whichever path got here first
    if (depth === 1) existing.isDirect = true;
    if (parentId) ctx.edges.push({ from: parentId, to: id });
    return;
  }
  if (ctx.nodes.size > MAX_TREE_NODES) return; // root is in the map, hence > rather than >=

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
    const parentPk = await getPackument(ctx, parent.name);
    const publisher = parentPk?.versions?.[parent.version]?._npmUser?.name;
    const signal = pk && youngDependencySignal(pk, parent.id, release.publishedAt, { name: parent.name, publisher });
    if (!signal || child.signals?.some((s) => s.type === 'young_dependency')) continue;
    // The stronger, parent-relative signal replaces the generic "brand-new package" one
    child.signals = [...(child.signals ?? []).filter((s) => s.type !== 'young_package'), signal];
  }
}

async function weeklyDownloads(name: string): Promise<number | null> {
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

/** Direct dependencies only: that's where a mistyped name enters the tree. */
async function flagTyposquats(nodes: DepNode[]): Promise<void> {
  await Promise.allSettled(nodes.filter((n) => n.isDirect).map(async (node) => {
    const match = typosquatMatch(node.name);
    if (!match) return;
    const { target, exact } = match;
    const downloads = await weeklyDownloads(node.name);
    if (downloads !== null && downloads >= TYPOSQUAT_MAX_WEEKLY_DOWNLOADS) return;
    // Without download data an edit-distance match alone is too weak to flag
    if (downloads === null && !exact) return;
    const signal: RiskSignal = {
      type: 'typosquat',
      severity: 'high',
      title: `Possible typosquat of "${target}"`,
      detail: `"${node.name}" ${exact ? 'differs from' : 'is one typo away from'} the popular package "${target}"` +
        (exact ? ' only in punctuation' : '') +
        (downloads !== null ? ` but has only ${downloads.toLocaleString()} downloads a week.` : '.') +
        ' Check this is the package you meant to install.',
    };
    node.signals = [...(node.signals ?? []), signal];
  }));
}

const RISK_SEVERITIES = new Set<Severity>(['critical', 'high', 'medium']);

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

async function queryOSV(
  packages: { name: string; version: string }[],
  onProgress?: (detail: string) => void,
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
    } catch {}
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

export async function runDepChain(owner: string, repo: string, onProgress?: (detail: string) => void) {
  onProgress?.('locating package manifests...');
  const manifests = await findManifests(owner, repo);
  if (manifests.length > 0) onProgress?.(`reading ${manifests.length} manifest${manifests.length === 1 ? '' : 's'}...`);

  const contents: string[] = [];
  for (const path of manifests) {
    const content = await getFileContent(owner, repo, path);
    if (content) contents.push(content);
  }
  return analyzeManifests(`${owner}/${repo}`, contents, onProgress);
}

/**
 * The DepChain pipeline from raw package.json contents onward: registry
 * resolution, tree building, OSV lookup and risk signals. Split out of
 * runDepChain so the benchmark (scripts/benchmark) exercises exactly the code
 * a real scan runs, without needing a GitHub repo.
 */
export async function analyzeManifests(rootName: string, manifests: string[], onProgress?: (detail: string) => void) {
  // Collected as [name, range] pairs: the same package can appear in several
  // manifests with different ranges, and each resolves to its own node
  const prodDeps: [string, string][] = [];
  const devDeps: [string, string][] = [];
  for (const content of manifests) {
    let parsed: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try { parsed = JSON.parse(content); } catch { continue; }
    prodDeps.push(...Object.entries(parsed.dependencies ?? {}));
    devDeps.push(...Object.entries(parsed.devDependencies ?? {}));
  }

  // Production deps fill the cap first: they're what actually ships
  const seen = new Set<string>();
  const directDeps = [...prodDeps, ...devDeps].filter(([name, range]) => {
    // Git urls, workspace links and local paths never resolve via the registry
    if (!parseSpec(name, range)) return false;
    const key = `${name}@${range}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (directDeps.length === 0) return { nodes: [], edges: [], vulnCount: 0 };

  const ctx: ScanContext = {
    now: Date.now(),
    packuments: new Map(),
    limit: createLimiter(MAX_REGISTRY_CONCURRENCY),
    nodes: new Map(),
    edges: [],
    releases: new Map(),
  };
  const { nodes, edges } = ctx;
  const rootId = `${rootName}@root`;

  nodes.set(rootId, {
    id: rootId,
    name: rootName,
    version: 'root',
    isRoot: true,
    cves: [],
    ecosystem: 'npm',
  });

  // The tree resolves in parallel, so report its size on a clock instead of per package.
  const reportTree = () => onProgress?.(`resolving dependency tree · ${nodes.size - 1} packages...`);
  reportTree();
  const treeTicker = onProgress ? setInterval(reportTree, 1000) : null;
  try {
    await Promise.allSettled(
      directDeps
        .slice(0, MAX_DIRECT_DEPS)
        .map(([name, version]) => buildTree(ctx, name, version, 1, rootId))
    );
  } finally {
    if (treeTicker) clearInterval(treeTicker);
  }

  const depNodes = Array.from(nodes.values()).filter((n) => !n.isRoot);
  onProgress?.(`checking ${depNodes.length} packages against OSV...`);
  const [cveMap] = await Promise.all([
    queryOSV(depNodes.map((n) => ({ name: n.name, version: n.version })), onProgress),
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