import { Octokit } from '@octokit/rest';

export const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  request: { timeout: 10000 },
});

// HTTP status of an Octokit request error, or undefined for anything else
export function githubErrorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
}

export function parseRepoUrl(url: string): { owner: string; repo: string } {
  const cleaned = url
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  const parts = cleaned.split('/');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error('Invalid GitHub URL. Use: https://github.com/owner/repo');
  }
  return { owner: parts[0], repo: parts[1] };
}

// Confirms the repo exists and is readable with our token. Scanners swallow
// API errors and return empty results, so without this gate a private or
// misspelled repo would score as "clean" instead of failing.
export async function checkRepoAccess(
  owner: string,
  repo: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await octokit.repos.get({ owner, repo });
    return { ok: true };
  } catch (err) {
    const status = githubErrorStatus(err);
    const rateLimited =
      (err as { response?: { headers?: Record<string, string> } }).response?.headers?.[
        'x-ratelimit-remaining'
      ] === '0';
    if (status === 404) {
      return {
        ok: false,
        reason: `Repository ${owner}/${repo} was not found or is private. Specter can only scan public repos.`,
      };
    }
    if ((status === 403 || status === 429) && rateLimited) {
      return { ok: false, reason: 'GitHub API rate limit reached. Try again in a few minutes.' };
    }
    if (status === 401 || status === 403) {
      return { ok: false, reason: `Access to ${owner}/${repo} was denied by GitHub.` };
    }
    return { ok: false, reason: `Could not reach GitHub to access ${owner}/${repo}.` };
  }
}

// In-memory cache to avoid redundant GitHub API calls within the same scan
const fileCache = new Map<string, string | null>();

export async function getFileContent(
  owner: string,
  repo: string,
  path: string
): Promise<string | null> {
  const key = `${owner}/${repo}/${path}`;
  if (fileCache.has(key)) return fileCache.get(key)!;
  try {
    const res = await octokit.repos.getContent({ owner, repo, path });
    if (Array.isArray(res.data) || res.data.type !== 'file') {
      fileCache.set(key, null);
      return null;
    }
    const content = Buffer.from(res.data.content, 'base64').toString('utf-8');
    fileCache.set(key, content);
    return content;
  } catch (err) {
    // Only a 404 means "file doesn't exist". Anything else (rate limit, repo
    // gone private mid-scan, network) must fail the scan, not read as absent.
    if (githubErrorStatus(err) !== 404) throw err;
    fileCache.set(key, null);
    return null;
  }
}

export async function getRepoTree(
  owner: string,
  repo: string
): Promise<{ path: string; type: string }[]> {
  const ref = await octokit.repos.get({ owner, repo });
  const defaultBranch = ref.data.default_branch;
  try {
    const res = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: defaultBranch,
      recursive: 'true',
    });
    return res.data.tree
      .filter((f) => f.type === 'blob')
      .map((f) => ({ path: f.path || '', type: f.type || '' }));
  } catch (err) {
    // 409 = repo has no commits yet: a genuinely empty tree
    if (githubErrorStatus(err) === 409) return [];
    throw err;
  }
}

export function clearFileCache() {
  fileCache.clear();
}
