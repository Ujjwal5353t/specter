'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { useConsole } from '@/lib/console/store';
import { ghostKey } from '@/lib/console/derive';
import { C, fmtDate, fmtDateTime, mono, repoSlug, shortSha } from '@/lib/console/theme';
import { scanViewHref } from '@/lib/console/views';
import type { ScanResult, SecretFinding } from '@/types';
import { Cell, CopyButton, Empty, GhostLink, Label, PrimaryButton, useSelection } from '../ui';
import { useJson, useWidth } from '../useWidth';
import { useRouter } from 'next/navigation';

interface Commit { sha: string; author: string; name: string | null; date: string | null; message: string }

// runGhostCommit's generic-token threshold (src/lib/scanners/ghostcommit.ts).
const ENTROPY_THRESHOLD = 4.5;
const LANE_Y = [112, 172, 232, 292];
const X0 = 150;

interface Ghost { sha: string; findings: SecretFinding[]; date: string; author: string; message: string; maxEntropy: number }

export default function GhostCommitView({ result: r }: { result: ScanResult }) {
  const router = useRouter();
  const meta = useConsole((s) => s.meta[r.scanId]);
  const demo = r.scanId.startsWith('demo-');
  const commitsRes = useJson<{ commits: Commit[] }>(demo ? null : `/api/scan/${r.scanId}/commits`);
  const findings = useMemo(() => r.ghostcommit?.findings ?? [], [r]);
  const total = r.ghostcommit?.totalCommitsScanned ?? 0;

  const ghosts = useMemo<Ghost[]>(() => {
    const by = new Map<string, SecretFinding[]>();
    for (const f of findings) {
      if (!by.has(f.commit_sha)) by.set(f.commit_sha, []);
      by.get(f.commit_sha)!.push(f);
    }
    return [...by.entries()].map(([sha, list]) => ({
      sha, findings: list, date: list[0].date, author: list[0].author, message: list[0].commit_message,
      maxEntropy: Math.max(...list.map((f) => f.entropy)),
    })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [findings]);

  const [sel, setSel] = useSelection();
  const selected = ghosts.find((g) => g.sha === sel) ?? ghosts[ghosts.length - 1] ?? null;

  // Every commit in the window: the fetched list, plus any ghost the list lacks.
  const commits = useMemo(() => {
    const list: Commit[] = [...(commitsRes.data?.commits ?? [])];
    for (const g of ghosts) if (!list.some((c) => c.sha === g.sha)) list.push({ sha: g.sha, author: g.author, name: g.author, date: g.date, message: g.message });
    return list.filter((c) => c.date);
  }, [commitsRes.data, ghosts]);

  const [boxRef, width] = useWidth<HTMLDivElement>(1376);
  const scene = useMemo(() => {
    const X1 = width - 26;
    const times = commits.map((c) => new Date(c.date!).getTime());
    const t0 = Math.min(...times), t1 = Math.max(...times);
    const span = Math.max(t1 - t0, 3_600_000);
    const x = (iso: string) => X0 + ((new Date(iso).getTime() - t0) / span) * (X1 - X0);
    const ghostSet = new Set(ghosts.map((g) => g.sha));
    const counts = new Map<string, number>();
    for (const c of commits) counts.set(c.author, (counts.get(c.author) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
    const lanes = ranked.length > 4 ? [...ranked.slice(0, 3), 'others'] : ranked;
    const laneOf = (a: string) => { const i = lanes.indexOf(a); return i === -1 ? lanes.length - 1 : i; };
    const ticks = commits.length ? Array.from({ length: 6 }, (_, i) => ({ x: X0 + (i / 5) * (X1 - X0), label: fmtDate(new Date(t0 + (i / 5) * span).toISOString()).toUpperCase() })) : [];
    return { x, lanes, laneOf, ticks, ghostSet, X1, t0, t1 };
  }, [commits, ghosts, width]);

  const trail = ghosts.map((g) => [scene.x(g.date), LANE_Y[scene.laneOf(g.author)]] as const);
  let trailD = '';
  trail.forEach((p, i) => {
    if (i === 0) { trailD = `M${p[0]} ${p[1]}`; return; }
    const a = trail[i - 1], mx = (a[0] + p[0]) / 2;
    trailD += ` C${mx} ${a[1] - 40} ${mx} ${p[1] - 40} ${p[0]} ${p[1]}`;
  });

  const barY = (e: number) => 420 - e * 10;
  const files = selected ? [...new Set(selected.findings.map((f) => f.file))] : [];
  const purge = files.length ? `git filter-repo --invert-paths ${files.map((f) => `--path '${f}'`).join(' ')}` : '';
  const repo = repoSlug(r.repoUrl);
  const head = meta && meta !== 'missing' ? meta.head : null;

  return (
    <div className="flex flex-col">
      <section ref={boxRef} aria-label="Commit timeline" className="relative" style={{ height: 452, borderBottom: `1px solid ${C.line}`, background: 'linear-gradient(180deg, #050A12, #03060B)', overflow: 'hidden' }}>
        <div className="absolute flex flex-col" style={{ left: 24, top: 20, gap: 8, zIndex: 1 }}>
          <div style={{ font: mono(10, 500), letterSpacing: '.2em', color: C.cyan }}>{'// GHOSTCOMMIT · HISTORY FORENSICS'}</div>
          <div style={{ fontSize: 17, fontWeight: 500, color: C.bright }}>{total} commits walked · {ghosts.length} ghost{ghosts.length === 1 ? '' : 's'} recovered</div>
        </div>
        <div className="absolute flex flex-wrap justify-end sx-hide-md" style={{ right: 24, top: 20, gap: 8, font: mono(10, 500), letterSpacing: '.12em', zIndex: 1 }}>
          {commits.length > 0 && <span style={{ padding: '7px 10px', border: `1px solid ${C.line3}`, color: C.muted }}>RANGE <span style={{ color: C.ink }}>{fmtDate(new Date(scene.t0).toISOString()).toUpperCase()} – {fmtDate(new Date(scene.t1).toISOString()).toUpperCase()}</span></span>}
          <span style={{ padding: '7px 10px', border: `1px solid ${C.line3}`, color: C.muted }}>BRANCH <span style={{ color: C.ink }}>{head?.branch ?? 'default'}</span></span>
          <span style={{ padding: '7px 10px', border: `1px solid ${C.line3}`, color: C.muted }}>ENTROPY ≥ <span style={{ color: C.ink }}>{ENTROPY_THRESHOLD}</span></span>
        </div>

        {commits.length === 0 ? (
          <div className="absolute" style={{ left: 24, top: 110, font: mono(11), color: C.muted }}>
            {commitsRes.loading ? 'Loading commit history…' : commitsRes.error ? `Commit timeline unavailable: ${commitsRes.error}` : demo ? 'Commit timeline is not available for sample reports.' : 'No commits in the scanned window.'}
          </div>
        ) : (
          <svg width={width} height={452} style={{ position: 'absolute', left: 0, top: 0 }} aria-hidden>
            {scene.lanes.map((name, i) => (
              <g key={name}>
                <line x1={0} x2={width} y1={LANE_Y[i]} y2={LANE_Y[i]} stroke="#0E1826" />
                <text x={24} y={LANE_Y[i] - 8} fontFamily="JetBrains Mono, monospace" fontSize="10.5" fill={C.muted}>{name.length > 16 ? `${name.slice(0, 15)}…` : name}</text>
              </g>
            ))}
            {scene.ticks.map((t) => (
              <g key={t.x}>
                <line x1={t.x} x2={t.x} y1={88} y2={350} stroke="rgba(62,128,235,.06)" />
                <text x={t.x} y={442} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="9.5" letterSpacing=".08em" fill={C.dimmer}>{t.label}</text>
              </g>
            ))}
            {trailD && <><path d={trailD} fill="none" stroke="rgba(255,61,79,.12)" strokeWidth="10" /><path className="sx-trail" d={trailD} fill="none" stroke={C.red} strokeWidth="1.4" opacity=".85" /></>}
            <text x={24} y={372} fontFamily="JetBrains Mono, monospace" fontSize="9.5" letterSpacing=".08em" fill={C.dimmer}>ENTROPY</text>
            <text x={24} y={385} fontFamily="JetBrains Mono, monospace" fontSize="9.5" letterSpacing=".08em" fill={C.dimmer}>PER GHOST</text>
            <line x1={X0} x2={scene.X1} y1={barY(ENTROPY_THRESHOLD)} y2={barY(ENTROPY_THRESHOLD)} stroke="rgba(232,184,74,.35)" strokeDasharray="4 3" />
            <text x={scene.X1} y={barY(ENTROPY_THRESHOLD) - 6} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="9.5" fill="#9A7E3A">THRESHOLD {ENTROPY_THRESHOLD}</text>
            {commits.map((c) => {
              const gx = scene.x(c.date!);
              if (scene.ghostSet.has(c.sha)) return null;
              return (
                <g key={c.sha}>
                  <line x1={gx} x2={gx} y1={416} y2={420} stroke="rgba(62,128,235,.35)" strokeWidth="2" />
                  <circle cx={gx} cy={LANE_Y[scene.laneOf(c.author)]} r={3} fill={C.blue} opacity={0.75}><title>{`${shortSha(c.sha)} · ${c.author} · ${c.message}`}</title></circle>
                </g>
              );
            })}
            {ghosts.map((g) => {
              const gx = scene.x(g.date), gy = LANE_Y[scene.laneOf(g.author)], on = g.sha === selected?.sha;
              return (
                <g key={g.sha} style={{ cursor: 'pointer' }} onClick={() => setSel(g.sha)}>
                  <rect x={gx - 1.5} y={barY(g.maxEntropy)} width={3} height={g.maxEntropy * 10} fill={C.red} />
                  <circle cx={gx} cy={gy} r={16} fill="none" stroke={on ? '#fff' : 'rgba(255,61,79,.35)'} />
                  <circle cx={gx} cy={gy} r={8} fill={C.red} style={{ filter: 'drop-shadow(0 0 6px rgba(255,61,79,.8))' }} />
                  <text x={gx} y={gy - 38} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="10.5" fontWeight="600" fill={C.red}>{shortSha(g.sha)}</text>
                  <text x={gx} y={gy - 25} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="9.5" fill={C.muted}>{g.findings[0].file.split('/').pop()}{g.findings.length > 1 ? ` +${g.findings.length - 1}` : ''}</text>
                  <title>{`${shortSha(g.sha)} · ${g.findings.length} secret(s) · ${g.message}`}</title>
                </g>
              );
            })}
          </svg>
        )}
      </section>

      <div className="sx-split">
        <section className="sx-main sx-pad flex flex-col" style={{ padding: '20px 24px', gap: 14 }}>
          {!selected ? (
            <Empty title="NO GHOSTS RECOVERED">
              GhostCommit walked the last {total} commit{total === 1 ? '' : 's'} on the default branch and found no credentials or high-entropy strings in any diff.
            </Empty>
          ) : (
            <>
              <div className="flex flex-wrap justify-between items-center" style={{ gap: 10 }}>
                <div className="flex items-center min-w-0" style={{ gap: 12 }}>
                  <Label color={C.muted} size={10}>EVIDENCE</Label>
                  <span style={{ font: mono(15, 600), color: C.redSoft }}>{shortSha(selected.sha)}</span>
                  <span className="sx-trunc" style={{ fontSize: 14, color: C.ink }}>“{selected.message}”</span>
                </div>
                <span style={{ padding: '4px 7px', border: `1px solid ${C.red}`, font: mono(10, 500), letterSpacing: '.14em', color: C.red }}>CRITICAL · {selected.findings.length} SECRET{selected.findings.length > 1 ? 'S' : ''}</span>
              </div>
              <div className="grid sx-grid-cells" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))', border: `1px solid ${C.line3}` }}>
                <Cell label="AUTHOR">{selected.author}</Cell>
                <Cell label="COMMITTED">{fmtDateTime(selected.date)}</Cell>
                <Cell label="FILES">{files.length} affected</Cell>
                <Cell label="MAX ENTROPY" color={C.amber}>{selected.maxEntropy.toFixed(1)}</Cell>
                <Cell label="COMMIT" color={C.cyan} last>
                  {demo ? shortSha(selected.sha) : <a href={`https://github.com/${repo}/commit/${selected.sha}`} target="_blank" rel="noreferrer">{shortSha(selected.sha)} ↗</a>}
                </Cell>
              </div>
              <div className="flex flex-col" style={{ border: `1px solid ${C.line3}`, background: C.well, minHeight: 0 }}>
                {files.map((file) => {
                  const hits = selected.findings.filter((f) => f.file === file).sort((a, b) => a.line - b.line);
                  return (
                    <div key={file}>
                      <div className="flex items-center justify-between" style={{ height: 30, padding: '0 12px', borderBottom: `1px solid ${C.line3}`, font: mono(10.5), color: C.soft, gap: 12 }}>
                        <span className="sx-trunc">{file} <span style={{ color: C.green }}>+{hits.length}</span></span>
                        <span className="sx-hide-sm" style={{ color: C.dim }}>VALUES MASKED · RAW NEVER LEAVES SCANNER</span>
                      </div>
                      <div style={{ padding: '6px 0', font: mono(12, 400, 1.75) }}>
                        {hits.map((f, i) => (
                          <div key={i} className="grid" style={{ gridTemplateColumns: '52px 18px minmax(0,1fr)', background: 'rgba(255,61,79,.07)', color: C.ink }}>
                            <span style={{ textAlign: 'right', paddingRight: 12, color: C.redSoft }}>{f.line}</span>
                            <span style={{ color: C.green }}>+</span>
                            <span className="sx-trunc"><span style={{ color: C.redSoft }}>{f.preview}</span>  <span style={{ color: C.dim }}>← {f.type.toLowerCase()} · entropy {f.entropy.toFixed(1)}</span></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap" style={{ gap: 8 }}>
                <PrimaryButton onClick={() => router.push(`${scanViewHref('sec', r.scanId)}?focus=${encodeURIComponent(`history|${ghostKey(selected.findings[0])}`)}`)}>OPEN IN SECRETS</PrimaryButton>
                <CopyButton text={purge} label="COPY PURGE COMMAND" />
                <GhostLink href={`/scan/${r.scanId}`}>TRACE IN MAP</GhostLink>
              </div>
            </>
          )}
        </section>

        <section className="sx-aside flex flex-col" style={{ width: 540 }}>
          <div style={{ height: 44, padding: '0 20px', display: 'flex', alignItems: 'center', borderBottom: `1px solid ${C.line}`, font: mono(10, 500), letterSpacing: '.18em', color: C.ink }}>
            GHOST TRAIL <span style={{ color: C.dim, marginLeft: 8 }}>· CHRONOLOGICAL</span>
          </div>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {ghosts.length === 0 && <li style={{ padding: '14px 20px', font: mono(11), color: C.muted }}>No ghost commits in the scanned window.</li>}
            {ghosts.map((g) => (
              <li key={g.sha}>
                <button type="button" onClick={() => setSel(g.sha)} className="sx-tr w-full grid items-center text-left"
                  style={{ gridTemplateColumns: '18px 76px minmax(0,1fr) 54px 44px', columnGap: 10, height: 52, padding: '0 20px', borderBottom: `1px solid ${C.row}`, background: g.sha === selected?.sha ? C.sel : 'transparent' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: C.red, boxShadow: `0 0 8px ${C.red}` }} />
                  <span style={{ font: mono(11, 600), color: C.red }}>{shortSha(g.sha)}</span>
                  <span className="flex flex-col min-w-0" style={{ gap: 4 }}>
                    <span className="sx-trunc" style={{ fontSize: 12.5, color: C.ink }}>{[...new Set(g.findings.map((f) => f.type))].join(' + ')} → {g.findings[0].file.split('/').pop()}</span>
                    <span className="sx-trunc" style={{ font: mono(10), color: C.dim }}>{g.author} · {fmtDateTime(g.date)}</span>
                  </span>
                  <span style={{ font: mono(10.5), color: C.amber, textAlign: 'right' }}>H {g.maxEntropy.toFixed(1)}</span>
                  <span style={{ font: mono(9.5, 600), letterSpacing: '.1em', color: C.red, textAlign: 'right' }}>CRIT</span>
                </button>
              </li>
            ))}
          </ol>
          {ghosts.length > 0 && (
            <div style={{ padding: '14px 20px', font: mono(10, 400, 1.5), color: C.dim }}>
              Deleting a file does not delete it from git history. Rotate each credential first, then purge. <Link href={scanViewHref('sec', r.scanId)}>All secrets →</Link>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
