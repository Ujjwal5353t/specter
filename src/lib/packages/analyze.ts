import semver from 'semver';
import type { Severity } from '@/types';
import { supabaseAdmin } from '@/lib/supabase';
import { PACKAGE_NAME, createLimiter, fetchPackument, checkTyposquat } from '@/lib/npm/registry';
import { runDiffTier } from './diff';
import { runSandboxTier } from './sandbox';
import {
  analyzeVersion, youngDependencySignal,
  type NpmVersionDoc,
} from '@/lib/scanners/deprisk';

/**
 * Package-level pre-install verdict engine (issue #27/#28): given one npm
 * `name@version`, decide `allow` / `warn` / `block` from registry metadata
 * and OSV — no GitHub API calls, no repository access, so it can run before
 * anything is ever cloned or installed.
 *
 * Tier 1 is registry metadata + OSV. A version that scores at or above the warn
 * threshold is escalated to tier 2, the tarball diff (diff.ts): its files are
 * compared with the previous version's and scanned as text, never executed.
 * Tier 3 is the sandbox (sandbox.ts, #45): the same versions are run in a
 * throwaway Docker container and what they do is recorded. It is optional, since
 * it needs a separate runner service. The LLM review tier (#43) will hang off the
 * same rule, see needsEscalation() below.
 *
 * CACHING. Published npm versions are immutable, so a verdict is looked up by
 * (name, version) *before* any network call: a repeat call is one DB read. A
 * caller that has an integrity hash (a lockfile does) can pass it; a cached
 * verdict for a different tarball is then not reused. Only complete verdicts
 * are cached, so a cache hit never hides a source that failed.
 */

const OSV_QUERY_API = 'https://api.osv.dev/v1/query';
const FETCH_TIMEOUT_MS = 8000;
// A cached verdict is re-derived after this long: OSV `MAL-` advisories are
// usually published after a malicious version is already live, so an old
// `allow` must not be trusted forever.
const VERDICT_TTL_MS = 6 * 60 * 60 * 1000;
// A release adding more dependencies than this is off the normal path; the rest go unchecked
const MAX_NEW_DEPS_CHECKED = 10;
const REGISTRY_CONCURRENCY = 6;

export type Verdict = 'allow' | 'warn' | 'block';

export type VerdictSignalType =
  | 'new_publisher' | 'new_dependency' | 'young_dependency' | 'young_package'
  | 'fresh_release' | 'install_script' | 'provenance_dropped' | 'typosquat'
  | 'osv_malicious' | 'osv_advisory'
  // Tarball-diff tier (#39)
  | 'diff_rule' | 'diff_install_script' | 'diff_new_files' | 'diff_skipped' | 'archive_anomaly'
  // Sandbox tier (#45)
  | 'sandbox_honeypot_read' | 'sandbox_token_exfil' | 'sandbox_network' | 'sandbox_process'
  | 'sandbox_sensitive_read' | 'sandbox_clean' | 'sandbox_skipped';

export interface VerdictSignal {
  type: VerdictSignalType;
  severity: Severity;
  title: string;
  detail: string;
  /** OSV/GHSA/MAL- id, for the two signal types that come from an OSV advisory. */
  advisoryId?: string;
  /** Id of the static rule behind a 'diff_rule' signal (see rules.ts). */
  rule?: string;
}

export interface PackageVerdict {
  name: string;
  version: string;
  /** dist.integrity (or shasum) of this exact version, '' if the registry didn't report one. */
  integrity: string;
  verdict: Verdict;
  score: number;
  signals: VerdictSignal[];
  /** How far the analysis went: registry metadata + OSV, then the tarball diff, then the sandbox run. */
  tierReached: 'metadata' | 'diff' | 'sandbox';
  analyzedAt: string;
  /** True when this came from package_verdicts instead of a fresh analysis. */
  fromCache: boolean;
  /**
   * Sources that could not be checked: 'registry', 'osv', 'registry:<dep>' for a new
   * dependency, 'version-not-found', 'invalid-input'. Their signals are absent, not
   * "clean", so a verdict with failures is never `allow` (see analyzePackage).
   */
  sourceFailures: string[];
}

// ── Scoring ──────────────────────────────────────────────────────────────
//
// Same ordinal weights as the repo scan's calcThreatScore (README: "How the
// threat score works"), for one consistent scale across the app:
//   critical 15 · high 8 · medium 4 · low 1 · info 0
// `score` is the sum of every signal's weight, except OSV advisories that are
// not malicious-package matches: those are ordinary CVEs ("vulnerable", not
// "malicious"), so together they add at most MAX_ADVISORY_SCORE. A popular
// package with a long CVE list therefore stays `allow` on its own, while a
// CVE still counts when it stacks with real supply-chain signals.
//
// Thresholds are hand-picked, not statistical, exactly like calcThreatScore:
//   score ≥ 23  → block  (needs real stacking: e.g. one critical + one high,
//                         not a single weak signal)
//   score ≥ 8   → warn   (one high signal, or two-plus weaker ones)
//   otherwise   → allow
// A confirmed OSV malicious-package match (a `MAL-` id, or any advisory
// tagged CWE-506 "Embedded Malicious Code") forces `block` outright,
// regardless of score — that is not a heuristic, it is a direct report of
// known-malicious code. So does the sandbox catching a package reading the fake
// credentials it planted, or passing them on: observed behaviour, not a guess.
// A verdict that would be `allow` but had a source fail is `warn` instead: a
// package that could not be fully checked is not one we can vouch for.
const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 15, high: 8, medium: 4, low: 1, info: 0 };
const BLOCK_SCORE = 23;
const WARN_SCORE = 8;
const MAX_SCORED_ADVISORIES = 3;
const MAX_ADVISORY_SCORE = SEVERITY_WEIGHT.medium;

export function scoreOf(signals: VerdictSignal[]): number {
  let score = 0;
  let advisories = 0;
  for (const s of signals) {
    if (s.type === 'osv_advisory') advisories += SEVERITY_WEIGHT[s.severity];
    else score += SEVERITY_WEIGHT[s.severity];
  }
  return score + Math.min(advisories, MAX_ADVISORY_SCORE);
}

/** Signals that are proof rather than suspicion: any one of them is a `block`. */
const HARD_SIGNALS = new Set<VerdictSignalType>(['osv_malicious', 'sandbox_honeypot_read', 'sandbox_token_exfil']);

export function verdictFor(signals: VerdictSignal[], score: number, failures: string[]): Verdict {
  if (signals.some((s) => HARD_SIGNALS.has(s.type))) return 'block';
  if (score >= BLOCK_SCORE) return 'block';
  if (score >= WARN_SCORE || failures.length > 0) return 'warn';
  return 'allow';
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
    tierReached: row.tier_reached === 'sandbox' || row.tier_reached === 'diff' ? row.tier_reached : 'metadata',
    analyzedAt: row.analyzed_at,
    // Only complete verdicts are ever written, so a cached one had no failed source
    fromCache: true, sourceFailures: [],
  };
}

async function readCache(name: string, version: string, integrity?: string): Promise<PackageVerdict | null> {
  try {
    // A miss and a real failure (table not migrated yet, Supabase down) are
    // deliberately treated the same: both just mean "compute a fresh verdict".
    let query = supabaseAdmin
      .from('package_verdicts')
      .select('*')
      .eq('name', name).eq('version', version);
    if (integrity) query = query.eq('integrity', integrity);
    const { data, error } = await query.order('analyzed_at', { ascending: false }).limit(1);
    if (error || !data || data.length === 0) return null;
    if (Date.now() - Date.parse(data[0].analyzed_at) > VERDICT_TTL_MS) return null;
    return rowToVerdict(data[0]);
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
 * Escalation rule (#27 scope): only a version that scored above the `allow`
 * threshold here is worth the cost of the diff, LLM and sandbox tiers
 * (#39/#43/#45). The diff and sandbox tiers apply the same score threshold
 * inline; the LLM tier (#43) doesn't exist yet and will call this hook, so the
 * rule lives in one place instead of each tier re-deriving "is this verdict
 * bad enough to look closer at".
 */
export function needsEscalation(v: PackageVerdict): boolean {
  return v.verdict !== 'allow';
}

/** Verdict for input that never reached a data source. */
function unchecked(name: string, version: string, failure: string): PackageVerdict {
  return {
    name, version, integrity: '',
    verdict: 'warn', score: 0, signals: [], tierReached: 'metadata',
    analyzedAt: new Date().toISOString(),
    fromCache: false, sourceFailures: [failure],
  };
}

/**
 * Verdict for one exact npm `name@version`. Never throws: a source that fails
 * (registry down, OSV down, Supabase not migrated) is recorded in
 * `sourceFailures` and simply contributes no signals, rather than failing
 * the whole check or being counted as "clean". `integrity` is the lockfile's
 * hash for this version, when the caller has one.
 */
export async function analyzePackage(
  name: string,
  version: string,
  options: { integrity?: string } = {},
): Promise<PackageVerdict> {
  if (!PACKAGE_NAME.test(name) || semver.valid(version) !== version) {
    return unchecked(name, version, 'invalid-input');
  }

  try {
    const cached = await readCache(name, version, options.integrity);
    if (cached) return cached;

    const label = `${name}@${version}`;
    const sourceFailures: string[] = [];
    const signals: VerdictSignal[] = [];
    const now = Date.now();
    const limit = createLimiter(REGISTRY_CONCURRENCY);

    // OSV needs no registry data, so it runs alongside the registry work. A
    // version npm has since removed (event-stream@3.3.6) is still known to OSV.
    const osvPromise = fetchOSVVulns(name, version);

    const pk = await fetchPackument(name);
    const doc = pk?.versions?.[version];
    if (!pk) sourceFailures.push('registry');
    else if (!doc) sourceFailures.push('version-not-found');

    if (pk && doc) {
      const analysis = analyzeVersion(pk, version, now);
      signals.push(...(analysis.signals as VerdictSignal[]));

      // New dependencies this version added, each checked for its own age —
      // the exact shape of the event-stream/flatmap-stream attack: a brand-new
      // package slipped in as a dependency of an already-trusted one.
      if (analysis.newDeps.length > 0 && analysis.publishedAt !== null) {
        const publishedAt = analysis.publishedAt;
        const parent = { name, publisher: doc._npmUser?.name };
        await Promise.all(analysis.newDeps.slice(0, MAX_NEW_DEPS_CHECKED).map((dep) => limit(async () => {
          const depPk = await fetchPackument(dep);
          if (!depPk) {
            sourceFailures.push(`registry:${dep}`);
            return;
          }
          const signal = youngDependencySignal(depPk, label, publishedAt, parent);
          if (signal) signals.push(signal as VerdictSignal);
        })));
      }
    }

    // Checks the package's download count too, so a small legitimate package
    // with a similar name isn't called a typosquat on spelling alone
    const typosquat = await checkTyposquat(name).catch(() => null);
    if (typosquat) signals.push(typosquat as VerdictSignal);

    const vulns = await osvPromise;
    if (vulns === null) sourceFailures.push('osv');
    else signals.push(...osvSignals(vulns));

    // Tier 2, the tarball diff, only for versions the metadata tier already
    // flagged (and, below it, tier 3 for those same versions). A confirmed-malicious version needs no further proof, and one npm
    // no longer serves has no tarball to read.
    let tierReached: PackageVerdict['tierReached'] = 'metadata';
    if (pk && doc && scoreOf(signals) >= WARN_SCORE && !signals.some((s) => s.type === 'osv_malicious')) {
      const diff = await runDiffTier(pk, version);
      signals.push(...diff.signals);
      if (diff.failure) sourceFailures.push(diff.failure);
      if (diff.reached) tierReached = 'diff';

      // Tier 3, the sandbox, for the same versions once the diff has added its
      // signals: what static reading can't see (obfuscated or conditional code)
      // shows up when the package is actually run. Optional: skipped when no
      // runner is configured, and a runner failure is recorded, never "clean".
      const sandbox = await runSandboxTier(name, version);
      signals.push(...sandbox.signals);
      if (sandbox.failure) sourceFailures.push(sandbox.failure);
      if (sandbox.reached) tierReached = 'sandbox';
    }

    // Strongest evidence first, so the reasons behind a verdict read well
    signals.sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]);
    const score = scoreOf(signals);
    const verdict: PackageVerdict = {
      name, version, integrity: integrityOf(doc),
      verdict: verdictFor(signals, score, sourceFailures),
      score, signals, tierReached,
      analyzedAt: new Date(now).toISOString(),
      fromCache: false, sourceFailures,
    };

    // Only a complete verdict is cached: one built without a source could
    // under-report, and a cache hit would hide that. A removed version is left
    // uncached too, in case it is (re)published later.
    if (sourceFailures.length === 0) await writeCache(verdict);

    return verdict;
  } catch (err) {
    return unchecked(name, version, `analysis-error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
