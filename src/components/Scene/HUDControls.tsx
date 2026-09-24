'use client';

export type LayerFilter = 'all' | 'vulnerable' | 'api' | 'commits';
export type LayoutMode = '3d' | '2d';

interface Props {
  filter: LayerFilter;
  onFilterChange: (f: LayerFilter) => void;
  layoutMode: LayoutMode;
  onLayoutModeChange: (m: LayoutMode) => void;
  onFocusCore: () => void;
}

const FILTERS: { value: LayerFilter; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'vulnerable', label: 'VULNERABLE ONLY' },
  { value: 'api', label: 'API ENDPOINTS' },
  { value: 'commits', label: 'COMMITS' },
];

export default function HUDControls({ filter, onFilterChange, layoutMode, onLayoutModeChange, onFocusCore }: Props) {
  return (
    // Kept clear of the scan sidebar: beside the gimbal (bottom-left) on desktop,
    // where the sidebar covers the right edge; top-right on mobile, where the
    // results sheet covers the bottom.
    <div className="absolute top-6 right-4 items-end md:top-auto md:right-auto md:bottom-6 md:left-28 md:items-start z-30 flex flex-col gap-2 pointer-events-auto max-w-[calc(100vw-32px)]">
      <div className="glass-panel rounded-sm px-2 py-1.5 flex items-center gap-1.5">
        <button
          onClick={onFocusCore}
          className="tactical-btn rounded-sm px-2.5 py-1.5 font-mono text-[9px] tracking-wider uppercase cursor-pointer"
          style={{ color: 'var(--accent-hi)' }}
        >
          ⌖ Focus Core
        </button>
        <div className="w-px h-4" style={{ background: 'var(--glass-border)' }} />
        <button
          onClick={() => onLayoutModeChange(layoutMode === '3d' ? '2d' : '3d')}
          className="tactical-btn rounded-sm px-2.5 py-1.5 font-mono text-[9px] tracking-wider uppercase cursor-pointer"
          style={{ color: 'var(--ink)' }}
        >
          {layoutMode === '3d' ? '3D VIEW' : '2D VIEW'}
        </button>
      </div>

      <div className="glass-panel rounded-sm px-2 py-1.5 flex flex-wrap justify-end md:justify-start items-center gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => onFilterChange(f.value)}
            className="rounded-sm px-2 py-1 font-mono text-[8px] tracking-wider uppercase cursor-pointer transition-colors"
            style={{
              color: filter === f.value ? '#030712' : 'var(--muted)',
              background: filter === f.value ? 'var(--accent)' : 'transparent',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}
