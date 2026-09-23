'use client';
import { motion } from 'framer-motion';
import type { ScanResult } from '@/types';

interface Props {
  result: ScanResult;
  activeFilter?: string | null;
  onFilterChange?: (scanner: string | null) => void;
}

const SCANNERS = [
  { key: 'depchain', label: 'DepChain', abbr: 'DEP' },
  { key: 'ghostcommit', label: 'GhostCommit', abbr: 'GST' },
  { key: 'layerscan', label: 'LayerScan', abbr: 'LYR' },
  { key: 'apibleed', label: 'APIBleed', abbr: 'API' },
  { key: 'envtrace', label: 'EnvTrace', abbr: 'ENV' },
];

type Status = 'inactive' | 'clean' | 'warning' | 'vulnerable';

function statusFor(key: string, result: ScanResult): Status {
  switch (key) {
    case 'depchain': {
      const d = result.depchain;
      if (!d) return 'inactive';
      return d.vulnCount > 0 ? 'vulnerable' : 'clean';
    }
    case 'ghostcommit': {
      const g = result.ghostcommit;
      if (!g) return 'inactive';
      return g.findings.length > 0 ? 'vulnerable' : 'clean';
    }
    case 'layerscan': {
      const l = result.layerscan;
      if (!l) return 'inactive';
      if (l.findings.some((f) => f.severity === 'critical' || f.severity === 'high')) return 'vulnerable';
      return l.findings.length > 0 ? 'warning' : 'clean';
    }
    case 'apibleed': {
      const a = result.apibleed;
      if (!a) return 'inactive';
      return a.unsecuredCount > 0 ? 'vulnerable' : 'clean';
    }
    case 'envtrace': {
      const e = result.envtrace;
      if (!e) return 'inactive';
      if (e.findings.some((f) => f.severity === 'critical')) return 'vulnerable';
      return e.findings.length > 0 ? 'warning' : 'clean';
    }
    default:
      return 'inactive';
  }
}

const STATUS_COLOR: Record<Status, string> = {
  inactive: 'var(--muted)',
  clean: '#22c55e',
  warning: '#F59E0B',
  vulnerable: '#FF2A6D',
};

export default function ScannerBadges({ result, activeFilter, onFilterChange }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[9px] tracking-[0.2em] uppercase" style={{ color: 'var(--muted)' }}>
          scanner telemetry
        </span>
        {activeFilter && (
          <button
            onClick={() => onFilterChange?.(null)}
            className="font-mono text-[8px] uppercase tracking-wider cursor-pointer"
            style={{ color: 'var(--accent-hi)' }}
          >
            clear filter ×
          </button>
        )}
      </div>
      <div className="grid grid-cols-5 gap-1">
        {SCANNERS.map(({ key, label, abbr }, i) => {
          const status = statusFor(key, result);
          const color = STATUS_COLOR[status];
          const isActive = activeFilter === key;

          return (
            <motion.button
              key={key}
              onClick={() => onFilterChange?.(isActive ? null : key)}
              title={label}
              className="tactical-btn relative flex flex-col items-center py-2 px-1 rounded-sm cursor-pointer"
              style={{
                background: isActive ? `${color}18` : status === 'inactive' ? 'var(--surface)' : 'var(--glass-bg)',
                border: `1px solid ${isActive ? color : status === 'inactive' ? 'var(--border)' : `${color}30`}`,
              }}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07, duration: 0.3 }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full mb-1.5"
                style={{
                  background: color,
                  boxShadow: status !== 'inactive' ? `0 0 6px ${color}99` : 'none',
                }}
              />
              <span className="font-mono text-[9px] font-bold tracking-wider leading-none mb-0.5" style={{ color }}>
                {abbr}
              </span>
              <span className="font-mono text-[6.5px] leading-none uppercase" style={{ color: 'var(--muted)' }}>
                {status === 'inactive' ? '—' : status === 'clean' ? 'clean' : status === 'warning' ? 'warn' : 'found'}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
