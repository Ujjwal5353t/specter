'use client';
import { motion } from 'framer-motion';
import type { AIExplanation } from '@/types';

export type AIStatus = 'idle' | 'loading' | 'ok' | 'unconfigured' | 'failed';

interface Props {
  explanation?: AIExplanation | null;
  status?: AIStatus;
  onRetry?: () => void;
}

export default function AIPanel({ explanation, status = 'ok', onRetry }: Props) {
  if (!explanation) {
    if (status === 'idle' || status === 'ok') return null;
    return (
      <div className="px-5 pb-6">
        <div className="flex items-center gap-2 my-4">
          <span className="font-mono text-[9px] tracking-[0.2em] uppercase" style={{ color: 'var(--muted)' }}>
            ▶ AI INTELLIGENCE BRIEF
          </span>
          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
        </div>
        {status === 'loading' && (
          <p className="font-mono text-[9px] tracking-wide animate-pulse" style={{ color: 'var(--muted)' }}>
            generating brief...
          </p>
        )}
        {status === 'unconfigured' && (
          <p className="font-mono text-[9px] tracking-wide" style={{ color: 'var(--muted)' }}>
            AI brief unavailable (no API key configured)
          </p>
        )}
        {status === 'failed' && (
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[9px] tracking-wide" style={{ color: 'var(--high)' }}>
              AI brief failed to load
            </p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="tactical-btn font-mono text-[9px] tracking-wider uppercase px-2.5 py-1 rounded-sm cursor-pointer shrink-0"
                style={{ color: 'var(--ink)' }}
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <motion.div
      className="px-5 pb-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.5, duration: 0.4 }}
    >
      {/* Section divider — terminal-style header */}
      <div className="flex items-center gap-2 my-4">
        <span className="font-mono text-[9px] tracking-[0.2em] uppercase" style={{ color: 'var(--accent-hi)' }}>
          ▶ AI INTELLIGENCE BRIEF
        </span>
        <div
          className="flex-1 h-px"
          style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--accent) 33%, transparent), transparent)' }}
        />
      </div>

      {/* Summary — analyst's overall assessment */}
      <div
        className="p-3 rounded-sm mb-4"
        style={{
          background: 'color-mix(in srgb, var(--accent) 5%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent) 15%, transparent)',
        }}
      >
        <p className="font-body text-[11px] leading-relaxed" style={{ color: 'var(--ink)' }}>
          {explanation.summary}
        </p>
      </div>

      {/* Disclaimer — model output is unverified */}
      <p className="font-mono text-[9px] tracking-wide mb-4 -mt-2" style={{ color: 'var(--muted)' }}>
        AI-generated analysis. May contain errors; verify fixes independently before applying.
      </p>

      {/* Individual items — analyst breakdown per finding */}
      <div className="space-y-3">
        {(explanation.items ?? []).map((item, i) => (
          <motion.div
            key={i}
            className="rounded-sm overflow-hidden"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 + i * 0.1 }}
          >
            {/* Item header */}
            <div
              className="px-3 py-2 flex items-center gap-2"
              style={{
                background: 'color-mix(in srgb, var(--critical) 6%, transparent)',
                borderBottom: '1px solid color-mix(in srgb, var(--critical) 12%, transparent)',
              }}
            >
              <div 
                className="w-1 h-1 rounded-full shrink-0" 
                style={{ background: 'var(--critical)', boxShadow: '0 0 4px color-mix(in srgb, var(--critical) 50%, transparent)' }} 
              />
              <span className="font-mono text-[10px] font-bold leading-snug" style={{ color: 'var(--critical)' }}>
                {item.title}
              </span>
            </div>

            {/* Fields */}
            <div className="p-3 space-y-2.5">
              {[
                { label: 'Why dangerous', value: item.why_dangerous, color: 'var(--ink)' },
                { label: 'Fix', value: item.exact_fix, color: 'var(--white)' },
                { label: 'Typical attack pattern', value: item.attack_pattern, color: 'var(--muted)', italic: true },
              ].map(({ label, value, color, italic }) => (
                <div key={label}>
                  <span
                    className="font-mono text-[8px] tracking-widest uppercase block mb-0.5"
                    style={{ color: 'var(--muted)' }}
                  >
                    {label}
                  </span>
                  <p
                    className={`font-body text-[11px] leading-relaxed ${italic ? 'italic' : ''}`}
                    style={{ color }}
                  >
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}