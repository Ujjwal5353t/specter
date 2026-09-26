'use client';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useScanStore } from '@/store/scanStore';
import { useConsole } from '@/lib/console/store';
import { matchView, type ViewId } from '@/lib/console/views';
import Hud from './Hud';
import Rail from './Rail';
import CommandPalette from './CommandPalette';

/**
 * App frame. On the landing page it is exactly the previous layout (scene
 * layer + pass-through UI layer). On console routes it adds the SPECTER HUD
 * and intelligence rail around the content, and moves the persistent 3D
 * scene into the content area. The scene stays mounted across views (hidden
 * off the threat map) so returning to the map keeps its camera and state.
 */
export default function ConsoleFrame({ scene, children }: { scene: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const { view, scanId } = matchView(pathname);

  if (!view) {
    return (
      <>
        <div className="absolute inset-0 z-0 pointer-events-auto">{scene}</div>
        <div className="relative z-10 h-full w-full pointer-events-none">{children}</div>
      </>
    );
  }

  const isMap = view === 'map';
  return (
    <>
      <div className="sx-scene" style={isMap ? undefined : { display: 'none' }}>{scene}</div>
      <ConsoleChrome view={view} routeScanId={scanId} />
      <div className={`sx-content ${isMap ? 'sx-content--map' : 'sx-content--view'}`}>{children}</div>
    </>
  );
}

function ConsoleChrome({ view, routeScanId }: { view: ViewId; routeScanId: string | null }) {
  const scanResult = useScanStore((s) => s.scanResult);
  const { scans, loadScans, loadSystem, loadMeta, hydrate } = useConsole();
  const prevRoute = useRef<string | null>(null);
  const isMap = view === 'map';

  // Before any page effect runs (layout effects flush first): drop a different
  // scan's result or error so it can't render under this scan's URL. The
  // threat map page then rehydrates the right scan exactly as it always has.
  useLayoutEffect(() => {
    if (!routeScanId) return;
    const s = useScanStore.getState();
    const otherResult = !!s.scanResult && s.scanResult.scanId !== routeScanId;
    const staleError = !!s.error && prevRoute.current !== null && prevRoute.current !== routeScanId;
    if (otherResult || staleError) {
      s.reset();
      useConsole.setState({ hydration: null });
    }
    prevRoute.current = routeScanId;
  }, [routeScanId]);

  // Module views load the scan themselves on a direct visit (the map page does its own).
  useEffect(() => {
    if (!routeScanId || isMap || routeScanId.startsWith('demo-')) return;
    const s = useScanStore.getState();
    if (s.scanResult?.scanId === routeScanId || s.isPolling || s.isLoading) return;
    const h = useConsole.getState().hydration;
    if (h?.id === routeScanId && h.state !== 'done') return;
    if (s.error) return;
    hydrate(routeScanId);
  }, [routeScanId, isMap, hydrate]);

  useEffect(() => {
    loadSystem();
    loadScans();
    const t = setInterval(() => loadScans(true), 60_000);
    return () => clearInterval(t);
  }, [loadScans, loadSystem]);

  // Rail/HUD context: the scan in the URL, else the one in memory, else the newest with live results.
  const contextScanId =
    routeScanId ??
    scanResult?.scanId ??
    scans?.find((s) => s.report === 'ready')?.id ??
    null;

  useEffect(() => {
    if (contextScanId && !contextScanId.startsWith('demo-')) loadMeta(contextScanId);
  }, [contextScanId, loadMeta]);

  return (
    <>
      <Hud view={view} scanId={contextScanId} />
      <Rail view={view} scanId={contextScanId} />
      <CommandPalette scanId={contextScanId} />
    </>
  );
}
