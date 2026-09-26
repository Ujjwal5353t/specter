/**
 * package-lock.json (lockfileVersion 2 or 3) → the list of registry packages
 * that would be installed. Shared by the lockfile check API, the specter-guard
 * CLI (via the API) and the PR check.
 */

import { isValidPackageName, isValidVersion } from './validate';

export interface LockfilePackage {
  name: string;
  version: string;
  /** Tarball integrity recorded in the lockfile; lets the cache be read without a registry call. */
  integrity?: string;
}

export interface ParsedLockfile {
  packages: LockfilePackage[];
  /** Entries left out: workspace links, git/file/tarball URLs and private-registry packages. */
  skipped: number;
  lockfileVersion: number;
}

export class LockfileError extends Error {}

interface LockEntry {
  name?: unknown;
  version?: unknown;
  resolved?: unknown;
  integrity?: unknown;
  link?: unknown;
}

// Hosts whose package names mean the same thing on registry.npmjs.org.
const PUBLIC_REGISTRY_HOSTS = new Set(['registry.npmjs.org', 'registry.yarnpkg.com']);

const NM = 'node_modules/';

/** `node_modules/a/node_modules/@s/b` → `@s/b` (the last segment chain). */
function nameFromPath(key: string): string | null {
  const i = key.lastIndexOf(NM);
  if (i === -1) return null;
  const name = key.slice(i + NM.length);
  return name || null;
}

/** True for a plain registry tarball URL, or no URL at all (bundled dependencies). */
function isPublicRegistry(resolved: unknown): boolean {
  if (resolved === undefined) return true;
  if (typeof resolved !== 'string') return false;
  try {
    const u = new URL(resolved);
    return u.protocol === 'https:' && PUBLIC_REGISTRY_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export function parseLockfile(input: unknown): ParsedLockfile {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new LockfileError('Body must be the contents of a package-lock.json object.');
  }
  const lock = input as { lockfileVersion?: unknown; packages?: unknown };
  const lockfileVersion = typeof lock.lockfileVersion === 'number' ? lock.lockfileVersion : 0;

  if (lockfileVersion < 2 || !lock.packages || typeof lock.packages !== 'object') {
    throw new LockfileError(
      'Only package-lock.json lockfileVersion 2 or 3 is supported (npm 7 or newer). ' +
        'Regenerate it with `npm install --package-lock-only`.',
    );
  }

  const seen = new Set<string>();
  const packages: LockfilePackage[] = [];
  let skipped = 0;

  for (const [key, raw] of Object.entries(lock.packages as Record<string, LockEntry>)) {
    if (key === '') continue; // the root project itself
    const entry = raw ?? {};
    // `name` is set when the install path is an alias for a differently named package
    const name = typeof entry.name === 'string' && entry.name ? entry.name : nameFromPath(key);
    const version = entry.version;

    // The lockfile can come from an untrusted pull request, so anything that is not a
    // well-formed name and exact version is dropped before it is checked or echoed back.
    if (!isValidPackageName(name) || !isValidVersion(version) || entry.link === true || !isPublicRegistry(entry.resolved)) {
      skipped++;
      continue;
    }
    const id = `${name}@${version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    packages.push({
      name,
      version,
      integrity: typeof entry.integrity === 'string' ? entry.integrity : undefined,
    });
  }

  return { packages, skipped, lockfileVersion };
}
