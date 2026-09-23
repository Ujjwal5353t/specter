import { create } from 'zustand';
import type { ScanResult } from '@/types';

interface ScanStore {
  scanResult: ScanResult | null;
  selectedNode: string | null;
  sidebarOpen: boolean;
  isPolling: boolean;
  isLoading: boolean;
  error: string | null;
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

export const useScanStore = create<ScanStore>((set, get) => ({
  scanResult: null,
  selectedNode: null,
  sidebarOpen: false,
  isPolling: false,
  isLoading: false,
  error: null,

  setScanResult: (result) => set({ scanResult: result, isLoading: false }),
  setSelectedNode: (id) => set({ selectedNode: id, sidebarOpen: id !== null }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (err) => set({ error: err, isLoading: false }),

  reset: () => {
    get().stopPolling();
    set({ scanResult: null, selectedNode: null, sidebarOpen: false, error: null, isLoading: false });
  },

  startPolling: (scanId: string) => {
    // Drop any previous scan's result/error so they can't bleed into this one
    get().stopPolling();
    set({ isPolling: true, scanResult: null, error: null });
    pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/scan/${scanId}/status`);
        if (!res.ok) throw new Error('Status check failed');
        const data = await res.json();

        if (data.scan?.status === 'completed') {
          get().stopPolling();
          set({
            scanResult: {
              scanId,
              repoUrl: data.scan.repo_url,
              status: 'completed',
              threatScore: data.scan.threat_score ?? 0,
              depchain: data.cache?.dep_data ?? undefined,
              ghostcommit: data.cache?.secret_data ?? undefined,
              layerscan: data.cache?.docker_data ?? undefined,
              apibleed: data.cache?.api_data ?? undefined,
              envtrace: data.cache?.env_data ?? undefined,
            },
            isLoading: false,
          });
        } else if (data.scan?.status === 'failed') {
          get().stopPolling();
          set({ error: data.scan.error_message ?? 'Scan failed. The repo may be private or the URL is incorrect.', isLoading: false });
        }
      } catch {
        // keep polling on transient errors
      }
    }, 3000);
  },

  stopPolling: () => {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    set({ isPolling: false });
  },
}));