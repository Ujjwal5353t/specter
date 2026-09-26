'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useScanStore } from '@/store/scanStore';
import { prepareScan, useConsole } from '@/lib/console/store';
import { risesWithin } from '@/lib/console/history';
import { C, fmtDuration, fmtTime, mono, repoSlug, shortSha, timeAgo } from '@/lib/console/theme';
import { scanViewHref, type ViewId } from '@/lib/console/views';

const ENGINE_COUNT = 5;

export default function Hud({ view, scanId }: { view: ViewId; scanId: string | null }) {
  const router = useRouter();
  const scanResult = useScanStore((s) => s.scanResult);
  const isPolling = useScanStore((s) => s.isPolling);
  const progress = useScanStore((s) => s.progress);
  const reset = useScanStore((s) => s.reset);
  const { scans, system, meta, loadMeta, setPalette, setNav, navOpen } = useConsole();
  const m = scanId ? meta[scanId] : undefined;
  const info = m && m !== 'missing' ? m : null;
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [, tick] = useState(0);

  // Refresh the header once a polled scan lands, and keep "x min ago" current.
  useEffect(() => {
    if (scanId && scanResult?.scanId === scanId) loadMeta(scanId, true);
  }, [scanId, scanResult?.scanId, loadMeta]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const demo = !!scanId?.startsWith('demo-');
  const repoUrl = info?.scan.repo_url ?? (scanResult?.scanId === scanId ? scanResult?.repoUrl : null) ?? null;
  const [owner, name] = repoSlug(repoUrl).split('/');

  let statusText = 'NO SCAN';
  let statusColor: string = C.dim;
  let lastText = '—';
  if (isPolling) {
    const done = progress?.filter((p) => p.status !== 'running').length ?? 0;
    statusText = `SCANNING · ${Math.round((done / ENGINE_COUNT) * 100)}%`;
    statusColor = C.cyan;
    lastText = 'IN PROGRESS';
  } else if (demo) {
    statusText = 'SAMPLE REPORT';
    statusColor = C.amber;
  } else if (info) {
    const s = info.scan;
    if (s.status === 'failed') { statusText = 'FAILED'; statusColor = C.red; }
    else if (s.status !== 'completed') { statusText = 'SCANNING'; statusColor = C.cyan; }
    else if (s.from_cache) { statusText = 'COMPLETE · CACHED'; statusColor = C.green; }
    else if (s.completed_at) {
      statusText = `COMPLETE · ${fmtDuration(new Date(s.completed_at).getTime() - new Date(s.created_at).getTime())}`;
      statusColor = C.green;
    } else { statusText = 'COMPLETE'; statusColor = C.green; }
    const at = info.scannedAt ?? s.completed_at ?? s.created_at;
    lastText = `${fmtTime(at)} · ${timeAgo(at).toUpperCase()}`;
  }

  const channels = system ? [system.webhook && 'WEBHOOK', system.cron && 'SCHEDULE', system.telegram && 'TELEGRAM'].filter(Boolean) as string[] : [];
  const monitorLive = !!system && (system.webhook || system.cron);
  const alerts = useMemo(() => (scans ? risesWithin(scans, 24 * 60 * 60 * 1000) : []), [scans]);

  // Repo switcher: each repo's newest scan whose results can still be opened.
  const switchable = useMemo(() => {
    const seen = new Set<string>();
    return (scans ?? []).filter((s) => s.report === 'ready' && !seen.has(s.repo_url) && seen.add(s.repo_url)).slice(0, 8);
  }, [scans]);

  const openScan = (id: string) => {
    setMenu(false);
    prepareScan(id);
    const keep = view !== 'rpt' && view !== 'mon' ? view : 'map';
    router.push(scanViewHref(keep, id));
  };

  const newScan = () => {
    reset();
    router.push('/');
  };

  return (
    <header className="sx-root absolute left-0 right-0 top-0 z-30 flex items-stretch pointer-events-auto"
      style={{ height: 44, background: C.hud, borderBottom: `1px solid ${C.line}` }}>
      <button type="button" onClick={() => setNav(!navOpen)} aria-label="Open navigation" className="md:hidden flex items-center justify-center shrink-0"
        style={{ width: 44, borderRight: `1px solid ${C.line}`, color: C.soft }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      <button type="button" onClick={newScan} aria-label="Specter home — start a new scan" title="New scan"
        className="hidden md:flex shrink-0 items-center justify-center" style={{ width: 64, borderRight: `1px solid ${C.line}` }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="1.4" aria-hidden>
          <path d="M12 1.5L22.5 12 12 22.5 1.5 12z" /><path d="M12 7l5 5-5 5-5-5z" fill="rgba(79,216,240,.18)" />
        </svg>
      </button>
      <div className="flex items-center" style={{ padding: '0 20px', borderRight: `1px solid ${C.line}` }}>
        <span style={{ fontStretch: '125%', fontWeight: 700, fontSize: 12, letterSpacing: '.34em', color: '#E6EEF6' }}>SPECTER</span>
      </div>

      <div ref={menuRef} className="relative flex min-w-0" style={{ borderRight: `1px solid ${C.line}` }}>
        <button type="button" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}
          className="flex items-center min-w-0" style={{ gap: 10, padding: '0 16px', color: C.ink, font: mono(12, 500) }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="1.6" aria-hidden className="shrink-0"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></svg>
          <span className="sx-trunc" style={{ maxWidth: 260 }}>
            {owner ? <><span style={{ color: C.muted }}>{owner} /</span> {name}</> : <span style={{ color: C.muted }}>{view === 'rpt' || view === 'mon' ? 'all repositories' : 'no repository'}</span>}
          </span>
          {info?.head && (
            <span className="sx-hide-lg shrink-0" title={`Default branch ${info.head.branch} · head ${info.head.sha}`}
              style={{ padding: '4px 6px', border: `1px solid ${C.line2}`, color: C.muted, fontSize: 10.5 }}>
              {info.head.branch} · {shortSha(info.head.sha)}
            </span>
          )}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" aria-hidden className="shrink-0"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {menu && (
          <div role="menu" className="absolute sx-fade" style={{ top: 43, left: 0, minWidth: 320, background: C.hud, border: `1px solid ${C.line2}`, zIndex: 50, boxShadow: '0 20px 40px -20px rgba(0,0,0,.8)' }}>
            <div style={{ padding: '10px 14px', font: mono(9.5, 500), letterSpacing: '.14em', color: C.dim, borderBottom: `1px solid ${C.line}` }}>SWITCH REPOSITORY · RESULTS AVAILABLE</div>
            {switchable.length === 0 && <div style={{ padding: '12px 14px', font: mono(11), color: C.muted }}>No other scans with live results.</div>}
            {switchable.map((s) => (
              <button key={s.id} role="menuitem" type="button" onClick={() => openScan(s.id)} className="sx-ri w-full flex items-center justify-between"
                style={{ padding: '10px 14px', font: mono(11.5), color: s.id === scanId ? C.cyan : C.ink, gap: 16 }}>
                <span className="sx-trunc">{repoSlug(s.repo_url)}</span>
                <span style={{ color: C.muted, fontSize: 10 }}>{s.threat_score ?? '—'} · {timeAgo(s.created_at)}</span>
              </button>
            ))}
            <Link href="/reports" onClick={() => setMenu(false)} className="block" style={{ padding: '10px 14px', borderTop: `1px solid ${C.line}`, font: mono(10.5, 500), letterSpacing: '.1em' }}>ALL REPORTS →</Link>
          </div>
        )}
      </div>

      <div className="sx-hide-md flex items-center" style={{ gap: 22, padding: '0 18px', font: mono(10.5, 500), letterSpacing: '.08em' }}>
        <div className="flex items-center" style={{ gap: 8 }}>
          <span style={{ color: C.dim }}>SCAN</span>
          <span className={isPolling ? 'sx-live' : ''} style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
          <span style={{ color: statusColor }}>{statusText}</span>
        </div>
        <div className="sx-hide-lg flex items-center" style={{ gap: 8 }}>
          <span style={{ color: C.dim }}>LAST</span>
          <span style={{ color: C.softer }}>{lastText}</span>
        </div>
        <Link href="/monitoring" className="flex items-center" style={{ gap: 8 }} title="Continuous monitoring channels">
          <span style={{ color: C.dim }}>MONITOR</span>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: monitorLive ? C.green : C.dimmer, boxShadow: monitorLive ? '0 0 8px rgba(63,207,142,.7)' : 'none' }} />
          <span style={{ color: monitorLive ? C.green : C.muted }}>{system ? (monitorLive ? 'LIVE' : 'OFF') : '—'}</span>
          {channels.length > 0 && <span className="sx-hide-lg" style={{ color: C.dim }}>· {channels.join(' · ')}</span>}
        </Link>
      </div>

      <div className="grow" />
      <div className="flex items-center" style={{ gap: 4, padding: '0 12px', borderLeft: `1px solid ${C.line}` }}>
        <button type="button" onClick={() => setPalette(true)} aria-label="Search nodes, CVEs, commits"
          className="flex items-center sx-act" style={{ height: 28, gap: 10, padding: '0 10px', border: `1px solid ${C.line2}`, background: '#060B12', color: C.muted, font: mono(11) }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0M20 20l-4-4" /></svg>
          <span className="sx-hide-md">Search nodes, CVEs, commits</span>
          <span className="sx-hide-sm" style={{ padding: '2px 4px', border: '1px solid #1C2C40', fontSize: 9.5 }}>⌘K</span>
        </button>
        <Link href="/monitoring" aria-label={`Alerts, ${alerts.length} score rise${alerts.length === 1 ? '' : 's'} in the last 24 hours`}
          title={alerts.length ? `${alerts.length} threat-score rise${alerts.length === 1 ? '' : 's'} in the last 24h` : 'No score rises in the last 24h'}
          className="relative flex items-center justify-center" style={{ width: 36, height: 36, color: C.soft }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4" /></svg>
          {alerts.length > 0 && <span style={{ position: 'absolute', right: 7, top: 8, width: 6, height: 6, background: C.red, borderRadius: '50%' }} />}
        </Link>
        <button type="button" onClick={newScan} className="sx-act sx-hide-sm flex items-center"
          style={{ height: 28, gap: 8, padding: '0 12px', border: `1px solid ${C.line2}`, background: '#060B12', color: C.soft, font: mono(10.5, 500), letterSpacing: '.12em' }}>
          + NEW SCAN
        </button>
      </div>
    </header>
  );
}
