import type { Severity } from '@/types';

/**
 * Palette of the SPECTER console views (html/SPECTER/03–11 design references).
 * Same values the scan console (components/scan/ScanConsole.tsx) uses, so the
 * shell, the live-scan console and every module view read as one system.
 */
export const C = {
  bg: '#03060B',
  panel: '#04080D',
  hud: '#04080E',
  well: '#050A11',
  code: '#060C14',
  line: '#101B29',
  line2: '#16273A',
  line3: '#13212F',
  row: '#0B1420',
  btn: '#1E3348',
  sel: '#0A1522',
  hover: '#08101A',
  ink: '#D5E1EC',
  bright: '#E9F0F7',
  white: '#F2F6FA',
  cyan: '#4FD8F0',
  cyanHi: '#8BE9FA',
  green: '#3FCF8E',
  red: '#FF3D4F',
  redSoft: '#FF6B78',
  orange: '#FF8A2B',
  orangeSoft: '#FFA25C',
  amber: '#E8B84A',
  blue: '#3576EE',
  blueDeep: '#1D48A6',
  slate: '#5D7FA8',
  dim: '#4F6680',
  dimmer: '#3C5068',
  muted: '#6E8299',
  soft: '#8A9BB0',
  softer: '#A8B8C9',
  body: '#C3D1DF',
  railInk: '#5E7189',
} as const;

export const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
export const SANS = "'Archivo Variable', 'Archivo', ui-sans-serif, system-ui, sans-serif";

export const SEV: Record<Severity, { color: string; label: string; short: string; rank: number }> = {
  critical: { color: C.red, label: 'CRITICAL', short: 'CRIT', rank: 0 },
  high: { color: C.orange, label: 'HIGH', short: 'HIGH', rank: 1 },
  medium: { color: C.amber, label: 'MEDIUM', short: 'MED', rank: 2 },
  low: { color: C.slate, label: 'LOW', short: 'LOW', rank: 3 },
  info: { color: C.dim, label: 'INFO', short: 'INFO', rank: 4 },
};

export function sevRank(s: Severity | string | undefined): number {
  return SEV[s as Severity]?.rank ?? 5;
}

export function worstOf(list: (Severity | undefined)[]): Severity | null {
  let worst: Severity | null = null;
  for (const s of list) if (s && (worst === null || sevRank(s) < sevRank(worst))) worst = s;
  return worst;
}

/** Score band used by the reports and monitoring references. */
export function band(score: number): { label: string; color: string } {
  if (score >= 75) return { label: 'CRITICAL', color: C.red };
  if (score >= 50) return { label: 'HIGH', color: C.orange };
  if (score >= 25) return { label: 'MEDIUM', color: C.amber };
  return { label: 'LOW', color: C.slate };
}

export const mono = (size: number, weight = 400, lh: number | string = 1) => `${weight} ${size}px/${lh} ${MONO}`;

export function repoSlug(url: string | null | undefined): string {
  return (url ?? '').replace(/^https?:\/\/github\.com\//i, '');
}

export function shortSha(sha: string | null | undefined): string {
  return (sha ?? '').slice(0, 7);
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${fmtDate(iso)} · ${fmtTime(iso)}`;
}

export function fmtDuration(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${pad(m)}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
