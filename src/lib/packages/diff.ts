import semver from 'semver';
import type { VerdictSignal } from './analyze';
import { fetchTarball, type Tarball } from './tarball';
import { RULES, hostsIn, type RuleContext } from './rules';
import { previousVersion, type Packument } from '@/lib/scanners/deprisk';

/*
 * Tarball-diff tier (#39): compare a flagged version's files with the previous
 * version's and scan what changed. Text only, never executed (see tarball.ts).
 *
 * It runs only for versions the metadata tier already flagged, so the cost
 * (two downloads, a few hundred KB of regex scanning) is paid rarely, and once
 * per version because the verdict is cached.
 */

const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall'];
const CODE_FILE = /\.(?:[cm]?js|jsx|sh|bash|ps1|bat|cmd)$/i;
// Bound the work per file: only this much added code is scanned
const MAX_ADDED_CHARS = 300_000;
const MAX_LINES = 50_000;
const MAX_FILES_LISTED = 5;
// What the LLM review (#43) is shown: the added code around each rule hit, size-capped
export const HUNK_LIMITS = { hunks: 6, chars: 1500 } as const;

/** The added code behind a diff signal: enough context for a reviewer, never a whole file. */
export interface DiffHunk {
  path: string;
  /** Ids of the rules (or 'diff_install_script') that fired on this code. */
  rules: string[];
  added: string;
}

interface ChangedFile {
  path: string;
  /** Lines present in this version but not in the previous one. */
  added: string;
  isNew: boolean;
}

/** Lines of `text` that are not in `before`, capped. */
function addedLines(text: string, before: string | null): string {
  const seen = before === null ? null : new Set(before.split('\n', MAX_LINES));
  const out: string[] = [];
  let size = 0;
  for (const line of text.split('\n', MAX_LINES)) {
    if (seen?.has(line) || line.trim() === '') continue;
    out.push(line);
    size += line.length + 1;
    if (size >= MAX_ADDED_CHARS) break;
  }
  return out.join('\n').slice(0, MAX_ADDED_CHARS);
}

function readManifest(tarball: Tarball | null): { scripts?: Record<string, string> } | null {
  const text = tarball?.files.get('package.json')?.text;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** A window of `added` around the rule's evidence snippet, or its start when the snippet can't be located. */
function excerptAround(added: string, evidence: string): string {
  // The evidence is one printable line that begins 10 characters before the match
  const at = added.indexOf(evidence.slice(10, 40));
  if (at === -1 || added.length <= HUNK_LIMITS.chars) return added.slice(0, HUNK_LIMITS.chars);
  const from = Math.max(0, at - 400);
  return added.slice(from, from + HUNK_LIMITS.chars);
}

const listFiles = (paths: string[]) =>
  paths.slice(0, MAX_FILES_LISTED).join(', ') + (paths.length > MAX_FILES_LISTED ? `, +${paths.length - MAX_FILES_LISTED} more` : '');

/**
 * Signals from comparing two unpacked tarballs. `prev` is null for a package's
 * first release, which is scanned whole (there is nothing to diff against).
 */
export function scanDiff(prev: Tarball | null, next: Tarball, label: string): VerdictSignal[] {
  return analyzeDiff(prev, next, label).signals;
}

/** scanDiff plus the code behind its signals, for the LLM review. */
export function analyzeDiff(prev: Tarball | null, next: Tarball, label: string): { signals: VerdictSignal[]; hunks: DiffHunk[] } {
  const signals: VerdictSignal[] = [];
  const hunks: DiffHunk[] = [];

  // Files that are new or whose text changed, reduced to just the added lines
  const changed: ChangedFile[] = [];
  const newCodeFiles: string[] = [];
  for (const [path, file] of next.files) {
    const before = prev?.files.get(path);
    if (before && before.sha256 === file.sha256) continue;
    if (!before && prev && CODE_FILE.test(path)) newCodeFiles.push(path);
    if (file.text === null) continue;
    const added = addedLines(file.text, before?.text ?? null);
    if (added) changed.push({ path, added, isNew: !before });
  }

  // Install hooks whose command was rewritten. (A hook that appeared is already
  // reported by the metadata tier's install_script signal.)
  const before = readManifest(prev)?.scripts ?? {};
  const after = readManifest(next)?.scripts ?? {};
  for (const hook of INSTALL_HOOKS) {
    if (before[hook] && after[hook] && before[hook] !== after[hook]) {
      signals.push({
        type: 'diff_install_script',
        severity: 'high',
        title: `Install script "${hook}" was rewritten`,
        detail: `${label}: "${hook}" changed from \`${before[hook].slice(0, 60)}\` to \`${after[hook].slice(0, 60)}\`.`,
      });
      hunks.push({ path: 'package.json', rules: ['diff_install_script'], added: `"${hook}": ${JSON.stringify(after[hook].slice(0, 400))}` });
    }
  }

  if (newCodeFiles.length > 0) {
    signals.push({
      type: 'diff_new_files',
      severity: 'low',
      title: 'New code files in this release',
      detail: `${label} adds ${newCodeFiles.length} code file(s) not in the previous version: ${listFiles(newCodeFiles)}.`,
    });
  }

  if (next.unsafeEntries > 0) {
    signals.push({
      type: 'archive_anomaly',
      severity: 'medium',
      title: 'Archive contains entries with unsafe paths',
      detail: `${label}'s tarball has ${next.unsafeEntries} entr${next.unsafeEntries === 1 ? 'y' : 'ies'} with absolute or "../" paths, which a normal npm publish never produces.`,
    });
  }

  // Static rules, one signal per rule across all changed files
  const prevHosts = new Set<string>();
  for (const file of prev?.files.values() ?? []) if (file.text) for (const h of hostsIn(file.text)) prevHosts.add(h);
  const ctx: RuleContext = { prevHosts };
  const fired = new Map<string, { file: ChangedFile; rules: string[]; evidence: string }>();
  for (const rule of RULES) {
    const hits: { path: string; evidence: string }[] = [];
    for (const file of changed) {
      const evidence = rule.detect(file.added, ctx);
      if (!evidence) continue;
      hits.push({ path: file.path, evidence });
      const seen = fired.get(file.path);
      if (seen) seen.rules.push(rule.id);
      else fired.set(file.path, { file, rules: [rule.id], evidence });
    }
    if (hits.length === 0) continue;
    signals.push({
      type: 'diff_rule',
      rule: rule.id,
      severity: rule.severity,
      title: rule.title,
      detail: `${label} — in ${listFiles(hits.map((h) => h.path))}: "${hits[0].evidence}"`,
    });
  }

  // Files hit by the most rules first; the reviewer only ever sees these
  const room = HUNK_LIMITS.hunks - hunks.length;
  for (const { file, rules, evidence } of [...fired.values()].sort((a, b) => b.rules.length - a.rules.length).slice(0, Math.max(0, room))) {
    hunks.push({ path: file.path, rules, added: excerptAround(file.added, evidence) });
  }
  return { signals, hunks };
}

export interface DiffTierResult {
  signals: VerdictSignal[];
  /** The added code behind the signals, size-capped; input for the LLM review. */
  hunks: DiffHunk[];
  /** Set when a download failed for a transient reason; the verdict must not be cached. */
  failure?: string;
  /** True when the tier ran (or was deterministically skipped), so tierReached can move to 'diff'. */
  reached: boolean;
}

const skippedSignal = (label: string, reason: string): VerdictSignal => ({
  type: 'diff_skipped',
  severity: 'info',
  title: 'Tarball diff skipped',
  detail: `${label}: ${reason}.`,
});

/**
 * Runs the diff tier for `version`: fetches its tarball and the previous
 * version's, and returns diff signals. Never throws.
 */
export async function runDiffTier(pk: Packument, version: string): Promise<DiffTierResult> {
  const label = `${pk.name}@${version}`;
  try {
    const dist = pk.versions?.[version]?.dist;
    if (!dist?.tarball) return { signals: [skippedSignal(label, 'the registry lists no tarball for this version')], hunks: [], reached: true };

    const prevVersion = semver.valid(version) ? previousVersion(pk, version) : null;
    const prevDist = prevVersion ? pk.versions?.[prevVersion]?.dist : undefined;

    const [next, prev] = await Promise.all([
      fetchTarball(dist.tarball, dist.unpackedSize),
      prevDist?.tarball ? fetchTarball(prevDist.tarball, prevDist.unpackedSize) : Promise.resolve(null),
    ]);

    if (!next.ok) {
      return next.kind === 'failed'
        ? { signals: [], hunks: [], failure: 'tarball', reached: false }
        : { signals: [skippedSignal(label, next.reason)], hunks: [], reached: true };
    }
    if (prev && !prev.ok) {
      return prev.kind === 'failed'
        ? { signals: [], hunks: [], failure: 'tarball:previous', reached: false }
        : { signals: [skippedSignal(label, `previous version ${prevVersion}: ${prev.reason}`)], hunks: [], reached: true };
    }
    return { ...analyzeDiff(prev?.ok ? prev.tarball : null, next.tarball, label), reached: true };
  } catch (err) {
    return { signals: [], hunks: [], failure: `tarball: ${err instanceof Error ? err.message : String(err)}`, reached: false };
  }
}
