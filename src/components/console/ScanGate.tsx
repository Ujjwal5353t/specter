'use client';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useScanStore } from '@/store/scanStore';
import { useConsole } from '@/lib/console/store';
import { C, mono } from '@/lib/console/theme';
import type { ScanResult } from '@/types';
import { Empty, GhostButton, Kicker, PrimaryButton } from './ui';

/**
 * Hands a module view the scan named in the URL, from the same scan store
 * the threat map uses. While a scan is still running it defers to the map
 * route, which shows the live scan console.
 */
export default function ScanGate({ children }: { children: (r: ScanResult) => ReactNode }) {
  const params = useParams();
  const scanId = params.scanId as string;
  const router = useRouter();
  const scanResult = useScanStore((s) => s.scanResult);
  const isPolling = useScanStore((s) => s.isPolling);
  const error = useScanStore((s) => s.error);
  const repoUrl = useScanStore((s) => s.repoUrl);
  const startPolling = useScanStore((s) => s.startPolling);
  const hydration = useConsole((s) => s.hydration);
  const [rescan, setRescan] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const ready = scanResult?.scanId === scanId ? scanResult : null;

  useEffect(() => {
    if (!ready && isPolling) router.replace(`/scan/${scanId}`);
  }, [ready, isPolling, router, scanId]);

  if (ready) {
    return (
      <Suspense fallback={null}>
        <div className="sx-root sx-fade" style={{ minHeight: '100%', background: C.bg }}>{children(ready)}</div>
      </Suspense>
    );
  }

  const hyd = hydration?.id === scanId ? hydration : null;
  const notFound = hyd?.state === 'notfound' || (scanId.startsWith('demo-') && !isPolling);
  const failure = (hyd?.state === 'error' && hyd.message) || error;

  const doRescan = async () => {
    if (!repoUrl) return;
    setRescan({ busy: true, error: null });
    try {
      const res = await fetch('/api/scan/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoUrl, force: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.scanId) throw new Error(data.error ?? 'Rescan failed to start');
      useConsole.setState({ hydration: null });
      startPolling(data.scanId);
      router.push(`/scan/${data.scanId}`);
    } catch (e) {
      setRescan({ busy: false, error: e instanceof Error ? e.message : 'Rescan failed to start' });
    }
  };

  return (
    <div className="sx-root" style={{ minHeight: '100%', background: C.bg, padding: 24 }}>
      <Kicker>{`// SCAN ${scanId.slice(0, 8).toUpperCase()}`}</Kicker>
      {notFound ? (
        <Empty title="SCAN NOT FOUND" action={<Link href="/" style={{ font: mono(10.5, 500), letterSpacing: '.12em' }}>← START A NEW SCAN</Link>}>
          {scanId.startsWith('demo-')
            ? 'Sample reports live only in this browser session. Open the sample again from the start page.'
            : 'The link may be wrong, or the scan was removed.'}
        </Empty>
      ) : failure ? (
        <Empty title="RESULTS UNAVAILABLE" action={
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            {repoUrl && <PrimaryButton onClick={doRescan} disabled={rescan.busy}>{rescan.busy ? 'STARTING…' : '↻ RESCAN REPOSITORY'}</PrimaryButton>}
            <GhostButton onClick={() => router.push('/reports')}>OPEN REPORTS</GhostButton>
          </div>
        }>
          <span style={{ color: C.redSoft }}>{failure}</span>
          {rescan.error && <div style={{ marginTop: 8, color: C.orange }}>{rescan.error}</div>}
        </Empty>
      ) : (
        <div className="flex items-center" style={{ gap: 10, marginTop: 18, font: mono(11), color: C.muted }}>
          <span className="sx-live" style={{ width: 6, height: 6, borderRadius: '50%', background: C.cyan }} />
          {isPolling ? 'Scan in progress — opening the live console…' : 'Loading scan results…'}
        </div>
      )}
    </div>
  );
}
