'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CATEGORY_LABEL, copyAllFinding, secretItems, SOURCE_LABEL, type SecretCategory, type SecretItem,
} from '@/lib/console/derive';
import { C, fmtDateTime, mono, repoSlug, SEV, shortSha } from '@/lib/console/theme';
import { scanViewHref } from '@/lib/console/views';
import type { ScanResult } from '@/types';
import { Empty, GhostButton, GhostLink, Label, useSelection, ViewHeader } from '../ui';

const CATEGORIES: SecretCategory[] = ['aws', 'token', 'private-key', 'database', 'jwt', 'other'];

const BLAST: Record<SecretCategory, string> = {
  aws: 'AWS keys carry whatever IAM permissions they were issued with — often storage, compute and billing — until the key is deactivated.',
  token: 'An API token acts as its owner on the issuing service until it is revoked; usage is billed and logged against that account.',
  'private-key': 'A private key lets its holder impersonate the owner (TLS, SSH or signing) until the key pair is replaced.',
  database: 'A connection string gives direct database access with the embedded role, bypassing the application’s own access checks.',
  jwt: 'A leaked JWT or signing secret lets an attacker forge or replay sessions until the secret is rotated and old tokens expire.',
  other: 'A high-entropy string added in a diff is usually a key or credential. Confirm what it grants and treat it as exposed.',
};

/** Where to revoke/rotate, when the credential's issuer can be told from its type. */
function rotationUrl(s: SecretItem): string | null {
  const t = `${s.type} ${s.detail}`;
  if (/aws/i.test(t)) return 'https://console.aws.amazon.com/iam/home#/security_credentials';
  if (/github token/i.test(t)) return 'https://github.com/settings/tokens';
  if (/stripe/i.test(t)) return 'https://dashboard.stripe.com/apikeys';
  if (/openai/i.test(t)) return 'https://platform.openai.com/api-keys';
  if (/anthropic/i.test(t)) return 'https://console.anthropic.com/settings/keys';
  if (/slack/i.test(t)) return 'https://api.slack.com/apps';
  return null;
}

async function fetchTriage(scanId: string): Promise<Triage> {
  try {
    const res = await fetch(`/api/scan/${scanId}/triage`, { cache: 'no-store' });
    return res.ok ? await res.json() : { available: false, items: [] };
  } catch {
    return { available: false, items: [] };
  }
}

interface Triage { available: boolean; items: { fingerprint: string; status: 'open' | 'resolved'; updated_at: string }[] }

export default function SecretsView({ result: r }: { result: ScanResult }) {
  const items = useMemo(() => secretItems(r), [r]);
  const copyAll = copyAllFinding(r);
  const missingIgnore = r.envtrace?.findings.some((f) => f.type === 'missing_gitignore') ?? false;
  const demo = r.scanId.startsWith('demo-');
  const [sel, setSel] = useSelection();
  const [triage, setTriage] = useState<Triage | null>(null);
  const [saving, setSaving] = useState<{ fp: string; error: string | null } | null>(null);

  const loadTriage = useCallback(() => fetchTriage(r.scanId).then(setTriage), [r.scanId]);
  useEffect(() => {
    if (!demo) loadTriage();
  }, [demo, loadTriage]);

  const status = (s: SecretItem) => triage?.items.find((t) => t.fingerprint === s.fp);
  const isResolved = (s: SecretItem) => status(s)?.status === 'resolved';
  const open = items.filter((s) => !isResolved(s));
  const s = items.find((x) => x.fp === sel) ?? open[0] ?? items[0] ?? null;

  const setStatus = async (item: SecretItem, next: 'open' | 'resolved') => {
    setSaving({ fp: item.fp, error: null });
    try {
      const res = await fetch(`/api/scan/${r.scanId}/triage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fingerprint: item.fp, status: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Could not save');
      await loadTriage();
      setSaving(null);
    } catch (e) {
      setSaving({ fp: item.fp, error: e instanceof Error ? e.message : 'Could not save' });
    }
  };

  const exposure = (x: SecretItem) => {
    const parts = [SOURCE_LABEL[x.source]];
    if (copyAll && (x.source === 'env-file' || x.source === 'source' || x.source === 'example')) parts.push('IMAGE · COPY . .');
    return parts;
  };

  const repo = repoSlug(r.repoUrl);

  return (
    <div className="sx-split">
      <main className="sx-main flex flex-col">
        <ViewHeader kicker="// SECRET DETECTIONS"
          title={`${items.length} credential${items.length === 1 ? '' : 's'} exposed · ${open.length} still open`}
          right={<div className="sx-hide-md" style={{ font: mono(10.5), color: C.dim }}>SOURCES · git history · env files · source · image layers</div>} />

        <div className="sx-pad" style={{ padding: '0 24px' }}>
          <div className="grid sx-grid-cells" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))', border: `1px solid ${C.line3}` }}>
            {CATEGORIES.map((cat, i) => {
              const all = items.filter((x) => x.category === cat);
              const n = all.filter((x) => !isResolved(x)).length;
              const resolved = all.length - n;
              return (
                <div key={cat} className="flex flex-col" style={{ padding: '14px 16px', gap: 10, borderRight: i < CATEGORIES.length - 1 ? `1px solid ${C.line3}` : 0 }}>
                  <Label color={C.muted}>{CATEGORY_LABEL[cat]}</Label>
                  <span style={{ font: mono(28, 600), color: n ? C.red : resolved ? C.slate : C.green }}>
                    {n}{resolved > 0 && <span style={{ fontSize: 11, color: C.dim, fontWeight: 400 }}> +{resolved} RESOLVED</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {items.length === 0 ? (
          <Empty title="NO EXPOSED CREDENTIALS">
            No secrets in the scanned git history, committed env files, source files or Dockerfile.
            {missingIgnore && <> Note: <Link href={scanViewHref('env', r.scanId)}>.env is not in .gitignore</Link>, so the next one committed would be tracked.</>}
          </Empty>
        ) : (
          <div className="sx-table-wrap" style={{ marginTop: 20 }}>
            <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ height: 34, font: mono(9.5, 500), letterSpacing: '.14em', color: C.dim, textAlign: 'left', borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
                  <th style={{ fontWeight: 500, paddingLeft: 24, width: 250 }}>DETECTION</th>
                  <th style={{ fontWeight: 500, width: 200 }}>LOCATION</th>
                  <th style={{ fontWeight: 500, width: 160 }}>EXPOSURE</th>
                  <th style={{ fontWeight: 500, width: 56 }}>H</th>
                  <th style={{ fontWeight: 500, paddingRight: 24 }}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => {
                  const res = isResolved(x);
                  const c = res ? C.slate : SEV[x.severity].color;
                  const t = status(x);
                  return (
                    <tr key={x.fp} className="sx-tr" onClick={() => setSel(x.fp)} style={{ height: 64, borderBottom: `1px solid ${C.row}`, background: x.fp === s?.fp ? C.sel : 'transparent', cursor: 'pointer' }}>
                      <td style={{ paddingLeft: 24 }}>
                        <button type="button" onClick={() => setSel(x.fp)} className="flex flex-col text-left min-w-0" style={{ gap: 6, maxWidth: '100%' }}>
                          <span className="flex items-center sx-trunc" style={{ gap: 8, fontSize: 13, fontWeight: 500, color: C.bright }}>
                            <span style={{ width: 7, height: 7, background: c, transform: 'rotate(45deg)', flexShrink: 0 }} />{x.type}
                          </span>
                          <span className="sx-trunc" style={{ font: mono(11), color: c }}>{x.mask}</span>
                        </button>
                      </td>
                      <td style={{ font: mono(11, 400, 1.6), color: C.softer }}>
                        <div className="sx-trunc" title={x.file}>{x.file}{x.line ? `:${x.line}` : ''}</div>
                        <div style={{ color: C.dim }}>{x.commit ? `first seen ${shortSha(x.commit.commit_sha)}` : 'at HEAD'}</div>
                      </td>
                      <td style={{ font: mono(9.5, 500, 1.8), letterSpacing: '.1em', color: C.soft }}>{exposure(x).map((e) => <div key={e}>{e}</div>)}</td>
                      <td style={{ font: mono(11), color: C.amber }}>{x.entropy != null ? x.entropy.toFixed(1) : '—'}</td>
                      <td style={{ paddingRight: 24 }}>
                        <span className="inline-flex items-center" style={{ gap: 6, padding: '4px 8px', border: `1px solid ${res ? C.btn : c}`, font: mono(9.5, 500), letterSpacing: '.12em', color: res ? C.muted : c }}>
                          {res ? `RESOLVED · ${fmtDateTime(t!.updated_at).toUpperCase()}` : 'OPEN'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="grow" />
        <div className="sx-pad" style={{ padding: '14px 24px', borderTop: `1px solid ${C.line}`, font: mono(10.5, 400, 1.5), color: C.dim }}>
          Secret values are masked at the scanner — at most the first 8 characters of a match are kept. Raw values never reach the dashboard, reports, or Telegram alerts.
          {triage && !triage.available && !demo && <> Triage storage is not set up: run <span style={{ color: C.soft }}>supabase/schema.sql</span> to enable MARK RESOLVED.</>}
        </div>
      </main>

      <aside className="sx-aside flex flex-col" style={{ width: 496 }}>
        {!s ? <Empty title="EVIDENCE FILE">Nothing to investigate.</Empty> : (
          <>
            <div className="flex flex-col" style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${C.line}`, gap: 10 }}>
              <div className="flex justify-between" style={{ font: mono(10, 500), letterSpacing: '.16em' }}>
                <span style={{ color: C.muted }}>EVIDENCE FILE</span>
                <span style={{ color: isResolved(s) ? C.slate : SEV[s.severity].color }}>{isResolved(s) ? 'RESOLVED' : SEV[s.severity].label}</span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 500, color: C.bright }}>{s.type}</div>
              <div className="sx-trunc" style={{ padding: '10px 12px', background: C.code, border: `1px solid ${C.line3}`, font: mono(14, 500), letterSpacing: '.04em', color: isResolved(s) ? C.slate : SEV[s.severity].color }}>{s.mask}</div>
            </div>

            <div style={{ padding: '18px 24px 8px', font: mono(10, 500), letterSpacing: '.16em', color: C.muted }}>PROVENANCE — HOW IT GOT HERE</div>
            <Provenance s={s} r={r} copyAll={!!copyAll && s.source !== 'history' && s.source !== 'image' ? copyAll.layer : null} missingIgnore={missingIgnore} />

            <div className="flex flex-col" style={{ margin: '4px 24px 0', padding: '12px 14px', border: '1px solid rgba(255,61,79,.35)', background: 'rgba(255,61,79,.05)', gap: 6 }}>
              <Label color={C.redSoft}>BLAST RADIUS</Label>
              <span style={{ fontSize: 13, lineHeight: 1.45, color: C.body }}>
                {BLAST[s.category]}
                {s.source === 'history' && ' Deleting it at HEAD does not help: it stays recoverable from every clone until history is rewritten.'}
              </span>
            </div>

            <div className="grow" />
            {saving?.error && <div style={{ padding: '0 24px 8px', font: mono(10.5), color: C.orange }}>{saving.error}</div>}
            <div className="grid" style={{ padding: '16px 24px 22px', borderTop: `1px solid ${C.line}`, gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
              {rotationUrl(s) ? (
                <a href={rotationUrl(s)!} target="_blank" rel="noreferrer" className="sx-primary"
                  style={{ gridColumn: 'span 2', height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: C.red, color: C.bg, font: mono(11, 600), letterSpacing: '.14em' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 12a8 8 0 0 1 13.7-5.6L20 9M20 4v5h-5M20 12a8 8 0 0 1-13.7 5.6L4 15M4 20v-5h5" /></svg>
                  ROTATE SECRET ↗
                </a>
              ) : (
                <div style={{ gridColumn: 'span 2', padding: '10px 12px', border: `1px solid ${C.line3}`, font: mono(10.5, 400, 1.5), color: C.muted }}>
                  Rotate this credential with its issuer, then remove it from the repository.
                </div>
              )}
              <GhostLink href={s.source === 'history' ? `${scanViewHref('gst', r.scanId)}?focus=${s.commit!.commit_sha}` : s.source === 'image' ? scanViewHref('lyr', r.scanId) : scanViewHref('env', r.scanId)}>VIEW EVIDENCE</GhostLink>
              {demo ? <GhostButton disabled>VIEW ON GITHUB</GhostButton> : s.commit
                ? <GhostLink external href={`https://github.com/${repo}/commit/${s.commit.commit_sha}`}>VIEW COMMIT {shortSha(s.commit.commit_sha)} ↗</GhostLink>
                : <GhostLink external href={`https://github.com/${repo}/blob/HEAD/${s.file}${s.line ? `#L${s.line}` : ''}`}>VIEW FILE ↗</GhostLink>}
              <GhostButton style={{ gridColumn: 'span 2' }} disabled={!triage?.available || saving?.fp === s.fp && !saving.error}
                title={!triage?.available ? 'Triage storage unavailable' : undefined}
                onClick={() => setStatus(s, isResolved(s) ? 'open' : 'resolved')}>
                {saving?.fp === s.fp && !saving.error ? 'SAVING…' : isResolved(s) ? 'REOPEN' : 'MARK RESOLVED'}
              </GhostButton>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function Provenance({ s, r, copyAll, missingIgnore }: { s: SecretItem; r: ScanResult; copyAll: number | null; missingIgnore: boolean }) {
  const steps: { title: string; detail: string }[] = [];
  if (s.commit) {
    steps.push({ title: 'Committed', detail: `${shortSha(s.commit.commit_sha)} · ${s.commit.author} · ${fmtDateTime(s.commit.date)}` });
    steps.push({ title: 'Added in diff', detail: `${s.file}:${s.line} — “${s.commit.commit_message}”` });
    steps.push({ title: 'Recoverable from history', detail: `one of ${r.ghostcommit?.totalCommitsScanned ?? '?'} commits GhostCommit walked` });
  } else if (s.source === 'image') {
    steps.push({ title: 'Written into the Dockerfile', detail: `${s.file}${s.line ? `:${s.line}` : ''} — ${s.detail}` });
    steps.push({ title: 'Baked into an image layer', detail: 'readable by anyone who can pull the image (docker history / inspect)' });
  } else {
    steps.push({ title: s.source === 'env-file' ? 'Committed env file' : s.source === 'example' ? 'Example config with a live-looking value' : 'Hardcoded in source', detail: `${s.file}${s.line ? `:${s.line}` : ''}` });
    steps.push({ title: 'Present at HEAD', detail: s.detail });
    if (missingIgnore) steps.push({ title: '.env not ignored', detail: '.gitignore has no .env rule — new env files get tracked too' });
    if (copyAll != null) steps.push({ title: 'Shipped in the image', detail: `COPY . . copies the whole build context${copyAll ? ` (Dockerfile:${copyAll})` : ''}` });
  }
  const color = SEV[s.severity].color;
  return (
    <ol style={{ margin: 0, padding: '4px 24px 0', listStyle: 'none' }}>
      {steps.map((st, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={i} className="grid" style={{ gridTemplateColumns: '22px minmax(0,1fr)', columnGap: 12 }}>
            <div className="flex flex-col items-center">
              <span className={last && s.severity === 'critical' ? 'sx-pulse' : ''} style={{ width: 11, height: 11, marginTop: 3, border: `1.5px solid ${i === 0 || last ? color : C.blue}`, background: last ? color : 'transparent', transform: 'rotate(45deg)' }} />
              <span style={{ flexGrow: 1, width: 1, minHeight: 22, background: last ? 'transparent' : '#1A2B3F' }} />
            </div>
            <div className="flex flex-col min-w-0" style={{ paddingBottom: 14, gap: 4 }}>
              <span style={{ fontSize: 13.5, color: C.bright }}>{st.title}</span>
              <span style={{ font: mono(10.5, 400, 1.4), color: C.muted, wordBreak: 'break-word' }}>{st.detail}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
