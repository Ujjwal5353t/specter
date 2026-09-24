import semver from 'semver';
import type { RiskSignal } from '@/types';
import { POPULAR_PACKAGES } from './popularPackages';

// Supply-chain risk heuristics computed from npm registry metadata alone.
// Each check is a yellow flag, not a verdict: several on one package is what matters.

const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH_RELEASE_DAYS = 7;
const YOUNG_PACKAGE_DAYS = 30;
// A publisher change only means something once the package has a track record
const MIN_HISTORY_FOR_PUBLISHER_CHECK = 3;
const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall'];

export interface NpmVersionDoc {
  version: string;
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  _npmUser?: { name?: string };
  dist?: { attestations?: unknown };
}

/** The full registry document for a package (registry.npmjs.org/<name>). */
export interface Packument {
  name: string;
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, NpmVersionDoc>;
  time?: Record<string, string>;
}

export interface VersionAnalysis {
  signals: RiskSignal[];
  publishedAt: number | null;
  /** Dependencies this version declares that the previous version did not. */
  newDeps: string[];
}

function ageText(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

function parseTime(pk: Packument, key: string): number | null {
  const t = pk.time?.[key];
  const ms = t ? Date.parse(t) : NaN;
  return Number.isNaN(ms) ? null : ms;
}

function installHooks(doc: NpmVersionDoc | undefined): string[] {
  return INSTALL_HOOKS.filter((h) => doc?.scripts?.[h]?.trim());
}

/** Highest published version below `version` (same release channel). */
export function previousVersion(pk: Packument, version: string): string | null {
  if (!semver.valid(version)) return null;
  const isPre = semver.prerelease(version) !== null;
  let best: string | null = null;
  for (const v of Object.keys(pk.versions ?? {})) {
    if (!semver.valid(v) || !semver.lt(v, version)) continue;
    if (!isPre && semver.prerelease(v)) continue;
    if (!best || semver.gt(v, best)) best = v;
  }
  return best;
}

export function analyzeVersion(pk: Packument, version: string, now: number): VersionAnalysis {
  const signals: RiskSignal[] = [];
  const doc = pk.versions?.[version];
  const publishedAt = parseTime(pk, version);
  if (!doc) return { signals, publishedAt, newDeps: [] };

  const prevVersion = previousVersion(pk, version);
  const prev = prevVersion ? pk.versions?.[prevVersion] : undefined;
  const label = `${pk.name}@${version}`;

  // 1. First release by someone who never published this package before
  const publisher = doc._npmUser?.name;
  if (publisher && publishedAt !== null) {
    const earlier = Object.values(pk.versions ?? {}).filter((d) => {
      const t = parseTime(pk, d.version);
      return t !== null && t < publishedAt;
    });
    if (
      earlier.length >= MIN_HISTORY_FOR_PUBLISHER_CHECK &&
      !earlier.some((d) => d._npmUser?.name === publisher)
    ) {
      const prevPublisher = prev?._npmUser?.name;
      signals.push({
        type: 'new_publisher',
        severity: 'low',
        title: 'First release by a new publisher',
        detail: `${label} was published by "${publisher}", who never published any of the ${earlier.length} earlier versions` +
          (prevPublisher ? ` (previous release was by "${prevPublisher}").` : '.'),
      });
    }
  }

  // 2. Dependencies that appeared in this release
  let newDeps: string[] = [];
  if (prev && prevVersion) {
    const before = new Set(Object.keys(prev.dependencies ?? {}));
    newDeps = Object.keys(doc.dependencies ?? {}).filter((d) => !before.has(d));
    if (newDeps.length > 0) {
      const isPatch = semver.diff(prevVersion, version) === 'patch';
      signals.push({
        type: 'new_dependency',
        severity: 'low',
        title: isPatch ? 'Dependency added in a patch release' : 'New dependency in this release',
        detail: `${label} added ${newDeps.join(', ')} (not present in ${prevVersion}).` +
          (isPatch ? ' Patch releases should only fix bugs, not pull in new code.' : ''),
      });
    }
  }

  // 3. Released very recently — most malicious versions are pulled within days
  if (publishedAt !== null && now - publishedAt < FRESH_RELEASE_DAYS * DAY_MS) {
    signals.push({
      type: 'fresh_release',
      severity: 'low',
      title: 'Very recent release',
      detail: `${label} was published ${ageText(now - publishedAt)} ago. Compromised versions are usually caught within days.`,
    });
  }

  // 4. Package itself is brand new
  const createdAt = parseTime(pk, 'created');
  if (createdAt !== null && now - createdAt < YOUNG_PACKAGE_DAYS * DAY_MS) {
    signals.push({
      type: 'young_package',
      severity: 'medium',
      title: 'Brand-new package',
      detail: `${pk.name} was first published ${ageText(now - createdAt)} ago and has no track record.`,
    });
  }

  // 5. Runs code automatically during npm install
  const hooks = installHooks(doc);
  if (hooks.length > 0) {
    const added = prev !== undefined && installHooks(prev).length === 0;
    const script = doc.scripts?.[hooks[0]] ?? '';
    signals.push({
      type: 'install_script',
      severity: added ? 'medium' : 'low',
      title: added ? 'Install script added in this release' : 'Runs an install script',
      detail: `${label} runs "${hooks.join(', ')}" on npm install: ${script.substring(0, 80)}` +
        (added ? ` (${prevVersion} had none).` : ''),
    });
  }

  // 6. Earlier release had signed build provenance, this one does not
  if (prev?.dist?.attestations && !doc.dist?.attestations) {
    signals.push({
      type: 'provenance_dropped',
      severity: 'high',
      title: 'Build provenance missing',
      detail: `${prevVersion} was published with signed provenance from its CI pipeline, but ${version} was not — ` +
        'it may have been published from a stolen account rather than the normal build.',
    });
  }

  // Maintainer changes and new dependencies are routine on their own (teams grow,
  // packages evolve). They matter when they coincide with other changes in the same
  // release — the pattern of an account takeover — so only then are they escalated.
  const isMajor = prevVersion !== null && semver.major(version) !== semver.major(prevVersion);
  const has = (type: RiskSignal['type'], severity?: RiskSignal['severity']) =>
    signals.some((s) => s.type === type && (!severity || s.severity === severity));
  const publisherCorroborated =
    has('fresh_release') || has('provenance_dropped') || has('install_script', 'medium') ||
    (newDeps.length > 0 && !isMajor);
  for (const s of signals) {
    if (s.type === 'new_publisher' && publisherCorroborated) s.severity = 'medium';
    if (s.type === 'new_dependency' && has('new_publisher') && !isMajor) s.severity = 'medium';
  }

  return { signals, publishedAt, newDeps };
}

/**
 * Flags a dependency that was added to its parent in the parent's current
 * release while the dependency itself was only days old (flatmap-stream, peacenotwar).
 */
export function youngDependencySignal(
  dep: Packument,
  parentLabel: string,
  parentPublishedAt: number
): RiskSignal | null {
  const createdAt = parseTime(dep, 'created');
  if (createdAt === null) return null;
  const age = parentPublishedAt - createdAt;
  if (age >= YOUNG_PACKAGE_DAYS * DAY_MS) return null;
  return {
    type: 'young_dependency',
    severity: 'high',
    title: 'Newly added dependency was brand new',
    detail: age >= 0
      ? `${dep.name} was only ${ageText(age)} old when ${parentLabel} started depending on it.`
      : `${dep.name} did not exist yet when ${parentLabel} was published.`,
  };
}

// Optimal string alignment distance: Levenshtein plus adjacent transpositions ("lodahs")
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

const POPULAR_SET = new Set(POPULAR_PACKAGES);
const stripSeparators = (s: string) => s.toLowerCase().replace(/[-_./]/g, '');

/** The popular package `name` looks like a misspelling of, if any. */
export function typosquatTarget(name: string): string | null {
  if (POPULAR_SET.has(name) || name.length < 4) return null;
  const bare = stripSeparators(name);
  for (const popular of POPULAR_PACKAGES) {
    if (stripSeparators(popular) === bare) return popular;
    if (Math.abs(popular.length - name.length) <= 1 && editDistance(name, popular) === 1) return popular;
  }
  return null;
}
