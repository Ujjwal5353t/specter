'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { useScanStore } from '@/store/scanStore';
import { useConsole } from '@/lib/console/store';
import { engineCounts, secretItems } from '@/lib/console/derive';
import { C, MONO } from '@/lib/console/theme';
import { VIEWS, viewHref, type ViewDef, type ViewId } from '@/lib/console/views';

function useDots(scanId: string | null): Partial<Record<ViewId, boolean>> {
  const scanResult = useScanStore((s) => s.scanResult);
  return useMemo(() => {
    if (!scanResult || scanResult.scanId !== scanId) return {};
    const c = engineCounts(scanResult);
    return {
      dep: c.depchain > 0, gst: c.ghostcommit > 0, lyr: c.layerscan > 0, api: c.apibleed > 0, env: c.envtrace > 0,
      sec: secretItems(scanResult).length > 0,
    };
  }, [scanResult, scanId]);
}

function RailItem({ v, active, href, lit, horizontal = false, onNavigate }: {
  v: ViewDef; active: boolean; href: string | null; lit: boolean; horizontal?: boolean; onNavigate?: () => void;
}) {
  const style: React.CSSProperties = horizontal
    ? { height: 48, display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', position: 'relative', textDecoration: 'none',
        color: active ? C.cyan : C.railInk, background: active ? '#071320' : 'transparent', boxShadow: active ? `inset 2px 0 0 ${C.cyan}` : 'none' }
    : { height: 58, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, position: 'relative', textDecoration: 'none',
        color: active ? C.cyan : C.railInk, background: active ? '#071320' : 'transparent',
        boxShadow: active ? `inset 0 0 0 1px #133049, inset 0 -2px 0 ${C.cyan}` : 'none' };
  const inner = (
    <>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={v.d} /></svg>
      <span style={{ fontSize: horizontal ? 10.5 : 8.5, letterSpacing: '.14em', fontWeight: 500 }}>{horizontal ? v.label.toUpperCase() : v.code}</span>
      <span style={{ position: 'absolute', right: 9, top: horizontal ? 21 : 11, width: 5, height: 5, borderRadius: '50%', background: lit && v.dot ? v.dot : 'transparent' }} />
    </>
  );
  if (!href) {
    // Scan-scoped view with no scan to show yet: the landing page is where one starts.
    return (
      <Link href="/" className="sx-ri" aria-label={`${v.label} — run a scan first`} title={`${v.label} — run a scan first`} onClick={onNavigate}
        style={{ ...style, opacity: 0.45 }}>
        {inner}
      </Link>
    );
  }
  return (
    <Link href={href} className="sx-ri" aria-label={v.label} title={v.label} aria-current={active ? 'page' : undefined} onClick={onNavigate} style={style}>
      {inner}
    </Link>
  );
}

export default function Rail({ view, scanId }: { view: ViewId; scanId: string | null }) {
  const dots = useDots(scanId);
  const { system, systemError, navOpen, setNav } = useConsole();
  const isPolling = useScanStore((s) => s.isPolling);
  const sysOk = !!system && !systemError;

  return (
    <>
      <nav aria-label="Intelligence navigation" className="sx-root hidden md:flex absolute left-0 bottom-0 z-30 flex-col pointer-events-auto sx-scroll"
        style={{ top: 44, width: 64, background: C.hud, borderRight: `1px solid ${C.line}`, fontFamily: MONO }}>
        {VIEWS.map((v) => <RailItem key={v.id} v={v} active={v.id === view} href={viewHref(v, scanId)} lit={!!dots[v.id]} />)}
        <div className="grow" />
        <div className="flex items-center justify-center shrink-0" title={sysOk ? 'API reachable' : 'API unreachable'}
          style={{ height: 44, gap: 5, borderTop: `1px solid ${C.line}`, fontSize: 8.5, letterSpacing: '.1em', color: sysOk ? C.green : C.dim }}>
          <span className={isPolling ? 'sx-live' : ''} style={{ width: 5, height: 5, borderRadius: '50%', background: sysOk ? C.green : C.dim }} />SYS
        </div>
      </nav>

      {navOpen && (
        <div className="sx-root md:hidden fixed inset-0 z-50 pointer-events-auto" onClick={() => setNav(false)} style={{ background: 'rgba(3,6,11,.6)' }}>
          <nav aria-label="Intelligence navigation" onClick={(e) => e.stopPropagation()} className="sx-fade sx-scroll flex flex-col"
            style={{ position: 'absolute', top: 44, left: 0, bottom: 0, width: 280, background: C.hud, borderRight: `1px solid ${C.line}`, fontFamily: MONO }}>
            {VIEWS.map((v) => (
              <RailItem key={v.id} v={v} horizontal active={v.id === view} href={viewHref(v, scanId)} lit={!!dots[v.id]} onNavigate={() => setNav(false)} />
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
