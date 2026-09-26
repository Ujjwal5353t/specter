'use client';
import { useState, useCallback, useEffect, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useScanStore } from '@/store/scanStore';
import EcosystemField from '@/components/landing/EcosystemField';
import StarField from '@/components/landing/StarField';
import { toRepoSlug, toRepoUrl } from '@/lib/repoInput';
import type { ScanResult } from '@/types';

/**
 * Entry landing page — the design language of
 * HTML/01 · Entry — Landing-html/Main.dc.html, laid out as a fluid full-screen
 * composition: header / [hero | ecosystem field] / engines / incident archive.
 *
 * Type and spacing scale with the viewport rather than the page being
 * uniformly zoomed, so the composition fills a desktop screen at native size.
 *
 * All dynamic behaviour (scan start, sample reports, errors, loading) goes
 * through the existing store and API routes untouched.
 */

// The reference's palette.
const C = {
  bg: '#03060B',
  ink: '#D5E1EC',
  inkBright: '#E9F0F7',
  inkSoft: '#7F92A8',
  cyan: '#4FD8F0',
  dim: '#4F6680',
  dimmer: '#3C5068',
  muted: '#52667D',
  faint: '#44546A',
  navInk: '#8A9BB0',
  line: '#16273A',
  lineSoft: '#111E2D',
  lineFooter: '#0E1826',
  slash: '#27405C',
  tickInk: '#6E8299',
  green: '#3FCF8E',
  red: '#FF3D4F',
  orange: '#FF8A2B',
  engineName: '#E0E9F2',
  wordmark: '#E6EEF6',
} as const;

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SANS = "'Archivo Variable', 'Archivo', ui-sans-serif, system-ui, sans-serif";

// One gutter shared by the header, hero, engines and footer so every band
// lines up on the same left/right edge. Matches the reference's 80px inset on
// a 1440 artboard, so the hero sits in from the edge rather than flush to it.
const GUTTER = 'clamp(24px, 5.5vw, 104px)';

// Hero column width (excluding gutter) — ~620px on a 1440 viewport.
const HERO_W = 'clamp(420px, 43vw, 700px)';

// How far the globe's vertical centre sits below the main band's own centre —
// a gentle nudge so it still reads as sitting just above/behind the engine
// row, now that its size (see EcosystemField's NATURAL_SPAN) keeps the whole
// sphere inside its own box instead of being clipped by it.
const GLOBE_SHIFT = 'clamp(16px, 2.8vh, 32px)';

// Quick-fill suggestions — decorative UI copy, not application data.
const TRY_REPOS = ['vanshikaaz/specter', 'expressjs/express', 'vercel/next.js'];

// Existing bundled sample reports (unchanged behaviour).
const DEMOS = [
  {
    id: 'event-stream',
    label: 'event-stream',
    year: '2018',
    dossier: '8M+ downloads carried a Bitcoin-stealing payload for ~2 months before detection.',
  },
  {
    id: 'node-ipc',
    label: 'node-ipc',
    year: '2022',
    dossier: 'A maintainer shipped disk-wiping code targeting Russian/Belarusian IPs via a dependency update.',
  },
];

// The five scanners this app actually runs.
const ENGINES = [
  { idx: '01', code: 'DEP', name: 'DEPCHAIN', desc: 'Vulnerable and malicious packages, resolved against OSV.dev.' },
  { idx: '02', code: 'GST', name: 'GHOSTCOMMIT', desc: 'Secrets and high-entropy strings buried in git history.' },
  { idx: '03', code: 'LYR', name: 'LAYERSCAN', desc: 'Dockerfile layers — root users, unpinned bases, baked secrets.' },
  { idx: '04', code: 'API', name: 'APIBLEED', desc: 'Route discovery, missing auth on write endpoints, rate limits.' },
  { idx: '05', code: 'ENV', name: 'ENVTRACE', desc: 'Leaky env files, example configs with live-looking values.' },
];

const TELEMETRY_LABELS = [
  'SYSTEM ONLINE',
  'THREAT ENGINE READY',
  'OSV INTELLIGENCE CONNECTED',
  'GITHUB TELEMETRY CONNECTED',
  'REPOSITORY TELEMETRY STANDBY',
];

// Publicly documented supply-chain incidents — informational copy.
const INCIDENTS = [
  { year: '2018', pkg: 'event-stream', what: 'maintainer handoff, wallet-stealing payload in flatmap-stream' },
  { year: '2021', pkg: 'ua-parser-js', what: 'hijacked npm account ships cryptominer' },
  { year: '2021', pkg: 'log4j', what: 'Log4Shell remote code execution' },
  { year: '2022', pkg: 'node-ipc', what: 'protestware overwrites files by geolocation' },
  { year: '2022', pkg: 'colors / faker', what: 'maintainer sabotage, infinite loop release' },
  { year: '2024', pkg: 'xz-utils', what: 'multi-year social-engineering backdoor in sshd path' },
];

function formatClock(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export default function Home() {
  const [repoPath, setRepoPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [samplesOpen, setSamplesOpen] = useState(false);
  const router = useRouter();
  const { setScanResult, startPolling, setLoading: setStoreLoading } = useScanStore();

  // Real client-boot timestamps for the telemetry readout — computed once.
  const [telemetry] = useState(() => {
    const now = Date.now();
    return TELEMETRY_LABELS.map((label, i) => ({ label, time: formatClock(new Date(now + i * 190)) }));
  });

  useEffect(() => {
    if (!samplesOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSamplesOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [samplesOpen]);

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
    setSamplesOpen(false);
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (loading || !repoPath.trim()) return;
    // Accept a full URL, github.com/owner/repo or owner/repo — never prefix a
    // value that already carries the host.
    const slug = toRepoSlug(repoPath);
    if (!slug) {
      setErr('Enter a GitHub repository: owner/repo or https://github.com/owner/repo');
      return;
    }
    startScan(toRepoUrl(slug));
  };

  const navLink = { color: C.navInk } as const;
  // The typed value already names its host (a pasted URL or github.com/…).
  const hasHost = /^\s*(https?:\/\/|www\.|github\.com\/)/i.test(repoPath);
  const targetSlug = toRepoSlug(repoPath);

  return (
    <div
      className="entry-stage fixed inset-0 overflow-hidden flex flex-col pointer-events-auto"
      style={{ background: C.bg, color: C.ink, fontFamily: SANS }}
    >
      <StarField />

      {/* ── Header ───────────────────────────────────────────────── */}
      <header
        className="relative z-20 shrink-0 flex items-center justify-between"
        style={{
          height: 'clamp(56px, 5.4vh, 66px)',
          paddingLeft: GUTTER,
          paddingRight: GUTTER,
          borderBottom: `1px solid ${C.lineFooter}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="1.4" aria-hidden>
            <path d="M12 1.5L22.5 12 12 22.5 1.5 12z" />
            <path d="M12 7l5 5-5 5-5-5z" fill="rgba(79,216,240,.18)" />
            <path d="M12 10.5v3M10.5 12h3" />
          </svg>
          <span style={{ fontStretch: '125%', fontWeight: 700, fontSize: 13.5, letterSpacing: '.32em', color: C.wordmark }}>
            SPECTER
          </span>
        </div>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 26, font: `500 11px/1 ${MONO}`, letterSpacing: '.14em' }}>
          <span style={{ color: C.dim }}>v1.0.4</span>
          <a href="#engines" className="entry-navlink" style={navLink}>ENGINES</a>
          <Link href="/pricing" className="entry-navlink" style={navLink}>PRICING</Link>

          <span style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setSamplesOpen((o) => !o)}
              disabled={loading}
              aria-expanded={samplesOpen}
              className="entry-navlink disabled:opacity-40"
              style={navLink}
            >
              SAMPLE REPORT
            </button>
            {samplesOpen && (
              <div
                style={{
                  position: 'absolute', top: 24, right: 0, width: 272, zIndex: 40,
                  background: 'rgba(7,11,18,.97)', border: `1px solid ${C.line}`, padding: 6,
                }}
              >
                {DEMOS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => loadDemo(`${d.id}.json`)}
                    className="entry-sample"
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '7px 8px',
                      font: `400 10px/1.5 ${MONO}`, letterSpacing: '.04em', color: C.navInk,
                    }}
                  >
                    <span style={{ color: C.orange }}>{d.year}</span>{' '}
                    <span style={{ color: C.ink }}>{d.label}</span>
                    <span style={{ display: 'block', color: C.dim, marginTop: 3 }}>{d.dossier}</span>
                  </button>
                ))}
              </div>
            )}
          </span>

          <a
            href="https://github.com/VanshikaaZ/specter"
            target="_blank"
            rel="noopener noreferrer"
            className="entry-navlink"
            style={navLink}
          >
            SOURCE ↗
          </a>
        </nav>
      </header>

      {/* ── Main band: one layered composition ──────────────────────
          The ecosystem field is a full-height layer centred at ~64% of the
          width, so its left flank reaches into the hero's territory; the hero
          and telemetry sit on layers above it and stay fully legible. */}
      <div className="relative z-10 flex-1 min-h-0">
        {samplesOpen && (
          <button
            type="button"
            aria-label="Close sample reports"
            onClick={() => setSamplesOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'transparent', border: 0, cursor: 'default' }}
          />
        )}

        {/* Shifted down by the same amount top and bottom, so the box keeps
            its height (globe size/scale unchanged) and only its vertical
            centre moves — the lower arc bleeds behind the engine row below,
            which paints over it (see z-index on #engines). */}
        <div className="absolute" style={{ top: GLOBE_SHIFT, bottom: `calc(-1 * ${GLOBE_SHIFT})`, left: '19%', right: 0, zIndex: 0 }}>
          <EcosystemField />
        </div>

        {/* Hero */}
        <main
          className="relative h-full flex flex-col justify-center"
          style={{
            zIndex: 2,
            width: `calc(${GUTTER} + ${HERO_W})`,
            paddingLeft: GUTTER,
            // Optical centring: sit a touch above the band's midline.
            paddingTop: 'clamp(8px, 2vh, 24px)',
            paddingBottom: 'clamp(16px, 4.5vh, 56px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, font: `500 clamp(10px, 0.78vw, 12.5px)/1 ${MONO}`, letterSpacing: '.2em', color: C.cyan }}>
            <span className="entry-live" style={{ width: 6, height: 6, background: C.green, borderRadius: '50%' }} />
            <span>SYSTEM ONLINE</span>
            <span style={{ color: C.slash }}>/</span>
            <span style={{ color: C.tickInk }}>THREAT ENGINE READY</span>
          </div>

          <h1
            style={{
              margin: 'clamp(16px, 3vh, 32px) 0 0',
              fontStretch: '125%',
              fontWeight: 600,
              fontSize: 'clamp(46px, min(5.5vw, 9.4vh), 100px)',
              lineHeight: 0.9,
              letterSpacing: '.11em',
              whiteSpace: 'nowrap',
              color: C.inkBright,
            }}
          >
            SPECTER
          </h1>

          <div style={{ marginTop: 'clamp(14px, 2.4vh, 24px)', font: `500 clamp(11px, 0.88vw, 14px)/1 ${MONO}`, letterSpacing: '.3em', color: C.cyan }}>
            SUPPLY CHAIN THREAT INTELLIGENCE
          </div>

          <p
            style={{
              margin: 'clamp(20px, 3.8vh, 40px) 0 0',
              fontSize: 'clamp(18px, min(1.85vw, 3.1vh), 32px)',
              lineHeight: 1.25,
              fontWeight: 300,
              color: C.inkSoft,
              textWrap: 'pretty',
            }}
          >
            The ghosts in your codebase.<br />
            <span style={{ color: C.inkBright, fontWeight: 400 }}>Made visible.</span>
          </p>

          {/* Scan console — posts to the existing /api/scan/start */}
          <form
            onSubmit={handleSubmit}
            style={{
              marginTop: 'clamp(24px, 5.4vh, 60px)', width: '100%', position: 'relative',
              border: `1px solid ${C.line}`, background: 'rgba(6,10,17,.94)',
              backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
              boxShadow: '0 18px 48px -24px rgba(0,0,0,.9)',
            }}
          >
            <div style={{ position: 'absolute', left: -1, top: -1, width: 10, height: 10, borderLeft: `1px solid ${C.cyan}`, borderTop: `1px solid ${C.cyan}` }} />
            <div style={{ position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRight: `1px solid ${C.cyan}`, borderBottom: `1px solid ${C.cyan}` }} />

            <div
              style={{
                height: 'clamp(28px, 3.4vh, 32px)', padding: '0 15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderBottom: `1px solid ${C.lineSoft}`, font: `500 9.5px/1 ${MONO}`, letterSpacing: '.15em', color: C.muted,
              }}
            >
              <label htmlFor="repo">{'// INITIATE SCAN — TARGET REPOSITORY'}</label>
              <span>PUBLIC REPOS · NO INSTALL</span>
            </div>

            <div style={{ height: 'clamp(50px, 6.6vh, 60px)', display: 'flex', alignItems: 'stretch' }}>
              {/* The static prefix only frames a bare owner/repo; once the
                  value carries its own host it would read as a doubled URL. */}
              {!hasHost && (
                <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 15, font: `400 clamp(13px, 1vw, 15px)/1 ${MONO}`, color: C.faint }}>
                  github.com/
                </div>
              )}
              <input
                id="repo"
                type="text"
                value={repoPath}
                onChange={(e) => { setRepoPath(e.target.value); if (err) setErr(''); }}
                placeholder="owner/repository"
                disabled={loading}
                autoComplete="off"
                spellCheck={false}
                title={repoPath || undefined}
                className="entry-input"
                style={{
                  flexGrow: 1, minWidth: 0, padding: hasHost ? '0 14px 0 15px' : '0 14px 0 4px',
                  font: `400 clamp(13px, 1vw, 15px)/1 ${MONO}`, color: C.inkBright,
                  // Long URLs scroll inside the field while editing and show an
                  // ellipsis at rest; the value itself is never altered.
                  textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap',
                }}
              />
              <button
                type="submit"
                disabled={loading || repoPath.trim().length === 0}
                className="entry-cta disabled:cursor-not-allowed"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '0 clamp(18px, 1.6vw, 28px)',
                  background: C.cyan, color: C.bg, fontWeight: 600, fontSize: 'clamp(12px, 0.92vw, 14px)',
                  letterSpacing: '.1em', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {loading ? 'STARTING SCAN' : 'ANALYZE REPOSITORY'}
                <span style={{ fontFamily: MONO }}>→</span>
              </button>
            </div>
          </form>

          <div style={{ marginTop: 'clamp(12px, 1.8vh, 18px)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', font: `400 clamp(10.5px, 0.8vw, 12px)/1 ${MONO}`, color: C.muted }}>
            <span style={{ letterSpacing: '.14em', marginRight: 2 }}>TRY</span>
            {TRY_REPOS.map((t) => (
              <button
                key={t}
                type="button"
                disabled={loading}
                onClick={() => setRepoPath(t)}
                className="entry-chip disabled:opacity-40"
                style={{ padding: '7px 10px', border: `1px solid ${C.line}`, color: C.navInk, background: 'rgba(6,10,17,.7)' }}
              >
                {t}
              </button>
            ))}
          </div>

          {err && (
            <p style={{ marginTop: 10, font: `400 11px/1.4 ${MONO}`, color: C.red }}>{err}</p>
          )}
        </main>

        {/* Telemetry — floats over the field's lower-right flank on its own
            backing, above the globe layer, so the two never compete. */}
        <div
          className="absolute"
          style={{
            zIndex: 3,
            right: `calc(${GUTTER} + clamp(0px, 2.4vw, 48px))`,
            bottom: 'clamp(14px, 3vh, 34px)',
            width: 'clamp(330px, 25.5vw, 410px)',
            padding: '11px 14px 12px',
            display: 'flex', flexDirection: 'column', gap: 6,
            background: 'linear-gradient(180deg, rgba(4,8,14,.66), rgba(4,8,14,.9))',
            backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
            borderLeft: `1px solid ${C.line}`,
            font: `400 clamp(9.5px, 0.72vw, 11px)/1 ${MONO}`, letterSpacing: '.05em',
          }}
          aria-hidden
        >
          {telemetry.map((t) => (
            <div key={t.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, whiteSpace: 'nowrap' }}>
              <span style={{ color: C.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ color: C.green }}>[OK]</span> {t.label}
              </span>
              <span style={{ color: C.dimmer }} suppressHydrationWarning>{t.time}</span>
            </div>
          ))}
          <div style={{ color: C.cyan, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {targetSlug
              ? `> target acquired: ${targetSlug}`
              : <>&gt; awaiting target<span className="entry-caret">_</span></>}
          </div>
        </div>
      </div>

      {/* ── Engines ──────────────────────────────────────────────── */}
      <section
        id="engines"
        className="relative z-20 shrink-0"
        style={{
          marginLeft: GUTTER, marginRight: GUTTER, marginBottom: 'clamp(12px, 2.4vh, 28px)',
          border: `1px solid ${C.lineSoft}`,
          // Translucent on purpose: the globe should read clearly through this
          // row, not disappear behind it. The blur keeps its fine node/edge
          // detail from competing with the card text's own solid, high-
          // contrast colour, which is what actually keeps the text readable.
          background: 'rgba(4,8,14,.58)',
          backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
          display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
        }}
      >
        {ENGINES.map((g, i) => (
          <div
            key={g.code}
            className="entry-engine"
            style={{
              padding: 'clamp(12px, 1.9vh, 20px) clamp(14px, 1.3vw, 24px) clamp(14px, 2.1vh, 22px)',
              borderRight: i === ENGINES.length - 1 ? 'none' : `1px solid ${C.lineSoft}`,
              display: 'flex', flexDirection: 'column', gap: 'clamp(5px, 0.8vh, 8px)',
              minWidth: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, font: `500 9.5px/1 ${MONO}`, letterSpacing: '.13em' }}>
              <span style={{ color: C.dimmer }}>{g.idx} / {g.code}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.green }}>
                <span className="entry-live" style={{ width: 5, height: 5, borderRadius: '50%', background: C.green }} />
                READY
              </span>
            </div>
            <div style={{ fontStretch: '112%', fontWeight: 600, fontSize: 'clamp(13px, 1.1vw, 17px)', letterSpacing: '.13em', color: C.engineName }}>
              {g.name}
            </div>
            <div style={{ fontSize: 'clamp(11px, 0.86vw, 13.5px)', lineHeight: 1.45, color: C.inkSoft }}>{g.desc}</div>
          </div>
        ))}
      </section>

      {/* ── Incident archive ─────────────────────────────────────── */}
      <footer
        className="relative z-10 shrink-0 flex items-center overflow-hidden"
        style={{ height: 'clamp(34px, 4vh, 42px)', borderTop: `1px solid ${C.lineFooter}`, font: `400 10.5px/1 ${MONO}`, letterSpacing: '.06em' }}
      >
        <div
          className="shrink-0 flex items-center"
          style={{
            height: '100%', paddingLeft: GUTTER, paddingRight: 18, gap: 8,
            background: C.bg, color: C.red, letterSpacing: '.16em',
            position: 'relative', zIndex: 1, borderRight: `1px solid ${C.lineFooter}`,
          }}
        >
          <span style={{ width: 6, height: 6, background: C.red }} />
          INCIDENT ARCHIVE
        </div>
        <div
          className="entry-tick"
          style={{ display: 'flex', gap: 44, paddingLeft: 28, whiteSpace: 'nowrap', color: C.tickInk }}
          aria-hidden
        >
          {[...INCIDENTS, ...INCIDENTS].map((inc, i) => (
            <span key={i}>
              <span style={{ color: C.orange }}>{inc.year}</span> ·{' '}
              <span style={{ color: C.ink }}>{inc.pkg}</span> — {inc.what}
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}
