import type {
  ApiEndpoint, DepNode, DockerFinding, EnvFinding, ScanResult, SecretFinding, Severity,
} from '@/types';
import { hasRiskSignal } from '@/lib/depGraphLayout';
import { sevRank, shortSha, worstOf } from './theme';
import type { ViewId } from './views';

/* ─────────────────────────────── Threat score ───────────────────────────── */

export type Engine = 'depchain' | 'ghostcommit' | 'layerscan' | 'apibleed' | 'envtrace';

export const ENGINE_NAME: Record<Engine, string> = {
  depchain: 'DEPCHAIN', ghostcommit: 'GHOSTCOMMIT', layerscan: 'LAYERSCAN', apibleed: 'APIBLEED', envtrace: 'ENVTRACE',
};
export const ENGINE_VIEW: Record<Engine, ViewId> = {
  depchain: 'dep', ghostcommit: 'gst', layerscan: 'lyr', apibleed: 'api', envtrace: 'env',
};

const SEV_WEIGHT: Record<Severity, number> = { critical: 15, high: 8, medium: 4, low: 1, info: 0 };

export interface ScoreBuckets { infra: number; deps: number; secrets: number; api: number; total: number }

/**
 * Mirrors calcThreatScore() in src/app/api/scan/[scanId]/run/route.ts (as
 * ThreatGauge.tsx does) — four capped buckets. `without` drops engines to
 * project what the score becomes once their findings are fixed.
 */
export function scoreBuckets(r: ScanResult, without: Engine[] = []): ScoreBuckets {
  const drop = new Set(without);
  const env = drop.has('envtrace') ? 0 : (r.envtrace?.findings ?? []).reduce((a, f) => a + (SEV_WEIGHT[f.severity] ?? 0), 0);
  const layer = drop.has('layerscan') ? 0 : (r.layerscan?.findings ?? []).reduce((a, f) => a + (SEV_WEIGHT[f.severity] ?? 0), 0);
  const infra = Math.min(env + layer, 40);
  const deps = drop.has('depchain') ? 0 : Math.min((r.depchain?.vulnCount ?? 0) * 8 + (r.depchain?.riskCount ?? 0) * 4, 30);
  const secrets = drop.has('ghostcommit') ? 0 : Math.min((r.ghostcommit?.findings?.length ?? 0) * 10, 20);
  const api = drop.has('apibleed') ? 0 : Math.min((r.apibleed?.unsecuredCount ?? 0) * 5, 10);
  return { infra, deps, secrets, api, total: Math.min(infra + deps + secrets + api, 100) };
}

/** Points the score drops if every finding of `engines` were resolved. */
export function scoreImpact(r: ScanResult, engines: Engine[]): number {
  return scoreBuckets(r).total - scoreBuckets(r, engines).total;
}

/* ─────────────────────────────── All findings ───────────────────────────── */

export interface NormFinding {
  key: string;
  engine: Engine;
  severity: Severity;
  title: string;
  where: string;
  view: ViewId;
  /** Selection key understood by the target view (?focus=). */
  focus?: string;
}

export function allFindings(r: ScanResult): NormFinding[] {
  const out: NormFinding[] = [];
  for (const row of depRows(r)) {
    out.push({
      key: `dep:${row.key}`, engine: 'depchain', severity: row.severity,
      title: row.cve ? `${row.node.name}@${row.node.version} · ${row.cve.id}` : `${row.signals[0]?.title ?? 'Risk signal'} · ${row.node.name}`,
      where: row.direct ? 'direct dependency' : `transitive · depth ${row.depth ?? '?'}`, view: 'dep', focus: row.key,
    });
  }
  (r.ghostcommit?.findings ?? []).forEach((f) => out.push({
    key: `gst:${ghostKey(f)}`, engine: 'ghostcommit', severity: 'critical', title: `${f.type} · ${f.file}:${f.line}`,
    where: shortSha(f.commit_sha), view: 'gst', focus: f.commit_sha,
  }));
  (r.layerscan?.findings ?? []).forEach((f, i) => out.push({
    key: `lyr:${i}`, engine: 'layerscan', severity: f.severity, title: f.issue,
    where: f.layer > 0 ? `Dockerfile:${f.layer}` : 'Dockerfile', view: 'lyr', focus: String(i),
  }));
  (r.apibleed?.endpoints ?? []).filter((e) => e.issues.length > 0).forEach((e) => out.push({
    key: `api:${endpointKey(e)}`, engine: 'apibleed', severity: e.severity, title: `${e.method} ${e.path} — ${e.issues[0]}`,
    where: e.file, view: 'api', focus: endpointKey(e),
  }));
  (r.envtrace?.findings ?? []).forEach((f, i) => out.push({
    key: `env:${i}`, engine: 'envtrace', severity: f.severity, title: f.detail,
    where: f.line ? `${f.file}:${f.line}` : f.file, view: 'env', focus: String(i),
  }));
  return out.sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
}

export function engineCounts(r: ScanResult): Record<Engine, number> {
  const c: Record<Engine, number> = { depchain: 0, ghostcommit: 0, layerscan: 0, apibleed: 0, envtrace: 0 };
  for (const f of allFindings(r)) c[f.engine]++;
  return c;
}

/**
 * Same finding list the threat-map page sends to /api/explain (buildAiFindings
 * in src/app/scan/[scanId]/page.tsx). Kept identical so the brief generated
 * from either view covers the same evidence.
 */
export function buildAiFindings(scanResult: ScanResult) {
  return [
    ...(scanResult.depchain?.nodes?.filter((n) => (n.cves?.length ?? 0) > 0).flatMap((n) =>
      n.cves.map((c) => ({ scanner: 'depchain', title: `${n.name}@${n.version}`, detail: c.summary, severity: c.severity }))
    ) ?? []),
    ...(scanResult.depchain?.nodes?.flatMap((n) =>
      (n.signals ?? []).filter((s) => s.severity !== 'low').map((s) => ({ scanner: 'depchain', title: `${s.title}: ${n.name}@${n.version}`, detail: s.detail, severity: s.severity }))
    ) ?? []),
    ...(scanResult.ghostcommit?.findings?.map((f) => ({ scanner: 'ghostcommit', title: f.type, detail: f.file, severity: 'critical' as const })) ?? []),
    ...(scanResult.layerscan?.findings?.map((f) => ({ scanner: 'layerscan', title: f.issue.substring(0, 60), detail: f.fix, severity: f.severity })) ?? []),
    ...(scanResult.apibleed?.endpoints?.filter((e) => e.issues.length > 0).map((e) => ({ scanner: 'apibleed', title: `${e.method} ${e.path}`, detail: e.issues[0], severity: e.severity })) ?? []),
    ...(scanResult.envtrace?.findings?.map((f) => ({ scanner: 'envtrace', title: f.type, detail: f.detail, severity: f.severity })) ?? []),
  ];
}

/* ─────────────────────────────── Dependencies ───────────────────────────── */

export interface DepIndex {
  byId: Map<string, DepNode>;
  children: Map<string, string[]>;
  rootId: string | null;
  depth: Map<string, number>;
  /** BFS parent pointer from the root, for resolution paths. */
  via: Map<string, string>;
}

export function depIndex(r: ScanResult): DepIndex {
  const nodes = r.depchain?.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  for (const e of r.depchain?.edges ?? []) {
    if (!children.has(e.from)) children.set(e.from, []);
    children.get(e.from)!.push(e.to);
  }
  const rootId = nodes.find((n) => n.isRoot)?.id ?? null;
  const depth = new Map<string, number>();
  const via = new Map<string, string>();
  if (rootId) {
    depth.set(rootId, 0);
    const queue = [rootId];
    while (queue.length) {
      const id = queue.shift()!;
      for (const c of children.get(id) ?? []) {
        if (depth.has(c)) continue;
        depth.set(c, depth.get(id)! + 1);
        via.set(c, id);
        queue.push(c);
      }
    }
  }
  return { byId, children, rootId, depth, via };
}

/** Root → … → node, following the shortest resolution chain. */
export function resolutionPath(idx: DepIndex, nodeId: string): string[] {
  const path = [nodeId];
  let cur = nodeId;
  while (idx.via.has(cur)) {
    cur = idx.via.get(cur)!;
    path.unshift(cur);
  }
  return path;
}

export interface DepRow {
  key: string;
  node: DepNode;
  cve: DepNode['cves'][number] | null;
  signals: NonNullable<DepNode['signals']>;
  severity: Severity;
  direct: boolean;
  depth: number | null;
}

export function depRows(r: ScanResult, idx = depIndex(r)): DepRow[] {
  const rows: DepRow[] = [];
  for (const n of r.depchain?.nodes ?? []) {
    if (n.isRoot) continue;
    const signals = (n.signals ?? []).filter((s) => s.severity !== 'low' && s.severity !== 'info');
    const base = { node: n, signals, direct: !!n.isDirect, depth: idx.depth.get(n.id) ?? null };
    if ((n.cves?.length ?? 0) > 0) {
      for (const c of n.cves) rows.push({ ...base, key: `${n.id}|${c.id}`, cve: c, severity: c.severity });
    } else if (hasRiskSignal(n)) {
      rows.push({ ...base, key: `${n.id}|signal`, cve: null, severity: worstOf(signals.map((s) => s.severity)) ?? 'medium' });
    }
  }
  return rows.sort((a, b) =>
    sevRank(a.severity) - sevRank(b.severity) ||
    (b.cve?.score ?? 0) - (a.cve?.score ?? 0) ||
    Number(b.direct) - Number(a.direct));
}

/** package.json change that clears the row, when a fixed version is known. */
export function depFix(row: DepRow): string | null {
  const fixed = row.cve?.fixed_in;
  if (!fixed) return null;
  if (row.direct) return `npm i ${row.node.name}@^${fixed}`;
  return `"overrides": {\n  "${row.node.name}": "^${fixed}"\n}`;
}

/* ──────────────────────────────── Secrets ───────────────────────────────── */

export type SecretSource = 'history' | 'env-file' | 'example' | 'source' | 'image';
export type SecretCategory = 'aws' | 'token' | 'private-key' | 'database' | 'jwt' | 'other';

export interface SecretItem {
  fp: string;
  source: SecretSource;
  category: SecretCategory;
  type: string;
  mask: string;
  file: string;
  line: number | null;
  severity: Severity;
  entropy: number | null;
  commit: SecretFinding | null;
  detail: string;
}

export const CATEGORY_LABEL: Record<SecretCategory, string> = {
  aws: 'AWS KEYS', token: 'API TOKENS', 'private-key': 'PRIVATE KEYS', database: 'DATABASE CREDS', jwt: 'JWT / SESSION', other: 'HIGH-ENTROPY',
};

export function categorize(text: string): SecretCategory {
  if (/aws/i.test(text)) return 'aws';
  if (/private key/i.test(text)) return 'private-key';
  if (/database|postgres|mysql|mongo|redis/i.test(text)) return 'database';
  if (/jwt/i.test(text)) return 'jwt';
  if (/token|api key|api_key|stripe|openai|anthropic|slack|oauth|secret key|credential/i.test(text)) return 'token';
  return 'other';
}

export function ghostKey(f: SecretFinding): string {
  return `${f.commit_sha}|${f.file}|${f.line}|${f.type}`;
}

export function secretItems(r: ScanResult): SecretItem[] {
  const out: SecretItem[] = [];
  for (const f of r.ghostcommit?.findings ?? []) {
    out.push({
      fp: `history|${ghostKey(f)}`, source: 'history', category: categorize(f.type), type: f.type, mask: f.preview,
      file: f.file, line: f.line, severity: 'critical', entropy: f.entropy, commit: f,
      detail: `Introduced in ${shortSha(f.commit_sha)} — ${f.commit_message}`,
    });
  }
  (r.envtrace?.findings ?? []).forEach((f: EnvFinding) => {
    if (f.type === 'missing_gitignore') return;
    if (f.type === 'exposed_env' && f.severity !== 'critical') return; // schema-only env file: shown in EnvTrace
    const source: SecretSource = f.type === 'exposed_env' ? 'env-file' : /example file/i.test(f.detail) ? 'example' : 'source';
    const label = f.type === 'exposed_env' ? 'Committed env value' : f.detail.split(/ with | hardcoded /)[0];
    out.push({
      fp: `${source}|${f.file}|${f.line ?? ''}|${f.detail}`, source, category: categorize(f.detail), type: label,
      mask: (f.detail.match(/([A-Z0-9_]+=\[REDACTED\])/)?.[1]) ?? '[REDACTED]',
      file: f.file, line: f.line ?? null, severity: f.severity, entropy: null, commit: null, detail: f.detail,
    });
  });
  (r.layerscan?.findings ?? []).forEach((f: DockerFinding) => {
    if (f.instruction !== '[REDACTED]') return;
    out.push({
      fp: `image|Dockerfile|${f.layer}|${f.issue}`, source: 'image', category: categorize(f.issue), type: /ENV/.test(f.issue) ? 'Secret in ENV instruction' : 'Secret in RUN instruction',
      mask: '[REDACTED]', file: 'Dockerfile', line: f.layer || null, severity: f.severity, entropy: null, commit: null, detail: f.issue,
    });
  });
  return out.sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
}

export const SOURCE_LABEL: Record<SecretSource, string> = {
  history: 'GIT HISTORY', 'env-file': 'ENV FILE · HEAD', example: 'EXAMPLE FILE · HEAD', source: 'SOURCE · HEAD', image: 'IMAGE LAYER',
};

/** The Dockerfile finding for a whole-context copy, if the image ships the working tree. */
export function copyAllFinding(r: ScanResult): DockerFinding | null {
  return r.layerscan?.findings.find((f) => /COPY \. \./.test(f.issue)) ?? null;
}

/* ────────────────────────────────── API ─────────────────────────────────── */

export function endpointKey(e: ApiEndpoint): string {
  return `${e.method} ${e.path}`;
}

export const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH', 'ANY']);

export function endpointFacts(e: ApiEndpoint) {
  return {
    write: WRITE_METHODS.has(e.method),
    rateLimited: !e.issues.some((i) => /rate limit/i.test(i)),
    cors: e.issues.some((i) => /CORS/i.test(i)),
  };
}

/* ───────────────────────────── Attack path ──────────────────────────────── */

export interface Stage {
  phase: 'ENTRY' | 'BUILD' | 'ESCALATE' | 'IMPACT';
  title: string;
  lines: string[];
  severity: Severity;
  view: ViewId;
  engine: Engine;
}

/**
 * The primary attack path, assembled only from findings that exist: an entry
 * point (leaked secret, exposed env value or vulnerable direct dependency), a
 * build-time amplifier, a privilege escalation, and an exposed write surface.
 * Missing stages are left out rather than filled in.
 */
export function attackPath(r: ScanResult): Stage[] {
  const stages: Stage[] = [];
  const ghost = r.ghostcommit?.findings?.[0];
  const envCrit = r.envtrace?.findings.find((f) => f.severity === 'critical');
  const idx = depIndex(r);
  const vulnDirect = depRows(r, idx).find((row) => row.cve && row.direct && sevRank(row.severity) <= 1);
  if (ghost) {
    stages.push({ phase: 'ENTRY', title: 'Secret in history', severity: 'critical', view: 'gst', engine: 'ghostcommit',
      lines: [`${shortSha(ghost.commit_sha)} · ${ghost.file}:${ghost.line}`, `${ghost.type}, entropy ${ghost.entropy.toFixed(1)}`] });
  } else if (envCrit) {
    stages.push({ phase: 'ENTRY', title: 'Credential at HEAD', severity: envCrit.severity, view: 'env', engine: 'envtrace',
      lines: [envCrit.line ? `${envCrit.file}:${envCrit.line}` : envCrit.file, envCrit.detail.slice(0, 60)] });
  } else if (vulnDirect?.cve) {
    stages.push({ phase: 'ENTRY', title: 'Vulnerable dependency', severity: vulnDirect.severity, view: 'dep', engine: 'depchain',
      lines: [`${vulnDirect.node.name}@${vulnDirect.node.version}`, `${vulnDirect.cve.id}`] });
  }
  const layers = r.layerscan?.findings ?? [];
  const build = layers
    .filter((f) => /COPY \. \.|Secret in ENV|Hardcoded secret|curl\/wget|ADD with URL/.test(f.issue))
    .sort((a, b) => sevRank(a.severity) - sevRank(b.severity))[0];
  if (build) {
    stages.push({ phase: 'BUILD', title: /COPY/.test(build.issue) ? 'Context baked into image' : /curl/.test(build.issue) ? 'Remote code at build' : /ADD/.test(build.issue) ? 'Unverified download' : 'Secret in image layer',
      severity: build.severity, view: 'lyr', engine: 'layerscan',
      lines: [build.layer > 0 ? `Dockerfile:${build.layer}` : 'Dockerfile', build.instruction === '[REDACTED]' ? 'value redacted' : build.instruction.slice(0, 40)] });
  }
  const root = layers.find((f) => /runs as root/.test(f.issue));
  if (root) {
    stages.push({ phase: 'ESCALATE', title: 'Runs as root', severity: root.severity, view: 'lyr', engine: 'layerscan',
      lines: ['no USER directive', 'uid 0 inside the container'] });
  }
  const openWrite = (r.apibleed?.endpoints ?? [])
    .filter((e) => !e.hasAuth && WRITE_METHODS.has(e.method))
    .sort((a, b) => sevRank(a.severity) - sevRank(b.severity))[0];
  if (openWrite) {
    stages.push({ phase: 'IMPACT', title: 'Unauthenticated write', severity: openWrite.severity, view: 'api', engine: 'apibleed',
      lines: [`${openWrite.method} ${openWrite.path}`, openWrite.file] });
  }
  return stages;
}

/* ───────────────────────────── Remediation ──────────────────────────────── */

export interface Remediation {
  priority: 'P0' | 'P1' | 'P2';
  action: string;
  engine: Engine;
  count: number;
  impact: number;
}

export function remediationPlan(r: ScanResult): Remediation[] {
  const plan: Remediation[] = [];
  const add = (engine: Engine, worst: Severity | null, count: number, action: string) => {
    if (!count || !worst) return;
    const priority = worst === 'critical' ? 'P0' : worst === 'high' ? 'P1' : 'P2';
    plan.push({ priority, action, engine, count, impact: scoreImpact(r, [engine]) });
  };

  const ghost = r.ghostcommit?.findings ?? [];
  if (ghost.length) {
    const files = [...new Set(ghost.map((f) => f.file))];
    add('ghostcommit', 'critical', ghost.length,
      `Rotate ${ghost.length} leaked credential${ghost.length > 1 ? 's' : ''}; purge ${files.slice(0, 2).join(', ')}${files.length > 2 ? ` +${files.length - 2}` : ''} from history`);
  }
  const unauth = (r.apibleed?.endpoints ?? []).filter((e) => e.issues.length > 0);
  const openWrites = unauth.filter((e) => !e.hasAuth && WRITE_METHODS.has(e.method));
  add('apibleed', worstOf(unauth.map((e) => e.severity)), unauth.length,
    openWrites.length
      ? `Require auth on ${openWrites.slice(0, 2).map((e) => `${e.method} ${e.path}`).join(' and ')}${openWrites.length > 2 ? ` +${openWrites.length - 2}` : ''}`
      : `Add rate limiting to ${unauth.length} endpoint${unauth.length > 1 ? 's' : ''}`);
  const layers = [...(r.layerscan?.findings ?? [])].sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
  add('layerscan', worstOf(layers.map((f) => f.severity)), layers.length,
    layers.slice(0, 2).map((f) => f.fix.split('\n')[0]).join('; '));
  const env = [...(r.envtrace?.findings ?? [])].sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
  add('envtrace', worstOf(env.map((f) => f.severity)), env.length,
    env[0]?.type === 'missing_gitignore' ? 'Add .env to .gitignore; remove committed env values' : `Remove committed values from ${[...new Set(env.map((f) => f.file))].slice(0, 2).join(', ')}`);
  const rows = depRows(r);
  const fixable = rows.filter((row) => row.cve?.fixed_in);
  add('depchain', worstOf(rows.map((row) => row.severity)), rows.length,
    fixable.length
      ? `Upgrade ${fixable.slice(0, 2).map((row) => `${row.node.name} ≥ ${row.cve!.fixed_in}`).join(', ')}${fixable.length > 2 ? ` +${fixable.length - 2}` : ''}`
      : `Review ${rows.length} flagged package${rows.length > 1 ? 's' : ''} (no fixed release published)`);

  const order = { P0: 0, P1: 1, P2: 2 };
  return plan.sort((a, b) => order[a.priority] - order[b.priority] || b.impact - a.impact);
}
