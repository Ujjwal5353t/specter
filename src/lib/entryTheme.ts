// Palette and type stacks of the Entry design (mirrors src/app/page.tsx),
// shared by pages that follow that design language.
export const C = {
  bg: '#03060B',
  ink: '#D5E1EC',
  inkBright: '#E9F0F7',
  inkSoft: '#7F92A8',
  cyan: '#4FD8F0',
  dim: '#4F6680',
  muted: '#52667D',
  navInk: '#8A9BB0',
  line: '#16273A',
  lineSoft: '#111E2D',
  lineFooter: '#0E1826',
  slash: '#27405C',
  green: '#3FCF8E',
  red: '#FF3D4F',
  orange: '#FF8A2B',
  engineName: '#E0E9F2',
  wordmark: '#E6EEF6',
} as const;

export const MONO = "'JetBrains Mono', ui-monospace, monospace";
export const SANS = "'Archivo Variable', 'Archivo', ui-sans-serif, system-ui, sans-serif";
export const GUTTER = 'clamp(16px, 5.5vw, 104px)';

export const mono = (size: number, weight = 500) => `${weight} ${size}px/1.4 ${MONO}`;
