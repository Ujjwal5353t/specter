'use client';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useScanStore } from '@/store/scanStore';
import { prepareScan, useConsole } from '@/lib/console/store';
import { hourlyCounts, opsEvents, repoHistories, type RepoHistory } from '@/lib/console/history';
import { band, C, fmtTime, mono, repoSlug, timeAgo } from '@/lib/console/theme';
import { scanViewHref } from '@/lib/console/views';
import { toRepoSlug, toRepoUrl } from '@/lib/repoInput';
import { Empty, GhostButton, Label, PrimaryButton, useNow } from '../ui';

function spark(points: { score: number }[]): { d: string; lastY: number } {
  if (!points.length) return { d: '', lastY: 26 };
  const pts = points.length === 1 ? [points[0], points[0]] : points;
  const d = pts.map((p, i) => `${((i / (pts.length - 1)) * 118).toFixed(1)},${(26 - (p.score / 100) * 24).toFixed(1)}`).join(' ');
  return { d, lastY: 26 - (pts[pts.length - 1].score / 100) * 24 };
}

export default function MonitoringView() {
  const router = useRouter();
  const { scans, scansError, system, loadScans, loadSystem } = useConsole();
  const startPolling = useScanStore((s) => s.startPolling);
  const [adding, setAdding] = useState(false);
  const [repoInput, setRepoInput] = useState('');
  const [addState, setAddState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  useEffect(() => { loadScans(true); loadSystem(); }, [loadScans, loadSystem]);

  const monitored = useMemo(() => new Set(system?.monitoredRepos ?? []), [system]);
  const histories = useMemo(() => {
    const h = repoHistories(scans ?? []);
    // Scheduled repos that have never been scanned still belong on the watch list.
    for (const url of monitored) {
      if (!h.some((x) => x.repo_url === url)) {
        h.push({ repo_url: url, latest: null, previous: null, running: null, lastFailed: null, lastActivity: '', points: [], scans: 0 });
      }
    }
    return h;
  }, [scans, monitored]);
  const now = useNow();
  const events = useMemo(() => opsEvents(scans ?? []), [scans]);
  const day = events.filter((e) => now - new Date(e.t).getTime() < 86_400_000);
  const hourly = hourlyCounts(events, 24, now);
  const maxHour = Math.max(1, ...hourly);
  const rises = day.filter((e) => e.kind === 'RISE');
  const lastRise = events.find((e) => e.kind === 'RISE');
  const lastFresh = (scans ?? []).find((s) => s.status === 'completed' && !s.from_cache);
  const rising = histories.filter((h) => statusOf(h, monitored).label === 'RISING').length;

  const channels = [
    { name: 'GITHUB WEBHOOK', on: !!system?.webhook, state: system?.webhook ? 'CONFIGURED' : 'NOT SET', main: '/api/webhooks/github', sub: 'push to default branch · HMAC-SHA256' },
    { name: 'TELEGRAM', on: !!system?.telegram, state: system?.telegram ? 'CONNECTED' : 'NOT SET', main: system?.telegram ? 'score-rise alerts' : 'alerts disabled', sub: 'first scan or any score increase' },
    { name: 'SCHEDULED SCANS', on: !!system?.cron, state: system?.cron ? 'ARMED' : 'OFF', main: `${monitored.size} repo${monitored.size === 1 ? '' : 's'} listed`, sub: 'GET /api/monitor/cron · MONITORED_REPOS', cyan: true },
    { name: 'OSV FEED', on: !!lastFresh, state: lastFresh ? 'QUERIED' : 'IDLE', main: lastFresh ? `${fmtTime(lastFresh.completed_at ?? lastFresh.created_at)} · ${timeAgo(lastFresh.completed_at ?? lastFresh.created_at)}` : 'no fresh scan yet', sub: 'live advisory lookup on every fresh scan' },
  ];

  const addRepo = async (e: FormEvent) => {
    e.preventDefault();
    const slug = toRepoSlug(repoInput);
    if (!slug) return setAddState({ busy: false, error: 'Enter a GitHub repository as owner/repo or a github.com URL' });
    setAddState({ busy: true, error: null });
    try {
      const res = await fetch('/api/scan/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoUrl: toRepoUrl(slug) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.scanId) throw new Error(data.error ?? 'Scan failed to start');
      prepareScan(data.scanId);
      startPolling(data.scanId);
      router.push(`/scan/${data.scanId}`);
    } catch (err) {
      setAddState({ busy: false, error: err instanceof Error ? err.message : 'Scan failed to start' });
    }
  };

  const open = (h: RepoHistory) => {
    const id = h.running?.id ?? h.latest?.id;
    if (!id) return;
    prepareScan(id);
    if (h.running) startPolling(id);
    router.push(h.running ? `/scan/${id}` : scanViewHref('ovr', id));
  };

  return (
    <div className="sx-root sx-split" style={{ background: C.bg }}>
      <main className="sx-main flex flex-col">
        <div className="sx-pad flex flex-wrap justify-between items-end" style={{ padding: '20px 24px 16px', gap: 12 }}>
          <div className="flex flex-col" style={{ gap: 8 }}>
            <div style={{ font: mono(10, 500), letterSpacing: '.2em', color: C.cyan }}>{'// CONTINUOUS MONITORING · OPERATIONS'}</div>
            <div style={{ fontSize: 17, fontWeight: 500, color: C.bright }}>
              {scans ? `${histories.length} repositor${histories.length === 1 ? 'y' : 'ies'} tracked · ${monitored.size} scheduled · ${rising} rising` : 'Loading…'}
            </div>
          </div>
          {adding ? (
            <form onSubmit={addRepo} className="flex flex-wrap items-center" style={{ gap: 8 }}>
              <input autoFocus value={repoInput} onChange={(e) => setRepoInput(e.target.value)} placeholder="owner/repo" aria-label="Repository to scan"
                style={{ height: 34, width: 220, padding: '0 10px', background: C.well, border: `1px solid ${C.btn}`, color: C.bright, font: mono(11.5), outline: 'none' }} />
              <PrimaryButton type="submit" style={{ height: 34 }} disabled={addState.busy}>{addState.busy ? 'STARTING…' : 'SCAN'}</PrimaryButton>
              <GhostButton style={{ height: 34 }} onClick={() => { setAdding(false); setAddState({ busy: false, error: null }); }}>CANCEL</GhostButton>
            </form>
          ) : (
            <GhostButton style={{ height: 34 }} onClick={() => setAdding(true)}>+ SCAN REPOSITORY</GhostButton>
          )}
        </div>
        {addState.error && <div className="sx-pad" style={{ padding: '0 24px 12px', font: mono(10.5), color: C.orange }}>{addState.error}</div>}

        <div className="sx-pad" style={{ padding: '0 24px' }}>
          <div className="grid sx-grid-cells" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', border: `1px solid ${C.line3}` }}>
            {channels.map((c, i) => {
              const color = !system ? C.dim : c.on ? (c.cyan ? C.cyan : C.green) : C.dim;
              return (
                <div key={c.name} className="flex flex-col min-w-0" style={{ padding: '14px 16px', gap: 9, borderRight: i < 3 ? `1px solid ${C.line3}` : 0 }}>
                  <div className="flex justify-between items-center" style={{ font: mono(9.5, 500), letterSpacing: '.14em', gap: 8 }}>
                    <span style={{ color: C.muted }}>{c.name}</span>
                    <span className="flex items-center" style={{ gap: 6, color }}><span className={c.on ? 'sx-live' : ''} style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />{system ? c.state : '—'}</span>
                  </div>
                  <div className="sx-trunc" style={{ font: mono(13, 500, 1.2), color: C.bright }}>{c.main}</div>
                  <div className="sx-trunc" style={{ font: mono(10, 400, 1.2), color: C.dim }}>{c.sub}</div>
                </div>
              );
            })}
          </div>
        </div>

        {scansError && <Empty title="HISTORY UNAVAILABLE"><span style={{ color: C.redSoft }}>{scansError}</span></Empty>}
        {scans && histories.length === 0 && <Empty title="NOTHING UNDER WATCH">Scan a repository, list it in MONITORED_REPOS for scheduled rescans, or point a GitHub push webhook at /api/webhooks/github.</Empty>}
        {histories.length > 0 && (
          <div className="sx-table-wrap" style={{ marginTop: 20 }}>
            <table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ height: 34, font: mono(9.5, 500), letterSpacing: '.14em', color: C.dim, textAlign: 'left', borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
                  <th style={{ fontWeight: 500, paddingLeft: 24 }}>REPOSITORY</th>
                  <th style={{ fontWeight: 500, width: 84 }}>CURRENT</th>
                  <th style={{ fontWeight: 500, width: 84 }}>PREVIOUS</th>
                  <th style={{ fontWeight: 500, width: 70 }}>DELTA</th>
                  <th style={{ fontWeight: 500, width: 140 }}>30-DAY TREND</th>
                  <th style={{ fontWeight: 500, width: 110 }}>LAST SCAN</th>
                  <th style={{ fontWeight: 500, width: 128, paddingRight: 24 }}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {histories.map((h) => {
                  const cur = h.latest?.threat_score ?? null;
                  const prev = h.previous?.threat_score ?? null;
                  const delta = cur != null && prev != null ? cur - prev : null;
                  const c = cur != null ? band(cur).color : C.dim;
                  const sp = spark(h.points);
                  const st = statusOf(h, monitored);
                  const alerting = st.label === 'RISING';
                  return (
                    <tr key={h.repo_url} className="sx-tr" onClick={() => open(h)} style={{ height: 60, borderBottom: `1px solid ${C.row}`, background: alerting ? 'rgba(255,61,79,.04)' : 'transparent', font: mono(11.5), cursor: h.latest || h.running ? 'pointer' : 'default' }}>
                      <td style={{ paddingLeft: 24 }}>
                        <div className="flex flex-col min-w-0" style={{ gap: 6 }}>
                          <span className="sx-trunc" style={{ color: C.bright, fontWeight: 500 }}>{repoSlug(h.repo_url)}</span>
                          <span className="sx-trunc" style={{ fontSize: 10, color: C.dim }}>{monitored.has(h.repo_url) ? 'schedule · cron' : 'on demand'} · {h.scans} scan{h.scans === 1 ? '' : 's'}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: 17, fontWeight: 600, color: c }}>{cur ?? '—'}</td>
                      <td style={{ color: C.muted }}>{prev ?? '—'}</td>
                      <td style={{ color: delta == null ? C.dim : delta > 0 ? C.redSoft : delta < 0 ? C.green : C.muted, fontWeight: 500 }}>
                        {delta == null ? '—' : `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta)}`}
                      </td>
                      <td>
                        {h.points.length ? (
                          <svg width="120" height="28" viewBox="0 0 120 28" aria-label={`${h.points.length} scores in 30 days`}>
                            <line x1="0" y1="27.5" x2="120" y2="27.5" stroke="#0F1B2A" />
                            <polyline points={sp.d} fill="none" stroke={c} strokeWidth="1.4" />
                            <circle cx="118" cy={sp.lastY} r="2.5" fill={c} />
                          </svg>
                        ) : <span style={{ color: C.dim, fontSize: 10 }}>no data</span>}
                      </td>
                      <td style={{ color: C.soft }}>{h.running ? 'running' : h.lastActivity ? timeAgo(h.lastActivity, now) : 'never'}</td>
                      <td style={{ paddingRight: 24 }}>
                        <span className={alerting ? 'sx-alert' : st.label === 'SCANNING' ? 'sx-live' : ''} title={st.title}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 8px', border: `1px solid ${alerting ? C.red : C.line2}`, fontSize: 9.5, letterSpacing: '.12em', color: st.color }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: st.color }} />{st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="grow" />
        <div className="sx-pad flex flex-wrap justify-between" style={{ padding: '14px 24px', borderTop: `1px solid ${C.line}`, font: mono(10.5), color: C.dim, gap: 10, marginTop: 20 }}>
          <span>ALERT RULE · first monitored scan, or any threat-score increase → Telegram</span>
          <span>PUSH SCANS SKIP THE 6H CACHE · <span style={{ color: C.softer }}>default branch only</span></span>
        </div>
      </main>

      <aside className="sx-aside flex flex-col" style={{ width: 420 }}>
        <div className="flex items-center justify-between" style={{ height: 44, padding: '0 22px', borderBottom: `1px solid ${C.line}`, font: mono(10, 500), letterSpacing: '.18em' }}>
          <span style={{ color: C.ink }}>OPERATIONS LOG</span>
          <span className="flex items-center" style={{ gap: 6, color: C.green }}><span className="sx-live" style={{ width: 5, height: 5, borderRadius: '50%', background: C.green }} />LIVE · 60S</span>
        </div>
        <div style={{ padding: '14px 22px 4px' }}>
          <svg width="100%" height="44" viewBox="0 0 376 44" preserveAspectRatio="none" aria-label="Scan events per hour, last 24 hours">
            {hourly.map((n, i) => (
              <rect key={i} x={i * (376 / 24) + 1} width={376 / 24 - 3} y={42 - (n / maxHour) * 38} height={Math.max(1, (n / maxHour) * 38)} fill={n ? 'rgba(79,216,240,.55)' : 'rgba(79,216,240,.12)'} />
            ))}
          </svg>
          <div className="flex justify-between" style={{ font: mono(9.5), color: C.dimmer, marginTop: 4 }}>
            <span>EVENTS / HOUR</span><span>24H · {day.length} EVENTS · {rises.length} RISE{rises.length === 1 ? '' : 'S'}</span>
          </div>
        </div>
        <ol style={{ margin: 0, padding: '8px 22px', listStyle: 'none' }}>
          {events.length === 0 && <li style={{ padding: '11px 0', font: mono(10.5), color: C.muted }}>No scan activity yet.</li>}
          {events.slice(0, 14).map((e) => (
            <li key={e.id} className="grid" style={{ padding: '11px 0', borderBottom: `1px solid ${C.row}`, gridTemplateColumns: '64px 64px minmax(0,1fr)', columnGap: 10, font: mono(10.5, 400, 1.45) }}>
              <span style={{ color: C.dimmer }} title={new Date(e.t).toLocaleString()}>{now - new Date(e.t).getTime() < 86_400_000 ? fmtTime(e.t) : timeAgo(e.t, now)}</span>
              <span style={{ color: e.color, letterSpacing: '.08em', fontSize: 9.5 }}>{e.kind}</span>
              <span style={{ color: C.softer, wordBreak: 'break-word' }}>{e.msg}</span>
            </li>
          ))}
        </ol>
        <div className="grow" />
        <div className="flex flex-col" style={{ margin: '0 22px 22px', padding: '12px 14px', border: `1px solid ${C.line3}`, background: C.well, gap: 8 }}>
          <Label color={C.muted}>LATEST SCORE RISE{lastRise ? ` · ${fmtTime(lastRise.t)}` : ''}</Label>
          {lastRise ? (
            <div style={{ font: mono(11.5, 400, 1.5), color: C.ink, whiteSpace: 'pre-line' }}>
              {`▲ SPECTER · ${lastRise.repo}\n${lastRise.msg.replace(`${lastRise.repo} `, '')}\n`}
              <Link href={scanViewHref('ovr', lastRise.scanId)} onClick={() => prepareScan(lastRise.scanId)}>→ Open brief</Link>
            </div>
          ) : <div style={{ font: mono(11), color: C.muted }}>No repository’s score has risen between scans.</div>}
          {system && !system.telegram && <div style={{ font: mono(10), color: C.dim }}>Telegram is not configured, so rises are not pushed anywhere yet.</div>}
        </div>
      </aside>
    </div>
  );
}

function statusOf(h: RepoHistory, monitored: Set<string>): { label: string; color: string; title: string } {
  if (h.running) return { label: 'SCANNING', color: C.cyan, title: 'A scan is running' };
  if (h.lastFailed) return { label: 'FAILED', color: C.redSoft, title: h.lastFailed.error_message ?? 'Last scan failed' };
  const cur = h.latest?.threat_score, prev = h.previous?.threat_score;
  if (cur != null && prev != null && cur > prev) return { label: 'RISING', color: C.red, title: `Score rose ${prev} → ${cur}` };
  if (monitored.has(h.repo_url)) return { label: h.latest ? 'MONITORING' : 'AWAITING SWEEP', color: C.green, title: 'Listed in MONITORED_REPOS' };
  return { label: h.latest ? 'STABLE' : 'NO RESULT', color: C.muted, title: 'Scanned on demand' };
}
