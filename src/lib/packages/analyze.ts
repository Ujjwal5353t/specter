import type { Severity } from '@/types';
import { supabaseAdmin } from '@/lib/supabase';
import {
  analyzeVersion, typosquatMatch, youngDependencySignal,
  type Packument, type NpmVersionDoc,
} from '@/lib/scanners/deprisk';

/**
 * Package-level pre-install verdict engine (issue #27/#28): given one npm
 * `name@version`, decide `allow` / `warn` / `block` from registry metadata
 * and OSV — no GitHub API calls, no repository access, so it can run before
 * anything is ever cloned or installed.
 *
 * This is the "metadata" tier only. Later tiers (tarball diff, LLM review,
 * sandbox — #39/#43/#45) are separate, bigger pieces of work; a `warn` or
 * `block` verdict here is exactly the trigger they'd escalate on — see
 * needsEscalation() below, which is that rule as a concrete, importable
 * check rather than each future tier re-deriving it from the verdict.
 */

const REGISTRY_BASE = 'https://registry.npmjs.org';
const OSV_QUERY_API = 'https://api.osv.dev/v1/query';
const FETCH_TIMEOUT_MS = 8000;

export type Verdict = 'allow' | 'warn' | 'block';

export type VerdictSignalType =
  | 'new_publisher' | 'new_dependency' | 'young_dependency' | 'young_package'
  | 'fresh_release' | 'install_script' | 'provenance_dropped' | 'typosquat'
  | 'osv_malicious' | 'osv_advisory';

export interface VerdictSignal {
  type: VerdictSignalType;
  severity: Severity;
  title: string;
  detail: string;
  /** OSV/GHSA/MAL- id, for the two signal types that come from an OSV advisory. */
  advisoryId?: string;
}

export interface PackageVerdict {
  name: string;
  version: string;
  /** dist.integrity (or shasum) of this exact version, '' if the registry didn't report one. */
  integrity: string;
  verdict: Verdict;
  score: number;
  signals: VerdictSignal[];
  tierReached: 'metadata';
  analyzedAt: string;
  /** True when this came from package_verdicts instead of a fresh analysis. */
  fromCache: boolean;
  /**
   * Signal sources that could not be reached (e.g. 'registry', 'osv'). Their
   * signals are simply absent, not treated as "clean" — check this before
   * trusting an 'allow' verdict.
   */
  sourceFailures: string[];
}

// ── Scoring ──────────────────────────────────────────────────────────────
//
// Same ordinal weights as the repo scan's calcThreatScore (README: "How the
// threat score works"), for one consistent scale across the app:
//   critical 15 · high 8 · medium 4 · low 1 · info 0
// `score` is the sum of every signal's weight (OSV advisories other than a
// malicious-package match are capped to the 3 most severe, so a package with
// a long CVE list can't inflate the score past what a human would weigh it).
//
// Thresholds are hand-picked, not statistical, exactly like calcThreatScore:
//   score ≥ 23  → block  (needs real stacking: e.g. one critical + one high,
//                         not a single weak signal)
//   score ≥ 8   → warn   (one high signal, or two-plus weaker ones)
//   otherwise   → allow
// A confirmed OSV malicious-package match (a `MAL-` id, or any advisory
// tagged CWE-506 "Embedded Malicious Code") forces `block` outright,
// regardless of score — that is not a heuristic, it is a direct report of
// known-malicious code.
const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 15, high: 8, medium: 4, low: 1, info: 0 };
const BLOCK_SCORE = 23;
const WARN_SCORE = 8;
const MAX_SCORED_ADVISORIES = 3;

function scoreOf(signals: VerdictSignal[]): number {
  return signals.reduce((sum, s) => sum + SEVERITY_WEIGHT[s.severity], 0);
}

function verdictFor(signals: VerdictSignal[], score: number): Verdict {
  if (signals.some((s) => s.type === 'osv_malicious')) return 'block';
  if (score >= BLOCK_SCORE) return 'block';
  if (score >= WARN_SCORE) return 'warn';
  return 'allow';
}

// ── npm registry ─────────────────────────────────────────────────────────

/** Self-contained on purpose (see module doc): no import of DepChain/GitHub code. */
async function fetchPackument(name: string): Promise<Packument | null> {
  try {
    const res = await fetch(`${REGISTRY_BASE}/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return (await res.json()) as Packument;
  } catch {
    return null;
  }
}

function integrityOf(doc: NpmVersionDoc | undefined): string {
  return doc?.dist?.integrity ?? (doc?.dist?.shasum ? `sha1-${doc.dist.shasum}` : '');
}

// ── OSV ──────────────────────────────────────────────────────────────────

interface OSVVuln {
  id: string;
  summary?: string;
  details?: string;
  severity?: { score: number | string }[];
  database_specific?: { severity?: string; cwe_ids?: string[] };
}

/** An advisory OSV or OpenSSF's malicious-packages feed reports as actually-malicious code. */
function isMaliciousAdvisory(v: OSVVuln): boolean {
  return v.id.startsWith('MAL-') || (v.database_specific?.cwe_ids ?? []).includes('CWE-506');
}

function severityOf(v: OSVVuln): Severity {
  const dbSev = v.database_specific?.severity?.toLowerCase();
  if (dbSev === 'critical') return 'critical';
  if (dbSev === 'high') return 'high';
  if (dbSev === 'moderate' || dbSev === 'medium') return 'medium';
  if (dbSev === 'low') return 'low';
  const numeric = v.severity?.find((s) => typeof s.score === 'number')?.score as number | undefined;
  if (numeric !== undefined) {
    if (numeric >= 9) return 'critical';
    if (numeric >= 7) return 'high';
    if (numeric >= 4) return 'medium';
    if (numeric > 0) return 'low';
  }
  return 'medium';
}

/** Exact-version query (OSV does the range/version matching server-side) — one package, no hydration needed. */
async function fetchOSVVulns(name: string, version: string): Promise<OSVVuln[] | null> {
  try {
    const res = await fetch(OSV_QUERY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: { name, ecosystem: 'npm' }, version }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.vulns) ? data.vulns : [];
  } catch {
    return null;
  }
}

function osvSignals(vulns: OSVVuln[]): VerdictSignal[] {
  const signals: VerdictSignal[] = [];
  const malicious = vulns.filter(isMaliciousAdvisory);
  const rest = vulns.filter((v) => !isMaliciousAdvisory(v));

  for (const v of malicious) {
    signals.push({
      type: 'osv_malicious',
      severity: 'critical',
      title: 'Reported as malicious code',
      detail: `${v.id}: ${(v.summary && v.summary.trim()) || (v.details ?? '').trim().split('\n')[0].substring(0, 140) || 'flagged as malicious by OSV.'}`,
      advisoryId: v.id,
    });
  }

  const bySeverity = [...rest].sort((a, b) => SEVERITY_WEIGHT[severityOf(b)] - SEVERITY_WEIGHT[severityOf(a)]);
  for (const v of bySeverity.slice(0, MAX_SCORED_ADVISORIES)) {
    signals.push({
      type: 'osv_advisory',
      severity: severityOf(v),
      title: `Known vulnerability: ${v.id}`,
      detail: (v.summary && v.summary.trim()) || (v.details ?? '').trim().split('\n')[0].substring(0, 140) || v.id,
      advisoryId: v.id,
    });
  }
  return signals;
}

// ── Cache (best-effort — see supabase/schema.sql for package_verdicts) ────

function rowToVerdict(row: {
  name: string; version: string; integrity: string; verdict: Verdict; score: number;
  signals: VerdictSignal[]; tier_reached: string; analyzed_at: string;
}): PackageVerdict {
  return {
    name: row.name, version: row.version, integrity: row.integrity,
    verdict: row.verdict, score: row.score, signals: row.signals,
    tierReached: 'metadata', analyzedAt: row.analyzed_at,
    fromCache: true, sourceFailures: [],
  };
}

async function readCache(name: string, version: string, integrity: string): Promise<PackageVerdict | null> {
  try {
    // A miss and a real failure (table not migrated yet, Supabase down) are
    // deliberately treated the same: both just mean "compute a fresh verdict".
    const { data, error } = await supabaseAdmin
      .from('package_verdicts')
      .select('*')
      .eq('name', name).eq('version', version).eq('integrity', integrity)
      .maybeSingle();
    if (error || !data) return null;
    return rowToVerdict(data);
  } catch {
    return null;
  }
}

async function writeCache(v: PackageVerdict): Promise<void> {
  try {
    // supabase-js resolves an { error } object rather than throwing on a
    // PostgREST-level failure (e.g. the table not being migrated yet), so
    // that has to be checked explicitly — try/catch alone only covers a
    // network-level throw. Same pattern as scanProgress.ts's writeProgress.
    const { error } = await supabaseAdmin.from('package_verdicts').upsert({
      name: v.name, version: v.version, integrity: v.integrity,
      verdict: v.verdict, score: v.score, signals: v.signals,
      tier_reached: v.tierReached, analyzed_at: v.analyzedAt,
    }, { onConflict: 'name,version,integrity' });
    if (error) console.warn(`package_verdicts write failed (${v.name}@${v.version}):`, error.message);
  } catch (err) {
    console.warn(`package_verdicts write failed (${v.name}@${v.version}):`, err instanceof Error ? err.message : err);
  }
}

// ── Entry point ──────────────────────────────────────────────────────────

/**
 * Verdict for one npm `name@version`. Never throws: a source that fails
 * (registry down, OSV down, Supabase not migrated) is recorded in
 * `sourceFailures` and simply contributes no signals, rather than failing
 * the whole check or being counted as "clean".
 */
/**
 * Escalation rule (#27 scope): only a version that scored above the `allow`
 * threshold here is worth the cost of the diff, LLM and sandbox tiers
 * (#39/#43/#45). Those tiers don't exist yet — this is the hook they'll
 * call once they do, so the rule lives in one place instead of each of
 * them re-deriving "is this verdict bad enough to look closer at".
 */
export function needsEscalation(v: PackageVerdict): boolean {
  return v.verdict !== 'allow';
}

export async function analyzePackage(name: string, version: string): Promise<PackageVerdict> {
  const sourceFailures: string[] = [];

  // The cache key needs the exact-version integrity, which only the registry
  // has — so a first, cheap packument fetch always happens even on a cache
  // hit. It's the OSV call (the slower, rate-limited one) that a hit skips.
  const pk = await fetchPackument(name);
  if (!pk) sourceFailures.push('registry');
  const doc = pk?.versions?.[version];
  const integrity = integrityOf(doc);

  const cached = await readCache(name, version, integrity);
  if (cached) return { ...cached, sourceFailures };

  const now = Date.now();
  const signals: VerdictSignal[] = [];

  if (pk) {
    const analysis = analyzeVersion(pk, version, now);
    signals.push(...(analysis.signals as VerdictSignal[]));

    // New dependencies this version added, each checked for its own age —
    // the exact shape of the event-stream/flatmap-stream attack: a brand-new
    // package slipped in as a dependency of an already-trusted one.
    if (analysis.newDeps.length > 0 && analysis.publishedAt !== null) {
      const publishedAt = analysis.publishedAt;
      const parent = { name, publisher: doc?._npmUser?.name };
      const depResults = await Promise.allSettled(
        analysis.newDeps.map(async (depName) => {
          const depPk = await fetchPackument(depName);
          if (!depPk) return null;
          return youngDependencySignal(depPk, `${name}@${version}`, publishedAt, parent);
        }),
      );
      for (const r of depResults) {
        if (r.status === 'fulfilled' && r.value) signals.push(r.value as VerdictSignal);
      }
    }
  }

  const typosquat = typosquatMatch(name);
  if (typosquat) {
    signals.push({
      type: 'typosquat',
      severity: 'high',
      title: `Possible typosquat of "${typosquat.target}"`,
      detail: `"${name}" ${typosquat.exact ? 'differs from' : 'is one typo away from'} the popular package "${typosquat.target}".`,
    });
  }

  const vulns = await fetchOSVVulns(name, version);
  if (vulns === null) sourceFailures.push('osv');
  else signals.push(...osvSignals(vulns));

  const score = scoreOf(signals);
  const verdict: PackageVerdict = {
    name, version, integrity,
    verdict: verdictFor(signals, score),
    score, signals, tierReached: 'metadata',
    analyzedAt: new Date(now).toISOString(),
    fromCache: false, sourceFailures,
  };

  // Cache regardless of source failures — a partial-but-recorded verdict is
  // still more honest than re-deriving it every call, and sourceFailures
  // travels with it either way. Fire-and-forget: caching must never slow
  // down the caller.
  void writeCache(verdict);

  return verdict;
}
