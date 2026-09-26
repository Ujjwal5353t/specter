import { octokit, githubErrorStatus } from '@/lib/github';
import { checkLockfile, type LockfileCheck, type PackageCheck } from './checkService';
import { LockfileError, parseLockfile, type LockfilePackage } from './lockfile';

/**
 * PR check (#36): when a pull request changes package-lock.json, check only the
 * packages it adds or bumps and report on the PR as a commit status
 * (`specter/packages`) plus a single comment that is updated in place.
 * Called from the signed webhook via after(), so it has the rest of that
 * function's 60 s to work with and never blocks GitHub's delivery.
 */

export const LOCKFILE_PATH = 'package-lock.json';
export const STATUS_CONTEXT = 'specter/packages';
const COMMENT_MARKER = '<!-- specter-package-check -->';
// Leaves room in the 60 s function limit for the GitHub calls before and after.
const PR_CHECK_BUDGET_MS = 35_000;
const MAX_FILE_PAGES = 30; // 100 files per page: GitHub lists at most 3000 files per PR
const MAX_COMMENT_ROWS = 20;

export interface PullRequestTarget {
  owner: string;
  repo: string;
  number: number;
  baseSha: string;
  headSha: string;
}

type StatusState = 'pending' | 'success' | 'failure' | 'error';

// ── GitHub reads ─────────────────────────────────────────────────────────

async function lockfileChanged(t: PullRequestTarget): Promise<boolean> {
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    const { data } = await octokit.pulls.listFiles({ owner: t.owner, repo: t.repo, pull_number: t.number, per_page: 100, page });
    if (data.some((f) => f.filename === LOCKFILE_PATH)) return true;
    if (data.length < 100) return false;
  }
  return false;
}

/** File text at a commit, or null when it does not exist there. */
async function readAtRef(t: PullRequestTarget, ref: string): Promise<string | null> {
  try {
    const res = await octokit.repos.getContent({ owner: t.owner, repo: t.repo, path: LOCKFILE_PATH, ref });
    if (Array.isArray(res.data) || res.data.type !== 'file') return null;
    if (res.data.content) return Buffer.from(res.data.content, 'base64').toString('utf-8');
    // Over 1 MB the contents API sends no body; the blob endpoint serves up to 100 MB
    const blob = await octokit.git.getBlob({ owner: t.owner, repo: t.repo, file_sha: res.data.sha });
    return Buffer.from(blob.data.content, 'base64').toString('utf-8');
  } catch (err) {
    if (githubErrorStatus(err) === 404) return null;
    throw err;
  }
}

// ── Diff ─────────────────────────────────────────────────────────────────

/** Packages present in the head lockfile that the base one did not already have at that exact version. */
export function changedPackages(baseText: string | null, headText: string): { changed: LockfilePackage[]; skipped: number } {
  const head = parseLockfile(JSON.parse(headText));
  const known = new Set<string>();
  if (baseText) {
    try {
      for (const p of parseLockfile(JSON.parse(baseText)).packages) known.add(`${p.name}@${p.version}`);
    } catch {
      // A base that cannot be parsed just means everything in head counts as new
    }
  }
  return { changed: head.packages.filter((p) => !known.has(`${p.name}@${p.version}`)), skipped: head.skipped };
}

// ── Reporting ────────────────────────────────────────────────────────────

function flagged(result: LockfileCheck): PackageCheck[] {
  return result.packages.filter((p) => p.verdict === 'block' || p.verdict === 'warn');
}

export function statusFor(result: LockfileCheck, changedCount: number): { state: StatusState; description: string } {
  const { block, warn, pending } = result.counts;
  const unchecked = pending > 0 ? `; ${pending} not checked in time` : '';
  if (block > 0) {
    const names = result.packages.filter((p) => p.verdict === 'block').map((p) => `${p.name}@${p.version}`);
    return { state: 'failure', description: `Blocked: ${names.join(', ')}${unchecked}`.slice(0, 140) };
  }
  if (warn > 0) return { state: 'success', description: `${warn} of ${changedCount} new package(s) have warnings${unchecked}` };
  return {
    state: 'success',
    description: pending > 0
      ? `${changedCount - pending} of ${changedCount} new package(s) checked, nothing flagged${unchecked}`
      : `${changedCount} new package(s) checked, nothing flagged`,
  };
}

/** Plain text made safe for a markdown table cell inside a code span: package data is untrusted. */
const code = (s: string) => `\`${s.replace(/[`|\r\n]/g, ' ').slice(0, 120)}\``;

export function commentFor(result: LockfileCheck | null, changedCount: number): string {
  if (!result || flagged(result).length === 0) {
    return `${COMMENT_MARKER}\n### Specter: nothing flagged\nThe packages added or changed in this pull request's \`${LOCKFILE_PATH}\` are no longer flagged.`;
  }
  const rows = flagged(result);
  const shown = rows.slice(0, MAX_COMMENT_ROWS).map((p) => {
    // Titles and advisory ids only: `detail` can carry text written by a package's publisher
    const why = p.signals
      .filter((s) => s.severity !== 'info')
      .slice(0, 3)
      .map((s) => `${code(s.title)}${s.advisoryId && !s.title.includes(s.advisoryId) ? ` (${code(s.advisoryId)})` : ''}`)
      .join('<br>');
    return `| **${p.verdict}** | ${code(`${p.name}@${p.version}`)} | ${why || '-'} |`;
  });
  const { block, warn } = result.counts;
  const title = [block > 0 && `${block} blocked`, warn > 0 && `${warn} with warnings`].filter(Boolean).join(', ');
  return [
    COMMENT_MARKER,
    `### Specter: ${title} among ${changedCount} new package(s)`,
    '',
    '| Verdict | Package | Signals |',
    '| --- | --- | --- |',
    ...shown,
    ...(rows.length > MAX_COMMENT_ROWS ? [`| | _…and ${rows.length - MAX_COMMENT_ROWS} more_ | |`] : []),
    '',
    `_Only packages added or changed in this pull request's \`${LOCKFILE_PATH}\` were checked. Verdicts are risk signals, not guarantees._`,
  ].join('\n');
}

async function findOwnComment(t: PullRequestTarget): Promise<number | null> {
  for (let page = 1; page <= 5; page++) {
    const { data } = await octokit.issues.listComments({ owner: t.owner, repo: t.repo, issue_number: t.number, per_page: 100, page });
    const hit = data.find((c) => c.body?.includes(COMMENT_MARKER));
    if (hit) return hit.id;
    if (data.length < 100) return null;
  }
  return null;
}

/** One comment per PR, edited on each push. A clean result only edits a comment that already exists. */
async function upsertComment(t: PullRequestTarget, result: LockfileCheck | null, changedCount: number) {
  const isFlagged = result !== null && flagged(result).length > 0;
  const existing = await findOwnComment(t);
  if (existing === null && !isFlagged) return;
  const body = commentFor(result, changedCount);
  if (existing !== null) {
    try {
      await octokit.issues.updateComment({ owner: t.owner, repo: t.repo, comment_id: existing, body });
      return;
    } catch (err) {
      // Someone else's comment that merely contains the marker: fall through and post our own
      if (githubErrorStatus(err) !== 403) throw err;
    }
  }
  await octokit.issues.createComment({ owner: t.owner, repo: t.repo, issue_number: t.number, body });
}

// ── Entry point ──────────────────────────────────────────────────────────

/** Returns a short outcome label (for logs and tests). Never throws. */
export async function runPullRequestCheck(t: PullRequestTarget): Promise<string> {
  const setStatus = async (state: StatusState, description: string) => {
    try {
      await octokit.repos.createCommitStatus({
        owner: t.owner, repo: t.repo, sha: t.headSha, state, context: STATUS_CONTEXT, description: description.slice(0, 140),
      });
    } catch (err) {
      console.error(`PR check: could not set status on ${t.owner}/${t.repo}@${t.headSha.slice(0, 7)}:`, err instanceof Error ? err.message : err);
    }
  };

  try {
    // No lockfile change: do nothing at all, not even a status
    if (!(await lockfileChanged(t))) return 'no-lockfile-change';

    await setStatus('pending', 'Checking new packages…');
    const [baseText, headText] = await Promise.all([readAtRef(t, t.baseSha), readAtRef(t, t.headSha)]);
    if (headText === null) {
      await setStatus('success', `No ${LOCKFILE_PATH} in this pull request`);
      return 'no-head-lockfile';
    }

    let diff: ReturnType<typeof changedPackages>;
    try {
      diff = changedPackages(baseText, headText);
    } catch (err) {
      const reason = err instanceof LockfileError ? err.message : `${LOCKFILE_PATH} is not valid JSON`;
      await setStatus('error', reason);
      return 'unsupported-lockfile';
    }
    if (diff.changed.length === 0) {
      await setStatus('success', 'No new or changed packages');
      await upsertComment(t, null, 0).catch(() => {});
      return 'no-package-changes';
    }

    const { result } = await checkLockfile(diff.changed, PR_CHECK_BUDGET_MS);
    const { state, description } = statusFor(result, diff.changed.length);
    await setStatus(state, description);
    await upsertComment(t, result, diff.changed.length).catch((err) =>
      console.error(`PR check: could not comment on ${t.owner}/${t.repo}#${t.number}:`, err instanceof Error ? err.message : err),
    );
    return state === 'failure' ? 'blocked' : result.counts.warn > 0 ? 'warned' : 'clean';
  } catch (err) {
    console.error(`PR check failed for ${t.owner}/${t.repo}#${t.number}:`, err instanceof Error ? err.message : err);
    await setStatus('error', 'Specter could not complete the check');
    return 'error';
  }
}
