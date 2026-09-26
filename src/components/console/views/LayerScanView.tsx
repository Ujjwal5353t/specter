'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { scoreImpact } from '@/lib/console/derive';
import { C, mono, SEV, sevRank, worstOf } from '@/lib/console/theme';
import { scanViewHref } from '@/lib/console/views';
import type { DockerFinding, ScanResult } from '@/types';
import { CopyButton, Empty, GhostLink, Label, Legend, useSelection } from '../ui';
import { useJson } from '../useWidth';

interface Instruction { instr: string; args: string; line: number }

const FS_INSTR = new Set(['FROM', 'RUN', 'COPY', 'ADD', 'WORKDIR']);
const DOCKER_KEYWORDS = /^(FROM|RUN|CMD|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|HEALTHCHECK)\b/i;

/** The scanner's fix text as Dockerfile lines: literal instructions stay, advice becomes a comment. */
function fixLines(fix: string): string[] {
  return fix.split('\n').map((l) => l.replace(/^(Pin|Use|Add):\s*/i, '')).map((l) => (DOCKER_KEYWORDS.test(l) ? l : `# ${l}`));
}

export default function LayerScanView({ result: r }: { result: ScanResult }) {
  const demo = r.scanId.startsWith('demo-');
  const findings = useMemo(() => r.layerscan?.findings ?? [], [r]);
  const noDockerfile = !r.layerscan || r.layerscan.baseImage === 'No Dockerfile found';
  const df = useJson<{ path: string | null; instructions: Instruction[] }>(demo || noDockerfile ? null : `/api/scan/${r.scanId}/dockerfile`);
  const [selRaw, setSelRaw] = useSelection();
  const sel = selRaw != null && selRaw !== '' && !Number.isNaN(Number(selRaw)) ? Number(selRaw) : null;
  const setSel = (i: number) => setSelRaw(String(i));

  const instructions = useMemo(() => df.data?.instructions ?? [], [df.data]);
  const byLine = useMemo(() => {
    const m = new Map<number, { f: DockerFinding; i: number }[]>();
    findings.forEach((f, i) => { if (!m.has(f.layer)) m.set(f.layer, []); m.get(f.layer)!.push({ f, i }); });
    return m;
  }, [findings]);
  const global = useMemo(() => byLine.get(0) ?? [], [byLine]);
  const users = instructions.filter((x) => x.instr === 'USER');
  const finalUser = users.length ? users[users.length - 1].args : null;
  const stages = instructions.filter((x) => x.instr === 'FROM').length;
  const fsLayers = instructions.filter((x) => FS_INSTR.has(x.instr)).length;
  const impact = scoreImpact(r, ['layerscan']);
  const baseFlag = findings.some((f) => /latest|unversioned/.test(f.issue));

  const patch = useMemo(() => {
    const out: { kind: ' ' | '-' | '+'; text: string }[] = [];
    for (const ins of instructions) {
      const hits = byLine.get(ins.line) ?? [];
      const text = `${ins.instr} ${ins.args}`;
      if (!hits.length) { out.push({ kind: ' ', text }); continue; }
      out.push({ kind: '-', text });
      for (const { f } of hits) for (const l of fixLines(f.fix)) out.push({ kind: '+', text: l });
    }
    for (const { f } of global) for (const l of fixLines(f.fix)) out.push({ kind: '+', text: l });
    return out;
  }, [instructions, byLine, global]);
  const ignoreFix = findings.find((f) => /\.dockerignore/.test(f.fix));
  const dockerignore = ignoreFix ? (ignoreFix.fix.split(':').slice(1).join(':').split(',').map((s) => s.trim()).filter(Boolean)) : [];
  const patchText = patch.filter((l) => l.kind !== '-').map((l) => l.text).join('\n') + (dockerignore.length ? `\n\n# .dockerignore\n${dockerignore.join('\n')}` : '');

  if (noDockerfile) {
    return (
      <div>
        <div className="sx-pad" style={{ padding: '20px 24px 0' }}><Label color={C.cyan} size={10}>{'// LAYERSCAN · CONTAINER INTELLIGENCE'}</Label></div>
        <Empty title="NO DOCKERFILE">LayerScan looked for Dockerfile, Dockerfile.prod, docker/Dockerfile and deploy/Dockerfile and found none, so there is no image to analyse.</Empty>
      </div>
    );
  }

  const sorted = findings.map((f, i) => ({ f, i })).sort((a, b) => sevRank(a.f.severity) - sevRank(b.f.severity));
  const selIdx = sel ?? sorted[0]?.i ?? null;

  return (
    <div className="sx-split">
      <section className="sx-main relative" aria-label="Image layer stack" style={{ minHeight: 856, overflow: 'hidden', background: 'radial-gradient(ellipse 60% 55% at 35% 55%, #081424, #03060B 75%)' }}>
        <div className="sx-pad flex flex-col" style={{ padding: '20px 24px', gap: 8 }}>
          <div style={{ font: mono(10, 500), letterSpacing: '.2em', color: C.cyan }}>{'// LAYERSCAN · CONTAINER INTELLIGENCE'}</div>
          <div style={{ fontSize: 17, fontWeight: 500, color: C.bright }}>
            {df.data?.path ?? 'Dockerfile'} · {instructions.length || '—'} instructions · {fsLayers || '—'} filesystem layers
          </div>
          <div className="flex flex-wrap" style={{ gap: 14, font: mono(10.5), color: C.muted }}>
            <span>BASE <span style={{ color: baseFlag ? C.amber : C.softer }}>{r.layerscan!.baseImage}</span></span>
            <span>STAGES <span style={{ color: C.softer }}>{stages || '—'}</span></span>
            <span>FINAL USER <span style={{ color: finalUser && finalUser !== 'root' && finalUser !== '0' ? C.green : C.redSoft }}>{instructions.length ? finalUser ?? 'root (no USER)' : '—'}</span></span>
          </div>
        </div>
        {df.loading && <div style={{ padding: '0 24px', font: mono(11), color: C.muted }}>Reading Dockerfile…</div>}
        {(df.error || demo) && <div style={{ padding: '0 24px', font: mono(11), color: C.muted }}>{demo ? 'Layer stack is not available for sample reports — findings are listed on the right.' : `Layer stack unavailable: ${df.error}. Findings are listed on the right.`}</div>}
        {instructions.length > 0 && <Stack instructions={instructions} byLine={byLine} global={global} selIdx={selIdx} onPick={setSel} />}
        <div className="absolute sx-hide-sm" style={{ left: 24, bottom: 20 }}>
          <Legend items={[
            { swatch: <span />, label: 'BUILD ORDER ↑' },
            { swatch: <span style={{ width: 8, height: 8, background: C.red, transform: 'rotate(45deg)' }} />, label: 'FINDING ON LAYER' },
            { swatch: <span style={{ width: 12, height: 6, border: `1px dashed ${C.dimmer}` }} />, label: 'METADATA ONLY' },
          ]} />
        </div>
      </section>

      <aside className="sx-aside flex flex-col" style={{ width: 596 }}>
        <div className="flex items-center justify-between" style={{ height: 44, padding: '0 24px', borderBottom: `1px solid ${C.line}`, font: mono(10, 500), letterSpacing: '.18em' }}>
          <span style={{ color: C.ink }}>LAYER FINDINGS</span>
          <span style={{ color: C.dim }}>{findings.length} OPEN · SCORE IMPACT {impact}</span>
        </div>
        {findings.length === 0 && <Empty title="CLEAN IMAGE">No LayerScan rule fired on this Dockerfile.</Empty>}
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {sorted.map(({ f, i }) => {
            const on = i === selIdx;
            return (
              <li key={i}>
                <button type="button" onClick={() => setSel(i)} className="sx-tr w-full grid text-left"
                  style={{ padding: '16px 24px', borderBottom: `1px solid ${C.row}`, gridTemplateColumns: '64px minmax(0,1fr) auto', columnGap: 14, rowGap: 6, background: on ? 'rgba(255,61,79,.04)' : 'transparent', boxShadow: on ? `inset 2px 0 0 ${SEV[f.severity].color}` : 'none' }}>
                  <span style={{ font: mono(10, 600, 1.4), letterSpacing: '.1em', color: SEV[f.severity].color }}>{SEV[f.severity].label}</span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: C.bright }}>{f.issue}</span>
                  <span style={{ font: mono(10.5, 400, 1.4), color: C.muted }}>{f.layer > 0 ? `Dockerfile:${f.layer}` : 'image-wide'}</span>
                  <span />
                  <span style={{ gridColumn: 'span 2', fontSize: 12.5, lineHeight: 1.5, color: C.soft, whiteSpace: 'pre-wrap' }}>
                    {f.instruction && f.instruction !== '[REDACTED]' && f.layer > 0 && <span style={{ font: mono(11), color: C.softer }}>{f.instruction}{'\n'}</span>}
                    Fix: {f.fix}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {patch.length > 0 && findings.length > 0 && (
          <>
            <div className="flex justify-between" style={{ padding: '18px 24px 8px', font: mono(10, 500), letterSpacing: '.16em' }}>
              <span style={{ color: C.muted }}>PROPOSED DOCKERFILE</span>
              {impact > 0 && <span style={{ color: C.green }}>−{impact} SCORE</span>}
            </div>
            <div className="sx-scroll" style={{ margin: '0 24px', border: `1px solid ${C.line3}`, background: C.well, padding: '8px 0', font: mono(12, 400, 1.7), maxHeight: 360 }}>
              {patch.map((l, i) => (
                <div key={i} className="grid" style={{ gridTemplateColumns: '26px minmax(0,1fr)', background: l.kind === '-' ? 'rgba(255,61,79,.07)' : l.kind === '+' ? 'rgba(63,207,142,.07)' : 'transparent', color: l.kind === '-' ? '#FF8A94' : l.kind === '+' ? '#7FE0B0' : C.muted }}>
                  <span style={{ textAlign: 'center' }}>{l.kind === ' ' ? '' : l.kind === '-' ? '−' : '+'}</span>
                  <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: 10 }}>{l.text}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="grow" />
        <div className="flex flex-wrap" style={{ padding: '16px 24px 22px', borderTop: `1px solid ${C.line}`, gap: 8 }}>
          <CopyButton primary text={patchText} disabled={!instructions.length || !findings.length} label={dockerignore.length ? 'COPY PATCH + .dockerignore' : 'COPY PATCH'} style={{ flexGrow: 1, height: 40 }} />
          <GhostLink href={`/scan/${r.scanId}`} style={{ height: 40 }}>SHOW IN MAP</GhostLink>
        </div>
        <div style={{ padding: '0 24px 18px', font: mono(10, 400, 1.5), color: C.dim }}>
          Secrets baked into layers also appear under <Link href={scanViewHref('sec', r.scanId)}>Secrets</Link>.
        </div>
      </aside>
    </div>
  );
}

function Stack({ instructions, byLine, global, selIdx, onPick }: {
  instructions: Instruction[];
  byLine: Map<number, { f: DockerFinding; i: number }[]>;
  global: { f: DockerFinding; i: number }[];
  selIdx: number | null;
  onPick: (i: number) => void;
}) {
  const n = instructions.length;
  const step = Math.max(26, Math.min(70, 560 / Math.max(n, 1)));
  const HW = 150, HH = 64, T = 10, CX = 240;
  const top = 120;
  const height = top + HH * 2 + step * (n - 1) + 90;
  // Bottom slab = first instruction; build order goes up.
  const yOf = (k: number) => top + HH + step * (n - 1 - k);
  const slabColor = (k: number) => {
    const hits = byLine.get(instructions[k].line) ?? [];
    const topHits = k === n - 1 ? [...hits, ...global] : hits;
    return worstOf(topHits.map((h) => h.f.severity));
  };
  let fsIndex = -1;
  const layerNo = instructions.map((ins) => (FS_INSTR.has(ins.instr) ? `L${++fsIndex}` : '··'));

  const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

  return (
    <svg viewBox={`0 0 780 ${height}`} preserveAspectRatio="xMinYMin meet" style={{ display: 'block', width: '100%', maxWidth: 980, height: 'auto' }}
      role="img" aria-label={`Image layer stack, ${n} instructions`}>
      <line x1={CX} y1={top - 20} x2={CX} y2={yOf(0) + HH + 20} stroke="rgba(79,216,240,.12)" strokeDasharray="2 4" />
      {instructions.map((ins, k) => {
        const y = yOf(k);
        const sev = slabColor(k);
        const meta = !FS_INSTR.has(ins.instr);
        const edge = sev ? SEV[sev].color : ins.instr === 'FROM' ? C.slate : C.blue;
        const fill = sev ? `${SEV[sev].color}29` : ins.instr === 'FROM' ? 'rgba(93,127,168,.22)' : 'rgba(53,118,238,.14)';
        const hits = [...(byLine.get(ins.line) ?? []), ...(k === n - 1 ? global : [])];
        const on = hits.some((h) => h.i === selIdx);
        return (
          <g key={k} style={{ cursor: hits.length ? 'pointer' : 'default' }} onClick={() => hits.length && onPick(hits[0].i)}>
            <title>{`${ins.instr} ${ins.args} — Dockerfile:${ins.line}`}</title>
            {!meta && (
              <>
                <polygon points={`${CX - HW},${y} ${CX},${y + HH} ${CX},${y + HH + T} ${CX - HW},${y + T}`} fill={sev ? '#2A0A10' : '#0B1A33'} stroke={sev ? `${edge}80` : '#1E3A66'} />
                <polygon points={`${CX},${y + HH} ${CX + HW},${y} ${CX + HW},${y + T} ${CX},${y + HH + T}`} fill={sev ? '#1F070C' : '#081428'} stroke={sev ? `${edge}80` : '#1E3A66'} />
              </>
            )}
            <polygon className={sev === 'critical' ? 'sx-hot' : ''} points={`${CX},${y - HH} ${CX + HW},${y} ${CX},${y + HH} ${CX - HW},${y}`}
              fill={meta ? 'none' : fill} stroke={on ? '#fff' : meta ? C.dimmer : edge} strokeDasharray={meta ? '3 3' : undefined} strokeWidth={on ? 1.5 : 1} />
            {hits.slice(0, 3).map((h, j) => {
              const hx = CX - 30 + j * 30, hy = y - 8 + (j % 2) * 14;
              return <polygon key={j} className="sx-hot" points={`${hx},${hy - 8} ${hx + 8},${hy} ${hx},${hy + 8} ${hx - 8},${hy}`} fill={SEV[h.f.severity].color} />;
            })}
            <polyline points={`${CX + HW},${y} ${CX + HW + 40},${y}`} fill="none" stroke={sev ? edge : '#1E3348'} />
            <text x={440} y={y - 2} fontFamily="JetBrains Mono, monospace" fontSize="12.5" fill={sev ? SEV[sev].color : ins.instr === 'FROM' ? C.softer : C.body}>
              <tspan fill={sev ? SEV[sev].color : '#2A5CC0'} opacity={0.75}>{layerNo[k]}</tspan> {clip(`${ins.instr} ${ins.args}`, 44)}
            </text>
            <text x={440} y={y + 14} fontFamily="JetBrains Mono, monospace" fontSize="9.5" letterSpacing=".12em">
              {hits.slice(0, 1).map((h, j) => <tspan key={j} fill={SEV[h.f.severity].color}>■ {clip(h.f.issue.split(' — ')[0].toUpperCase(), 30)}  </tspan>)}
              <tspan fill={C.dim}>{hits.length > 1 ? `+${hits.length - 1} · ` : ''}Dockerfile:{ins.line}</tspan>
            </text>
          </g>
        );
      })}
      <line x1="60" x2="420" y1={top} y2={top} stroke="rgba(79,216,240,.55)" strokeWidth="1" opacity="0">
        <animate attributeName="y1" values={`${yOf(0) + HH};${top - HH}`} dur="5s" repeatCount="indefinite" />
        <animate attributeName="y2" values={`${yOf(0) + HH};${top - HH}`} dur="5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.85;1" dur="5s" repeatCount="indefinite" />
      </line>
    </svg>
  );
}
