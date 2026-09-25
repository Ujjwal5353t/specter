'use client';
import ThreatGauge from '@/components/ui/ThreatGauge';
import ScannerBadges from '@/components/ui/ScannerBadges';
import FindingsList from '@/components/ui/FindingsList';
import AIPanel from '@/components/ui/AIPanel';
import ThreatFlash from '@/components/ui/ThreatFlash';
import ScanLoader from '@/components/ui/ScanLoader';
import SpecterLogo from '@/components/ui/SpecterLogo';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useScanStore, resultFromStatus, type ScanStatusResponse } from '@/store/scanStore';
import { generateReport } from '@/lib/report';
import type { ScanResult } from '@/types';

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

interface SidebarProps {
  scanResult: ScanResult;
  scannerFilter: string | null;
  onFilterChange: (scanner: string | null) => void;
  onExportPdf: () => void;
  pdfLoading: boolean;
  onRescan: () => void;
  rescanning: boolean;
}

// Extracted to module scope (was previously declared inside ScanPage's body,
// which recreated it — and remounted the whole sidebar, losing expanded-
// finding state and replaying every entrance animation — on every unrelated
// re-render, e.g. dragging the mobile sheet).
function ScanSidebar({ scanResult, scannerFilter, onFilterChange, onExportPdf, pdfLoading, onRescan, rescanning }: SidebarProps) {
  return (
    <>
      <div className="scan-line-effect absolute inset-0 pointer-events-none z-10 overflow-hidden rounded-none" />
      <div className="px-5 md:pt-16 pt-2 pb-4 shrink-0 relative z-20" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="absolute top-4 right-5 z-20 flex items-center gap-2">
          <button
            onClick={onRescan}
            disabled={rescanning}
            title="Ignore cached results and run every scanner again. Slower, but reflects the latest repo state and scanner fixes."
            className="tactical-btn flex items-center gap-2 px-3 py-1.5 rounded-sm cursor-pointer disabled:opacity-60"
            style={{ color: 'var(--ink)' }}
          >
            {rescanning ? (
              <span className="w-2.5 h-2.5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--accent-hi) transparent transparent transparent' }} />
            ) : (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 6a4 4 0 1 1-1.2-2.85M10 1.5v2.5H7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <span className="font-mono text-[10px] tracking-wider">{rescanning ? 'STARTING…' : 'DEEP RESCAN'}</span>
          </button>
          <button
            onClick={onExportPdf}
            disabled={pdfLoading}
            className="tactical-btn group flex items-center gap-2 px-3 py-1.5 rounded-sm cursor-pointer disabled:opacity-60"
            style={{ color: 'var(--ink)' }}
          >
            {pdfLoading ? (
              <span className="w-2.5 h-2.5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--accent-hi) transparent transparent transparent' }} />
            ) : (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 1v7M3 6l3 3 3-3M2 10h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            )}
            <span className="font-mono text-[10px] tracking-wider">{pdfLoading ? 'EXPORTING…' : 'EXPORT PDF'}</span>
          </button>
        </div>
        <ThreatGauge result={scanResult} />
      </div>

      {/* A cached result skipped the scanners entirely — say so, and point at the fresh-data path */}
      {scanResult.fromCache && (
        <div
          className="px-5 py-2 shrink-0 relative z-20 flex items-center justify-between gap-3"
          style={{ borderBottom: '1px solid var(--border)', background: 'color-mix(in srgb, var(--accent) 4%, transparent)' }}
        >
          <span className="font-mono text-[9px] tracking-wider uppercase" style={{ color: 'var(--ink)' }}>
            Cached result{scanResult.scannedAt ? ` · scanned ${timeAgo(scanResult.scannedAt)}` : ''}
          </span>
          <button
            onClick={onRescan}
            disabled={rescanning}
            className="font-mono text-[9px] tracking-wider uppercase cursor-pointer disabled:opacity-60 shrink-0"
            style={{ color: 'var(--accent-hi)' }}
          >
            ▶ deep rescan for fresh data
          </button>
        </div>
      )}

      <div className="px-5 py-3 shrink-0 relative z-20" style={{ borderBottom: '1px solid var(--border)' }}>
        <ScannerBadges result={scanResult} activeFilter={scannerFilter} onFilterChange={onFilterChange} />
      </div>

      <div className="flex-1 overflow-y-auto relative z-20">
        <FindingsList
          result={scanResult}
          scannerFilter={scannerFilter}
          hasAiExplanation={!!scanResult.aiExplanation}
          onRequestAiFocus={() => document.getElementById('ai-intelligence-brief')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
        {scanResult.aiExplanation && (
          <div id="ai-intelligence-brief">
            <AIPanel explanation={scanResult.aiExplanation} />
          </div>
        )}
      </div>

      <div
        className="px-5 py-2.5 shrink-0 flex items-center justify-between relative z-20 bg-void/50 backdrop-blur-sm"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <span className="font-mono text-[9px]" style={{ color: 'var(--muted)' }}>
          {scanResult.repoUrl.replace('https://github.com/', '')}
        </span>
        <div className="w-1.5 h-1.5 rounded-full animate-threat-pulse" style={{ background: 'var(--safe)', boxShadow: '0 0 4px rgba(34,197,94,0.6)' }} />
      </div>
    </>
  );
}

export default function ScanPage() {
  const params = useParams();
  const router = useRouter();
  const { scanResult, isPolling, isLoading, error, reset, startPolling, setScanResult, setError } = useScanStore();
  const aiRef = useRef<{ fetched: boolean }>({ fetched: false });
  const hydrateRef = useRef(false);

  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [scannerFilter, setScannerFilter] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [rescanning, setRescanning] = useState(false);

  const handleBack = () => {
    // Otherwise the rehydrate effect sees the emptied store before this page
    // unmounts and refetches the old scan into the global 3D scene.
    hydrateRef.current = true;
    reset();
    router.push('/');
  };

  // Rehydrate on a direct visit / page refresh: the store only lives in
  // memory, so opening /scan/[id] with nothing loaded (no prior /start or
  // demo click in this session) previously just rendered blank forever.
  useEffect(() => {
    const scanId = params.scanId as string;
    if (!scanId || hydrateRef.current) return;
    hydrateRef.current = true;
    // Already loaded in this session (via /start or a demo): nothing to rehydrate.
    if (scanResult || isPolling || isLoading) return;

    (async () => {
      try {
        const res = await fetch(`/api/scan/${scanId}/status`);
        if (!res.ok) return;
        const data: ScanStatusResponse = await res.json();
        if (data.scan?.status === 'completed') {
          setScanResult(resultFromStatus(scanId, data));
        } else if (data.scan?.status === 'scanning' || data.scan?.status === 'pending') {
          startPolling(scanId);
        } else if (data.scan?.status === 'failed') {
          setError(data.scan.error_message ?? 'Scan failed. The repo may be private or the URL is incorrect.');
        }
      } catch {
        /* leave state as-is on a transient error */
      }
    })();
  }, [params.scanId, scanResult, isPolling, isLoading, setScanResult, startPolling, setError]);

  useEffect(() => {
    if (!scanResult || scanResult.status !== 'completed' || aiRef.current.fetched) return;
    if (scanResult.aiExplanation) return;
    aiRef.current.fetched = true;

    const allFindings = [
      ...(scanResult.depchain?.nodes?.filter((n) => (n.cves?.length ?? 0) > 0).flatMap((n) =>
        n.cves.map((c) => ({ scanner: 'depchain', title: `${n.name}@${n.version}`, detail: c.summary, severity: c.severity }))
      ) ?? []),
      ...(scanResult.depchain?.nodes?.flatMap((n) =>
        (n.signals ?? []).filter((s) => s.severity !== 'low').map((s) => ({ scanner: 'depchain', title: `${s.title}: ${n.name}@${n.version}`, detail: s.detail, severity: s.severity }))
      ) ?? []),
      ...(scanResult.ghostcommit?.findings?.map((f) => ({ scanner: 'ghostcommit', title: f.type, detail: f.file, severity: 'critical' as const })) ?? []),
      ...(scanResult.layerscan?.findings?.map((f) => ({ scanner: 'layerscan', title: f.issue.substring(0, 60), detail: f.fix, severity: f.severity })) ?? []),
      ...(scanResult.apibleed?.endpoints?.filter((e) => e.issues.length > 0).map((e) => ({ scanner: 'apibleed', title: `${e.method} ${e.path}`, detail: e.issues[0], severity: e.severity })) ?? []),
      ...(scanResult.envtrace?.findings?.map((f) => ({ scanner: 'envtrace', title: f.type, detail: f.detail, severity: f.severity })) ?? []),
    ];

    if (allFindings.length > 0) {
      fetch('/api/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ findings: allFindings }) })
        .then((r) => r.json())
        .then((data) => {
          // Error responses ({ error }) have no items array and would crash AIPanel.
          if (!data || typeof data.summary !== 'string' || !Array.isArray(data.items)) {
            console.error('AI brief unavailable:', data?.error ?? data);
            return;
          }
          useScanStore.setState((s) => ({ scanResult: s.scanResult ? { ...s.scanResult, aiExplanation: data } : s.scanResult }));
        })
        .catch(() => {});
    }
    // `aiRef.current.fetched` guards against re-firing when `scanResult`
    // changes again after the AI explanation merges back in below.
  }, [scanResult]);

  // Deep rescan: bypass the 6h cache so every scanner runs against the repo again.
  const handleRescan = async () => {
    if (!scanResult || rescanning) return;
    setRescanning(true);
    try {
      const res = await fetch('/api/scan/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: scanResult.repoUrl, force: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.scanId) throw new Error(data.error ?? 'Rescan failed to start');
      // Let the AI brief and rehydration run again for the new scan.
      aiRef.current.fetched = false;
      hydrateRef.current = true;
      startPolling(data.scanId);
      router.push(`/scan/${data.scanId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rescan failed to start');
    } finally {
      setRescanning(false);
    }
  };

  const handleExportPdf = async () => {
    if (!scanResult) return;
    setPdfLoading(true);
    try {
      await Promise.resolve();
      generateReport(scanResult);
    } finally {
      setTimeout(() => setPdfLoading(false), 400);
    }
  };

  const isReady = !!scanResult;

  return (
    <main className="relative w-full h-screen overflow-hidden bg-transparent">
      {isReady && <ThreatFlash score={scanResult!.threatScore} />}

      <button
        onClick={handleBack}
        className="tactical-btn absolute top-6 left-6 z-50 flex items-center gap-2 group px-4 py-2.5 rounded-sm shadow-lg pointer-events-auto cursor-pointer"
        style={{ background: 'rgba(0,240,255,0.08)', border: '1px solid var(--accent)', backdropFilter: 'blur(8px)' }}
      >
        <SpecterLogo size="sm" />
        <span className="font-mono text-[10px] tracking-widest uppercase font-bold text-white group-hover:text-accent-hi transition-colors">
          + NEW SCAN
        </span>
      </button>

      <AnimatePresence>
        {(isPolling || isLoading) && !isReady && <ScanLoader />}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div
            className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <div className="glass-panel text-center p-6 rounded-sm pointer-events-auto">
              <p className="font-mono text-[11px] mb-4" style={{ color: 'var(--critical)' }}>{error}</p>
              <button
                onClick={handleBack}
                className="tactical-btn pointer-events-auto cursor-pointer font-mono text-[10px] tracking-widest uppercase px-4 py-2 rounded-sm"
                style={{ color: 'var(--ink)' }}
              >
                TRY ANOTHER REPO →
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isReady && (
          <>
            <motion.aside
              className="hidden md:flex absolute top-0 right-0 h-full w-[380px] lg:w-[400px] flex-col z-30 overflow-hidden pointer-events-auto"
              style={{ background: 'rgba(3,7,18,0.96)', borderLeft: '1px solid var(--border-hi)', backdropFilter: 'blur(8px)' }}
              initial={{ x: 420, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 420, opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 250 }}
            >
              <ScanSidebar
                scanResult={scanResult!}
                scannerFilter={scannerFilter}
                onFilterChange={setScannerFilter}
                onExportPdf={handleExportPdf}
                pdfLoading={pdfLoading}
                onRescan={handleRescan}
                rescanning={rescanning}
              />
            </motion.aside>

            <motion.aside
              className="flex md:hidden absolute bottom-0 left-0 right-0 flex-col z-40 overflow-hidden pointer-events-auto"
              style={{
                background: 'rgba(3,7,18,0.97)',
                borderTop: '1px solid var(--border-hi)',
                borderRadius: '20px 20px 0 0',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
              }}
              initial={{ y: '100%', height: '40vh' }}
              animate={{ y: 0, height: isMobileExpanded ? '85vh' : '40vh' }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            >
              <motion.div
                className="flex justify-center pt-4 pb-3 shrink-0 w-full relative z-20 cursor-grab active:cursor-grabbing touch-none"
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={0.2}
                onDragEnd={(e, info) => {
                  if (info.offset.y < -20) setIsMobileExpanded(true);
                  if (info.offset.y > 20) setIsMobileExpanded(false);
                }}
                onClick={() => setIsMobileExpanded(!isMobileExpanded)}
              >
                <div className="w-12 h-1.5 rounded-full transition-colors" style={{ background: isMobileExpanded ? 'var(--accent)' : 'var(--border-hi)' }} />
              </motion.div>

              <ScanSidebar
                scanResult={scanResult!}
                scannerFilter={scannerFilter}
                onFilterChange={setScannerFilter}
                onExportPdf={handleExportPdf}
                pdfLoading={pdfLoading}
                onRescan={handleRescan}
                rescanning={rescanning}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </main>
  );
}
