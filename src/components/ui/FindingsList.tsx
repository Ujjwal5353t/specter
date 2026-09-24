'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ScanResult, Severity } from '@/types';

interface Props {
  result: ScanResult;
  scannerFilter?: string | null;
  hasAiExplanation?: boolean;
  onRequestAiFocus?: () => void;
}

interface Finding {
  id: string;
  scanner: string;
  severity: Severity;
  title: string;
  detail: string;
  filePath?: string;
  line?: number;
  entropy?: number;
}

const SEV_CONFIG: Record<Severity, { color: string; label: string }> = {
  critical: { color: '#FF2A6D', label: 'CRIT' },
  high: { color: '#FF7A1A', label: 'HIGH' },
  medium: { color: '#eab308', label: 'MED' },
  low: { color: 'var(--ink)', label: 'LOW' },
  info: { color: 'var(--muted)', label: 'INFO' },
};

function extractFindings(r: ScanResult): Finding[] {
  const out: Finding[] = [];
  const SEV_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

  r.depchain?.nodes
    .filter((n) => (n.cves?.length ?? 0) > 0)
    .forEach((n) => n.cves.forEach((c) => out.push({
      id: `dep-${n.id}-${c.id}`, scanner: 'depchain',
      severity: c.severity, title: `${n.name}@${n.version}`, detail: c.summary,
    })));

  r.depchain?.nodes.forEach((n) => (n.signals ?? []).forEach((s) => out.push({
    id: `risk-${n.id}-${s.type}`, scanner: 'depchain',
    severity: s.severity, title: `${s.title} · ${n.name}@${n.version}`, detail: s.detail,
  })));

  r.ghostcommit?.findings.forEach((f, i) => out.push({
    id: `ghost-${i}`, scanner: 'ghostcommit', severity: 'critical',
    title: f.type, detail: `Introduced in commit ${f.commit_sha.substring(0, 7)} — ${f.commit_message}`,
    filePath: f.file, line: f.line, entropy: f.entropy,
  }));

  r.layerscan?.findings.forEach((f, i) => out.push({
    id: `layer-${i}`, scanner: 'layerscan',
    severity: f.severity, title: f.issue.substring(0, 70), detail: f.fix,
  }));

  r.apibleed?.endpoints
    .filter((e) => e.issues.length > 0)
    .forEach((e, i) => out.push({
      id: `api-${i}`, scanner: 'apibleed',
      severity: e.severity, title: `${e.method} ${e.path}`, detail: e.issues.join(' · '),
      filePath: e.file,
    }));

  r.envtrace?.findings.forEach((f, i) => out.push({
    id: `env-${i}`, scanner: 'envtrace',
    severity: f.severity, title: f.type.replace(/_/g, ' '), detail: f.detail,
    filePath: f.file, line: f.line,
  }));

  return out.sort((a, b) => (SEV_ORDER[a.severity] ?? 5) - (SEV_ORDER[b.severity] ?? 5));
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {}
      }}
      className="font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm shrink-0 cursor-pointer"
      style={{ color: copied ? '#22c55e' : 'var(--accent-hi)', border: '1px solid var(--border-hi)' }}
    >
      {copied ? 'copied ✓' : 'copy'}
    </button>
  );
}

export default function FindingsList({ result, scannerFilter, hasAiExplanation, onRequestAiFocus }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  let findings = extractFindings(result);
  if (scannerFilter) findings = findings.filter((f) => f.scanner === scannerFilter);

  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-mono text-[9px] tracking-[0.2em] uppercase" style={{ color: 'var(--muted)' }}>
          {findings.length} finding{findings.length !== 1 ? 's' : ''}
          {scannerFilter ? ` · ${scannerFilter}` : ''}
        </span>
        {findings.length > 0 && (
          <div className="h-px flex-1 rounded-full" style={{ background: 'linear-gradient(90deg, var(--border), transparent)' }} />
        )}
      </div>

      {findings.length === 0 ? (
        <div className="text-center py-8">
          <div className="font-mono text-xl mb-2" style={{ color: 'var(--safe)' }}>ALL CLEAR</div>
          <p className="font-mono text-[10px]" style={{ color: 'var(--muted)' }}>
            {scannerFilter ? `no findings from ${scannerFilter}` : '0 threats detected across 5 scanners'}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {findings.map((f, i) => {
            const cfg = SEV_CONFIG[f.severity] ?? SEV_CONFIG.info;
            const isOpen = expanded === f.id;

            return (
              <motion.div
                key={f.id}
                className="glass-panel rounded-sm overflow-hidden cursor-pointer"
                style={{ borderColor: isOpen ? `${cfg.color}40` : 'var(--glass-border)' }}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i, 12) * 0.025, duration: 0.22 }}
                onClick={() => setExpanded(isOpen ? null : f.id)}
              >
                <div className="flex items-start gap-2.5 p-2.5">
                  <span
                    className="font-mono text-[8px] font-bold tracking-wider leading-none shrink-0 mt-0.5 px-1 py-0.5 rounded-sm"
                    style={{ color: cfg.color, border: `1px solid ${cfg.color}50`, background: `${cfg.color}12` }}
                  >
                    [{cfg.label}]
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-bold leading-snug truncate" style={{ color: 'var(--white)' }}>
                        {f.title}
                      </span>
                      <span className="font-mono text-[8px] tracking-wider shrink-0" style={{ color: 'var(--muted)' }}>
                        {f.scanner.toUpperCase()}
                      </span>
                    </div>

                    {(f.filePath || f.entropy !== undefined) && (
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {f.filePath && (
                          <span className="font-mono text-[9px] px-1 py-0.5 rounded-sm" style={{ color: '#4dfaff', background: 'rgba(0,240,255,0.06)' }}>
                            {f.filePath}{f.line ? `:${f.line}` : ''}
                          </span>
                        )}
                        {f.entropy !== undefined && (
                          <span className="font-mono text-[9px]" style={{ color: 'var(--muted)' }}>
                            entropy {f.entropy.toFixed(2)}
                          </span>
                        )}
                      </div>
                    )}

                    <p className={`font-body text-[10px] mt-1 leading-relaxed ${isOpen ? '' : 'line-clamp-1'}`} style={{ color: 'var(--ink)' }}>
                      {f.detail}
                    </p>
                  </div>
                </div>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      <div className="mx-2.5 mb-2.5 p-2.5 rounded-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-mono text-[10px] leading-relaxed" style={{ color: 'var(--ink)' }}>{f.detail}</p>
                          <CopyButton text={f.detail} />
                        </div>
                        {hasAiExplanation && f.severity !== 'low' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onRequestAiFocus?.(); }}
                            className="mt-2 font-mono text-[8px] uppercase tracking-wider cursor-pointer"
                            style={{ color: 'var(--accent-hi)' }}
                          >
                            ▶ view in AI intelligence brief
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
