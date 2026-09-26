import type { ScanListItem } from './store';
import { C, repoSlug } from './theme';

export interface RepoHistory {
  repo_url: string;
  latest: ScanListItem | null;
  previous: ScanListItem | null;
  running: ScanListItem | null;
  lastFailed: ScanListItem | null;
  lastActivity: string;
  /** Completed scores over the window, oldest first. */
  points: { t: string; score: number }[];
  scans: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** Per-repo view of the scan history (input newest-first, as /api/scans returns it). */
export function repoHistories(scans: ScanListItem[], windowDays = 30): RepoHistory[] {
  const byRepo = new Map<string, ScanListItem[]>();
  for (const s of scans) {
    if (!byRepo.has(s.repo_url)) byRepo.set(s.repo_url, []);
    byRepo.get(s.repo_url)!.push(s);
  }
  const since = Date.now() - windowDays * DAY;
  return [...byRepo.entries()].map(([repo_url, list]) => {
    const completed = list.filter((s) => s.status === 'completed' && s.threat_score != null);
    const running = list.find((s) => s.status === 'scanning' || s.status === 'pending') ?? null;
    return {
      repo_url,
      latest: completed[0] ?? null,
      previous: completed[1] ?? null,
      running,
      lastFailed: list[0]?.status === 'failed' ? list[0] : null,
      lastActivity: list[0].created_at,
      points: completed.filter((s) => new Date(s.created_at).getTime() >= since).reverse()
        .map((s) => ({ t: s.created_at, score: s.threat_score! })),
      scans: list.length,
    };
  }).sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
}

export interface OpsEvent {
  id: string;
  t: string;
  kind: 'SCAN' | 'RISE' | 'DROP' | 'CACHE' | 'FAILED' | 'RUNNING';
  color: string;
  repo: string;
  msg: string;
  scanId: string;
  delta: number | null;
}

/** Operations log: every scan row as an event, scored against the repo's previous completed scan. */
export function opsEvents(scans: ScanListItem[]): OpsEvent[] {
  const prevScore = new Map<string, number>();
  const events: OpsEvent[] = [];
  for (let i = scans.length - 1; i >= 0; i--) {
    const s = scans[i];
    const repo = repoSlug(s.repo_url);
    const base = { id: s.id, t: s.created_at, repo, scanId: s.id };
    if (s.status === 'failed') {
      events.push({ ...base, kind: 'FAILED', color: C.redSoft, delta: null, msg: `${repo} · ${s.error_message ?? 'scan failed'}` });
      continue;
    }
    if (s.status !== 'completed' || s.threat_score == null) {
      events.push({ ...base, kind: 'RUNNING', color: C.cyan, delta: null, msg: `${repo} · scan in progress` });
      continue;
    }
    const prev = prevScore.get(s.repo_url);
    const delta = prev == null ? null : s.threat_score - prev;
    prevScore.set(s.repo_url, s.threat_score);
    const d = delta == null ? 'baseline' : delta > 0 ? `${prev} → ${s.threat_score} (+${delta})` : delta < 0 ? `${prev} → ${s.threat_score} (−${-delta})` : `${s.threat_score} (±0)`;
    if (delta != null && delta > 0) {
      events.push({ ...base, kind: 'RISE', color: C.red, delta, msg: `${repo} threat score rose ${d}` });
    } else if (s.from_cache) {
      events.push({ ...base, kind: 'CACHE', color: C.soft, delta, msg: `${repo} · ${s.threat_score} served from 6h cache` });
    } else {
      events.push({ ...base, kind: delta != null && delta < 0 ? 'DROP' : 'SCAN', color: C.green, delta, msg: `${repo} · ${delta == null ? `${s.threat_score} (baseline)` : d}` });
    }
  }
  return events.reverse();
}

export function risesWithin(scans: ScanListItem[], ms: number): OpsEvent[] {
  const since = Date.now() - ms;
  return opsEvents(scans).filter((e) => e.kind === 'RISE' && new Date(e.t).getTime() >= since);
}

/** Events per hour over the last `hours`, oldest bucket first. */
export function hourlyCounts(events: OpsEvent[], hours = 24, now = Date.now()): number[] {
  const out = new Array(hours).fill(0);
  for (const e of events) {
    const age = (now - new Date(e.t).getTime()) / 3_600_000;
    if (age >= 0 && age < hours) out[hours - 1 - Math.floor(age)]++;
  }
  return out;
}
