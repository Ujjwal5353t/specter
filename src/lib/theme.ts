import type { Severity } from '@/types';

export const PALETTE = {
  void: '#030712',
  voidDeep: '#000308',
  surface: '#0a0f1a',
  glassBg: 'rgba(255,255,255,0.03)',
  glassBorder: 'rgba(255,255,255,0.10)',
  cyan: '#00F0FF',
  cyanDim: 'rgba(0,240,255,0.18)',
  amber: '#F59E0B',
  amberDim: 'rgba(245,158,11,0.18)',
  crimson: '#FF2A6D',
  crimsonDim: 'rgba(255,42,109,0.18)',
  safe: '#22c55e',
  safeDim: 'rgba(34,197,94,0.18)',
  ink: '#8fa8cc',
  muted: '#3a4d6c',
} as const;

export function severityColor(sev: Severity | string | undefined): string {
  switch (sev) {
    case 'critical': return PALETTE.crimson;
    case 'high': return PALETTE.amber;
    case 'medium': return '#eab308';
    case 'low': return PALETTE.ink;
    default: return PALETTE.muted;
  }
}

export function severityGlow(sev: Severity | string | undefined): string {
  switch (sev) {
    case 'critical': return PALETTE.crimsonDim;
    case 'high': return PALETTE.amberDim;
    default: return 'rgba(255,255,255,0.06)';
  }
}
