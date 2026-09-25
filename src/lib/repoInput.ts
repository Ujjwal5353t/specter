// Normalizes what a user types into the landing page's repository field to an
// `owner/repo` slug. Accepts `https://github.com/owner/repo`,
// `github.com/owner/repo` and `owner/repo`, tolerating `www.`, a trailing
// `.git` or slash, and deeper paths such as `/tree/main` or `?tab=readme`.
// Returns null when no owner/repo pair can be read.
export function toRepoSlug(input: string): string | null {
  const cleaned = input
    .trim()
    .replace(/^git\+/, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[?#].*$/, '');

  // A host other than github.com (e.g. gitlab.com/owner/repo) isn't a
  // repository we can scan; a bare `owner/repo` has no host at all.
  const hostless = /^github\.com\//i.test(cleaned)
    ? cleaned.replace(/^github\.com\//i, '')
    : /^[^/]*\.[a-z]{2,}\//i.test(cleaned) ? null : cleaned;
  if (hostless === null) return null;

  const [owner, rawRepo] = hostless.split('/');
  const repo = rawRepo?.replace(/\.git$/i, '');
  // GitHub owner and repo names: letters, digits, '-', '_' and '.'.
  const valid = /^[A-Za-z0-9_.-]+$/;
  if (!owner || !repo || !valid.test(owner) || !valid.test(repo)) return null;
  return `${owner}/${repo}`;
}

// The URL shape the /api/scan/start contract expects.
export function toRepoUrl(slug: string): string {
  return `https://github.com/${slug}`;
}
