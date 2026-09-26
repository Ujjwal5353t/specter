/**
 * Cooldown and allowlist — issue #42.
 *
 * "Most compromised versions are pulled within hours, so holding brand-new
 * versions is a cheap and effective rule."
 *
 * This module is intentionally pure (no I/O, no side-effects) so it can be
 * unit-tested without mocking anything and called from both the Check API
 * and the lockfile route.
 *
 * Flow
 * ────
 * 1. Caller passes `CooldownOptions` alongside the package name/version.
 * 2. `resolveCooldown()` decides:
 *    a. If the package is on the allowlist → `{ kind: 'allowed', entry }`.
 *    b. If `minReleaseAgeHours` is not set or the version is old enough → `{ kind: 'pass' }`.
 *    c. Otherwise → `{ kind: 'held', ageMs, minAgeMs }`.
 * 3. The verdict engine in `analyze.ts` calls `resolveCooldown()` after it
 *    fetches the packument (which carries the publish timestamp), then either
 *    injects a `too_new` signal or short-circuits with the allowlist override.
 */

/** One entry in the `allow` list: an exact `name@version` string. */
export type AllowEntry = `${string}@${string}`;

/**
 * Options the caller passes to enable the cooldown feature.
 *
 * All fields are optional so callers that don't use the feature pay zero cost:
 *   - omitting `minReleaseAgeHours` (or passing 0 / undefined) is identical
 *     to the pre-#42 behaviour.
 *   - `allow` entries are matched case-sensitively against `name@version`.
 *   - `strict` promotes a `too_new` hold from `warn` to `block`.
 */
export interface CooldownOptions {
  /**
   * Minimum age (in hours) a published version must be before it is allowed.
   * Default: 0 (feature off). Values ≤ 0 disable the cooldown.
   */
  minReleaseAgeHours?: number;
  /**
   * When true, a version that is too new returns `block` instead of `warn`.
   * Default: false.
   */
  strict?: boolean;
  /**
   * Exact `name@version` strings that bypass the cooldown check.
   * Example: `["lodash@4.17.21", "@scope/pkg@1.0.0"]`
   */
  allow?: AllowEntry[];
}

// ── Result types ─────────────────────────────────────────────────────────────

/** The allowlist entry that matched (the exact `name@version` string). */
export interface CooldownAllowed {
  kind: 'allowed';
  /** The allowlist entry that matched, for display in the response. */
  entry: AllowEntry;
}

/** Version is old enough (or feature is off). Proceed normally. */
export interface CooldownPass {
  kind: 'pass';
}

/** Version is too new and not allowlisted. Inject a signal / hold. */
export interface CooldownHeld {
  kind: 'held';
  /** How old the version actually is, in milliseconds. */
  ageMs: number;
  /** The required minimum age, in milliseconds. */
  minAgeMs: number;
}

export type CooldownResult = CooldownAllowed | CooldownPass | CooldownHeld;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Formats a millisecond duration as a human-readable string ("2 hours", "30 minutes"). */
export function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Normalises an allowlist entry.
 * npm package names are case-sensitive, but a trailing whitespace typo should
 * not cause a silent miss, so we only trim — no lowercasing.
 */
function normalise(entry: string): string {
  return entry.trim();
}

/**
 * Checks whether `name@version` appears in `allow`.
 * Returns the matching entry string if found, otherwise null.
 */
function matchAllowlist(
  name: string,
  version: string,
  allow: AllowEntry[] | undefined,
): AllowEntry | null {
  if (!allow || allow.length === 0) return null;
  const target = normalise(`${name}@${version}`);
  for (const entry of allow) {
    if (normalise(entry) === target) return entry;
  }
  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Decides whether a `name@version` is held by the cooldown.
 *
 * @param name         npm package name
 * @param version      exact semver version string
 * @param publishedAt  Unix timestamp (ms) when this version was published on
 *                     npm, or `null` if the registry didn't report it.
 *                     When `null` and a cooldown is configured, we cannot
 *                     verify age → the package is held (treat unknown as new).
 * @param now          Current time (ms). Pass `Date.now()` in production;
 *                     injectable for tests.
 * @param opts         Cooldown configuration from the caller.
 */
export function resolveCooldown(
  name: string,
  version: string,
  publishedAt: number | null,
  now: number,
  opts: CooldownOptions,
): CooldownResult {
  const minHours = opts.minReleaseAgeHours ?? 0;

  // Feature is off → always pass
  if (minHours <= 0) return { kind: 'pass' };

  const minAgeMs = minHours * 60 * 60 * 1000;

  // Allowlist check runs before everything else so a pinned version is never held
  const matched = matchAllowlist(name, version, opts.allow);
  if (matched) return { kind: 'allowed', entry: matched };

  // Unknown publish time → treat as "just published" to avoid bypassing the hold
  const ageMs = publishedAt !== null ? now - publishedAt : 0;

  if (ageMs >= minAgeMs) return { kind: 'pass' };

  return { kind: 'held', ageMs, minAgeMs };
}

/**
 * Parses and validates caller-supplied cooldown options from a raw JSON body.
 * Returns `{ ok: true, opts }` or `{ ok: false, error, message }`.
 *
 * Designed to be used by both the /check and /check/lockfile route handlers.
 */
export function parseCooldownOptions(body: unknown): (
  | { ok: true; opts: CooldownOptions }
  | { ok: false; error: string; message: string }
) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_body', message: 'Request body must be a JSON object.' };
  }
  const raw = body as Record<string, unknown>;

  // minReleaseAgeHours
  let minReleaseAgeHours: number | undefined;
  if ('minReleaseAgeHours' in raw) {
    const v = raw['minReleaseAgeHours'];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return {
        ok: false,
        error: 'invalid_option',
        message: '`minReleaseAgeHours` must be a non-negative finite number (e.g. 24).',
      };
    }
    // Cap at 1 year — anything larger is almost certainly a mistake
    if (v > 8760) {
      return {
        ok: false,
        error: 'invalid_option',
        message: '`minReleaseAgeHours` must not exceed 8760 (1 year).',
      };
    }
    minReleaseAgeHours = v;
  }

  // strict
  let strict: boolean | undefined;
  if ('strict' in raw) {
    if (typeof raw['strict'] !== 'boolean') {
      return { ok: false, error: 'invalid_option', message: '`strict` must be a boolean.' };
    }
    strict = raw['strict'];
  }

  // allow
  let allow: AllowEntry[] | undefined;
  if ('allow' in raw) {
    const a = raw['allow'];
    if (!Array.isArray(a)) {
      return { ok: false, error: 'invalid_option', message: '`allow` must be an array of "name@version" strings.' };
    }
    if (a.length > 500) {
      return { ok: false, error: 'invalid_option', message: '`allow` must contain at most 500 entries.' };
    }
    for (let i = 0; i < a.length; i++) {
      const entry = a[i];
      if (typeof entry !== 'string') {
        return { ok: false, error: 'invalid_option', message: `\`allow[${i}]\` must be a string like "lodash@4.17.21".` };
      }
      // Must contain at least one "@" that isn't the leading scope "@"
      const atIdx = entry.lastIndexOf('@');
      if (atIdx <= 0) {
        return { ok: false, error: 'invalid_option', message: `\`allow[${i}]\` must be "name@version" (e.g. "lodash@4.17.21"). Got: "${entry}".` };
      }
    }
    allow = a as AllowEntry[];
  }

  return { ok: true, opts: { minReleaseAgeHours, strict, allow } };
}
