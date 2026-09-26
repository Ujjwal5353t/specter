'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { computeNodePositions, SCENE_COLORS, worstCveSeverity, hasRiskSignal } from '@/lib/depGraphLayout';
import { depFix, depIndex, depRows, resolutionPath, type DepIndex, type DepRow } from '@/lib/console/derive';
import { C, mono, SEV } from '@/lib/console/theme';
import type { DepNode, ScanResult } from '@/types';
import { Cell, Chip, CopyButton, dot, Empty, GhostLink, Label, Legend, SevTag, Stat, useSelection } from '../ui';

type Filter = 'all' | 'fix' | 'direct' | 'signal';

export default function DepChainView({ result: r }: { result: ScanResult }) {
  const idx = useMemo(() => depIndex(r), [r]);
  const rows = useMemo(() => depRows(r, idx), [r, idx]);
  const [sel, setSel] = useSelection();
  const [filter, setFilter] = useState<Filter>('all');

  const nodes = r.depchain?.nodes ?? [];
  const pkgs = nodes.filter((n) => !n.isRoot);
  if (pkgs.length === 0) {
    return (
      <div>
        <Header r={r} idx={idx} rows={rows} />
        <Empty title="NO DEPENDENCIES RESOLVED">DepChain found no package.json in this repository, so there is no dependency graph to analyse.</Empty>
      </div>
    );
  }

  const selKey = sel ?? rows[0]?.key ?? null;
  const selRow = rows.find((x) => x.key === selKey) ?? null;
  const selNodeId = selRow?.node.id ?? (selKey?.startsWith('node:') ? selKey.slice(5) : selKey?.split('|')[0]) ?? null;
  const selNode = selNodeId ? idx.byId.get(selNodeId) ?? null : null;
  const path = selNode ? resolutionPath(idx, selNode.id) : [];

  const counts = {
    all: rows.length,
    fix: rows.filter((x) => x.cve?.fixed_in).length,
    direct: rows.filter((x) => x.direct).length,
    signal: rows.filter((x) => x.signals.length > 0).length,
  };
  const shown = rows.filter((x) => filter === 'all' || (filter === 'fix' ? !!x.cve?.fixed_in : filter === 'direct' ? x.direct : x.signals.length > 0));

  const pick = (node: DepNode) => {
    const row = rows.find((x) => x.node.id === node.id);
    setSel(row ? row.key : `node:${node.id}`);
  };

  return (
    <div className="flex flex-col">
      <div className="sx-split" style={{ borderBottom: `1px solid ${C.line}` }}>
        <section className="sx-main relative" aria-label="Dependency graph"
          style={{ height: 500, overflow: 'hidden', background: 'radial-gradient(ellipse 60% 70% at 50% 50%, #081424, #03060B 75%)' }}>
          <DepCanvas nodes={nodes} edges={r.depchain?.edges ?? []} path={path} onPick={pick} />
          <div className="absolute pointer-events-none" style={{ left: 0, top: 0 }}><Header r={r} idx={idx} rows={rows} /></div>
          <div className="absolute sx-hide-sm" style={{ left: 24, bottom: 18 }}>
            <Legend items={[
              { swatch: dot(C.blue, 9), label: 'DIRECT' },
              { swatch: dot(C.blueDeep, 6), label: 'TRANSITIVE' },
              { swatch: dot(C.red, 7), label: 'CRITICAL' },
              { swatch: dot(C.orange, 7), label: 'HIGH' },
              { swatch: dot(C.amber, 7), label: 'MEDIUM' },
              { swatch: dot(SCENE_COLORS.riskSignal, 7), label: 'RISK SIGNAL' },
              { swatch: <span style={{ width: 16, height: 2, background: C.orange }} />, label: 'SELECTED PATH' },
            ]} />
          </div>
          <Link href={`/scan/${r.scanId}`} className="absolute sx-act" style={{ right: 20, top: 18, padding: '9px 12px', border: `1px solid ${C.btn}`, background: C.well, font: mono(10.5, 500), letterSpacing: '.14em', color: C.soft }}>
            SHOW IN THREAT MAP →
          </Link>
        </section>
        <Dossier node={selNode} row={selRow} path={path} idx={idx} />
      </div>

      <section className="flex flex-col">
        <div className="sx-pad flex flex-wrap items-center justify-between" style={{ minHeight: 44, padding: '8px 24px', borderBottom: `1px solid ${C.line}`, gap: 10 }}>
          <div style={{ font: mono(10, 500), letterSpacing: '.18em', color: C.ink }}>VULNERABILITY INTELLIGENCE <span style={{ color: C.dim }}>· SORTED BY SEVERITY × CVSS</span></div>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>ALL {counts.all}</Chip>
            <Chip active={filter === 'fix'} onClick={() => setFilter('fix')}>FIX AVAILABLE {counts.fix}</Chip>
            <Chip active={filter === 'direct'} onClick={() => setFilter('direct')}>DIRECT {counts.direct}</Chip>
            <Chip active={filter === 'signal'} onClick={() => setFilter('signal')}>SIGNALS {counts.signal}</Chip>
          </div>
        </div>
        {rows.length === 0 ? (
          <Empty title="NO VULNERABLE PACKAGES">None of the {pkgs.length} resolved packages has an OSV advisory or a medium-or-worse supply-chain signal.</Empty>
        ) : (
          <div className="sx-table-wrap">
            <table style={{ width: '100%', minWidth: 1080, borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ height: 34, font: mono(9.5, 500), letterSpacing: '.14em', color: C.dim, textAlign: 'left', borderBottom: `1px solid ${C.line}` }}>
                  <th style={{ fontWeight: 500, paddingLeft: 24, width: 200 }}>PACKAGE</th>
                  <th style={{ fontWeight: 500, width: 100 }}>VERSION</th>
                  <th style={{ fontWeight: 500, width: 100 }}>FIXED IN</th>
                  <th style={{ fontWeight: 500, width: 96 }}>SEVERITY</th>
                  <th style={{ fontWeight: 500, width: 190 }}>ADVISORY</th>
                  <th style={{ fontWeight: 500, width: 60 }}>CVSS</th>
                  <th style={{ fontWeight: 500, width: 120 }}>TYPE</th>
                  <th style={{ fontWeight: 500 }}>SUPPLY-CHAIN SIGNAL</th>
                  <th style={{ fontWeight: 500, width: 90, paddingRight: 24, textAlign: 'right' }}>FIX</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((x) => {
                  const on = x.key === selKey;
                  const c = SEV[x.severity].color;
                  return (
                    <tr key={x.key} className="sx-tr" onClick={() => setSel(x.key)} style={{ height: 38, borderBottom: `1px solid ${C.row}`, background: on ? C.sel : 'transparent', font: mono(11.5), color: C.softer, cursor: 'pointer' }}>
                      <td className="sx-trunc" style={{ paddingLeft: 24 }}><button type="button" onClick={() => setSel(x.key)} style={{ color: on ? '#fff' : C.ink, fontWeight: 500 }}>{x.node.name}</button></td>
                      <td className="sx-trunc">{x.node.version}</td>
                      <td style={{ color: x.cve?.fixed_in ? C.green : C.dim }}>{x.cve?.fixed_in ?? '—'}</td>
                      <td><SevTag severity={x.severity} /></td>
                      <td className="sx-trunc" style={{ color: C.ink }} title={x.cve?.summary}>{x.cve?.id ?? '—'}</td>
                      <td style={{ color: c }}>{x.cve ? x.cve.score.toFixed(1) : '—'}</td>
                      <td style={{ fontSize: 10, letterSpacing: '.08em' }}>{x.direct ? 'DIRECT' : `TRANSITIVE · ${x.depth ?? '?'}`}</td>
                      <td className="sx-trunc" style={{ fontSize: 10.5, color: x.signals.length ? C.orangeSoft : C.dim }} title={x.signals.map((s) => s.detail).join('\n')}>
                        {x.signals.length ? x.signals.map((s) => s.title).join(' · ') : '—'}
                      </td>
                      <td style={{ paddingRight: 24, textAlign: 'right', fontSize: 10, letterSpacing: '.1em', color: x.cve?.fixed_in ? C.green : C.dim }}>{x.cve?.fixed_in ? 'AVAILABLE' : x.cve ? 'NONE' : 'REVIEW'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Header({ r, idx, rows }: { r: ScanResult; idx: DepIndex; rows: DepRow[] }) {
  const pkgs = (r.depchain?.nodes ?? []).filter((n) => !n.isRoot);
  const direct = pkgs.filter((n) => n.isDirect).length;
  const maxDepth = Math.max(0, ...idx.depth.values());
  return (
    <div className="sx-pad flex flex-col" style={{ padding: '20px 24px', gap: 8 }}>
      <div style={{ font: mono(10, 500), letterSpacing: '.2em', color: C.cyan }}>{'// DEPCHAIN · DEPENDENCY INTELLIGENCE'}</div>
      <div style={{ fontSize: 17, fontWeight: 500, color: C.bright }}>{pkgs.length} packages, {rows.length} finding{rows.length === 1 ? '' : 's'}</div>
      <div className="flex flex-wrap" style={{ gap: 14, font: mono(10.5), color: C.muted }}>
        <Stat label="DIRECT" value={direct} />
        <Stat label="TRANSITIVE" value={pkgs.length - direct} />
        <Stat label="MAX DEPTH" value={maxDepth} />
        <Stat label="VULNERABLE" value={r.depchain?.vulnCount ?? 0} color={(r.depchain?.vulnCount ?? 0) ? C.orange : C.softer} />
        <span>SOURCE <span style={{ color: C.softer }}>OSV.dev · npm registry</span></span>
      </div>
    </div>
  );
}

function Dossier({ node, row, path, idx }: { node: DepNode | null; row: DepRow | null; path: string[]; idx: DepIndex }) {
  if (!node) {
    return <aside className="sx-aside" style={{ width: 440 }}><Empty title="PACKAGE DOSSIER">Pick a package in the graph or the table.</Empty></aside>;
  }
  const sev = row?.severity ?? worstCveSeverity(node);
  const color = sev ? SEV[sev].color : C.green;
  const names = path.map((id) => idx.byId.get(id)?.name ?? id);
  const chain = names.length > 5 ? [names[0], names[1], `(${names.length - 4} intermediates)`, names[names.length - 2], names[names.length - 1]] : names;
  const fix = row ? depFix(row) : null;
  const signals = (node.signals ?? []).filter((s) => s.severity !== 'info');
  return (
    <aside className="sx-aside flex flex-col" style={{ width: 440, padding: '20px 24px', gap: 16, minHeight: 500 }}>
      <div className="flex justify-between items-center" style={{ font: mono(10, 500), letterSpacing: '.16em' }}>
        <span style={{ color: C.muted }}>PACKAGE DOSSIER</span>
        <span style={{ padding: '4px 7px', border: `1px solid ${color}`, color }}>{sev ? SEV[sev].label : hasRiskSignal(node) ? 'SIGNAL' : 'CLEAN'}</span>
      </div>
      <div className="flex flex-col" style={{ gap: 6 }}>
        <div style={{ font: mono(22, 600, 1.1), color: C.bright, wordBreak: 'break-all' }}>{node.name}<span style={{ color: C.muted }}>@{node.version}</span></div>
        <div style={{ fontSize: 14, color: C.softer }}>{row?.cve?.summary ?? (signals[0]?.title ?? 'No known advisories for this version')}</div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', border: `1px solid ${C.line3}` }}>
        <Cell label="ADVISORY" size={11}>{row?.cve?.id ?? '—'}</Cell>
        <Cell label="CVSS" color={color} size={18}>{row?.cve ? row.cve.score.toFixed(1) : '—'}</Cell>
        <Cell label="FIXED IN" color={row?.cve?.fixed_in ? C.green : C.dim} size={13} last>{row?.cve?.fixed_in ?? '—'}</Cell>
      </div>
      <div className="flex flex-col" style={{ gap: 8 }}>
        <Label>RESOLUTION PATH · {node.isDirect ? 'DIRECT' : `TRANSITIVE · ${Math.max(0, path.length - 1)}`}</Label>
        <div className="flex flex-wrap items-center" style={{ gap: 6, font: mono(11.5) }}>
          {chain.map((c, i) => {
            const last = i === chain.length - 1;
            return (
              <span key={i} className="flex items-center" style={{ gap: 6 }}>
                <span style={{ padding: '5px 7px', border: `1px solid ${last ? color : C.btn}`, color: last ? color : c.startsWith('(') ? C.muted : C.ink }}>{c}</span>
                {!last && <span style={{ color: C.dimmer }}>›</span>}
              </span>
            );
          })}
        </div>
      </div>
      {signals.length > 0 && (
        <div className="flex flex-col" style={{ gap: 6 }}>
          <Label>SUPPLY-CHAIN SIGNALS</Label>
          {signals.map((s) => (
            <div key={s.type} style={{ fontSize: 12.5, lineHeight: 1.45, color: C.softer }}>
              <span style={{ color: SEV[s.severity].color, font: mono(10, 500) }}>{SEV[s.severity].short} </span>{s.title} — {s.detail}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col" style={{ gap: 8 }}>
        <Label>REMEDIATION · package.json</Label>
        <pre style={{ margin: 0, padding: '10px 12px', background: C.code, border: `1px solid ${C.line3}`, font: mono(11.5, 400, 1.55), color: fix ? C.softer : C.muted, whiteSpace: 'pre-wrap' }}>
          {fix ?? (row?.cve ? 'No fixed release is published for this advisory. Replace the package or pin a version outside the affected range.' : 'Review the signal above before upgrading or pinning.')}
        </pre>
      </div>
      <div className="grow" />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
        <CopyButton primary text={fix ?? ''} label="COPY FIX" disabled={!fix} />
        {row?.cve
          ? <GhostLink external href={`https://osv.dev/vulnerability/${encodeURIComponent(row.cve.id)}`}>OPEN ADVISORY ↗</GhostLink>
          : <GhostLink external href={`https://www.npmjs.com/package/${node.name}/v/${node.version}`}>OPEN ON NPM ↗</GhostLink>}
      </div>
    </aside>
  );
}

/** Canvas graph: the threat map's own node layout, projected and slowly orbiting. */
function DepCanvas({ nodes, edges, path, onPick }: {
  nodes: DepNode[]; edges: { from: string; to: string }[]; path: string[]; onPick: (n: DepNode) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ yaw: 0.5, drag: null as null | { x: number; yaw: number }, hover: -1, proj: [] as { x: number; y: number; r: number; n: DepNode }[] });
  const pos = useMemo(() => computeNodePositions(nodes), [nodes]);
  const pathKey = path.join('>');
  const onPickRef = useRef(onPick);
  useEffect(() => { onPickRef.current = onPick; }, [onPick]);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const onPath = new Set(path);
    const pathEdges = new Set(path.slice(1).map((id, i) => `${path[i]}|${id}`));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let t = 0;
    let max = 1;
    pos.forEach(([x, y, z]) => { max = Math.max(max, Math.abs(x), Math.abs(y), Math.abs(z)); });

    const draw = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const st = state.current;
      if (!st.drag && !reduced) st.yaw += 0.0016;
      t += 1;
      const cY = Math.cos(st.yaw), sY = Math.sin(st.yaw), pitch = 0.42, cP = Math.cos(pitch), sP = Math.sin(pitch);
      const scale = (Math.min(w, h) * 0.42) / max;
      const cx = w / 2, cy = h / 2 + 12;
      const P = new Map<string, { x: number; y: number; z: number; k: number }>();
      nodes.forEach((n) => {
        const p = pos.get(n.id); if (!p) return;
        const x0 = p[0] * scale, y0 = -p[1] * scale, z0 = p[2] * scale;
        const x = x0 * cY - z0 * sY, zr = x0 * sY + z0 * cY;
        const y = y0 * cP - zr * sP, z = y0 * sP + zr * cP;
        const k = 880 / (z + 1100);
        P.set(n.id, { x: cx + x * k, y: cy + y * k, z, k });
      });
      const fade = (z: number) => Math.max(0.25, Math.min(1, 1.1 - (z + 300) / 700));
      for (const e of edges) {
        const a = P.get(e.from), b = P.get(e.to); if (!a || !b) continue;
        const on = pathEdges.has(`${e.from}|${e.to}`);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        if (on) {
          ctx.strokeStyle = C.orange; ctx.lineWidth = 2; ctx.setLineDash([10, 6]); ctx.lineDashOffset = -t * 0.6;
          ctx.shadowColor = 'rgba(255,138,43,.6)'; ctx.shadowBlur = 8;
        } else {
          ctx.strokeStyle = `rgba(62,128,235,${(onPath.size ? 0.12 : 0.34) * fade((a.z + b.z) / 2)})`; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.shadowBlur = 0;
        }
        ctx.stroke();
      }
      ctx.setLineDash([]); ctx.shadowBlur = 0;
      const order = nodes.filter((n) => P.has(n.id)).sort((a, b) => P.get(b.id)!.z - P.get(a.id)!.z);
      const proj: typeof st.proj = [];
      for (const n of order) {
        const q = P.get(n.id)!;
        const worst = worstCveSeverity(n);
        const signal = !worst && hasRiskSignal(n);
        const base = n.isRoot ? 13 : worst ? 4.6 : signal ? 3.8 : n.isDirect ? 5 : 2;
        const rad = Math.max(1.2, base * q.k);
        const color = n.isRoot ? C.orange : worst ? SEV[worst].color : signal ? SCENE_COLORS.riskSignal : n.isDirect ? C.blue : C.blueDeep;
        const dim = onPath.size && !onPath.has(n.id) && !worst && !n.isRoot;
        ctx.globalAlpha = (dim ? 0.12 : 1) * fade(q.z);
        ctx.beginPath(); ctx.arc(q.x, q.y, rad, 0, Math.PI * 2);
        if (n.isRoot) {
          const g = ctx.createRadialGradient(q.x - rad * 0.3, q.y - rad * 0.3, 1, q.x, q.y, rad);
          g.addColorStop(0, '#FFC48A'); g.addColorStop(0.55, C.orange); g.addColorStop(1, '#B94A00');
          ctx.fillStyle = g; ctx.shadowColor = 'rgba(255,138,43,.35)'; ctx.shadowBlur = 30;
        } else {
          ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = worst ? 10 : 0;
        }
        ctx.fill(); ctx.shadowBlur = 0;
        if (onPath.has(n.id) && !n.isRoot) {
          ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(q.x, q.y, rad + 3, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        proj.push({ x: q.x, y: q.y, r: Math.max(rad, 5), n });
        if (onPath.has(n.id) || worst || (n.isDirect && q.z < -40 && !onPath.size) || proj.length - 1 === st.hover) {
          ctx.font = `500 10px ${"'JetBrains Mono', monospace"}`;
          ctx.fillStyle = worst ? SEV[worst].color : onPath.has(n.id) ? C.bright : C.muted;
          ctx.shadowColor = C.bg; ctx.shadowBlur = 6;
          ctx.fillText(n.isRoot ? n.name : `${n.name}${worst || onPath.has(n.id) ? `@${n.version}` : ''}`, q.x + rad + 6, q.y + 3);
          ctx.shadowBlur = 0;
        }
      }
      st.proj = proj;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, pos, pathKey]);

  const hit = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const list = state.current.proj;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if ((p.x - x) ** 2 + (p.y - y) ** 2 <= (p.r + 3) ** 2) return i;
    }
    return -1;
  };

  return (
    <canvas ref={ref} role="img" aria-label="Dependency graph — drag to rotate, click a package to inspect"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'grab', touchAction: 'none' }}
      onPointerDown={(e) => { state.current.drag = { x: e.clientX, yaw: state.current.yaw }; (e.target as Element).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => {
        const st = state.current;
        if (st.drag) st.yaw = st.drag.yaw + (e.clientX - st.drag.x) * 0.006;
        else { st.hover = hit(e); (e.target as HTMLElement).style.cursor = st.hover >= 0 ? 'pointer' : 'grab'; }
      }}
      onPointerUp={(e) => {
        const st = state.current;
        const moved = st.drag ? Math.abs(e.clientX - st.drag.x) > 4 : false;
        st.drag = null;
        if (!moved) { const i = hit(e); if (i >= 0) onPickRef.current(st.proj[i].n); }
      }}
    />
  );
}
