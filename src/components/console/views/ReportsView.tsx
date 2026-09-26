'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { resultFromStatus, type ScanStatusResponse } from '@/store/scanStore';
import { prepareScan, useConsole, type ScanListItem } from '@/lib/console/store';
import { generateReport } from '@/lib/report';
import { ENGINE_NAME, type Engine } from '@/lib/console/derive';
import { band, C, fmtDate, fmtDuration, fmtTime, mono, repoSlug, SEV } from '@/lib/console/theme';
import { scanViewHref } from '@/lib/console/views';
import type { Severity } from '@/types';
import { Chip, Empty, GhostButton, Label, PrimaryButton, useNow, ViewHeader } from '../ui';
import { useJson } from '../useWidth';

type Filter = 'all' | 'high' | 'week' | 'ready';

const STATUS: Record<ScanListItem['report'], { label: string; color: string }> = {
  ready: { label: 'READY', color: C.green },
  superseded: { label: 'SUPERSEDED', color: C.dim },
  expired: { label: 'EXPIRED', color: C.dim },
  scanning: { label: 'SCANNING', color: C.cyan },
  failed: { label: 'FAILED', color: C.redSoft },
};

export const reportId = (s: { id: string; created_at: string }) => {
  const d = new Date(s.created_at);
  return `SPX-${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${s.id.slice(0, 4).toUpperCase()}`;
};

export default function ReportsView() {
  const router = useRouter();
  const { scans, scansError, loadScans } = useConsole();
  const [filter, setFilter] = useState<Filter>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [pdf, setPdf] = useState<{ id: string; error: string | null } | null>(null);

  useEffect(() => { loadScans(true); }, [loadScans]);

  const now = useNow();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const all = useMemo(() => scans ?? [], [scans]);
  const counts = {
    high: all.filter((s) => (s.threat_score ?? 0) >= 50).length,
    week: all.filter((s) => new Date(s.created_at).getTime() >= weekAgo).length,
    ready: all.filter((s) => s.report === 'ready').length,
  };
  const rows = all.filter((s) =>
    filter === 'all' ? true : filter === 'high' ? (s.threat_score ?? 0) >= 50 : filter === 'week' ? new Date(s.created_at).getTime() >= weekAgo : s.report === 'ready');
  const repos = new Set(all.map((s) => s.repo_url)).size;
  const d = all.find((s) => s.id === sel) ?? rows.find((s) => s.threat_score != null) ?? null;

  const download = async (s: ScanListItem) => {
    setPdf({ id: s.id, error: null });
    try {
      const res = await fetch(`/api/scan/${s.id}/status`, { cache: 'no-store' });
      const data: ScanStatusResponse = await res.json();
      if (!res.ok || data.scan?.status !== 'completed') throw new Error(data.scan?.error_message ?? 'Results are no longer available');
      generateReport(resultFromStatus(s.id, data));
      setPdf(null);
    } catch (e) {
      setPdf({ id: s.id, error: e instanceof Error ? e.message : 'Export failed' });
    }
  };

  const openBrief = (s: ScanListItem) => {
    prepareScan(s.id);
    router.push(scanViewHref('ovr', s.id));
  };

  return (
    <div className="sx-root sx-split" style={{ background: C.bg }}>
      <main className="sx-main flex flex-col">
        <ViewHeader kicker="// INTELLIGENCE REPORTS · ARCHIVE"
          title={scans ? `${all.length} report${all.length === 1 ? '' : 's'} · ${repos} repositor${repos === 1 ? 'y' : 'ies'}` : 'Loading archive…'}
          right={
            <div className="flex flex-wrap" style={{ gap: 8 }}>
              <Chip active={filter === 'all'} onClick={() => setFilter('all')}>ALL</Chip>
              <Chip active={filter === 'ready'} onClick={() => setFilter('ready')}>READY {counts.ready}</Chip>
              <Chip active={filter === 'high'} onClick={() => setFilter('high')}>HIGH+ {counts.high}</Chip>
              <Chip active={filter === 'week'} onClick={() => setFilter('week')}>THIS WEEK {counts.week}</Chip>
            </div>
          } />
        {scansError && <Empty title="ARCHIVE UNAVAILABLE"><span style={{ color: C.redSoft }}>{scansError}</span></Empty>}
        {scans && all.length === 0 && <Empty title="NO REPORTS YET">Every scan you run lands here. Start one from the landing page.</Empty>}
        {rows.length > 0 && (
          <div className="sx-table-wrap">
            <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ height: 34, font: mono(9.5, 500), letterSpacing: '.14em', color: C.dim, textAlign: 'left', borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
                  <th style={{ fontWeight: 500, paddingLeft: 24, width: 150 }}>REPORT</th>
                  <th style={{ fontWeight: 500 }}>REPOSITORY</th>
                  <th style={{ fontWeight: 500, width: 120 }}>THREAT SCORE</th>
                  <th style={{ fontWeight: 500, width: 80 }}>FINDINGS</th>
                  <th style={{ fontWeight: 500, width: 100 }}>GENERATED</th>
                  <th style={{ fontWeight: 500, width: 108 }}>STATUS</th>
                  <th style={{ fontWeight: 500, width: 94, paddingRight: 24 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const b = s.threat_score != null ? band(s.threat_score) : null;
                  const on = s.id === d?.id;
                  const st = STATUS[s.report];
                  return (
                    <tr key={s.id} className="sx-tr" onClick={() => s.threat_score != null && setSel(s.id)} style={{ height: 56, borderBottom: `1px solid ${C.row}`, background: on ? C.sel : 'transparent', font: mono(11.5), cursor: s.threat_score != null ? 'pointer' : 'default' }}>
                      <td style={{ paddingLeft: 24, color: on ? '#fff' : C.ink, fontWeight: 500 }}>{reportId(s)}</td>
                      <td className="sx-trunc" style={{ color: C.ink }}>{repoSlug(s.repo_url)}{s.from_cache && <span style={{ color: C.dim, fontSize: 9.5, letterSpacing: '.1em' }}> · CACHED</span>}</td>
                      <td>
                        {b ? <span className="inline-flex items-baseline" style={{ gap: 8 }}><span style={{ fontSize: 16, fontWeight: 600, color: b.color }}>{s.threat_score}</span><span style={{ fontSize: 9.5, letterSpacing: '.12em', color: b.color }}>{b.label}</span></span>
                          : <span style={{ color: C.dim }}>··</span>}
                      </td>
                      <td style={{ color: C.softer }}>{s.findings ?? '—'}</td>
                      <td style={{ color: C.muted, fontSize: 10.5, lineHeight: 1.5 }}>{fmtDate(s.created_at)}<br />{fmtTime(s.created_at)}</td>
                      <td><span className={s.report === 'scanning' ? 'sx-live' : ''} style={{ fontSize: 9.5, letterSpacing: '.12em', color: st.color }} title={s.report === 'failed' ? s.error_message ?? '' : s.report === 'superseded' ? 'A newer scan of this repository replaced these results' : s.report === 'expired' ? 'Results are kept for 6 hours; rescan for current data' : ''}>{st.label}</span></td>
                      <td style={{ paddingRight: 24 }}>
                        <div className="flex justify-end" style={{ gap: 6 }}>
                          <IconBtn label={`Preview report ${reportId(s)}`} disabled={s.threat_score == null} onClick={() => setSel(s.id)} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0" />
                          <IconBtn label={`Download PDF ${reportId(s)}`} disabled={s.report !== 'ready' || pdf?.id === s.id} onClick={() => download(s)} d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pdf?.error && <div style={{ padding: '12px 24px', font: mono(10.5), color: C.orange }}>{pdf.error}</div>}
      </main>

      <aside className="sx-aside flex flex-col" style={{ width: 476, padding: '20px 28px 22px', gap: 14 }}>
        {d ? <Preview s={d} onView={() => openBrief(d)} onDownload={() => download(d)} busy={pdf?.id === d.id && !pdf.error} /> : <Empty title="PREVIEW">Pick a completed report.</Empty>}
      </aside>
    </div>
  );
}

function IconBtn({ label, d, onClick, disabled }: { label: string; d: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} className="sx-act"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${C.line2}`, color: C.soft, opacity: disabled ? 0.35 : 1 }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d={d} /></svg>
    </button>
  );
}

function Preview({ s, onView, onDownload, busy }: { s: ScanListItem; onView: () => void; onDownload: () => void; busy: boolean }) {
  const summary = useJson<{ total: number; engines: Record<string, Partial<Record<Severity, number>>> }>(s.source_scan_id ? `/api/scans/${s.source_scan_id}/summary` : null);
  const b = band(s.threat_score ?? 0);
  const engines = (['depchain', 'ghostcommit', 'layerscan', 'apibleed', 'envtrace'] as Engine[]);
  const dur = s.completed_at ? fmtDuration(new Date(s.completed_at).getTime() - new Date(s.created_at).getTime()) : null;
  const top = summary.data ? engines.map((e) => ({ e, n: Object.values(summary.data!.engines[e] ?? {}).reduce((a, x) => a + (x ?? 0), 0) })).filter((x) => x.n).sort((a, z) => z.n - a.n) : [];

  return (
    <>
      <div className="flex justify-between" style={{ font: mono(10, 500), letterSpacing: '.16em' }}>
        <span style={{ color: C.muted }}>PREVIEW · COVER PAGE</span><span style={{ color: C.dim }}>A4 · PDF</span>
      </div>
      <article className="relative grow flex flex-col" style={{ minHeight: 560, background: '#0A0F16', border: '1px solid #1A2838', padding: '26px 26px 20px', gap: 16, overflow: 'hidden', boxShadow: '0 30px 60px -30px rgba(0,0,0,.8)' }}>
        <div className="flex justify-between items-center" style={{ paddingBottom: 12, borderBottom: `2px solid ${C.ink}`, font: mono(9.5, 600), letterSpacing: '.2em' }}>
          <span className="flex items-center" style={{ gap: 8, color: C.bright }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="1.6" aria-hidden><path d="M12 1.5L22.5 12 12 22.5 1.5 12z" /></svg>SPECTER
          </span>
          <span style={{ color: b.color }}>{b.label} RISK</span>
        </div>
        <div style={{ font: mono(9.5, 500, 1.6), letterSpacing: '.14em', color: C.muted }}>
          SECURITY INTELLIGENCE REPORT<br />DOC {reportId(s)} · {fmtDate(s.created_at)}, {new Date(s.created_at).getFullYear()} · {fmtTime(s.created_at)}
        </div>
        <div className="flex flex-col" style={{ gap: 6 }}>
          <div style={{ fontSize: 26, fontWeight: 500, lineHeight: 1.15, color: C.white, wordBreak: 'break-word' }}>{repoSlug(s.repo_url)}</div>
          <div style={{ font: mono(11), color: C.muted }}>scan {s.id.slice(0, 8)} · {s.from_cache ? 'served from cache' : dur ? `ran in ${dur}` : 'fresh run'}</div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', borderTop: '1px solid #1A2838', borderBottom: '1px solid #1A2838' }}>
          <div className="flex flex-col" style={{ padding: '12px 0', gap: 6 }}><Label size={8.5}>THREAT SCORE</Label><span style={{ font: mono(30, 600), color: b.color }}>{s.threat_score}</span></div>
          <div className="flex flex-col" style={{ padding: '12px 0 12px 14px', borderLeft: '1px solid #1A2838', gap: 6 }}><Label size={8.5}>FINDINGS</Label><span style={{ font: mono(30, 600), color: C.bright }}>{s.findings ?? '—'}</span></div>
          <div className="flex flex-col" style={{ padding: '12px 0 12px 14px', borderLeft: '1px solid #1A2838', gap: 6 }}><Label size={8.5}>CRITICAL</Label><span style={{ font: mono(30, 600), color: C.red }}>{s.critical ?? '—'}</span></div>
        </div>
        <div className="flex flex-col" style={{ gap: 8 }}>
          <span style={{ font: mono(9, 600), letterSpacing: '.2em', color: C.soft }}>1. FINDINGS BY ENGINE</span>
          {!s.source_scan_id && <span style={{ fontSize: 12, color: C.muted }}>Per-engine detail is not stored for this cached replay.</span>}
          {summary.loading && <span style={{ fontSize: 12, color: C.muted }}>Loading…</span>}
          {summary.data && top.length === 0 && <span style={{ fontSize: 12, color: C.muted }}>No findings recorded.</span>}
          <div className="flex flex-col" style={{ gap: 5, font: mono(10.5, 400, 1.5), color: C.muted }}>
            {top.map(({ e, n }) => {
              const sev = summary.data!.engines[e] ?? {};
              return (
                <span key={e} className="flex justify-between" style={{ gap: 12 }}>
                  <span>{ENGINE_NAME[e]}</span>
                  <span className="flex" style={{ gap: 8 }}>
                    {(['critical', 'high', 'medium'] as Severity[]).filter((x) => sev[x]).map((x) => <span key={x} style={{ color: SEV[x].color }}>{sev[x]} {SEV[x].short}</span>)}
                    <span style={{ color: C.softer }}>{n}</span>
                  </span>
                </span>
              );
            })}
          </div>
        </div>
        <div className="absolute" style={{ right: 22, top: 150, padding: '8px 12px', border: `2px solid ${b.color}`, color: b.color, font: mono(13, 700), letterSpacing: '.2em', transform: 'rotate(-9deg)', opacity: 0.85 }}>{b.label} RISK</div>
        <div className="grow" />
        <div className="flex justify-between" style={{ paddingTop: 10, borderTop: '1px solid #1A2838', font: mono(8.5), letterSpacing: '.14em', color: C.dimmer }}>
          <span>MACHINE-GENERATED · VERIFY BEFORE ACTING</span><span>{STATUS[s.report].label}</span>
        </div>
      </article>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
        <GhostButton onClick={onView} disabled={s.report !== 'ready'} title={s.report !== 'ready' ? 'Only the latest scan of a repo keeps live results (6h)' : undefined} style={{ height: 40 }}>VIEW REPORT</GhostButton>
        <PrimaryButton onClick={onDownload} disabled={s.report !== 'ready' || busy} style={{ height: 40 }}>{busy ? 'EXPORTING…' : 'DOWNLOAD PDF'}</PrimaryButton>
      </div>
    </>
  );
}
