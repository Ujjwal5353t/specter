'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useScanStore } from '@/store/scanStore';
import { prepareScan, useConsole } from '@/lib/console/store';
import { allFindings, ENGINE_NAME } from '@/lib/console/derive';
import { C, mono, repoSlug, SEV, timeAgo } from '@/lib/console/theme';
import { VIEWS, scanViewHref, viewHref } from '@/lib/console/views';

interface Item { key: string; group: string; label: string; hint: string; color?: string; go: () => void }

export default function CommandPalette({ scanId }: { scanId: string | null }) {
  const router = useRouter();
  const { paletteOpen, setPalette, scans } = useConsole();
  const scanResult = useScanStore((s) => s.scanResult);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(!useConsole.getState().paletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPalette]);

  // Each time the palette opens it starts from an empty query.
  const [wasOpen, setWasOpen] = useState(paletteOpen);
  if (wasOpen !== paletteOpen) {
    setWasOpen(paletteOpen);
    if (paletteOpen) { setQ(''); setCursor(0); }
  }

  const items = useMemo<Item[]>(() => {
    const close = () => setPalette(false);
    const out: Item[] = [];
    for (const v of VIEWS) {
      const href = viewHref(v, scanId);
      if (href) out.push({ key: `view:${v.id}`, group: 'VIEWS', label: v.label, hint: v.code, go: () => { close(); router.push(href); } });
    }
    const loaded = scanResult && scanResult.scanId === scanId ? scanResult : null;
    if (loaded && scanId) {
      for (const f of allFindings(loaded)) {
        out.push({
          key: f.key, group: 'FINDINGS', label: f.title, hint: `${ENGINE_NAME[f.engine]} · ${f.where}`, color: SEV[f.severity].color,
          go: () => { close(); router.push(`${scanViewHref(f.view, scanId)}${f.focus ? `?focus=${encodeURIComponent(f.focus)}` : ''}`); },
        });
      }
      for (const n of loaded.depchain?.nodes ?? []) {
        if (n.isRoot || (n.cves?.length ?? 0) > 0) continue;
        out.push({ key: `pkg:${n.id}`, group: 'PACKAGES', label: `${n.name}@${n.version}`, hint: n.isDirect ? 'direct' : 'transitive',
          go: () => { close(); router.push(`${scanViewHref('dep', scanId)}?focus=${encodeURIComponent(`node:${n.id}`)}`); } });
      }
    }
    const seen = new Set<string>();
    for (const s of scans ?? []) {
      if (s.report !== 'ready' || seen.has(s.repo_url)) continue;
      seen.add(s.repo_url);
      out.push({ key: `repo:${s.id}`, group: 'REPOSITORIES', label: repoSlug(s.repo_url), hint: `score ${s.threat_score ?? '—'} · ${timeAgo(s.created_at)}`,
        go: () => { close(); prepareScan(s.id); router.push(scanViewHref('ovr', s.id)); } });
    }
    return out;
  }, [scanResult, scanId, scans, router, setPalette]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? items.filter((i) => `${i.label} ${i.hint} ${i.group}`.toLowerCase().includes(t)) : items;
    return list.slice(0, 80);
  }, [items, q]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!paletteOpen) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setPalette(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') filtered[cursor]?.go();
  };

  let lastGroup = '';
  return (
    <div className="sx-root fixed inset-0 z-[60] flex justify-center pointer-events-auto" style={{ background: 'rgba(3,6,11,.72)', paddingTop: '12vh' }}
      onMouseDown={() => setPalette(false)}>
      <div role="dialog" aria-label="Search" className="sx-fade flex flex-col" onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 'min(640px, calc(100vw - 32px))', maxHeight: '64vh', background: C.hud, border: `1px solid ${C.line2}`, boxShadow: '0 30px 80px -20px rgba(0,0,0,.9)' }}>
        <div className="flex items-center" style={{ gap: 10, padding: '0 14px', height: 48, borderBottom: `1px solid ${C.line}` }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" aria-hidden><path d="M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0M20 20l-4-4" /></svg>
          <input ref={inputRef} autoFocus value={q} onChange={(e) => { setQ(e.target.value); setCursor(0); }} onKeyDown={onKeyDown}
            placeholder={scanId ? 'Search findings, packages, CVEs, commits, endpoints…' : 'Search views and repositories…'}
            style={{ flex: 1, background: 'transparent', border: 0, outline: 'none', color: C.bright, font: mono(13) }} />
          <span style={{ padding: '2px 5px', border: '1px solid #1C2C40', font: mono(9.5), color: C.muted }}>ESC</span>
        </div>
        <div ref={listRef} className="sx-scroll" style={{ padding: '6px 0' }}>
          {filtered.length === 0 && <div style={{ padding: '16px', font: mono(11.5), color: C.muted }}>No matches in this scan.</div>}
          {filtered.map((it, i) => {
            const header = it.group !== lastGroup ? (lastGroup = it.group) : null;
            return (
              <div key={it.key}>
                {header && <div style={{ padding: '10px 16px 6px', font: mono(9, 500), letterSpacing: '.16em', color: C.dim }}>{header}</div>}
                <button type="button" data-idx={i} onMouseEnter={() => setCursor(i)} onClick={it.go}
                  className="w-full grid items-center text-left"
                  style={{ gridTemplateColumns: '10px minmax(0,1fr) auto', gap: 10, padding: '8px 16px', background: i === cursor ? C.sel : 'transparent' }}>
                  <span style={{ width: 6, height: 6, background: it.color ?? C.dimmer }} />
                  <span className="sx-trunc" style={{ font: mono(12), color: i === cursor ? C.white : C.ink }}>{it.label}</span>
                  <span className="sx-trunc" style={{ font: mono(10), color: C.muted, maxWidth: 220 }}>{it.hint}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
