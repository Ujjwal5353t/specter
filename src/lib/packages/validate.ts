import semver from 'semver';

// npm's own rule (legacy uppercase names included): optional @scope/, no
// leading dot or underscore, URL-safe characters only, at most 214 chars.
const NAME_RE = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

export function isValidPackageName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 214 && NAME_RE.test(name);
}

/** An exact version only: ranges and dist-tags would each need a registry lookup to resolve. */
export function isValidVersion(version: unknown): version is string {
  return typeof version === 'string' && version.length <= 256 && semver.valid(version) === version;
}
