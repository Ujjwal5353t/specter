'use client';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { C, mono, SEV } from '@/lib/console/theme';
import type { Severity } from '@/types';

export function Kicker({ children, color = C.cyan }: { children: ReactNode; color?: string }) {
  return <div style={{ font: mono(10, 500), letterSpacing: '.2em', color }}>{children}</div>;
}

export function Label({ children, color = C.dim, size = 9.5, style }: { children: ReactNode; color?: string; size?: number; style?: CSSProperties }) {
  return <span style={{ font: mono(size, 500), letterSpacing: '.14em', color, ...style }}>{children}</span>;
}

export function ViewHeader({ kicker, title, meta, right }: { kicker: string; title: ReactNode; meta?: ReactNode; right?: ReactNode }) {
  return (
    <div className="sx-pad flex flex-wrap items-end justify-between" style={{ padding: '20px 24px 18px', gap: 12 }}>
      <div className="flex flex-col min-w-0" style={{ gap: 8 }}>
        <Kicker>{kicker}</Kicker>
        <div style={{ fontSize: 17, fontWeight: 500, color: C.bright }}>{title}</div>
        {meta && <div className="flex flex-wrap" style={{ gap: 14, font: mono(10.5), color: C.muted }}>{meta}</div>}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, color = C.softer }: { label: string; value: ReactNode; color?: string }) {
  return <span><span style={{ color }}>{value}</span> {label}</span>;
}

export function SevTag({ severity, short = false, square = true }: { severity: Severity; short?: boolean; square?: boolean }) {
  const s = SEV[severity];
  return (
    <span className="inline-flex items-center" style={{ gap: 6, color: s.color, font: mono(10, 500), letterSpacing: '.1em' }}>
      {square && <span style={{ width: 6, height: 6, background: s.color, flexShrink: 0 }} />}
      {short ? s.short : s.label}
    </span>
  );
}

export function Chip({ children, active = false, onClick, color }: { children: ReactNode; active?: boolean; onClick?: () => void; color?: string }) {
  return (
    <button type="button" onClick={onClick} className="sx-act"
      style={{ padding: '6px 9px', border: `1px solid ${active ? C.btn : C.line3}`, color: color ?? (active ? C.ink : C.muted), font: mono(10, 500), letterSpacing: '.1em', background: active ? C.sel : 'transparent' }}>
      {children}
    </button>
  );
}

const btnBase: CSSProperties = { height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '0 16px', font: mono(10.5, 500), letterSpacing: '.12em', whiteSpace: 'nowrap' };

export function PrimaryButton({ children, onClick, disabled, color = C.cyan, style, title, type = 'button' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; color?: string; style?: CSSProperties; title?: string; type?: 'button' | 'submit' }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className="sx-primary"
      style={{ ...btnBase, background: color, color: C.bg, fontWeight: 600, ...style }}>
      {children}
    </button>
  );
}

export function GhostButton({ children, onClick, disabled, style, title }: { children: ReactNode; onClick?: () => void; disabled?: boolean; style?: CSSProperties; title?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className="sx-act"
      style={{ ...btnBase, border: `1px solid ${C.btn}`, color: C.softer, ...style }}>
      {children}
    </button>
  );
}

export function GhostLink({ href, children, style, external }: { href: string; children: ReactNode; style?: CSSProperties; external?: boolean }) {
  const s: CSSProperties = { ...btnBase, border: `1px solid ${C.btn}`, color: C.softer, ...style };
  if (external) return <a href={href} target="_blank" rel="noreferrer" className="sx-act" style={s}>{children}</a>;
  return <Link href={href} className="sx-act" style={s}>{children}</Link>;
}

/** Copies text; the button reports the result instead of assuming success. */
export function CopyButton({ text, label, primary = false, style, disabled }: { text: string; label: string; primary?: boolean; style?: CSSProperties; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 1600);
    return () => clearTimeout(t);
  }, [state]);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('ok');
    } catch {
      setState('fail');
    }
  };
  const content = state === 'ok' ? 'COPIED ✓' : state === 'fail' ? 'COPY FAILED' : label;
  return primary
    ? <PrimaryButton onClick={onClick} disabled={disabled} style={style}>{content}</PrimaryButton>
    : <GhostButton onClick={onClick} disabled={disabled} style={style}>{content}</GhostButton>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start sx-fade" style={{ gap: 10, padding: '28px 24px', maxWidth: 560 }}>
      <Label color={C.muted} size={10}>{title}</Label>
      {children && <div style={{ fontSize: 13.5, lineHeight: 1.55, color: C.softer }}>{children}</div>}
      {action}
    </div>
  );
}

export function Cell({ label, children, last, color = C.ink, size = 11.5 }: { label: string; children: ReactNode; last?: boolean; color?: string; size?: number }) {
  return (
    <div className="flex flex-col min-w-0" style={{ padding: '9px 12px', gap: 6, borderRight: last ? 0 : `1px solid ${C.line3}` }}>
      <Label size={9}>{label}</Label>
      <span className="sx-trunc" style={{ font: mono(size, 500, 1.2), color }}>{children}</span>
    </div>
  );
}

/** `?focus=` — the selection a view was opened with (search palette, cross-links). */
export function useFocusParam(): string | null {
  return useSearchParams().get('focus');
}

/**
 * A view's selected item: starts from `?focus=` and follows it when the URL
 * changes (e.g. picking another result in the search palette), while local
 * picks override it until then.
 */
export function useSelection(): [string | null, (v: string | null) => void] {
  const focus = useFocusParam();
  const [state, setState] = useState<{ focus: string | null; sel: string | null }>({ focus, sel: focus });
  if (state.focus !== focus) setState({ focus, sel: focus });
  return [state.focus !== focus ? focus : state.sel, (v) => setState({ focus, sel: v })];
}

/** Wall clock for relative times, ticking once a minute. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Legend({ items }: { items: { swatch: ReactNode; label: string }[] }) {
  return (
    <div className="flex flex-wrap" style={{ gap: 14, font: mono(10), color: C.muted }}>
      {items.map((it) => <span key={it.label} className="flex items-center" style={{ gap: 6 }}>{it.swatch}{it.label}</span>)}
    </div>
  );
}

export const dot = (color: string, size = 7, round = true): ReactNode =>
  <span style={{ width: size, height: size, borderRadius: round ? '50%' : 1, background: color, display: 'inline-block' }} />;
