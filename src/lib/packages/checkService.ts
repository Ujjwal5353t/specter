import { analyzePackage, type PackageVerdict, type Verdict } from './analyze';
import type { LockfilePackage } from './lockfile';

/**
 * What the public check API returns, built on analyzePackage(). Shared by
 * POST /api/v1/check, POST /api/v1/check/lockfile and the PR check so all
 * three apply the same rules for time budgets, partial results and pending.
 */

// Vercel kills the function at 60 s (maxDuration on the routes). Stay well
// inside it so the response always gets out; work still in flight is reported
// as `pending` and finishes into the cache for the next call.
export const SINGLE_BUDGET_MS = 30_000;
export const LOCKFILE_BUDGET_MS = 45_000;
const LOCKFILE_CONCURRENCY = 12;

export const MAX_LOCKFILE_PACKAGES = 2000;
export const MAX_BODY_BYTES = 6 * 1024 * 1024;

export type CheckVerdict = Verdict | 'pending';

export interface ApiSignal {
  type: string;
  severity: string;
  title: string;
  detail: string;
  advisoryId?: string;
}

export interface PackageCheck {
  name: string;
  version: string;
  verdict: CheckVerdict;
  score: number | null;
  signals: ApiSignal[];
  analyzedAt: string | null;
}

export interface LockfileCheck {
  verdict: Verdict;
  /** False when the time budget ran out: some packages are still `pending`. */
  complete: boolean;
  counts: Record<CheckVerdict, number>;
  packages: PackageCheck[];
}

// ── Input validation ─────────────────────────────────────────────────────

export { isValidPackageName, isValidVersion } from './validate';

// ── Verdict → API shape ──────────────────────────────────────────────────

type Mapped = { kind: 'ok'; check: PackageCheck } | { kind: 'not_found' };

/**
 * A verdict that rests on a source that could not be reached is never an
 * `allow`: it is a `warn` that says why, so an outage never reads as clean.
 */
function toCheck(v: PackageVerdict): Mapped {
  const signals: ApiSignal[] = v.signals.map((s) => ({
    type: s.type, severity: s.severity, title: s.title, detail: s.detail,
    ...(s.advisoryId ? { advisoryId: s.advisoryId } : {}),
  }));
  let verdict: Verdict = v.verdict;
  let score = v.score;

  // analyzePackage already turns any failed source into `warn`; what is added
  // here is the reason, so the caller sees why. A version the registry lacks and
  // no advisory covers is a plain not-found rather than a warning.
  if (v.sourceFailures.includes('version-not-found') && v.signals.length === 0) return { kind: 'not_found' };
  if (verdict !== 'block' && v.sourceFailures.length > 0) {
    verdict = 'warn';
    score = Math.max(score, 4);
    signals.push({
      type: 'unverified',
      severity: 'medium',
      title: 'Some checks could not run',
      detail: `Could not reach: ${v.sourceFailures.join(', ')}. No verdict can be trusted until they are back; try again.`,
    });
  }
  return {
    kind: 'ok',
    check: { name: v.name, version: v.version, verdict, score, signals, analyzedAt: v.analyzedAt },
  };
}

function pendingCheck(name: string, version: string): PackageCheck {
  return { name, version, verdict: 'pending', score: null, signals: [], analyzedAt: null };
}

/** analyzePackage never throws, but a bug in it must not take the whole request down. */
function safeAnalyze(name: string, version: string, integrity?: string): Promise<Mapped> {
  return analyzePackage(name, version, { integrity })
    .then(toCheck)
    .catch((): Mapped => ({
      kind: 'ok',
      check: {
        name, version, verdict: 'warn', score: 4, analyzedAt: null,
        signals: [{ type: 'unverified', severity: 'medium', title: 'Check failed', detail: 'The analysis failed unexpectedly; try again.' }],
      },
    }));
}

const TIMED_OUT = Symbol('timed-out');

function raceDeadline<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), Math.max(ms, 0)); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

// ── Single package ───────────────────────────────────────────────────────

export type SingleResult =
  | { kind: 'done'; check: PackageCheck }
  | { kind: 'not_found' }
  /** `background` is the still-running analysis; hand it to after() so it can finish into the cache. */
  | { kind: 'pending'; check: PackageCheck; background: Promise<unknown> };

export async function checkPackage(name: string, version: string, budgetMs = SINGLE_BUDGET_MS): Promise<SingleResult> {
  const work = safeAnalyze(name, version);
  const out = await raceDeadline(work, budgetMs);
  if (out === TIMED_OUT) return { kind: 'pending', check: pendingCheck(name, version), background: work };
  return out.kind === 'ok' ? { kind: 'done', check: out.check } : { kind: 'not_found' };
}

// ── Whole lockfile ───────────────────────────────────────────────────────

const ORDER: Record<CheckVerdict, number> = { block: 0, warn: 1, pending: 2, allow: 3 };

export async function checkLockfile(
  packages: LockfilePackage[],
  budgetMs = LOCKFILE_BUDGET_MS,
): Promise<{ result: LockfileCheck; background: Promise<unknown> }> {
  const deadline = Date.now() + budgetMs;
  const checks: PackageCheck[] = packages.map((p) => pendingCheck(p.name, p.version));
  const inflight: Promise<unknown>[] = [];
  let next = 0;

  // A fixed pool works through the list; whatever it hasn't reached when the
  // budget runs out stays `pending` and is picked up by the next call, which
  // finds everything finished so far in the cache.
  const worker = async () => {
    while (next < packages.length && Date.now() < deadline) {
      const i = next++;
      const p = packages[i];
      const work = safeAnalyze(p.name, p.version, p.integrity);
      const out = await raceDeadline(work, deadline - Date.now());
      if (out === TIMED_OUT) {
        inflight.push(work);
        return;
      }
      checks[i] = out.kind === 'ok'
        ? out.check
        : {
            name: p.name, version: p.version, verdict: 'warn', score: 4, analyzedAt: null,
            signals: [{ type: 'unverified', severity: 'medium', title: 'Not found in the npm registry', detail: `${p.name}@${p.version} is not published on registry.npmjs.org, so it could not be checked.` }],
          };
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOCKFILE_CONCURRENCY, packages.length) }, worker));

  const counts: Record<CheckVerdict, number> = { allow: 0, warn: 0, block: 0, pending: 0 };
  for (const c of checks) counts[c.verdict]++;
  // Incomplete results never report `allow`: unchecked packages are unknown, not clean.
  const verdict: Verdict = counts.block > 0 ? 'block' : counts.warn > 0 || counts.pending > 0 ? 'warn' : 'allow';

  checks.sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || a.name.localeCompare(b.name));
  return {
    result: { verdict, complete: counts.pending === 0, counts, packages: checks },
    background: Promise.allSettled(inflight),
  };
}
