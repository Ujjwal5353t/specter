'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useScanStore } from '@/store/scanStore';
import type { ScannerKey, ScannerProgress } from '@/types';

/**
 * Scan-in-progress console — the design of html/02 · Scan in progress-html
 * (Scanning.dc.html + Hud + Rail), driven entirely by the live scan state the
 * store already polls from /api/scan/[scanId]/status:
 *
 *  - scan row      → repo, created_at (elapsed clock)
 *  - scan_progress → per-engine status, step detail, duration, finding count
 *
 * Nothing here is simulated. The engines run in parallel on the server, so
 * they settle in whatever order they actually finish. Values the backend does
 * not provide (branch, commit SHA, per-engine percentages) are not invented:
 * the scan id stands in for the ref, and running engines show elapsed time.
 *
 * The threat graph is laid out procedurally, but every node on it stands for
 * something real: one hub per engine once it starts, one node per resolved
 * package / scanned commit / discovered endpoint / finding as those counts
 * arrive.
 */

const C = {
  bg: '#03060B',
  panel: '#04080D',
  hud: '#04080E',
  line: '#101B29',
  line2: '#16273A',
  ink: '#D5E1EC',
  bright: '#E9F0F7',
  cyan: '#4FD8F0',
  green: '#3FCF8E',
  red: '#FF3D4F',
  redSoft: '#FF6B78',
  orange: '#FF8A2B',
  orangeSoft: '#FFA25C',
  amber: '#E8B84A',
  blue: '#3576EE',
  dim: '#4F6680',
  dimmer: '#3C5068',
  muted: '#6E8299',
  soft: '#8A9BB0',
  softer: '#A8B8C9',
  railInk: '#5E7189',
} as const;

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SANS = "'Archivo Variable', 'Archivo', ui-sans-serif, system-ui, sans-serif";

const ENGINES: { key: ScannerKey; name: string; tag: string }[] = [
  { key: 'depchain', name: 'DEPCHAIN', tag: 'DEP' },
  { key: 'ghostcommit', name: 'GHOSTCOMMIT', tag: 'GST' },
  { key: 'layerscan', name: 'LAYERSCAN', tag: 'LYR' },
  { key: 'apibleed', name: 'APIBLEED', tag: 'API' },
  { key: 'envtrace', name: 'ENVTRACE', tag: 'ENV' },
];

// ── Formatting ───────────────────────────────────────────────────────────

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function clock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(Math.floor(d.getMilliseconds() / 10))}`;
}

function elapsed(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${pad(Math.floor(s / 60))}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

function blocks(p: number, n: number): string {
  const k = Math.round((Math.max(0, Math.min(100, p)) / 100) * n);
  return '█'.repeat(k) + '░'.repeat(n - k);
}

/** A block bar with a lit window sliding across it: work in progress, amount unknown. */
function sweepBlocks(phase: number, n: number): string {
  const w = 4;
  const at = Math.floor(phase) % (n + w);
  let s = '';
  for (let i = 0; i < n; i++) s += i >= at - w && i < at ? '█' : '░';
  return s;
}

/** First integer before `word` in a scanner detail line ("276 packages · 3 vulnerable"). */
function countOf(detail: string | null | undefined, word: RegExp): number | null {
  if (!detail) return null;
  const m = detail.match(new RegExp(`(\\d+)\\s+${word.source}`, 'i'));
  return m ? parseInt(m[1], 10) : null;
}

// ── Real scan facts, derived from scan_progress ──────────────────────────

interface Facts {
  byKey: Map<ScannerKey, ScannerProgress>;
  settled: number;
  packages: number | null;
  packagesTotal: number | null;
  vulnerable: number;
  commits: number | null;
  secrets: number;
  hasDockerfile: boolean | null;
  layerIssues: number;
  endpoints: number | null;
  unsecured: number;
  exposures: number;
  findings: number;
}

function deriveFacts(progress: ScannerProgress[] | null, seen: Record<string, number>): Facts {
  const byKey = new Map((progress ?? []).map((p) => [p.scanner, p]));
  const dep = byKey.get('depchain');
  const gst = byKey.get('ghostcommit');
  const lyr = byKey.get('layerscan');
  const api = byKey.get('apibleed');
  const env = byKey.get('envtrace');
  const done = (p?: ScannerProgress) => p?.status === 'done';

  // DepChain streams its step while running: "resolving dependency tree · 57
  // packages...", "checking 276 packages against OSV...", "fetching advisories
  // 3/26...", then "276 packages · 3 vulnerable". Steps without a package count
  // fall back to the latest one any poll has seen, so the cluster never collapses.
  const depSteps = Object.entries(seen)
    .filter(([k]) => k.startsWith('depchain:'))
    .sort((a, b) => a[1] - b[1])
    .map(([k]) => k.split(':').slice(2).join(':'));
  const latest = (re: RegExp) => {
    for (let i = depSteps.length - 1; i >= 0; i--) if (re.test(depSteps[i])) return countOf(depSteps[i], /packages?/);
    return null;
  };
  const depCount = countOf(dep?.detail, /packages?/) ?? latest(/\d+\s+packages?/i);
  const packagesTotal = done(dep) ? depCount : latest(/against OSV/i);
  const findings = (progress ?? []).reduce((s, p) => s + (p.status === 'done' ? p.finding_count ?? 0 : 0), 0);

  return {
    byKey,
    settled: (progress ?? []).filter((p) => p.status !== 'running').length,
    packages: done(dep) && /no package\.json/i.test(dep?.detail ?? '') ? 0 : depCount,
    packagesTotal,
    vulnerable: done(dep) ? dep?.finding_count ?? 0 : 0,
    commits: done(gst) ? countOf(gst?.detail, /commits?/) : null,
    secrets: done(gst) ? gst?.finding_count ?? 0 : 0,
    hasDockerfile: done(lyr) ? !/no Dockerfile/i.test(lyr?.detail ?? '') : null,
    layerIssues: done(lyr) ? lyr?.finding_count ?? 0 : 0,
    endpoints: done(api) ? countOf(api?.detail, /endpoints?/) : null,
    unsecured: done(api) ? api?.finding_count ?? 0 : 0,
    exposures: done(env) ? env?.finding_count ?? 0 : 0,
    findings,
  };
}

// ── Threat graph (layout is procedural; membership is real) ──────────────

type Kind = 'core' | 'hub' | 'dep' | 'tdep' | 'commit' | 'secret' | 'layer' | 'api' | 'file';
type Sev = '' | 'crit' | 'high';
interface GNode { id: string; kind: Kind; x: number; y: number; z: number; r: number; sev: Sev }
interface GEdge { a: string; b: string; k: 'n' | 'g' | 'x' | 't' }

/** Deterministic per-id jitter, so a node never moves when the graph grows. */
function jitter(id: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Render caps: beyond these a node stands for the cluster, not one item.
const CAP = { packages: 180, direct: 18, commits: 46, endpoints: 20, layers: 6, marks: 14 };

const HUB: Record<ScannerKey, [number, number, number]> = {
  depchain: [-190, -30, 30],
  ghostcommit: [10, 170, -250],
  layerscan: [0, 215, 120],
  apibleed: [280, -40, 90],
  envtrace: [-30, -215, -120],
};

function buildGraph(f: Facts, hasCore: boolean): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  if (!hasCore) return { nodes, edges };
  const add = (n: GNode) => { nodes.push(n); return n; };
  const link = (a: string, b: string, k: GEdge['k'] = 'n') => edges.push({ a, b, k });
  /** Indices of `marks` items spread evenly over `count`. */
  const spread = (count: number, marks: number) =>
    new Set(Array.from({ length: Math.min(marks, count) }, (_, j) => Math.floor((j * count) / Math.min(marks, count))));

  add({ id: 'core', kind: 'core', x: 0, y: 0, z: 0, r: 14, sev: '' });

  for (const { key } of ENGINES) {
    if (!f.byKey.has(key)) continue;
    const [x, y, z] = HUB[key];
    add({ id: `hub-${key}`, kind: 'hub', x, y, z, r: 4.6, sev: '' });
    link('core', `hub-${key}`);
  }

  // DepChain: one node per resolved package — direct deps ring the hub,
  // transitive ones cluster around their parent. Vulnerable ones glow.
  const pk = Math.min(f.packages ?? 0, CAP.packages);
  if (pk > 0) {
    const direct = Math.min(CAP.direct, pk);
    const [hx, hy, hz] = HUB.depchain;
    const pos: [number, number, number][] = [];
    const vulnIdx = spread(pk, Math.min(f.vulnerable, CAP.marks));
    for (let i = 0; i < pk; i++) {
      const R = jitter(`dep${i}`);
      const id = `dep${i}`;
      const sev: Sev = vulnIdx.has(i) ? 'high' : '';
      if (i < direct) {
        const t = (i / direct) * 6.283 + R() * 0.2;
        const ph = (R() - 0.5) * 1.3;
        const rad = 150 + R() * 80;
        const p: [number, number, number] = [hx + Math.cos(t) * Math.cos(ph) * rad, hy + Math.sin(ph) * rad * 0.9, hz + Math.sin(t) * Math.cos(ph) * rad];
        pos.push(p);
        add({ id, kind: 'dep', x: p[0], y: p[1], z: p[2], r: 3.6 + R() * 2.4, sev });
        link('hub-depchain', id);
      } else {
        const parent = i % direct;
        const [px, py, pz] = pos[parent];
        add({ id, kind: 'tdep', x: px + (R() - 0.5) * 125, y: py + (R() - 0.5) * 125, z: pz + (R() - 0.5) * 125, r: 1.3 + R() * 1.7, sev });
        link(`dep${parent}`, id);
        if (R() < 0.18 && i - direct > 2) link(id, `dep${direct + Math.floor(R() * (i - direct))}`, 'x');
      }
    }
  }

  // GhostCommit: the scanned history as a trail; each secret is a threat node
  // wired from the commit trail to the repo core.
  const cm = Math.min(f.commits ?? 0, CAP.commits);
  let prev: string | null = null;
  for (let i = 0; i < cm; i++) {
    const t = cm === 1 ? 0.5 : i / (cm - 1);
    const id = `c${i}`;
    add({ id, kind: 'commit', x: -470 + t * 940, y: 175 + Math.sin(t * 6.3) * 30, z: -250 + Math.cos(t * 4.2) * 70, r: 2, sev: '' });
    if (prev) link(prev, id, 'g');
    if (i % 9 === 4) link('hub-ghostcommit', id, 'g');
    prev = id;
  }
  for (let i = 0; i < Math.min(f.secrets, CAP.marks); i++) {
    const R = jitter(`s${i}`);
    const id = `s${i}`;
    add({ id, kind: 'secret', x: -90 + R() * 130, y: 35 + R() * 80, z: -60 - R() * 60, r: 4.4, sev: 'crit' });
    if (cm > 0) link(`c${Math.floor(R() * cm)}`, id, 't');
    else link('hub-ghostcommit', id, 't');
    link(id, 'core', 't');
  }

  // LayerScan: one bar per Dockerfile issue under the core.
  if (f.hasDockerfile) {
    const k = Math.min(f.layerIssues, CAP.layers);
    for (let i = 0; i < k; i++) {
      add({ id: `L${i}`, kind: 'layer', x: 0, y: 250 + i * 40, z: 120, r: 6, sev: 'high' });
      link(i ? `L${i - 1}` : 'hub-layerscan', `L${i}`);
    }
  }

  // APIBleed: discovered routes fan out from their hub; unguarded write routes
  // are threat nodes with a path to the core.
  const ep = Math.min(f.endpoints ?? 0, CAP.endpoints);
  const [ax, ay, az] = HUB.apibleed;
  for (let i = 0; i < ep; i++) {
    const R = jitter(`api${i}`);
    const ang = -1.25 + (ep === 1 ? 0.5 : i / (ep - 1)) * 2.5;
    const id = `api${i}`;
    const crit = i < Math.min(f.unsecured, ep);
    add({ id, kind: 'api', x: ax + Math.cos(ang) * 125, y: ay + Math.sin(ang) * 140, z: az + (R() - 0.5) * 110, r: 3.4, sev: crit ? 'crit' : '' });
    link('hub-apibleed', id);
    if (crit) link(id, 'core', 't');
  }

  // EnvTrace: each exposed env file.
  const [ex, ey, ez] = HUB.envtrace;
  for (let i = 0; i < Math.min(f.exposures, CAP.marks); i++) {
    const R = jitter(`env${i}`);
    const id = `env${i}`;
    add({ id, kind: 'file', x: ex + (R() - 0.5) * 150, y: ey + (R() - 0.5) * 90, z: ez + (R() - 0.5) * 120, r: 3.6, sev: 'high' });
    link('hub-envtrace', id);
    link(id, 'core', 't');
  }

  return { nodes, edges };
}

// ── Telemetry: real transitions in scan_progress, first-seen timestamps ──

interface LogEvent { key: string; t: number; tag: string; tc: string; msg: string; c: string }

/**
 * The telemetry stream, derived purely from real scan state. Completion times
 * are the server's (started_at + duration_ms); a running engine's step lines
 * are stamped with when a poll first saw them (store.progressSeen).
 */
function buildTelemetry(
  scanId: string,
  createdAt: string | null,
  repo: string,
  progress: ScannerProgress[] | null,
  seen: Record<string, number>,
): LogEvent[] {
  const out: LogEvent[] = [];
  if (createdAt) {
    out.push({ key: 'accepted', t: new Date(createdAt).getTime(), tag: '[SYS]', tc: C.cyan, msg: `scan ${scanId.slice(0, 8)} queued · ${repo}`, c: C.soft });
  }
  if (progress && progress.length > 0) {
    const start = Math.min(...progress.map((p) => new Date(p.started_at).getTime()));
    out.push({ key: 'dispatch', t: start, tag: '[SYS]', tc: C.cyan, msg: `repository access verified · ${progress.length} engines dispatched in parallel`, c: C.soft });
    const ends: number[] = [];
    for (const p of progress) {
      const eng = ENGINES.find((e) => e.key === p.scanner);
      if (!eng) continue;
      const tag = `[${eng.tag}]`;
      const end = new Date(p.started_at).getTime() + (p.duration_ms ?? 0);
      // Every step a poll has seen for this engine, not only the current one.
      for (const [k, t] of Object.entries(seen)) {
        const prefix = `${p.scanner}:running:`;
        if (!k.startsWith(prefix) || k === prefix) continue;
        out.push({ key: k, t, tag, tc: C.blue, msg: k.slice(prefix.length).replace(/\.{3}$/, ''), c: C.soft });
      }
      if (p.status === 'done') {
        ends.push(end);
        const hit = (p.finding_count ?? 0) > 0;
        const severe = hit && (p.scanner === 'ghostcommit' || p.scanner === 'apibleed');
        const dur = p.duration_ms != null ? ` · ${(p.duration_ms / 1000).toFixed(1)}s` : '';
        out.push({
          key: `${p.scanner}:done`, t: end, tag,
          tc: severe ? C.red : hit ? C.orange : C.green,
          msg: `complete · ${p.detail ?? 'done'}${dur}`,
          c: severe ? C.redSoft : hit ? C.orangeSoft : C.soft,
        });
      } else if (p.status === 'failed') {
        ends.push(end);
        out.push({ key: `${p.scanner}:failed`, t: end, tag, tc: C.red, msg: `engine failed · ${p.detail ?? 'could not finish'}`, c: C.redSoft });
      }
    }
    if (ends.length === ENGINES.length) {
      out.push({ key: 'finalize', t: Math.max(...ends) + 1, tag: '[SYS]', tc: C.cyan, msg: 'all engines settled · computing threat score', c: C.soft });
    }
  }
  return out.sort((a, b) => a.t - b.t).slice(-40);
}

// ── Rail (Rail.dc.html) ──────────────────────────────────────────────────

const RAIL = [
  { id: 'ovr', code: 'OVR', label: 'Overview — Intelligence brief', d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'map', code: 'MAP', label: 'Threat map', d: 'M10 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0M3 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 7v5M12 12l-6.3 4.6M12 12l6.3 4.6' },
  { id: 'dep', code: 'DEP', label: 'Dependencies', d: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5', engine: 'depchain', dot: C.amber },
  { id: 'gst', code: 'GST', label: 'Ghost commits', d: 'M3 12h6M15 12h6M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0', engine: 'ghostcommit', dot: C.red },
  { id: 'lyr', code: 'LYR', label: 'Infrastructure — LayerScan', d: 'M12 4l9 4.5-9 4.5-9-4.5zM3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5', engine: 'layerscan', dot: C.orange },
  { id: 'api', code: 'API', label: 'API surface — APIBleed', d: 'M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14', engine: 'apibleed', dot: C.red },
  { id: 'sec', code: 'SEC', label: 'Secrets — EnvTrace', d: 'M4 15a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M10 12.5L19 4M16 7l2.5 2.5M13.5 9.5l2 2', engine: 'envtrace', dot: C.red },
  { id: 'rpt', code: 'RPT', label: 'Reports', d: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6' },
  { id: 'mon', code: 'MON', label: 'Monitoring', d: 'M3 12h4l2-6 4 12 2-6h6' },
] as const;

// ── Component ────────────────────────────────────────────────────────────

const STARS = (() => {
  const R = jitter('stars');
  return Array.from({ length: 120 }, () => ({ l: R() * 100, t: R() * 100, o: 0.1 + R() * 0.45 }));
})();

export default function ScanConsole({ scanId, onNewScan }: { scanId: string; onNewScan: () => void }) {
  const progress = useScanStore((s) => s.progress);
  const repoUrl = useScanStore((s) => s.repoUrl);
  const createdAt = useScanStore((s) => s.scanCreatedAt);
  const isPolling = useScanStore((s) => s.isPolling);
  const progressSeen = useScanStore((s) => s.progressSeen);

  const repo = repoUrl ? repoUrl.replace(/^https?:\/\/github\.com\//i, '') : null;
  const [owner, name] = repo ? repo.split('/') : [null, null];

  // One clock drives the elapsed timer, the radar yaw and the running bars.
  const [now, setNow] = useState(() => Date.now());
  // Only ever rendered client-side (after polling starts), so window is available.
  const [reduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 80);
    return () => clearInterval(id);
  }, []);
  // Same yaw rate as the reference (0.002 rad per 80ms tick), from wall-clock time.
  const yaw = -0.42 + (reduced ? 0 : (now / 40_000) % (2 * Math.PI));

  const facts = useMemo(() => deriveFacts(progress, progressSeen), [progress, progressSeen]);
  const pct = progress ? Math.round((facts.settled / ENGINES.length) * 100) : 0;
  const running = ENGINES.filter((e) => facts.byKey.get(e.key)?.status === 'running');
  const stage = !createdAt ? 'CONNECTING'
    : !progress || progress.length === 0 ? 'VERIFYING REPOSITORY ACCESS'
    : running.length > 0 ? running.map((e) => e.name).join(' · ')
    : 'COMPUTING THREAT SCORE';
  const elapsedText = createdAt ? elapsed(now - new Date(createdAt).getTime()) : '--:--.-';

  const log = useMemo(() => buildTelemetry(scanId, createdAt, repo ?? '…', progress, progressSeen), [scanId, createdAt, repo, progress, progressSeen]);

  // Section box → layout scale, so the field fills the viewport natively.
  const stageRef = useRef<HTMLElement>(null);
  const [box, setBox] = useState({ w: 1016, h: 856 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const S = Math.max(0.55, Math.min(box.w / 1016, (box.h - 40) / 816, 1.35));
  const cx = box.w / 2;
  const cy = (box.h - 92) * 0.5 + 12;

  const graph = useMemo(() => buildGraph(facts, !!createdAt), [facts, createdAt]);

  const projected = useMemo(() => {
    const cY = Math.cos(yaw), sY = Math.sin(yaw), pitch = 0.3, cP = Math.cos(pitch), sP = Math.sin(pitch);
    const P = new Map<string, { x: number; y: number; z: number; s: number }>();
    for (const n of graph.nodes) {
      const x = n.x * cY - n.z * sY;
      let z = n.x * sY + n.z * cY;
      const y = n.y * cP - z * sP;
      z = n.y * sP + z * cP;
      const k = (1000 / (z + 1200)) * S;
      P.set(n.id, { x: cx + x * k, y: cy + y * k, z, s: k });
    }
    return P;
  }, [graph, yaw, S, cx, cy]);

  const fade = (z: number) => Math.max(0.22, Math.min(1, 1.12 - (z + 360) / 820));
  const ring = (d: number) => ({ left: cx - (d * S) / 2, top: cy - (d * S) / 2, width: d * S, height: d * S });

  const feeds = [
    {
      label: 'OSV.dev',
      color: facts.byKey.get('depchain')?.status === 'done' ? C.green
        : facts.byKey.get('depchain')?.status === 'failed' ? C.red
        : /OSV|advisories/i.test(facts.byKey.get('depchain')?.detail ?? '') ? C.cyan : C.dimmer,
      live: /OSV|advisories/i.test(facts.byKey.get('depchain')?.detail ?? ''),
    },
    { label: 'GitHub API', color: progress && progress.length > 0 ? C.green : C.dimmer, live: false },
    { label: 'Supabase', color: createdAt ? C.green : C.dimmer, live: false },
    { label: 'LLM brief · queued', color: C.amber, live: false },
  ];

  return (
    <div className="sc-root fixed inset-0 z-40 flex flex-col pointer-events-auto" style={{ background: C.bg, color: C.ink, fontFamily: SANS }}>
      {/* ── Top HUD ─────────────────────────────────────────────── */}
      <header className="shrink-0 flex items-stretch" style={{ height: 44, background: C.hud, borderBottom: `1px solid ${C.line}` }}>
        <button type="button" onClick={onNewScan} aria-label="Specter home — start a new scan" title="New scan"
          className="shrink-0 flex items-center justify-center" style={{ width: 64, borderRight: `1px solid ${C.line}` }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="1.4" aria-hidden>
            <path d="M12 1.5L22.5 12 12 22.5 1.5 12z" /><path d="M12 7l5 5-5 5-5-5z" fill="rgba(79,216,240,.18)" />
          </svg>
        </button>
        <div className="flex items-center" style={{ padding: '0 20px', borderRight: `1px solid ${C.line}` }}>
          <span style={{ fontStretch: '125%', fontWeight: 700, fontSize: 12, letterSpacing: '.34em', color: '#E6EEF6' }}>SPECTER</span>
        </div>
        <div className="flex items-center min-w-0" style={{ gap: 10, padding: '0 16px', borderRight: `1px solid ${C.line}`, font: `500 12px/1 ${MONO}` }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="1.6" aria-hidden className="shrink-0">
            <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" />
          </svg>
          <span className="truncate">
            {owner ? <><span style={{ color: C.muted }}>{owner} /</span> {name}</> : <span style={{ color: C.muted }}>resolving target…</span>}
          </span>
          <span className="shrink-0" title="Scan id" style={{ padding: '4px 6px', border: `1px solid ${C.line2}`, color: C.muted, fontSize: 10.5 }}>
            scan · {scanId.slice(0, 8)}
          </span>
        </div>
        <div className="sc-hide-sm flex items-center" style={{ gap: 22, padding: '0 18px', font: `500 10.5px/1 ${MONO}`, letterSpacing: '.08em' }}>
          <span className="flex items-center" style={{ gap: 8 }}>
            <span style={{ color: C.dim }}>SCAN</span>
            <span className="sc-live" style={{ width: 6, height: 6, borderRadius: '50%', background: C.cyan }} />
            <span style={{ color: C.cyan }}>SCANNING · {pct}%</span>
          </span>
          <span className="flex items-center" style={{ gap: 8 }}>
            <span style={{ color: C.dim }}>LAST</span>
            <span style={{ color: C.softer }}>IN PROGRESS</span>
          </span>
        </div>
        <div className="grow" />
        <div className="flex items-center" style={{ padding: '0 12px', borderLeft: `1px solid ${C.line}` }}>
          <button type="button" onClick={onNewScan} className="sc-btn flex items-center"
            style={{ height: 28, gap: 8, padding: '0 12px', border: `1px solid ${C.line2}`, background: '#060B12', color: C.soft, font: `500 10.5px/1 ${MONO}`, letterSpacing: '.12em' }}>
            + NEW SCAN
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* ── Rail ───────────────────────────────────────────────── */}
        <nav aria-label="Intelligence navigation" className="shrink-0 flex flex-col" style={{ width: 64, background: C.hud, borderRight: `1px solid ${C.line}`, fontFamily: MONO }}>
          {RAIL.map((it) => {
            const on = it.id === 'map';
            const eng = 'engine' in it ? facts.byKey.get(it.engine) : undefined;
            const dot = 'dot' in it && eng?.status === 'done' && (eng.finding_count ?? 0) > 0 ? it.dot : 'transparent';
            return (
              <div key={it.id} role="link" aria-disabled={!on} aria-current={on ? 'page' : undefined}
                title={on ? it.label : `${it.label} — available when the scan completes`}
                className="relative flex flex-col items-center justify-center"
                style={{
                  height: 58, gap: 6, color: on ? C.cyan : C.railInk, background: on ? '#071320' : 'transparent',
                  boxShadow: on ? `inset 0 0 0 1px #133049, inset 0 -2px 0 ${C.cyan}` : 'none', cursor: on ? 'default' : 'not-allowed',
                }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={it.d} /></svg>
                <span style={{ fontSize: 8.5, letterSpacing: '.14em', fontWeight: 500 }}>{it.code}</span>
                <span style={{ position: 'absolute', right: 9, top: 11, width: 5, height: 5, borderRadius: '50%', background: dot }} />
              </div>
            );
          })}
          <div className="grow" />
          <div className="flex items-center justify-center" title="Status polling active"
            style={{ height: 44, gap: 5, borderTop: `1px solid ${C.line}`, fontSize: 8.5, letterSpacing: '.1em', color: isPolling ? C.green : C.dim }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: isPolling ? C.green : C.dim }} />SYS
          </div>
        </nav>

        {/* ── Threat field ───────────────────────────────────────── */}
        <section ref={stageRef} aria-label="Scan in progress" className="relative flex-1 min-w-0 overflow-hidden"
          style={{ background: `radial-gradient(ellipse 70% 60% at 50% 44%, #081424 0%, ${C.bg} 72%)` }}>
          {STARS.map((s, i) => (
            <div key={i} className="absolute" style={{ left: `${s.l}%`, top: `${s.t}%`, width: 1, height: 1, borderRadius: '50%', background: '#9FC3E8', opacity: s.o }} />
          ))}

          <div className="absolute" style={{ ...ring(700), borderRadius: '50%', border: '1px solid rgba(79,216,240,.10)' }} />
          <div className="absolute" style={{ ...ring(500), borderRadius: '50%', border: '1px dashed rgba(79,216,240,.08)' }} />
          <div className="absolute" style={{ ...ring(300), borderRadius: '50%', border: '1px solid rgba(79,216,240,.07)' }} />
          <div className="absolute sc-radar" style={{
            ...ring(700), borderRadius: '50%',
            background: 'conic-gradient(from 0deg, rgba(79,216,240,0) 0deg, rgba(79,216,240,0) 300deg, rgba(79,216,240,.16) 358deg, rgba(79,216,240,.5) 360deg)',
          }} />

          <div className="absolute inset-0" style={{ bottom: 92 }} aria-hidden>
            {graph.edges.map((e, i) => {
              const a = projected.get(e.a), b = projected.get(e.b);
              if (!a || !b) return null;
              const dx = b.x - a.x, dy = b.y - a.y;
              return (
                <div key={`${e.a}>${e.b}:${i}`} className={`sc-ed sc-e-${e.k}`}
                  style={{ left: a.x, top: a.y, width: Math.sqrt(dx * dx + dy * dy), transform: `rotate(${Math.atan2(dy, dx)}rad)`, opacity: fade((a.z + b.z) / 2) }} />
              );
            })}
            {[...graph.nodes].sort((p, q) => (projected.get(q.id)!.z - projected.get(p.id)!.z)).map((n) => {
              const q = projected.get(n.id)!;
              const d = Math.max(2, n.r * 2 * q.s);
              const w = n.kind === 'layer' ? d * 4.2 : d;
              const h = n.kind === 'layer' ? Math.max(3, d * 0.55) : d;
              return (
                <div key={n.id} className={`sc-nd sc-k-${n.kind}${n.sev ? ` sc-s-${n.sev}` : ''}`}
                  style={{ left: q.x - w / 2, top: q.y - h / 2, width: w, height: h, opacity: fade(q.z) }} />
              );
            })}
          </div>

          {/* Target + progress */}
          <div className="absolute flex flex-col" style={{ left: 28, top: 24, gap: 10, maxWidth: 'calc(100% - 300px)' }}>
            <div className="flex items-center" style={{ gap: 8, font: `500 10px/1 ${MONO}`, letterSpacing: '.2em', color: C.cyan }}>
              <span className="sc-live" style={{ width: 6, height: 6, background: C.cyan, borderRadius: '50%' }} />ACQUIRING TARGET TELEMETRY
            </div>
            <div className="truncate" style={{ fontSize: 17, fontWeight: 500, color: C.bright }}>
              {repo ?? <span style={{ color: C.dim }}>resolving target…</span>}
              <span style={{ color: C.dim, fontWeight: 400 }}> @ default branch</span>
            </div>
            <div className="flex items-end" style={{ gap: 14, marginTop: 6 }}>
              <div style={{ font: `600 64px/.9 ${MONO}`, letterSpacing: '-.04em', color: C.bright }}>
                {pct}<span style={{ fontSize: 28, color: C.dim }}>%</span>
              </div>
              <div className="flex flex-col min-w-0" style={{ gap: 6, paddingBottom: 4, font: `400 10.5px/1 ${MONO}`, color: C.muted }}>
                <span>ELAPSED <span style={{ color: C.softer }}>{elapsedText}</span></span>
                <span className="truncate">STAGE <span style={{ color: C.softer }}>{stage}</span></span>
              </div>
            </div>
            <div style={{ width: 360, maxWidth: '100%', font: `400 12px/1 ${MONO}`, color: C.cyan, letterSpacing: '-.02em', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {blocks(pct, 32)}
            </div>
          </div>

          {/* Live counts */}
          <div className="absolute flex flex-col items-end" style={{ right: 24, top: 24, gap: 6, font: `400 10.5px/1 ${MONO}`, color: C.muted }}>
            <span>PACKAGES MAPPED <span style={{ color: C.ink }}>{facts.packages ?? '—'}</span>{facts.packagesTotal != null && <> / {facts.packagesTotal}</>}</span>
            <span>ENGINES SETTLED <span style={{ color: C.ink }}>{progress ? facts.settled : 0}</span> / {ENGINES.length}</span>
            <span>SIGNALS <span style={{ color: facts.findings > 0 ? C.redSoft : C.ink }}>{facts.findings} FOUND</span>
              {facts.secrets > 0 && <> · <span style={{ color: C.orangeSoft }}>{facts.secrets} SECRET{facts.secrets === 1 ? '' : 'S'}</span></>}
            </span>
          </div>

          {/* Engine cards */}
          <div className="absolute left-0 right-0 bottom-0 grid" style={{ height: 92, gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', borderTop: `1px solid ${C.line}`, background: 'rgba(4,8,14,.94)' }}>
            {ENGINES.map((e, i) => {
              const p = facts.byKey.get(e.key);
              const status = p?.status ?? 'queued';
              const color = status === 'done' ? C.green : status === 'failed' ? C.red : status === 'running' ? C.cyan : C.dimmer;
              const label = status === 'done' ? 'COMPLETE' : status === 'failed' ? 'FAILED' : status === 'running' ? 'SCANNING…' : 'QUEUED';
              // DepChain reports "fetching advisories i/N" — the only real fraction a running engine exposes.
              const frac = status === 'running' ? p?.detail?.match(/(\d+)\/(\d+)/) : null;
              const runPct = frac && +frac[2] > 0 ? Math.round((+frac[1] / +frac[2]) * 100) : null;
              const since = p ? now - new Date(p.started_at).getTime() : 0;
              const bar = status === 'done' || status === 'failed' ? blocks(100, 14)
                : status === 'running' ? (runPct != null ? blocks(runPct, 14) : sweepBlocks(reduced ? 0 : since / 160, 14))
                : blocks(0, 14);
              const right = status === 'done' ? '100%' : status === 'failed' ? 'ERR'
                : status === 'running' ? (runPct != null ? `${runPct}%` : elapsed(since).slice(0, 5)) : '—';
              const task = status === 'queued' ? 'awaiting dispatch'
                : status === 'running' ? (p?.detail?.replace(/\.{3}$/, '') ?? 'running')
                : status === 'failed' ? (p?.detail ?? 'could not finish')
                : `done · ${p?.detail ?? 'findings committed'}`;
              return (
                <div key={e.key} className="flex flex-col min-w-0" style={{ padding: '14px 16px', gap: 9, borderRight: i < ENGINES.length - 1 ? `1px solid ${C.line}` : 'none', fontFamily: MONO }}>
                  <div className="flex justify-between items-center" style={{ fontSize: 10.5, letterSpacing: '.1em', gap: 8 }}>
                    <span className="truncate" style={{ color: C.ink, fontWeight: 500 }}>{e.name}</span>
                    <span className="shrink-0" style={{ color, fontSize: 9.5 }}>{label}</span>
                  </div>
                  <div className="whitespace-nowrap overflow-hidden" style={{ fontSize: 11, letterSpacing: '-.03em', color }}>
                    {bar} <span style={{ color: C.muted, letterSpacing: 0 }}>{right}</span>
                  </div>
                  <div className="truncate" title={task} style={{ fontSize: 9.5, color: status === 'done' && (p?.finding_count ?? 0) > 0 ? C.orangeSoft : C.dim }}>{task}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Telemetry stream ───────────────────────────────────── */}
        <aside className="shrink-0 flex flex-col" style={{ width: 'clamp(300px, 25vw, 380px)', borderLeft: `1px solid ${C.line}`, background: C.panel }}>
          <div className="flex items-center justify-between shrink-0" style={{ height: 44, padding: '0 18px', borderBottom: `1px solid ${C.line}`, font: `500 10px/1 ${MONO}`, letterSpacing: '.18em' }}>
            <span style={{ color: C.ink }}>TELEMETRY STREAM</span>
            <span className="flex items-center" style={{ gap: 6, color: isPolling ? C.cyan : C.dim }}>
              <span className="sc-live" style={{ width: 5, height: 5, borderRadius: '50%', background: isPolling ? C.cyan : C.dim }} />RX
            </span>
          </div>
          <div role="log" aria-live="polite" className="flex flex-col justify-end grow min-h-0 overflow-hidden" style={{ padding: '12px 18px', gap: 7, font: `400 10.5px/1.45 ${MONO}` }}>
            {log.map((l) => (
              <div key={l.key} className="sc-row grid" style={{ gridTemplateColumns: '76px 40px minmax(0, 1fr)', columnGap: 8 }}>
                <span style={{ color: C.dimmer }} suppressHydrationWarning>{clock(l.t)}</span>
                <span style={{ color: l.tc }}>{l.tag}</span>
                <span style={{ color: l.c, overflowWrap: 'anywhere' }}>{l.msg}</span>
              </div>
            ))}
            <div style={{ color: C.cyan }}>&gt; <span className="sc-caret">_</span></div>
          </div>
          <div className="shrink-0 flex flex-col" style={{ padding: '14px 18px 18px', gap: 10, borderTop: `1px solid ${C.line}` }}>
            <div style={{ font: `500 10px/1 ${MONO}`, letterSpacing: '.18em', color: C.muted }}>FEEDS</div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, font: `400 10.5px/1 ${MONO}`, color: C.soft }}>
              {feeds.map((f) => (
                <span key={f.label} className="flex items-center" style={{ gap: 6 }}>
                  <span className={f.live ? 'sc-live' : undefined} style={{ width: 5, height: 5, borderRadius: '50%', background: f.color }} />{f.label}
                </span>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
