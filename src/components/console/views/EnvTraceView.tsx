'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { copyAllFinding, scoreImpact } from '@/lib/console/derive';
import { C, mono, repoSlug, SEV, sevRank } from '@/lib/console/theme';
import { scanViewHref } from '@/lib/console/views';
import type { EnvFinding, ScanResult, Severity } from '@/types';
import { CopyButton, Empty, GhostLink, Label, useSelection, ViewHeader } from '../ui';

const TYPE_LABEL: Record<string, string> = {
  exposed_env: 'Committed env file',
  missing_gitignore: '.env not ignored',
  hardcoded_secret: 'Hardcoded credential',
};

function kind(f: EnvFinding): 'live' | 'schema' | 'ignore' | 'example' | 'source' {
  if (f.type === 'missing_gitignore') return 'ignore';
  if (f.type === 'exposed_env') return f.severity === 'critical' ? 'live' : 'schema';
  return /example file/i.test(f.detail) ? 'example' : 'source';
}

function remediation(f: EnvFinding): { text: string; cmd: string | null } {
  switch (kind(f)) {
    case 'live':
      return { text: 'Rotate every value in this file, stop tracking it, and keep real values out of git.', cmd: `git rm --cached '${f.file}'\necho '${f.file.split('/').pop()}' >> .gitignore\ngit commit -m "Stop tracking ${f.file}"` };
    case 'schema':
      return { text: 'Even without real values, a tracked env file publishes your configuration schema. Keep a documented .env.example instead.', cmd: `git mv '${f.file}' '${f.file}.example'` };
    case 'ignore':
      return { text: 'Add env files to .gitignore so a future .env is never committed by accident.', cmd: `printf '\\n.env\\n.env.*\\n!.env.example\\n' >> .gitignore` };
    case 'example':
      return { text: 'Example files are copied into every developer setup. Replace the live-looking value with a placeholder and rotate it.', cmd: null };
    default:
      return { text: 'Move the credential to an environment variable read at runtime, rotate it, and purge it from history.', cmd: null };
  }
}

export default function EnvTraceView({ result: r }: { result: ScanResult }) {
  const findings = useMemo(
    () => (r.envtrace?.findings ?? []).map((f, i) => ({ f, i })).sort((a, b) => sevRank(a.f.severity) - sevRank(b.f.severity)),
    [r],
  );
  const [selRaw, setSelRaw] = useSelection();
  const sel = selRaw != null && selRaw !== '' && !Number.isNaN(Number(selRaw)) ? Number(selRaw) : null;
  const setSel = (i: number) => setSelRaw(String(i));
  const s = findings.find((x) => x.i === sel) ?? findings[0] ?? null;
  const copyAll = copyAllFinding(r);
  const impact = scoreImpact(r, ['envtrace']);
  const repo = repoSlug(r.repoUrl);
  const demo = r.scanId.startsWith('demo-');

  const files = useMemo(() => {
    const m = new Map<string, EnvFinding[]>();
    for (const { f } of findings) { if (!m.has(f.file)) m.set(f.file, []); m.get(f.file)!.push(f); }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [findings]);
  const maxPerFile = Math.max(1, ...files.map(([, l]) => l.length));

  const liveFiles = new Set(findings.filter(({ f }) => kind(f) === 'live').map(({ f }) => f.file)).size;
  const tiles: { label: string; value: string | number; color: string }[] = [
    { label: 'LIVE VALUES', value: findings.filter(({ f }) => kind(f) === 'live').length, color: C.red },
    { label: 'ENV FILES TRACKED', value: new Set(findings.filter(({ f }) => f.type === 'exposed_env').map(({ f }) => f.file)).size, color: C.orange },
    { label: 'EXAMPLE FILES', value: findings.filter(({ f }) => kind(f) === 'example').length, color: C.orange },
    { label: 'SOURCE HARDCODES', value: findings.filter(({ f }) => kind(f) === 'source').length, color: C.red },
  ];
  const ignored = !findings.some(({ f }) => f.type === 'missing_gitignore');

  return (
    <div className="sx-split">
      <main className="sx-main flex flex-col">
        <ViewHeader kicker="// ENVTRACE · ENVIRONMENT EXPOSURE"
          title={findings.length ? `${findings.length} exposure${findings.length === 1 ? '' : 's'} across ${files.length} file${files.length === 1 ? '' : 's'}` : 'No environment exposure'}
          meta={<><span>SCORE IMPACT <span style={{ color: impact ? C.orange : C.softer }}>{impact}</span></span>{liveFiles > 0 && <span>FILES WITH LIVE VALUES <span style={{ color: C.redSoft }}>{liveFiles}</span></span>}</>}
          right={<div className="sx-hide-md" style={{ font: mono(10.5), color: C.dim }}>CHECKS · env files · .gitignore · example configs · source</div>} />

        <div className="sx-pad" style={{ padding: '0 24px' }}>
          <div className="grid sx-grid-cells" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))', border: `1px solid ${C.line3}` }}>
            {tiles.map((t) => (
              <div key={t.label} className="flex flex-col" style={{ padding: '14px 16px', gap: 10, borderRight: `1px solid ${C.line3}` }}>
                <Label color={C.muted}>{t.label}</Label>
                <span style={{ font: mono(28, 600), color: t.value ? t.color : C.green }}>{t.value}</span>
              </div>
            ))}
            <div className="flex flex-col" style={{ padding: '14px 16px', gap: 10 }}>
              <Label color={C.muted}>.GITIGNORE</Label>
              <span style={{ font: mono(15, 600, 1.9), color: ignored ? C.green : C.red }}>{ignored ? 'COVERS .env' : 'MISSING .env'}</span>
            </div>
          </div>
        </div>

        {findings.length === 0 ? (
          <Empty title="CLEAN">No committed env files, no live-looking values in example configs, no hardcoded credentials in the scanned source, and .gitignore covers .env.</Empty>
        ) : (
          <>
            <div className="sx-pad" style={{ padding: '22px 24px 6px' }}><Label color={C.ink} size={10}>EXPOSURE SURFACE <span style={{ color: C.dim }}>· BY FILE</span></Label></div>
            <div className="sx-pad flex flex-col" style={{ padding: '6px 24px 4px', gap: 6 }}>
              {files.map(([file, list]) => {
                const bySev = (['critical', 'high', 'medium', 'low'] as Severity[]).map((sv) => ({ sv, n: list.filter((f) => f.severity === sv).length })).filter((x) => x.n);
                const on = s?.f.file === file;
                return (
                  <button key={file} type="button" onClick={() => setSel(findings.find((x) => x.f.file === file)!.i)} className="sx-tr grid items-center text-left"
                    style={{ gridTemplateColumns: 'minmax(0, 260px) minmax(0,1fr) 40px', gap: 14, padding: '6px 8px', background: on ? C.sel : 'transparent' }}>
                    <span className="sx-trunc" style={{ font: mono(11.5), color: on ? '#fff' : C.ink }} title={file}>{file}</span>
                    <span className="flex" style={{ height: 8, gap: 2 }}>
                      {bySev.map(({ sv, n }) => <span key={sv} style={{ width: `${(n / maxPerFile) * 100}%`, background: SEV[sv].color, boxShadow: sv === 'critical' ? `0 0 8px ${SEV[sv].color}80` : 'none' }} />)}
                    </span>
                    <span style={{ font: mono(11), color: C.softer, textAlign: 'right' }}>{list.length}</span>
                  </button>
                );
              })}
            </div>

            <div className="sx-table-wrap" style={{ marginTop: 18 }}>
              <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ height: 34, font: mono(9.5, 500), letterSpacing: '.14em', color: C.dim, textAlign: 'left', borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
                    <th style={{ fontWeight: 500, paddingLeft: 24, width: 96 }}>SEVERITY</th>
                    <th style={{ fontWeight: 500, width: 180 }}>TYPE</th>
                    <th style={{ fontWeight: 500, width: 200 }}>LOCATION</th>
                    <th style={{ fontWeight: 500, paddingRight: 24 }}>DETAIL</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map(({ f, i }) => (
                    <tr key={i} className="sx-tr" onClick={() => setSel(i)} style={{ height: 44, borderBottom: `1px solid ${C.row}`, background: i === s?.i ? C.sel : 'transparent', cursor: 'pointer', font: mono(11.5), color: C.softer }}>
                      <td style={{ paddingLeft: 24, color: SEV[f.severity].color, fontSize: 10, letterSpacing: '.1em' }}>{SEV[f.severity].label}</td>
                      <td className="sx-trunc" style={{ color: C.ink }}>{TYPE_LABEL[f.type] ?? f.type}</td>
                      <td className="sx-trunc" title={f.file}>{f.file}{f.line ? `:${f.line}` : ''}</td>
                      <td className="sx-trunc" style={{ paddingRight: 24, fontFamily: 'inherit' }} title={f.detail}>{f.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      <aside className="sx-aside flex flex-col" style={{ width: 480 }}>
        {!s ? <Empty title="FINDING">Nothing to inspect.</Empty> : (() => {
          const f = s.f, rem = remediation(f), k = kind(f);
          return (
            <>
              <div className="flex flex-col" style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${C.line}`, gap: 10 }}>
                <div className="flex justify-between" style={{ font: mono(10, 500), letterSpacing: '.16em' }}>
                  <span style={{ color: C.muted }}>ENV FINDING</span>
                  <span style={{ color: SEV[f.severity].color }}>{SEV[f.severity].label}</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 500, color: C.bright }}>{TYPE_LABEL[f.type] ?? f.type}</div>
                <div style={{ padding: '10px 12px', background: C.code, border: `1px solid ${C.line3}`, font: mono(12.5, 500, 1.5), color: SEV[f.severity].color, wordBreak: 'break-word' }}>
                  {f.file}{f.line ? `:${f.line}` : ''}
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.5, color: C.softer }}>{f.detail}</div>
              </div>
              <div className="flex flex-col" style={{ padding: '18px 24px 0', gap: 10 }}>
                <Label color={C.muted} size={10}>WHY IT MATTERS</Label>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: C.body }}>
                  {k === 'live' && 'A tracked env file with real values is readable by anyone who can clone the repository — and stays in history after deletion.'}
                  {k === 'schema' && 'The file holds placeholders only, but it reveals every variable name your deployment depends on.'}
                  {k === 'ignore' && 'Without an ignore rule, the next `git add .` commits your local .env along with everything else.'}
                  {k === 'example' && 'Example configs are copied verbatim on setup; a live-looking value here is either a leaked credential or will be mistaken for one.'}
                  {k === 'source' && 'A credential in source ships with every clone, build artifact and bundle that includes this file.'}
                  {copyAll && (k === 'live' || k === 'source') && ` The Dockerfile’s COPY . .${copyAll.layer ? ` (line ${copyAll.layer})` : ''} also bakes this file into the image.`}
                </div>
              </div>
              <div className="flex flex-col" style={{ padding: '18px 24px 0', gap: 8 }}>
                <Label color={C.muted} size={10}>REMEDIATION</Label>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: C.softer }}>{rem.text}</div>
                {rem.cmd && <pre style={{ margin: 0, padding: '10px 12px', background: C.code, border: `1px solid ${C.line3}`, font: mono(11.5, 400, 1.55), color: C.softer, whiteSpace: 'pre-wrap' }}>{rem.cmd}</pre>}
              </div>
              <div className="grow" />
              <div className="grid" style={{ padding: '16px 24px 22px', marginTop: 16, borderTop: `1px solid ${C.line}`, gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
                <CopyButton primary text={rem.cmd ?? ''} disabled={!rem.cmd} label="COPY COMMANDS" />
                {demo ? <GhostLink href={scanViewHref('sec', r.scanId)}>OPEN SECRETS</GhostLink>
                  : <GhostLink external href={`https://github.com/${repo}/blob/HEAD/${f.file}${f.line ? `#L${f.line}` : ''}`}>VIEW FILE ↗</GhostLink>}
                <div style={{ gridColumn: 'span 2', font: mono(10, 400, 1.5), color: C.dim }}>
                  Credentials found here are tracked with the rest in <Link href={scanViewHref('sec', r.scanId)}>Secrets</Link>.
                </div>
              </div>
            </>
          );
        })()}
      </aside>
    </div>
  );
}
