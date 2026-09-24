'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useScanStore } from '@/store/scanStore';
import type { ScannerKey, ScannerProgress } from '@/types';

const SCANNERS: { key: ScannerKey; label: string; desc: string }[] = [
  { key: 'depchain',    label: 'DepChain',    desc: 'resolving dependency tree...' },
  { key: 'ghostcommit', label: 'GhostCommit', desc: 'scanning commit history...' },
  { key: 'layerscan',   label: 'LayerScan',   desc: 'parsing dockerfile layers...' },
  { key: 'apibleed',    label: 'APIBleed',    desc: 'mapping api surface...' },
  { key: 'envtrace',    label: 'EnvTrace',    desc: 'tracing env exposure...' },
];

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function StatusDot({ status, i }: { status: ScannerProgress['status'] | 'queued'; i: number }) {
  if (status === 'done') {
    return <span className="w-3 font-mono text-[11px] leading-none shrink-0" style={{ color: 'var(--safe)' }}>✓</span>;
  }
  if (status === 'failed') {
    return <span className="w-3 font-mono text-[11px] leading-none shrink-0" style={{ color: 'var(--critical)' }}>✗</span>;
  }
  return (
    <span className="w-3 flex justify-center shrink-0">
      <motion.span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: status === 'queued' ? 'var(--muted)' : 'var(--accent)' }}
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.25 }}
      />
    </span>
  );
}

export default function ScanLoader() {
  // Real per-scanner state from /status (scan_progress); null until /run starts.
  const progress = useScanStore((s) => s.progress);
  const [now, setNow] = useState(() => Date.now());

  // Ticks the elapsed timers of running scanners between polls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const byKey = new Map(progress?.map((p) => [p.scanner, p]));
  const settled = progress?.filter((p) => p.status !== 'running').length ?? 0;

  return (
    <motion.div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Radar ring */}
      <div className="relative mb-10">
        {[0, 1, 2].map(i => {
          const opacity = Math.round((0.4 - i * 0.12) * 100);
          return (
            <motion.div
              key={i}
              className="absolute rounded-full border"
              style={{
                inset: -(i * 18),
                borderColor: `color-mix(in srgb, var(--accent) ${opacity}%, transparent)`,
              }}
              animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.5, ease: 'easeOut' }}
            />
          );
        })}
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{
            background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)'
          }}
        >
          <div className="w-3 h-3 rounded-full" style={{ background: 'var(--accent)', boxShadow: '0 0 10px var(--accent-glow)' }} />
        </div>
      </div>

      {/* Scanner list — each row reflects that scanner's real server-side state */}
      <div className="flex flex-col gap-2.5 min-w-72 max-w-[calc(100vw-32px)]">
        {SCANNERS.map((s, i) => {
          const p = byKey.get(s.key);
          const status = p?.status ?? 'queued';
          const text = status === 'queued' ? 'waiting to start...' : (p?.detail ?? s.desc);
          const time = status === 'running' && p
            ? formatElapsed(now - new Date(p.started_at).getTime())
            : p?.duration_ms != null ? `${(p.duration_ms / 1000).toFixed(1)}s` : '';

          return (
            <motion.div
              key={s.key}
              className="flex items-center gap-3"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.18 }}
            >
              <StatusDot status={status} i={i} />
              <span className="font-mono text-[11px] w-24 shrink-0" style={{ color: 'var(--white)' }}>
                {s.label}
              </span>
              {status === 'running' || status === 'queued' ? (
                <motion.span
                  className="font-mono text-[10px] flex-1 truncate"
                  style={{ color: 'var(--muted)' }}
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.3 }}
                >
                  {text}
                </motion.span>
              ) : (
                <span
                  className="font-mono text-[10px] flex-1 truncate"
                  style={{ color: status === 'failed' ? 'var(--critical)' : (p?.finding_count ?? 0) > 0 ? 'var(--high)' : 'var(--ink)' }}
                >
                  {text}
                </span>
              )}
              <span className="font-mono text-[10px] tabular-nums shrink-0" style={{ color: 'var(--muted)' }}>
                {time}
              </span>
            </motion.div>
          );
        })}
      </div>

      <motion.p
        className="font-mono text-[9px] tracking-widest uppercase mt-8"
        style={{ color: 'var(--muted)' }}
        animate={{ opacity: [0.4, 0.9, 0.4] }}
        transition={{ duration: 2.5, repeat: Infinity }}
        initial={{ opacity: 0 }}
      >
        {progress ? `${settled} / ${SCANNERS.length} SCANNERS COMPLETE` : 'STARTING SCANNERS'}
      </motion.p>
    </motion.div>
  );
}
