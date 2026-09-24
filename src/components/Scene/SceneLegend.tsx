'use client';
import { useState, type ReactNode } from 'react';
import { SCENE_COLORS } from '@/lib/depGraphLayout';

/** Top-left key for the 3D scene. Colours come from SCENE_COLORS, same as the meshes. */

function Dot({ color, size = 8, ring = false }: { color: string; size?: number; ring?: boolean }) {
  return (
    <span
      className="rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        background: color,
        boxShadow: ring ? `0 0 0 2px color-mix(in srgb, ${color} 25%, transparent)` : `0 0 4px ${color}`,
      }}
    />
  );
}

function Dash({ color, dotted = false }: { color: string; dotted?: boolean }) {
  return (
    <span
      className="shrink-0"
      style={{ width: 14, height: 0, borderTop: `2px ${dotted ? 'dotted' : 'dashed'} ${color}` }}
    />
  );
}

function Row({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className="w-3.5 flex items-center justify-center">{swatch}</span>
      <span className="font-mono text-[9px] leading-tight" style={{ color: 'var(--ink)' }}>{label}</span>
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[8px] tracking-[0.2em] uppercase mb-1.5" style={{ color: 'var(--muted)' }}>{title}</p>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}

export default function SceneLegend() {
  const [open, setOpen] = useState(true);

  return (
    // Below the HUD controls on mobile (they sit top-right there), under NEW SCAN on desktop.
    <div className="absolute top-36 md:top-20 left-6 z-30 pointer-events-auto select-none max-w-[calc(100vw-32px)]">
      <div className="glass-panel rounded-sm">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="w-full flex items-center justify-between gap-4 px-3 py-2 cursor-pointer"
        >
          <span className="font-mono text-[9px] tracking-[0.2em] uppercase" style={{ color: 'var(--accent-hi)' }}>
            Map legend
          </span>
          <span className="font-mono text-[9px]" style={{ color: 'var(--muted)' }}>{open ? '▾' : '▸'}</span>
        </button>

        {open && (
          <div className="px-3 pb-3 flex flex-col gap-3" style={{ borderTop: '1px solid var(--glass-border)' }}>
            <div className="pt-2.5">
              <Section title="Dependencies">
                <Row swatch={<Dot color={SCENE_COLORS.direct} size={12} />} label="Repository (centre)" />
                <Row swatch={<Dot color={SCENE_COLORS.direct} />} label="Direct dependency" />
                <Row swatch={<Dot color={SCENE_COLORS.transitive} size={6} />} label="Transitive dependency" />
              </Section>
            </div>

            <Section title="Worst advisory">
              <Row swatch={<Dot color={SCENE_COLORS.critical} ring />} label="Critical (pulsing)" />
              <Row swatch={<Dot color={SCENE_COLORS.high} ring />} label="High" />
              <Row swatch={<Dot color={SCENE_COLORS.medium} ring />} label="Medium" />
              <Row swatch={<Dot color={SCENE_COLORS.low} ring />} label="Low" />
              <Row swatch={<Dot color={SCENE_COLORS.riskSignal} ring />} label="Supply-chain warning" />
            </Section>

            <Section title="Other layers">
              <Row swatch={<Dash color={SCENE_COLORS.critical} dotted />} label="Attack path into repo" />
              <Row swatch={<Dash color={SCENE_COLORS.unauthed} />} label="API endpoint (colour = severity)" />
              <Row swatch={<Dash color={SCENE_COLORS.authed} />} label="API endpoint with auth" />
              <Row
                swatch={<span className="shrink-0" style={{ width: 4, height: 11, background: SCENE_COLORS.critical }} />}
                label="Leaked secret (commit history)"
              />
            </Section>

            <p className="font-mono text-[8px] leading-snug" style={{ color: 'var(--muted)' }}>
              Hover a node for its name · click for its findings · Esc to clear
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
