import type { ScannerKey } from '@/types';

/**
 * Every console destination the rail links to. Scan-scoped views live under
 * /scan/[scanId]/<segment>; the threat map is the scan route itself (the
 * existing page). Reports and monitoring span every scan.
 */
export type ViewId = 'ovr' | 'map' | 'dep' | 'gst' | 'lyr' | 'api' | 'sec' | 'env' | 'rpt' | 'mon';

export interface ViewDef {
  id: ViewId;
  code: string;
  label: string;
  /** Path segment under /scan/[scanId]; '' is the threat map; null = not scan-scoped. */
  segment: string | null;
  /** Engine whose findings light the rail dot. */
  engine?: ScannerKey | 'secrets';
  dot?: string;
  /** Icon path (24×24 viewBox), from the reference Rail.dc.html. */
  d: string;
}

export const VIEWS: ViewDef[] = [
  { id: 'ovr', code: 'OVR', label: 'Overview — Intelligence brief', segment: 'brief', d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'map', code: 'MAP', label: 'Threat map', segment: '', d: 'M10 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0M3 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 7v5M12 12l-6.3 4.6M12 12l6.3 4.6' },
  { id: 'dep', code: 'DEP', label: 'Dependencies — DepChain', segment: 'dependencies', engine: 'depchain', dot: '#E8B84A', d: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5' },
  { id: 'gst', code: 'GST', label: 'Ghost commits — GhostCommit', segment: 'ghost-commits', engine: 'ghostcommit', dot: '#FF3D4F', d: 'M3 12h6M15 12h6M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0' },
  { id: 'lyr', code: 'LYR', label: 'Infrastructure — LayerScan', segment: 'infrastructure', engine: 'layerscan', dot: '#FF8A2B', d: 'M12 4l9 4.5-9 4.5-9-4.5zM3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5' },
  { id: 'api', code: 'API', label: 'API surface — APIBleed', segment: 'api-surface', engine: 'apibleed', dot: '#FF3D4F', d: 'M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14' },
  { id: 'sec', code: 'SEC', label: 'Secrets investigation', segment: 'secrets', engine: 'secrets', dot: '#FF3D4F', d: 'M4 15a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M10 12.5L19 4M16 7l2.5 2.5M13.5 9.5l2 2' },
  { id: 'env', code: 'ENV', label: 'Environment — EnvTrace', segment: 'env', engine: 'envtrace', dot: '#FF8A2B', d: 'M5 4h14v16H5zM8 8h4M8 12h8M8 16h6M15 7.5l1.5 1.5' },
  { id: 'rpt', code: 'RPT', label: 'Reports', segment: null, d: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6' },
  { id: 'mon', code: 'MON', label: 'Monitoring', segment: null, d: 'M3 12h4l2-6 4 12 2-6h6' },
];

export function viewHref(v: ViewDef, scanId: string | null): string | null {
  if (v.id === 'rpt') return '/reports';
  if (v.id === 'mon') return '/monitoring';
  if (!scanId) return null;
  return v.segment ? `/scan/${scanId}/${v.segment}` : `/scan/${scanId}`;
}

export function scanViewHref(id: ViewId, scanId: string): string {
  return viewHref(VIEWS.find((v) => v.id === id)!, scanId) ?? '/';
}

/** Which view a pathname is, plus the scan it belongs to (if any). */
export function matchView(pathname: string): { view: ViewId | null; scanId: string | null } {
  if (pathname.startsWith('/reports')) return { view: 'rpt', scanId: null };
  if (pathname.startsWith('/monitoring')) return { view: 'mon', scanId: null };
  const m = pathname.match(/^\/scan\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!m) return { view: null, scanId: null };
  const seg = m[2] ?? '';
  const v = VIEWS.find((x) => x.segment === seg);
  return { view: v?.id ?? null, scanId: decodeURIComponent(m[1]) };
}
