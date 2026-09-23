'use client';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { useEffect, useMemo } from 'react';
import type { ScanResult } from '@/types';

interface Props { result: ScanResult; }

const SEV_WEIGHT: Record<string, number> = { critical: 15, high: 8, medium: 4, low: 1, info: 0 };

const THRESHOLDS = [
  { min: 70, color: '#FF2A6D', label: 'CRITICAL BREACH RISK' },
  { min: 40, color: '#F59E0B', label: 'HIGH RISK' },
  { min: 10, color: '#eab308', label: 'ELEVATED RISK' },
  { min: 0, color: '#22c55e', label: 'NOMINAL' },
];

// Mirrors calcThreatScore() in src/app/api/scan/[scanId]/run/route.ts so the
// breakdown bars always sum to the same score the backend actually computed.
function computeBreakdown(r: ScanResult) {
  const envFindings = r.envtrace?.findings ?? [];
  const layerFindings = r.layerscan?.findings ?? [];
  const envScore = envFindings.reduce((a, f) => a + (SEV_WEIGHT[f.severity] ?? 0), 0);
  const layerScore = layerFindings.reduce((a, f) => a + (SEV_WEIGHT[f.severity] ?? 0), 0);

  const vulnDeps = r.depchain?.vulnCount ?? 0;
  const secretsCount = r.ghostcommit?.findings?.length ?? 0;
  const unsecuredApis = r.apibleed?.unsecuredCount ?? 0;

  return [
    { label: 'INFRA', value: Math.min(envScore + layerScore, 40), max: 40, color: '#F59E0B' },
    { label: 'DEPENDENCIES', value: Math.min(vulnDeps * 8, 30), max: 30, color: '#FF2A6D' },
    { label: 'SECRETS', value: Math.min(secretsCount * 10, 20), max: 20, color: '#eab308' },
    { label: 'CODE/API', value: Math.min(unsecuredApis * 5, 10), max: 10, color: '#00F0FF' },
  ];
}

const R = 50;
const CIRC = 2 * Math.PI * R;

export default function ThreatGauge({ result }: Props) {
  const score = result.threatScore;
  const t = THRESHOLDS.find((th) => score >= th.min) ?? THRESHOLDS[3];
  const breakdown = useMemo(() => computeBreakdown(result), [result]);

  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v));
  const dashoffset = useTransform(count, (v) => CIRC * (1 - v / 100));
  const needleX = useTransform(count, (v) => 60 + R * Math.cos(((-90 + (v / 100) * 360) * Math.PI) / 180));
  const needleY = useTransform(count, (v) => 60 + R * Math.sin(((-90 + (v / 100) * 360) * Math.PI) / 180));

  useEffect(() => {
    const ctrl = animate(count, score, { duration: 1.4, ease: 'easeOut' });
    return () => ctrl.stop();
  }, [score, count]);

  return (
    <div className="hud-bracket p-2 md:p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[9px] tracking-[0.25em] uppercase" style={{ color: 'var(--muted)' }}>
          threat assessment
        </span>
        <span
          className="font-mono text-[9px] tracking-widest uppercase px-2 py-0.5 rounded-sm"
          style={{ color: t.color, background: `${t.color}18`, border: `1px solid ${t.color}40` }}
        >
          {t.label}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative shrink-0" style={{ width: 104, height: 104 }}>
          <svg width="104" height="104" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r={R} fill="none" stroke="var(--border)" strokeWidth="7" />
            <motion.circle
              cx="60" cy="60" r={R} fill="none" stroke={t.color} strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              style={{ strokeDashoffset: dashoffset, filter: `drop-shadow(0 0 5px ${t.color})` }}
              transform="rotate(-90 60 60)"
            />
            <motion.circle cx={needleX} cy={needleY} r="4" fill={t.color} style={{ filter: `drop-shadow(0 0 6px ${t.color})` }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <motion.span className="font-display font-bold leading-none" style={{ fontSize: 28, color: t.color }}>
              {rounded}
            </motion.span>
            <span className="font-mono text-[8px]" style={{ color: 'var(--muted)' }}>/100</span>
          </div>
        </div>

        <div className="flex-1 space-y-1.5 min-w-0">
          {breakdown.map((b) => (
            <div key={b.label}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-mono text-[7px] tracking-wider" style={{ color: 'var(--muted)' }}>{b.label}</span>
                <span className="font-mono text-[7px]" style={{ color: b.color }}>{b.value}/{b.max}</span>
              </div>
              <div className="h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: b.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${b.max > 0 ? (b.value / b.max) * 100 : 0}%` }}
                  transition={{ duration: 1, ease: 'easeOut', delay: 0.2 }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="font-mono text-[9px] mt-3 truncate" style={{ color: 'var(--muted)' }}>
        {result.repoUrl.replace('https://github.com/', '')}
      </p>
    </div>
  );
}
