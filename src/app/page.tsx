'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useScanStore } from '@/store/scanStore';
import SpecterLogo from '@/components/ui/SpecterLogo';
import type { ScanResult } from '@/types';

const DEMOS = [
  {
    id: 'event-stream',
    label: 'event-stream',
    year: '2018',
    tag: 'KNOWN EXPLOIT',
    dossier: '8M+ downloads carried a Bitcoin-stealing payload for ~2 months before detection.',
  },
  {
    id: 'node-ipc',
    label: 'node-ipc',
    year: '2022',
    tag: 'PROTESTWARE',
    dossier: 'A maintainer shipped disk-wiping code targeting Russian/Belarusian IPs via a dependency update.',
  },
];

const PLACEHOLDER_REPOS = ['torvalds/linux', 'facebook/react', 'vercel/next.js'];

const STATS = [
  { value: '742%', label: 'supply chain attacks up', sub: '2022 → 2024', color: '#FF2A6D', spark: [3, 5, 4, 7, 6, 9, 12, 15, 14, 18] },
  { value: '8M+', label: 'devs hit by event-stream', sub: 'Nov 2018', color: '#F59E0B', spark: [1, 1, 2, 2, 8, 8, 8, 8, 8, 8] },
  { value: '10B', label: 'est. log4shell damage', sub: 'USD', color: '#00F0FF', spark: [2, 2, 3, 4, 6, 9, 9, 10, 10, 10] },
];

const ENGINES = ['DEPCHAIN', 'GHOSTCOMMIT', 'LAYERSCAN', 'APIBLEED', 'ENVTRACE'];

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] as const },
});

function PingDot({ color = '#22d3ee' }: { color?: string }) {
  return (
    <span className="relative flex h-1.5 w-1.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: color }} />
      <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: color }} />
    </span>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data);
  const points = data.map((v, i) => `${(i / (data.length - 1)) * 56},${16 - (v / max) * 14}`).join(' ');
  return (
    <svg width="56" height="16" viewBox="0 0 56 16" className="opacity-70">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

function GithubIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [hoveredDemo, setHoveredDemo] = useState<string | null>(null);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const { setScanResult, startPolling, setLoading: setStoreLoading } = useScanStore();

  useEffect(() => {
    const id = setInterval(() => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_REPOS.length), 2600);
    return () => clearInterval(id);
  }, []);

  const startScan = useCallback(async (repoUrl: string) => {
    setErr('');
    setLoading(true);
    setStoreLoading(true);
    try {
      const res = await fetch('/api/scan/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Scan failed to start');
      startPolling(data.scanId);
      router.push(`/scan/${data.scanId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Scan failed to start');
      setLoading(false);
      setStoreLoading(false);
    }
  }, [router, startPolling, setStoreLoading]);

  const loadDemo = useCallback(async (file: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/demos/${file}`);
      const data: ScanResult = await res.json();
      setScanResult(data);
      router.push(`/scan/${data.scanId}`);
    } catch {
      setErr('Failed to load demo');
      setLoading(false);
    }
  }, [router, setScanResult]);

  return (
    <main className="relative w-full h-screen overflow-hidden bg-transparent pointer-events-none">

      {/* Minimal utility corner — deliberately unobtrusive, keeps the top of the page open */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 0.4 }}
        className="absolute top-6 right-6 z-20 pointer-events-auto flex items-center gap-3"
      >
        <span className="hidden sm:block font-mono text-[9px] tracking-widest text-slate-700">v1.0.4</span>
        <a
          href="https://github.com/VanshikaaZ/specter"
          target="_blank"
          rel="noopener noreferrer"
          className="tactical-btn flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-mono text-[9px] tracking-widest uppercase text-slate-500 hover:text-cyan-300 cursor-pointer"
        >
          <GithubIcon />
          SOURCE
        </a>
      </motion.div>

      <div className="h-screen flex items-center justify-center px-6">
        <div className="pointer-events-auto w-full max-w-2xl flex flex-col items-center text-center">

          {/* Reserved clearance for the 3D orbital visual rendered behind this layer */}
          <div style={{ height: 'clamp(150px, 22vh, 230px)' }} className="shrink-0" aria-hidden />

          {/* Identity plate — directly beneath the orbital visual */}
          <motion.div {...fadeUp(0.15)} className="flex flex-col items-center gap-2.5">
            <div className="flex items-center gap-2 text-cyan-300">
              <SpecterLogo size="md" />
              <span className="font-display text-base tracking-[0.2em] font-bold text-white/90">SPECTER</span>
            </div>
            <div className="flex items-center gap-2">
              <PingDot />
              <span className="font-mono text-[9px] tracking-[0.3em] text-cyan-400/75 uppercase">
                Telemetry Engine Online
              </span>
            </div>
          </motion.div>

          {/* Headline */}
          <motion.h1
            {...fadeUp(0.28)}
            className="font-display font-bold tracking-tight mt-7 leading-[1.15] text-3xl sm:text-4xl md:text-[44px]"
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #f1f5f9 45%, #94a3b8 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              filter: 'drop-shadow(0 0 24px rgba(0,240,255,0.14))',
            }}
          >
            Supply Chain Threat Intelligence
          </motion.h1>

          {/* Description */}
          <motion.p {...fadeUp(0.38)} className="text-sm text-slate-400 mt-3.5 max-w-md leading-relaxed">
            Real-time attack surface mapping — the ghosts in your codebase, made visible.
          </motion.p>

          {/* Scan console */}
          <motion.div {...fadeUp(0.5)} className="w-full mt-10">
            <div className="text-left px-1 mb-2 font-mono text-[9px] tracking-[0.25em] uppercase text-slate-600">
              {'// Initiate Scan — Target Repository'}
            </div>

            <div
              className="scan-line-effect relative rounded-md overflow-hidden"
              style={{ boxShadow: '0 0 50px rgba(0,240,255,0.06)' }}
            >
              <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1.5 pointer-events-none">
                <motion.span animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }} className="text-cyan-400">
                  <GithubIcon />
                </motion.span>
                <PingDot />
              </div>

              <input
                ref={inputRef}
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && url && startScan(url)}
                placeholder={`https://github.com/${PLACEHOLDER_REPOS[placeholderIdx]}`}
                disabled={loading}
                className="w-full h-16 pl-14 pr-36 rounded-md font-mono text-sm bg-slate-950/80 border border-cyan-500/25 text-white placeholder-slate-600 outline-none backdrop-blur-2xl focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/40 transition-all disabled:opacity-50"
              />

              <div className="absolute right-[104px] top-1/2 -translate-y-1/2 hidden sm:flex items-center gap-1 font-mono text-[8px] uppercase pointer-events-none text-slate-600">
                <span className="px-1.5 py-0.5 rounded-sm border border-slate-700">↵ Enter</span>
              </div>

              <button
                onClick={() => url && startScan(url)}
                disabled={loading || !url.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 font-mono font-bold tracking-widest text-xs px-6 py-2.5 rounded transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: loading || !url.trim() ? '#1e293b' : '#22d3ee',
                  color: loading || !url.trim() ? '#64748b' : '#020617',
                  boxShadow: loading || !url.trim() ? 'none' : '0 0 15px rgba(0,240,255,0.4)',
                }}
              >
                {loading ? '...' : 'SCAN →'}
              </button>
            </div>

            <AnimatePresence>
              {err && (
                <motion.p
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="text-sm mt-3"
                  style={{ color: '#FF2A6D' }}
                >
                  {err}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Attack simulation cards */}
          <motion.div {...fadeUp(0.6)} className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full mt-4">
            {DEMOS.map((d) => (
              <button
                key={d.id}
                onClick={() => loadDemo(`${d.id}.json`)}
                onMouseEnter={() => setHoveredDemo(d.id)}
                onMouseLeave={() => setHoveredDemo(null)}
                disabled={loading}
                className="bg-slate-950/50 border border-slate-800/80 hover:border-rose-500/50 hover:bg-slate-900/60 backdrop-blur-md p-3.5 rounded-md cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
              >
                <span className="block font-mono text-[8px] tracking-[0.2em] uppercase mb-1" style={{ color: '#FF2A6D' }}>
                  ⚠ {d.year} · {d.tag}
                </span>
                <span className="block font-mono text-[11px] text-slate-300">
                  [ {d.label} ]
                </span>
                <AnimatePresence>
                  {hoveredDemo === d.id && (
                    <motion.span
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="block font-mono text-[9px] mt-2 leading-relaxed overflow-hidden text-slate-500"
                    >
                      {d.dossier}
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            ))}
          </motion.div>

          {/* Divider */}
          <div
            className="w-full h-px mt-10 mb-6"
            style={{ background: 'linear-gradient(90deg, transparent, var(--border-hi), transparent)' }}
          />

          {/* Metrics + engine chips */}
          <motion.div {...fadeUp(0.72)} className="w-full space-y-3">
            <div className="flex gap-3 justify-center flex-wrap">
              {STATS.map((s) => (
                <div key={s.value} className="glass-panel rounded-sm px-4 py-2.5 text-left" style={{ minWidth: 104 }}>
                  <div className="font-display font-bold leading-none mb-1" style={{ fontSize: 20, color: s.color, letterSpacing: '-0.02em' }}>
                    {s.value}
                  </div>
                  <div className="font-mono text-[8px] mb-1" style={{ color: 'var(--muted)' }}>{s.label}</div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[7px]" style={{ color: 'var(--border-hi)' }}>{s.sub}</span>
                    <Sparkline data={s.spark} color={s.color} />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-1.5 justify-center flex-wrap">
              {ENGINES.map((e) => (
                <span
                  key={e}
                  className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider rounded-sm px-2.5 py-1 glass-panel text-slate-500"
                >
                  <span className="w-1 h-1 rounded-full bg-cyan-500/70" />
                  [ {e} ]
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </main>
  );
}
