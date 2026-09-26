'use client';
import { create } from 'zustand';
import { resultFromStatus, useScanStore, type ScanStatusResponse } from '@/store/scanStore';

export interface ScanListItem {
  id: string;
  repo_url: string;
  status: string;
  threat_score: number | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  from_cache: boolean;
  source_scan_id: string | null;
  findings: number | null;
  critical: number | null;
  report: 'ready' | 'superseded' | 'expired' | 'scanning' | 'failed';
}

export interface SystemInfo {
  webhook: boolean;
  telegram: boolean;
  cron: boolean;
  monitoredRepos: string[];
  ai: string | null;
  github: boolean;
}

export interface ScanMeta {
  scan: {
    id: string; repo_url: string; status: string; threat_score: number | null; created_at: string;
    completed_at: string | null; from_cache: boolean; error_message: string | null;
  };
  scannedAt: string | null;
  resultsAvailable: boolean;
  head: { branch: string; sha: string } | null;
}

type Hydration = { id: string; state: 'loading' | 'notfound' | 'error' | 'done'; message?: string } | null;

interface ConsoleStore {
  scans: ScanListItem[] | null;
  scansError: string | null;
  scansAt: number;
  system: SystemInfo | null;
  systemError: boolean;
  meta: Record<string, ScanMeta | 'missing'>;
  hydration: Hydration;
  paletteOpen: boolean;
  navOpen: boolean;
  loadScans: (force?: boolean) => Promise<void>;
  loadSystem: () => Promise<void>;
  loadMeta: (id: string, force?: boolean) => Promise<void>;
  hydrate: (id: string) => Promise<void>;
  setPalette: (open: boolean) => void;
  setNav: (open: boolean) => void;
}

let scansInflight: Promise<void> | null = null;
const metaInflight = new Map<string, Promise<void>>();

export const useConsole = create<ConsoleStore>((set, get) => ({
  scans: null,
  scansError: null,
  scansAt: 0,
  system: null,
  systemError: false,
  meta: {},
  hydration: null,
  paletteOpen: false,
  navOpen: false,

  loadScans: (force = false) => {
    if (scansInflight) return scansInflight;
    if (!force && get().scans && Date.now() - get().scansAt < 15_000) return Promise.resolve();
    scansInflight = (async () => {
      try {
        const res = await fetch('/api/scans?limit=300', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Could not load scan history');
        set({ scans: data.scans, scansError: null, scansAt: Date.now() });
      } catch (e) {
        set({ scansError: e instanceof Error ? e.message : 'Could not load scan history' });
      } finally {
        scansInflight = null;
      }
    })();
    return scansInflight;
  },

  loadSystem: async () => {
    if (get().system) return;
    try {
      const res = await fetch('/api/system', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      set({ system: await res.json(), systemError: false });
    } catch {
      set({ systemError: true });
    }
  },

  loadMeta: (id, force = false) => {
    if (!force && get().meta[id]) return Promise.resolve();
    if (metaInflight.has(id)) return metaInflight.get(id)!;
    const p = (async () => {
      try {
        const res = await fetch(`/api/scan/${id}/meta`, { cache: 'no-store' });
        const value = res.ok ? ((await res.json()) as ScanMeta) : 'missing';
        set((s) => ({ meta: { ...s.meta, [id]: value } }));
      } catch {
        /* transient: HUD just shows less */
      } finally {
        metaInflight.delete(id);
      }
    })();
    metaInflight.set(id, p);
    return p;
  },

  /**
   * Loads a scan into the shared scan store on a direct visit to a module
   * view — the same /status fetch and resultFromStatus mapping the threat map
   * page uses to rehydrate, so every view reads one ScanResult.
   */
  hydrate: async (id) => {
    const cur = get().hydration;
    if (cur?.id === id && cur.state === 'loading') return;
    set({ hydration: { id, state: 'loading' } });
    try {
      const res = await fetch(`/api/scan/${id}/status`, { cache: 'no-store' });
      if (res.status === 404) return set({ hydration: { id, state: 'notfound' } });
      if (!res.ok) return set({ hydration: { id, state: 'error', message: 'Could not load this scan. Try again in a moment.' } });
      const data: ScanStatusResponse = await res.json();
      const scan = useScanStore.getState();
      const status = data.scan?.status;
      if (status === 'completed') {
        scan.setScanResult(resultFromStatus(id, data));
        set({ hydration: { id, state: 'done' } });
      } else if (status === 'scanning' || status === 'pending') {
        scan.startPolling(id);
        set({ hydration: { id, state: 'done' } });
      } else {
        useScanStore.setState({ repoUrl: data.scan?.repo_url ?? null });
        set({ hydration: { id, state: 'error', message: data.scan?.error_message ?? 'Scan failed. The repo may be private or the URL is incorrect.' } });
      }
    } catch {
      set({ hydration: { id, state: 'error', message: 'Could not load this scan. Try again in a moment.' } });
    }
  },

  setPalette: (open) => set({ paletteOpen: open }),
  setNav: (open) => set({ navOpen: open }),
}));

/**
 * Point the shared scan store at another scan before navigating to it, so a
 * previous scan's result (or an in-flight poll) can't render under its URL.
 */
export function prepareScan(id: string) {
  const s = useScanStore.getState();
  if (s.scanResult?.scanId === id) return;
  s.reset();
  useConsole.setState({ hydration: null });
}
