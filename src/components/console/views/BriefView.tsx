'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useScanStore } from '@/store/scanStore';
import { useConsole } from '@/lib/console/store';
import { generateReport } from '@/lib/report';
import { computeNodePositions } from '@/lib/depGraphLayout';
import {
  allFindings, attackPath, buildAiFindings, ENGINE_NAME, ENGINE_VIEW, remediationPlan, scoreBuckets,
} from '@/lib/console/derive';
import { band, C, fmtTime, mono, SEV } from '@/lib/console/theme';
import { scanViewHref } from '@/lib/console/views';
import type { AIExplanation, ScanResult } from '@/types';
import { Label, PrimaryButton, GhostButton } from '../ui';

type AiState = 'idle' | 'loading' | 'ok' | 'failed' | 'unconfigured' | 'empty';

// One request per scan across mounts (the map page merges its own result into the same store).
const aiInflight = new Map<string, Promise<void>>();

function useAiBrief(r: ScanResult) {
  const hasFindings = buildAiFindings(r).length > 0;
  const [state, setState] = useState<AiState>(r.aiExplanation ? 'ok' : hasFindings ? 'loading' : 'empty');

  // Requests the brief; state updates happen only when the response lands.
  const request = useCallback((force: boolean) => {
    const findings = buildAiFindings(r);
    if (findings.length === 0) return;
    if (!force && aiInflight.has(r.scanId)) {
      aiInflight.get(r.scanId)!.then(() => setState(useScanStore.getState().scanResult?.aiExplanation ? 'ok' : 'failed'));
      return;
    }
    const p = fetch('/api/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ findings }) })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (res.status === 503 && data?.error === 'ai_not_configured') return setState('unconfigured');
        if (!res.ok || !data || typeof data.summary !== 'string' || !Array.isArray(data.items)) return setState('failed');
        if (useScanStore.getState().scanResult?.scanId !== r.scanId) return;
        useScanStore.setState((s) => ({ scanResult: s.scanResult ? { ...s.scanResult, aiExplanation: data as AIExplanation } : s.scanResult }));
        setState('ok');
      })
      .catch(() => setState('failed'))
      .finally(() => aiInflight.delete(r.scanId));
    aiInflight.set(r.scanId, p);
  }, [r]);

  useEffect(() => {
    if (!useScanStore.getState().scanResult?.aiExplanation) request(false);
  }, [request]);

  const regenerate = () => {
    if (!hasFindings) return;
    setState('loading');
    request(true);
  };
  const regenerating = state === 'loading' && !!r.aiExplanation;
  return { state: r.aiExplanation && !regenerating ? ('ok' as const) : state, regenerate };
}

const H = ({ n, children }: { n: string; children: React.ReactNode }) => (
  <div style={{ font: mono(10.5, 500), letterSpacing: '.24em', color: C.cyan }}>{n} — {children}</div>
);

export default function BriefView({ result: r }: { result: ScanResult }) {
  const system = useConsole((s) => s.system);
  const ai = useAiBrief(r);
  const [tg, setTg] = useState<{ busy: boolean; msg: string | null; ok?: boolean }>({ busy: false, msg: null });
  const findings = useMemo(() => allFindings(r), [r]);
  const stages = useMemo(() => attackPath(r), [r]);
  const plan = useMemo(() => remediationPlan(r), [r]);
  const b = band(r.threatScore);
  const demo = r.scanId.startsWith('demo-');
  const crit = findings.filter((f) => f.severity === 'critical').length;
  const high = findings.filter((f) => f.severity === 'high').length;
  const engines = new Set(findings.map((f) => f.engine));
  const p0 = [...new Set(plan.filter((p) => p.priority === 'P0').map((p) => p.engine))];
  const projected = r.threatScore - (scoreBuckets(r).total - scoreBuckets(r, p0).total);
  const at = r.scannedAt ?? null;
  const docId = `SPX-${at ? new Date(at).toISOString().slice(0, 10).replace(/-/g, '').replace(/^(\d{4})/, '$1-') : 'LIVE'}-${r.scanId.slice(0, 6).toUpperCase()}`;

  const sendTelegram = async () => {
    setTg({ busy: true, msg: null });
    try {
      const res = await fetch(`/api/scan/${r.scanId}/telegram`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setTg({ busy: false, ok: res.ok, msg: res.ok ? 'Brief sent to Telegram' : data.error ?? 'Send failed' });
    } catch {
      setTg({ busy: false, ok: false, msg: 'Send failed' });
    }
  };

  const phrase = crit || high
    ? `${crit ? `${crit} critical` : ''}${crit && high ? ' and ' : ''}${high ? `${high} high-severity` : ''} finding${crit + high === 1 ? '' : 's'}`
    : `${findings.length} lower-severity finding${findings.length === 1 ? '' : 's'}`;

  return (
    <div className="sx-split">
      <main className="sx-main flex flex-col" style={{ minWidth: 0 }}>
        <div className="sx-pad flex items-center justify-between" style={{ height: 40, flexShrink: 0, padding: '0 40px', borderBottom: `1px solid ${C.line}`, font: mono(10, 500), letterSpacing: '.16em', color: C.dim, gap: 12 }}>
          <span className="sx-trunc">DOC {docId} · INTELLIGENCE BRIEF</span>
          <span className="flex items-center shrink-0" style={{ gap: 14 }}>
            <span className="sx-hide-sm">{at ? `SCANNED ${fmtTime(at)}` : demo ? 'SAMPLE REPORT' : ''}</span>
            <span style={{ padding: '4px 8px', border: `1px solid ${b.color}80`, color: b.color }}>{b.label} RISK</span>
          </span>
        </div>

        <article className="sx-pad flex flex-col" style={{ padding: '30px 40px 28px', gap: 26 }}>
          <header className="flex flex-col" style={{ gap: 12 }}>
            <H n="01">THREAT ASSESSMENT</H>
            <h1 style={{ margin: 0, fontWeight: 400, fontSize: 25, lineHeight: 1.35, color: C.bright, maxWidth: 780, textWrap: 'pretty' }}>
              {findings.length === 0 ? (
                <>No engine reported a finding for this repository. <span style={{ color: C.green }}>Nothing to remediate</span> in this scan window.</>
              ) : (
                <>
                  The repository carries <span style={{ color: crit || high ? '#FF6B78' : C.amber }}>{phrase}</span> across {engines.size} of 5 engines.
                  {stages.length >= 2 && <> They line up into a {stages.length}-stage path from {stages[0].title.toLowerCase()} to {stages[stages.length - 1].title.toLowerCase()}.</>}
                </>
              )}
            </h1>
            <div className="flex flex-wrap" style={{ gap: 22, font: mono(10.5), color: C.muted }}>
              <span>SCORE <span style={{ color: b.color }}>{r.threatScore} {b.label}</span></span>
              <span>FINDINGS <span style={{ color: C.ink }}>{findings.length}</span></span>
              <span>ENGINES <span style={{ color: C.ink }}>{engines.size}/5</span></span>
              <span>ANALYST <span style={{ color: C.ink }}>{system?.ai ? `specter-brief · ${system.ai}` : system ? 'not configured' : '—'}</span></span>
            </div>
          </header>

          <section className="flex flex-col" style={{ gap: 14 }}>
            <H n="02">PRIMARY ATTACK PATH</H>
            {stages.length === 0 ? (
              <div style={{ padding: '14px 16px', border: `1px solid ${C.line3}`, fontSize: 13.5, color: C.softer }}>
                No entry point, build amplifier, privilege or exposed write surface was found, so there is no chained path to show.
              </div>
            ) : (
              <ol className="sx-grid-cells" style={{ margin: 0, padding: 0, listStyle: 'none', gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`, border: `1px solid ${C.line3}` }}>
                {stages.map((s, i) => {
                  const last = i === stages.length - 1;
                  return (
                    <li key={s.phase} style={{ padding: '14px 16px', borderRight: last ? 0 : `1px solid ${C.line3}`, position: 'relative', background: last ? 'rgba(255,61,79,.05)' : 'transparent' }}>
                      <Link href={scanViewHref(s.view, r.scanId)} className="flex flex-col" style={{ gap: 8, color: 'inherit' }}>
                        <div className="flex justify-between" style={{ font: mono(10, 500), letterSpacing: '.12em' }}>
                          <span style={{ color: SEV[s.severity].color }}>STAGE {String(i + 1).padStart(2, '0')}</span>
                          <span style={{ color: C.dimmer }}>{s.phase}</span>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 500, color: C.bright }}>{s.title}</div>
                        <div style={{ font: mono(10.5, 400, 1.5), color: C.soft, wordBreak: 'break-word' }}>{s.lines.map((l, j) => <div key={j}>{l}</div>)}</div>
                      </Link>
                      {!last && (
                        <span className="sx-hide-sm" style={{ position: 'absolute', right: -8, top: '50%', width: 15, height: 15, marginTop: -7, background: C.bg, border: `1px solid ${C.line3}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.red, font: mono(10, 500), zIndex: 1 }}>›</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', columnGap: 36, rowGap: 24 }}>
            <section className="flex flex-col" style={{ gap: 12 }}>
              <H n="03">WHY THIS MATTERS</H>
              <AiText state={ai.state} onRetry={ai.regenerate}>
                {r.aiExplanation?.summary}
              </AiText>
            </section>
            <section className="flex flex-col" style={{ gap: 12 }}>
              <H n="04">WHAT AN ATTACKER COULD DO</H>
              {ai.state === 'ok' && r.aiExplanation ? (
                <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13.5, lineHeight: 1.45, color: C.softer }}>
                  {r.aiExplanation.items.slice(0, 4).map((it, i) => (
                    <li key={i} className="grid" style={{ gridTemplateColumns: '26px minmax(0,1fr)' }}>
                      <span style={{ font: mono(11, 500, 1.6), color: i < 2 ? C.red : C.orange }}>A{i + 1}</span>
                      <span><span style={{ color: C.ink }}>{it.title}.</span> {it.attack_pattern}</span>
                    </li>
                  ))}
                </ol>
              ) : <AiText state={ai.state} onRetry={ai.regenerate} />}
            </section>
          </div>

          <section className="flex flex-col" style={{ gap: 12 }}>
            <div className="flex flex-wrap justify-between items-baseline" style={{ gap: 8 }}>
              <H n="05">RECOMMENDED REMEDIATION</H>
              {p0.length > 0 && (
                <div style={{ font: mono(10.5), color: C.muted }}>PROJECTED SCORE AFTER P0 <span style={{ color: C.amber }}>{r.threatScore} → {projected}</span></div>
              )}
            </div>
            {plan.length === 0 ? (
              <div style={{ fontSize: 13.5, color: C.softer }}>No remediation required.</div>
            ) : (
              <div className="sx-table-wrap">
                <table style={{ width: '100%', minWidth: 620, borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ font: mono(9.5, 500), letterSpacing: '.14em', color: C.dim, textAlign: 'left' }}>
                      <th style={{ padding: '0 0 8px', fontWeight: 500, width: 48 }}>PRI</th>
                      <th style={{ padding: '0 0 8px', fontWeight: 500 }}>ACTION</th>
                      <th style={{ padding: '0 0 8px', fontWeight: 500, width: 120 }}>ENGINE</th>
                      <th style={{ padding: '0 0 8px', fontWeight: 500, width: 80 }}>FINDINGS</th>
                      <th style={{ padding: '0 0 8px', fontWeight: 500, width: 64, textAlign: 'right' }}>SCORE</th>
                    </tr>
                  </thead>
                  <tbody style={{ color: C.body }}>
                    {plan.map((p, i) => (
                      <tr key={p.engine} style={{ borderTop: `1px solid #111E2D`, borderBottom: i === plan.length - 1 ? '1px solid #111E2D' : undefined }}>
                        <td style={{ padding: '10px 0', font: mono(11, 600), color: p.priority === 'P0' ? C.red : p.priority === 'P1' ? C.orange : C.amber }}>{p.priority}</td>
                        <td style={{ padding: '10px 12px 10px 0' }}>{p.action}</td>
                        <td style={{ font: mono(11), color: C.soft }}><Link href={scanViewHref(ENGINE_VIEW[p.engine], r.scanId)} style={{ color: C.soft }}>{ENGINE_NAME[p.engine]}</Link></td>
                        <td style={{ font: mono(11), color: C.soft }}>{p.count}</td>
                        <td style={{ textAlign: 'right', font: mono(11, 500), color: p.impact > 0 ? C.green : C.muted }}>{p.impact > 0 ? `−${p.impact}` : '0'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <div style={{ font: mono(10), color: C.dimmer, letterSpacing: '.06em' }}>
            MACHINE-GENERATED ASSESSMENT · EVIDENCE LINKED TO SCAN {r.scanId.slice(0, 8).toUpperCase()} · VERIFY BEFORE ACTING
          </div>
        </article>
      </main>

      <aside className="sx-aside flex flex-col" style={{ width: 480 }}>
        <div className="flex justify-between items-center" style={{ padding: '18px 24px 12px', font: mono(10, 500), letterSpacing: '.18em' }}>
          <span style={{ color: C.ink }}>PATH IN THREAT MAP</span>
          <Link href={`/scan/${r.scanId}`}>OPEN 3D →</Link>
        </div>
        <PathMini r={r} stages={stages} />

        <div style={{ padding: '22px 24px 10px', font: mono(10, 500), letterSpacing: '.18em', color: C.ink }}>SUPPORTING EVIDENCE</div>
        <ul style={{ margin: 0, padding: '0 24px', listStyle: 'none' }}>
          {findings.length === 0 && <li style={{ padding: '10px 0', font: mono(11), color: C.muted, borderTop: `1px solid ${C.line}` }}>No findings.</li>}
          {findings.slice(0, 7).map((f, i) => (
            <li key={f.key} className="grid" style={{ padding: '10px 0', borderTop: `1px solid ${C.line}`, borderBottom: i === Math.min(findings.length, 7) - 1 ? `1px solid ${C.line}` : undefined, gridTemplateColumns: '44px minmax(0,1fr) auto', columnGap: 10, alignItems: 'baseline', fontSize: 13 }}>
              <span style={{ font: mono(9.5, 600), color: SEV[f.severity].color }}>{SEV[f.severity].short}</span>
              <span className="sx-trunc" style={{ color: C.ink }} title={f.title}>{f.title}</span>
              <Link href={`${scanViewHref(f.view, r.scanId)}${f.focus ? `?focus=${encodeURIComponent(f.focus)}` : ''}`} className="sx-trunc" style={{ font: mono(10), maxWidth: 140 }}>{f.where}</Link>
            </li>
          ))}
        </ul>
        {findings.length > 7 && <div style={{ padding: '10px 24px', font: mono(10), color: C.dim }}>+{findings.length - 7} more across the module views</div>}

        <div className="grow" />
        {tg.msg && <div style={{ padding: '0 24px 8px', font: mono(10.5), color: tg.ok ? C.green : C.orange }}>{tg.msg}</div>}
        <div className="grid" style={{ padding: '18px 24px 22px', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, borderTop: `1px solid ${C.line}` }}>
          <PrimaryButton onClick={() => generateReport(r)} style={{ height: 40 }}>EXPORT PDF</PrimaryButton>
          <GhostButton onClick={sendTelegram} disabled={demo || tg.busy || !system?.telegram} style={{ height: 40, padding: '0 8px' }}
            title={demo ? 'Unavailable for sample reports' : !system?.telegram ? 'Telegram is not configured on this server' : 'Send this brief to the configured Telegram chat'}>
            {tg.busy ? 'SENDING…' : 'SEND TO TELEGRAM'}
          </GhostButton>
          <GhostButton onClick={ai.regenerate} disabled={ai.state === 'loading' || ai.state === 'empty' || system?.ai === null} style={{ height: 40 }}
            title={system?.ai === null ? 'No LLM key configured' : 'Generate a fresh analyst brief'}>
            {ai.state === 'loading' ? 'GENERATING…' : 'REGENERATE'}
          </GhostButton>
        </div>
      </aside>
    </div>
  );
}

function AiText({ state, onRetry, children }: { state: AiState; onRetry: () => void; children?: React.ReactNode }) {
  if (state === 'ok' && children) return <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: C.softer, textWrap: 'pretty' }}>{children}</p>;
  const msg: Record<AiState, string> = {
    idle: 'Waiting for the analyst brief…',
    loading: 'Generating the analyst brief from this scan’s findings…',
    ok: '',
    failed: 'The analyst brief could not be generated.',
    unconfigured: 'No LLM key is configured, so there is no analyst narrative. The structured sections of this brief are still complete.',
    empty: 'No findings to analyse.',
  };
  return (
    <div className="flex flex-col items-start" style={{ gap: 8, fontSize: 13.5, lineHeight: 1.55, color: C.muted }}>
      <span className={state === 'loading' ? 'sx-live' : ''}>{msg[state]}</span>
      {state === 'failed' && <button type="button" onClick={onRetry} style={{ font: mono(10, 500), letterSpacing: '.12em', color: C.cyan }}>↻ RETRY</button>}
    </div>
  );
}

/** Dependency constellation (the map's own layout, top-down) with the attack path traced over it. */
function PathMini({ r, stages }: { r: ScanResult; stages: ReturnType<typeof attackPath> }) {
  const W = 430, HGT = 288;
  const { dots, links } = useMemo(() => {
    const nodes = r.depchain?.nodes ?? [];
    const pos = computeNodePositions(nodes);
    let max = 1;
    pos.forEach(([x, , z]) => { max = Math.max(max, Math.abs(x), Math.abs(z)); });
    const project = (id: string) => {
      const p = pos.get(id);
      return p ? [W / 2 + (p[0] / max) * (W / 2 - 20), HGT / 2 + (p[2] / max) * (HGT / 2 - 16)] as const : null;
    };
    const dots = nodes.map((n) => ({ id: n.id, p: project(n.id), direct: !!n.isDirect, vuln: (n.cves?.length ?? 0) > 0 })).filter((d) => d.p);
    const links = (r.depchain?.edges ?? []).slice(0, 400).map((e) => [project(e.from), project(e.to)] as const).filter(([a, b]) => a && b);
    return { dots, links };
  }, [r]);

  const pts = stages.map((_, i) => {
    const t = stages.length === 1 ? 0.5 : i / (stages.length - 1);
    return [52 + t * (W - 104), 200 - t * 110 + (i % 2 ? 22 : 0)] as const;
  });
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(0)} ${p[1].toFixed(0)}`).join('');
  const engines = new Set(stages.map((s) => s.engine)).size;

  return (
    <div style={{ margin: '0 24px', height: 290, position: 'relative', border: `1px solid ${C.line3}`, background: 'radial-gradient(ellipse at 50% 50%, #081424, #03060B 75%)', overflow: 'hidden' }}>
      <svg width="100%" height="288" viewBox={`0 0 ${W} ${HGT}`} preserveAspectRatio="xMidYMid meet" role="img"
        aria-label={stages.length ? `Attack path: ${stages.map((s) => s.title).join(' → ')}` : 'Dependency constellation'}>
        <g stroke="rgba(62,128,235,.22)" strokeWidth="0.8">
          {links.map(([a, b], i) => <line key={i} x1={a![0]} y1={a![1]} x2={b![0]} y2={b![1]} />)}
        </g>
        <g>
          {dots.map((n) => <circle key={n.id} cx={n.p![0]} cy={n.p![1]} r={n.vuln ? 2.4 : n.direct ? 1.8 : 1.2} fill={n.vuln ? C.orange : n.direct ? C.blue : C.blueDeep} />)}
        </g>
        {stages.length > 0 && (
          <>
            <path className="sx-flow" d={d} fill="none" stroke={C.red} strokeWidth="1.8" />
            {pts.map((p, i) => {
              const s = stages[i];
              const col = SEV[s.severity].color;
              return (
                <g key={s.phase}>
                  {i === 0 && <circle className="sx-spulse" cx={p[0]} cy={p[1]} r="12" fill={col} />}
                  {i === 0 ? <circle cx={p[0]} cy={p[1]} r="5" fill={col} />
                    : i === pts.length - 1 ? <rect x={p[0] - 6} y={p[1] - 6} width="12" height="12" fill={col} />
                    : <rect x={p[0] - 5} y={p[1] - 5} width="10" height="10" fill={col} transform={`rotate(45 ${p[0]} ${p[1]})`} />}
                  <text x={p[0] - 20} y={p[1] + (i % 2 ? 22 : -14)} fontFamily="JetBrains Mono, monospace" fontSize="9.5" fill={C.softer}>{s.lines[0].slice(0, 22)}</text>
                </g>
              );
            })}
          </>
        )}
      </svg>
      <div style={{ position: 'absolute', left: 10, top: 10 }}>
        <Label size={9}>{stages.length ? `${stages.length} HOP${stages.length > 1 ? 'S' : ''} · ${engines} ENGINE${engines > 1 ? 'S' : ''}` : `${dots.length} PACKAGES · NO CHAINED PATH`}</Label>
      </div>
    </div>
  );
}
