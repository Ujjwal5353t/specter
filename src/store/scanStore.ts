import { create } from 'zustand';
import type { ScanResult, ScannerProgress } from '@/types';

/** Shape of GET /api/scan/[scanId]/status. */
export interface ScanStatusResponse {
  scan?: { status: string; repo_url: string; threat_score: number | null; error_message?: string | null; from_cache?: boolean };
  cache?: {
    dep_data?: ScanResult['depchain'];
    secret_data?: ScanResult['ghostcommit'];
    docker_data?: ScanResult['layerscan'];
    api_data?: ScanResult['apibleed'];
    env_data?: ScanResult['envtrace'];
  } | null;
  progress?: ScannerProgress[] | null;
  scannedAt?: string | null;
}

/** Builds a completed ScanResult from a status response (polling and page rehydration share this). */
export function resultFromStatus(scanId: string, data: ScanStatusResponse): ScanResult {
  return {
    scanId,
    repoUrl: data.scan?.repo_url ?? '',
    status: 'completed',
    threatScore: data.scan?.threat_score ?? 0,
    depchain: data.cache?.dep_data ?? undefined,
    ghostcommit: data.cache?.secret_data ?? undefined,
    layerscan: data.cache?.docker_data ?? undefined,
    apibleed: data.cache?.api_data ?? undefined,
    envtrace: data.cache?.env_data ?? undefined,
    fromCache: data.scan?.from_cache ?? false,
    scannedAt: data.scannedAt ?? undefined,
  };
}

// Fast enough that the loader's per-scanner ticks feel live.
const POLL_INTERVAL_MS = 1500;
// /run has maxDuration 60, so a scan still 'scanning' after this long was
// killed without updating its row; stop waiting instead of polling forever.
const POLL_TIMEOUT_MS = 120_000;
export const SCAN_TIMEOUT_MESSAGE = 'Scan timed out — the server stopped responding. Retry.';

interface ScanStore {
  scanResult: ScanResult | null;
  selectedNode: string | null;
  sidebarOpen: boolean;
  isPolling: boolean;
  isLoading: boolean;
  error: string | null;
  /** Repo of the scan being polled (from /status); lets the error state offer a retry. */
  repoUrl: string | null;
  /** Per-scanner state while a scan runs; null before /run reports any. */
  progress: ScannerProgress[] | null;
  setScanResult: (result: ScanResult) => void;
  setSelectedNode: (id: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (err: string | null) => void;
  startPolling: (scanId: string) => void;
  stopPolling: () => void;
  reset: () => void;
}

let pollInterval: ReturnType<typeof setInterval> | null = null;
// Bumped on every start/stop so a response still in flight from an old poll
// can't write into a newer scan's state.
let pollToken = 0;

export const useScanStore = create<ScanStore>((set, get) => ({
  scanResult: null,
  selectedNode: null,
  sidebarOpen: false,
  isPolling: false,
  isLoading: false,
  error: null,
  repoUrl: null,
  progress: null,

  setScanResult: (result) => set({ scanResult: result, isLoading: false }),
  setSelectedNode: (id) => set({ selectedNode: id, sidebarOpen: id !== null }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (err) => set({ error: err, isLoading: false }),

  reset: () => {
    get().stopPolling();
    set({ scanResult: null, selectedNode: null, sidebarOpen: false, error: null, repoUrl: null, isLoading: false, progress: null });
  },

  startPolling: (scanId: string) => {
    // Drop any previous scan's result/error so they can't bleed into this one
    get().stopPolling();
    set({ isPolling: true, scanResult: null, error: null, repoUrl: null, progress: null, selectedNode: null, sidebarOpen: false });
    const token = pollToken;
    const startedAt = Date.now();
    pollInterval = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        get().stopPolling();
        set({ error: SCAN_TIMEOUT_MESSAGE, isLoading: false });
        return;
      }
      try {
        const res = await fetch(`/api/scan/${scanId}/status`);
        if (!res.ok) throw new Error('Status check failed');
        const data: ScanStatusResponse = await res.json();
        if (token !== pollToken) return;
        if (data.progress) set({ progress: data.progress });
        if (data.scan?.repo_url) set({ repoUrl: data.scan.repo_url });

        if (data.scan?.status === 'completed') {
          get().stopPolling();
          set({ scanResult: resultFromStatus(scanId, data), isLoading: false });
        } else if (data.scan?.status === 'failed') {
          get().stopPolling();
          set({ error: data.scan.error_message ?? 'Scan failed. The repo may be private or the URL is incorrect.', isLoading: false });
        }
      } catch {
        // keep polling on transient errors; the timeout above bounds this
      }
    }, POLL_INTERVAL_MS);
  },

  stopPolling: () => {
    pollToken++;
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    set({ isPolling: false });
  },
}));