'use client';
import { useMemo } from 'react';
import { endpointFacts, endpointKey } from '@/lib/console/derive';
import { C, mono, SEV, sevRank } from '@/lib/console/theme';
import type { ApiEndpoint, ScanResult } from '@/types';
import { CopyButton, Empty, GhostLink, Legend, useSelection } from '../ui';
import { useJson } from '../useWidth';

const MC: Record<string, string> = { GET: C.cyan, POST: C.orange, PUT: C.amber, PATCH: C.amber, DELETE: C.redSoft, ANY: C.redSoft };

function risk(e: ApiEndpoint) {
  if (e.issues.length === 0) return { label: 'OK', color: C.green };
  return { label: SEV[e.severity].short, color: SEV[e.severity].color };
}

/** Guard snippet for what the endpoint is missing, in the idiom of the file it lives in. */
function guardSnippet(e: ApiEndpoint): string {
  const f = endpointFacts(e);
  const nextRoute = /\/route\.(ts|js)$/.test(e.file);
  if (nextRoute) {
    return [
      `// ${e.file}`,
      `export async function ${e.method === 'ANY' ? 'POST' : e.method}(req: NextRequest) {`,
      ...(!e.hasAuth ? [
        `  const token = req.headers.get('authorization')?.replace(/^Bearer /, '');`,
        `  const user = token ? await verifyToken(token) : null; // your session / JWT check`,
        `  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });`,
      ] : []),
      ...(!f.rateLimited ? [
        `  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';`,
        `  if (!rateLimit(ip)) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });`,
      ] : []),
      `  // …existing handler`,
      `}`,
    ].join('\n');
  }
  const mw = [!e.hasAuth && 'requireAuth', !f.rateLimited && 'rateLimiter'].filter(Boolean).join(', ');
  return `// ${e.file}\nrouter.${e.method.toLowerCase()}('${e.path}', ${mw || 'requireAuth'}, handler);`;
}

export default function ApiBleedView({ result: r }: { result: ScanResult }) {
  const endpoints = useMemo(
    () => [...(r.apibleed?.endpoints ?? [])].sort((a, b) => sevRank(a.issues.length ? a.severity : 'info') - sevRank(b.issues.length ? b.severity : 'info')),
    [r],
  );
  const [sel, setSel] = useSelection();
  const s = endpoints.find((e) => endpointKey(e) === sel) ?? endpoints[0] ?? null;
  const outside = endpoints.filter((e) => !e.hasAuth).length;

  if (endpoints.length === 0) {
    return (
      <div>
        <div className="sx-pad" style={{ padding: '20px 24px 0', font: mono(10, 500), letterSpacing: '.2em', color: C.cyan }}>{'// APIBLEED · ATTACK SURFACE'}</div>
        <Empty title="NO ROUTES DISCOVERED">APIBleed found no API route handlers (Next.js app/api routes, Express, FastAPI or Flask) in this repository.</Empty>
      </div>
    );
  }

  return (
    <div className="sx-split">
      <section className="sx-main relative" aria-label="API attack surface map" style={{ minHeight: 760, overflow: 'hidden', background: 'radial-gradient(circle at 55% 52%, #081424, #03060B 60%)' }}>
        <div className="sx-pad flex flex-col" style={{ padding: '20px 24px 0', gap: 8, position: 'relative', zIndex: 1 }}>
          <div style={{ font: mono(10, 500), letterSpacing: '.2em', color: C.cyan }}>{'// APIBLEED · ATTACK SURFACE'}</div>
          <div style={{ fontSize: 17, fontWeight: 500, color: C.bright }}>{endpoints.length} route{endpoints.length === 1 ? '' : 's'} · {outside} outside the auth perimeter</div>
        </div>
        <SurfaceMap endpoints={endpoints} selected={s} onPick={(e) => setSel(endpointKey(e))} />
        <div className="absolute sx-hide-sm" style={{ left: 24, bottom: 20 }}>
          <Legend items={[
            { swatch: <span style={{ width: 16, height: 2, background: C.red }} />, label: 'UNAUTH WRITE' },
            { swatch: <span style={{ width: 16, borderTop: '1px dashed #8FA6BF' }} />, label: 'UNAUTH READ' },
            { swatch: <span style={{ width: 12, height: 12, borderRadius: '50%', border: `1px dashed ${C.green}` }} />, label: 'AUTH DETECTED' },
          ]} />
        </div>
      </section>

      <aside className="sx-aside flex flex-col" style={{ width: 636 }}>
        <div className="flex items-center justify-between" style={{ height: 44, padding: '0 24px', borderBottom: `1px solid ${C.line}`, font: mono(10, 500), letterSpacing: '.18em', gap: 12 }}>
          <span style={{ color: C.ink }}>ENDPOINT MATRIX</span>
          <span className="sx-trunc" style={{ color: C.dim }}>INFERRED FROM ROUTE HANDLERS</span>
        </div>
        <div className="sx-scroll" style={{ maxHeight: 360 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ height: 32, font: mono(9, 500), letterSpacing: '.12em', color: C.dim, textAlign: 'left', borderBottom: `1px solid ${C.line}` }}>
                <th style={{ fontWeight: 500, paddingLeft: 24 }}>ENDPOINT</th>
                <th style={{ fontWeight: 500, width: 82 }}>AUTH</th>
                <th style={{ fontWeight: 500, width: 54 }}>WRITE</th>
                <th style={{ fontWeight: 500, width: 58 }}>RATE</th>
                <th style={{ fontWeight: 500, width: 52 }}>CORS</th>
                <th style={{ fontWeight: 500, width: 62, paddingRight: 24, textAlign: 'right' }}>RISK</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((e) => {
                const f = endpointFacts(e), k = risk(e), on = e === s;
                return (
                  <tr key={endpointKey(e)} className="sx-tr" onClick={() => setSel(endpointKey(e))} style={{ height: 36, borderBottom: `1px solid ${C.row}`, background: on ? C.sel : 'transparent', font: mono(11), cursor: 'pointer' }}>
                    <td className="sx-trunc" style={{ paddingLeft: 24 }}><button type="button" onClick={() => setSel(endpointKey(e))} style={{ color: on ? '#fff' : C.ink }} title={`${e.method} ${e.path}`}><span style={{ color: MC[e.method] ?? C.soft }}>{e.method}</span> {e.path}</button></td>
                    <td style={{ color: e.hasAuth ? C.green : C.redSoft, fontSize: 10 }}>{e.hasAuth ? 'DETECTED' : 'NONE'}</td>
                    <td style={{ color: f.write ? C.orangeSoft : C.dim }}>{f.write ? 'YES' : '—'}</td>
                    <td style={{ color: f.rateLimited ? C.green : C.soft }}>{f.rateLimited ? 'YES' : 'NO'}</td>
                    <td style={{ color: f.cors ? C.orange : C.dim }}>{f.cors ? '*' : '—'}</td>
                    <td style={{ paddingRight: 24, textAlign: 'right', fontSize: 9.5, letterSpacing: '.1em', color: k.color }}>{k.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {s && <Inspector r={r} e={s} />}
      </aside>
    </div>
  );
}

function Inspector({ r, e }: { r: ScanResult; e: ApiEndpoint }) {
  const demo = r.scanId.startsWith('demo-');
  const src = useJson<{ lines: string[]; total: number; url: string }>(demo ? null : `/api/scan/${r.scanId}/source?path=${encodeURIComponent(e.file)}`);
  const k = risk(e);
  const window = useMemo(() => {
    const lines = src.data?.lines ?? [];
    if (!lines.length) return null;
    const method = e.method === 'ANY' ? '(?:default|GET|POST|PUT|DELETE|PATCH)' : e.method;
    const pats = [
      new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`),
      new RegExp(`export\\s+const\\s+${method}\\b`),
      new RegExp(`\\.${e.method.toLowerCase()}\\s*\\(\\s*['"\`]${e.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      /export\s+default/,
    ];
    let at = -1;
    for (const p of pats) { at = lines.findIndex((l) => p.test(l)); if (at >= 0) break; }
    const start = Math.max(0, at >= 0 ? at - 1 : 0);
    return { start, at, lines: lines.slice(start, start + 16) };
  }, [src.data, e]);
  const snippet = guardSnippet(e);
  const needsGuard = !e.hasAuth || !endpointFacts(e).rateLimited;

  return (
    <div className="flex flex-col grow">
      <div className="flex justify-between items-center" style={{ padding: '18px 24px 10px', gap: 12 }}>
        <div className="flex flex-col min-w-0" style={{ gap: 6 }}>
          <span style={{ font: mono(10, 500), letterSpacing: '.16em', color: k.color }}>■ {e.issues.length ? SEV[e.severity].label : 'NO FINDING'} · {e.hasAuth ? 'AUTH DETECTED' : 'NO AUTH'}</span>
          <span className="sx-trunc" style={{ font: mono(15, 500), color: C.bright }}><span style={{ color: MC[e.method] ?? C.soft }}>{e.method}</span> {e.path}</span>
        </div>
        {src.data?.url
          ? <a href={src.data.url} target="_blank" rel="noreferrer" className="sx-trunc" style={{ font: mono(10.5), maxWidth: 260 }}>{e.file} ↗</a>
          : <span className="sx-trunc" style={{ font: mono(10.5), color: C.dim, maxWidth: 260 }}>{e.file}</span>}
      </div>
      <div className="sx-scroll" style={{ margin: '0 24px', border: `1px solid ${C.line3}`, background: C.well, padding: '10px 0', font: mono(11.5, 400, 1.7), overflowX: 'auto' }}>
        {src.loading && <div style={{ padding: '0 12px', color: C.muted }}>Reading handler source…</div>}
        {(src.error || demo) && <div style={{ padding: '0 12px', color: C.muted }}>{demo ? 'Source is not available for sample reports.' : `Source unavailable: ${src.error}`}</div>}
        {window?.lines.map((t, i) => {
          const n = window.start + i;
          const hot = n === window.at;
          return (
            <div key={n} className="grid" style={{ gridTemplateColumns: '40px minmax(0,1fr)', background: hot ? (e.hasAuth ? 'rgba(63,207,142,.07)' : 'rgba(255,61,79,.08)') : 'transparent', color: hot ? C.bright : C.soft, whiteSpace: 'pre' }}>
              <span style={{ textAlign: 'right', paddingRight: 10, color: C.dimmer }}>{n + 1}</span><span>{t || ' '}</span>
            </div>
          );
        })}
      </div>
      <ul style={{ margin: '12px 24px 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, lineHeight: 1.5, color: C.softer }}>
        {e.issues.length === 0 && <li>No issue detected: {e.hasAuth ? 'an auth check and ' : ''}rate limiting {endpointFacts(e).rateLimited ? 'are' : 'is'} present.</li>}
        {e.issues.map((i) => <li key={i}><span style={{ color: k.color }}>▸ </span>{i}</li>)}
      </ul>
      <div className="grow" />
      <div className="flex flex-wrap" style={{ padding: '16px 24px 22px', marginTop: 16, borderTop: `1px solid ${C.line}`, gap: 8 }}>
        <CopyButton primary text={snippet} disabled={!needsGuard} label={!e.hasAuth ? 'COPY AUTH GUARD' : 'COPY RATE-LIMIT GUARD'} style={{ flexGrow: 1, height: 40 }} />
        <GhostLink href={`/scan/${r.scanId}`} style={{ height: 40 }}>TRACE IN MAP</GhostLink>
      </div>
    </div>
  );
}

function SurfaceMap({ endpoints, selected, onPick }: { endpoints: ApiEndpoint[]; selected: ApiEndpoint | null; onPick: (e: ApiEndpoint) => void }) {
  const W = 760, H = 700, CX = 440, CY = 360, PERIM = 170, NET: [number, number] = [70, CY];
  const authed = endpoints.filter((e) => e.hasAuth);
  const open = endpoints.filter((e) => !e.hasAuth);
  const place = (list: ApiEndpoint[], from: number, to: number, radius: (i: number) => number) =>
    list.map((e, i) => {
      const t = list.length === 1 ? 0.5 : i / (list.length - 1);
      const a = ((from + (to - from) * t) * Math.PI) / 180;
      const rad = radius(i);
      return { e, x: CX + Math.cos(a) * rad, y: CY + Math.sin(a) * rad, left: Math.cos(a) < 0 };
    });
  const pts = [
    ...place(open, 118, 242, (i) => 245 + (open.length > 10 ? (i % 3) * 26 : 0)),
    ...place(authed, -62, 62, (i) => 110 + (authed.length > 8 ? (i % 2) * 34 : 0)),
  ];
  const labelAll = endpoints.length <= 14;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', maxWidth: 980, height: 'auto' }} role="img" aria-label={`${endpoints.length} API routes around the auth perimeter`}>
      <circle cx={CX} cy={CY} r={PERIM + 10} fill="url(#sx-perim-glow)" />
      <defs>
        <radialGradient id="sx-perim-glow"><stop offset="0%" stopColor="rgba(63,207,142,.06)" /><stop offset="100%" stopColor="rgba(63,207,142,0)" /></radialGradient>
      </defs>
      <circle cx={CX} cy={CY} r={PERIM} fill="none" stroke="rgba(63,207,142,.45)" strokeDasharray="4 4">
        <animateTransform attributeName="transform" type="rotate" from={`0 ${CX} ${CY}`} to={`360 ${CX} ${CY}`} dur="60s" repeatCount="indefinite" />
      </circle>
      <text x={CX + 60} y={CY - PERIM - 6} fontFamily="JetBrains Mono, monospace" fontSize="9.5" letterSpacing=".16em" fill={C.green}>AUTH PERIMETER</text>

      <rect x={NET[0] - 34} y={CY - 90} width={64} height={180} fill="none" stroke={C.dimmer} strokeDasharray="4 3" />
      <text transform={`translate(${NET[0] + 3} ${CY}) rotate(-90)`} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="10" letterSpacing=".3em" fill={C.soft}>INTERNET</text>

      {pts.map(({ e, x, y }) => {
        const f = endpointFacts(e);
        return (
          <g key={`edge-${endpointKey(e)}`}>
            <line x1={CX} y1={CY} x2={x} y2={y} stroke="rgba(62,128,235,.35)" />
            {!e.hasAuth && (
              f.write
                ? <line className="sx-ed-bad" x1={NET[0] + 30} y1={NET[1]} x2={x} y2={y} stroke={C.red} strokeWidth="2" style={{ filter: 'drop-shadow(0 0 4px rgba(255,61,79,.5))' }} />
                : <line x1={NET[0] + 30} y1={NET[1]} x2={x} y2={y} stroke="rgba(143,166,191,.5)" strokeDasharray="3 4" />
            )}
          </g>
        );
      })}

      <g transform={`translate(${CX} ${CY}) rotate(45)`}>
        <rect x={-22} y={-22} width={44} height={44} fill="#06121C" stroke={C.cyan} />
        <rect x={-5} y={-5} width={10} height={10} fill={C.cyan} />
      </g>
      <text x={CX} y={CY + 50} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="10" fill={C.softer}>router</text>

      {pts.map(({ e, x, y, left }) => {
        const k = risk(e), on = e === selected, big = e.issues.length && sevRank(e.severity) === 0;
        const size = big ? 14 : 10;
        const f = endpointFacts(e);
        const showLabel = labelAll || on || sevRank(e.severity) <= 1;
        return (
          <g key={endpointKey(e)} style={{ cursor: 'pointer' }} onClick={() => onPick(e)}>
            <title>{`${e.method} ${e.path} — ${e.hasAuth ? 'auth detected' : 'no auth'}${e.issues.length ? ` — ${e.issues.join('; ')}` : ''}`}</title>
            {on && <rect x={x - size / 2 - 4} y={y - size / 2 - 4} width={size + 8} height={size + 8} fill="none" stroke="#fff" />}
            <rect x={x - size / 2} y={y - size / 2} width={size} height={size} fill={k.color} className={big ? 'sx-hot' : ''} />
            {showLabel && (
              <g>
                <text x={left ? x - 14 : x + 14} y={y - (left ? 16 : 2)} textAnchor={left ? 'end' : 'start'} fontFamily="JetBrains Mono, monospace" fontSize="10.5" fontWeight="500" fill={on ? '#fff' : C.body}>
                  <tspan fill={MC[e.method] ?? C.soft}>{e.method}</tspan> {e.path.length > 34 ? `${e.path.slice(0, 33)}…` : e.path}
                </text>
                <text x={left ? x - 14 : x + 14} y={y - (left ? 4 : -11)} textAnchor={left ? 'end' : 'start'} fontFamily="JetBrains Mono, monospace" fontSize="9" letterSpacing=".12em"
                  fill={e.hasAuth ? C.green : f.write ? C.redSoft : '#8FA6BF'}>
                  {e.hasAuth ? `AUTH${f.rateLimited ? ' · RATE-LIMITED' : ''}` : f.write ? 'UNAUTH · WRITE' : 'UNAUTH · READ'}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
