import type { Metadata } from 'next';
import Link from 'next/link';
import StarField from '@/components/landing/StarField';

export const metadata: Metadata = {
  title: 'Pricing — Specter',
  description: 'Plans for checking every npm package before it is installed. Free for individuals, built up for teams and enterprises.',
};

/**
 * Pricing, in the Entry landing page's design language (same palette,
 * Archivo / JetBrains Mono type, hairline panels, star field).
 * Tiers, cards and the comparison table all derive from FEATURES below.
 */

// Mirrors the palette in src/app/page.tsx.
const C = {
  bg: '#03060B',
  ink: '#D5E1EC',
  inkBright: '#E9F0F7',
  inkSoft: '#7F92A8',
  cyan: '#4FD8F0',
  dim: '#4F6680',
  muted: '#52667D',
  navInk: '#8A9BB0',
  line: '#16273A',
  lineSoft: '#111E2D',
  lineFooter: '#0E1826',
  slash: '#27405C',
  green: '#3FCF8E',
  red: '#FF3D4F',
  engineName: '#E0E9F2',
  wordmark: '#E6EEF6',
} as const;

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SANS = "'Archivo Variable', 'Archivo', ui-sans-serif, system-ui, sans-serif";
const GUTTER = 'clamp(16px, 5.5vw, 104px)';

// TODO: point at the real sales contact (mailto: or form) before launch.
const CONTACT_HREF = 'https://github.com/pratham27-pro/specter/issues';

type TierId = 'free' | 'team' | 'enterprise' | 'feed';

interface Tier {
  id: TierId;
  code: string;
  price: string;
  unit: string;
  blurb: string;
  /** Tier this one builds on, shown as the first line of its checklist. */
  includes?: string;
  featured?: boolean;
  cta: { label: string; href: string; internal: boolean };
}

const TIERS: Tier[] = [
  {
    id: 'free',
    code: 'FREE',
    price: '$0',
    unit: 'FOREVER',
    blurb: 'Check any public npm package before you install it.',
    cta: { label: 'START FREE', href: '/', internal: true },
  },
  {
    id: 'team',
    code: 'TEAM',
    price: '$19',
    unit: 'PER DEVELOPER / MONTH',
    blurb: 'Enforcement for engineering teams: checks on every pull request and installs that can be blocked.',
    includes: 'Everything in Free',
    featured: true,
    cta: { label: 'CONTACT US', href: CONTACT_HREF, internal: false },
  },
  {
    id: 'enterprise',
    code: 'ENTERPRISE',
    price: 'Custom',
    unit: 'TAILORED TO YOUR ORG',
    blurb: 'Company-wide protection with private package analysis and guaranteed support.',
    includes: 'Everything in Team',
    cta: { label: 'CONTACT SALES', href: CONTACT_HREF, internal: false },
  },
  {
    id: 'feed',
    code: 'THREAT FEED',
    price: 'Custom',
    unit: 'FOR SECURITY COMPANIES',
    blurb: 'Machine-readable intelligence for products and teams that track malicious packages.',
    cta: { label: 'CONTACT SALES', href: CONTACT_HREF, internal: false },
  },
];

interface Feature {
  name: string;
  detail?: string;
  /** Lowest tier that has it. Free → Team → Enterprise are cumulative; the feed stands alone. */
  home: TierId;
}

const FEATURES: Feature[] = [
  { name: 'Verdicts for public npm packages', detail: 'Limited per IP', home: 'free' },
  { name: 'Command line tool', detail: 'Checks the lockfile before install', home: 'free' },
  { name: 'API and documentation', home: 'free' },
  { name: 'Repository scan and threat score', detail: 'Five scanners, scored 0 to 100', home: 'free' },
  { name: '3D attack-surface scene', home: 'free' },
  { name: 'PR checks on private repos', home: 'team' },
  { name: 'Block mode', detail: 'Stop risky installs outright', home: 'team' },
  { name: 'Wait-period rules', detail: 'Hold brand-new versions and keep an allow list', home: 'team' },
  { name: 'Sandbox reports', home: 'team' },
  { name: 'AI review reports', home: 'team' },
  { name: 'Registry proxy', detail: 'Blocks bad packages for the whole company', home: 'enterprise' },
  { name: 'Private package analysis', home: 'enterprise' },
  { name: 'Single sign-on (SSO)', home: 'enterprise' },
  { name: 'Service level agreement', home: 'enterprise' },
  { name: 'Live stream of malicious package versions', home: 'feed' },
];

const RANK: Record<TierId, number> = { free: 0, team: 1, enterprise: 2, feed: -1 };

function hasFeature(tier: TierId, f: Feature): boolean {
  if (f.home === 'feed' || tier === 'feed') return f.home === tier;
  return RANK[tier] >= RANK[f.home];
}

const CHECKS = [
  {
    title: 'REGISTRY SIGNALS',
    body: 'New maintainers, new dependencies, install scripts, lost provenance and typosquats, read straight from npm.',
  },
  {
    title: 'VERSION DIFF',
    body: 'Each release is compared with the one before it, catching what metadata alone cannot.',
  },
  {
    title: 'AI REVIEW',
    body: 'Suspicious changes come with a plain-language explanation of what moved and why it matters.',
  },
  {
    title: 'SANDBOX',
    body: 'Suspect packages run in a locked container with decoy credentials while we watch what they do.',
  },
];

const mono = (size: number, weight = 500) => `${weight} ${size}px/1.4 ${MONO}`;

function Check({ on }: { on: boolean }) {
  return on ? (
    <span aria-label="Included" style={{ color: C.cyan, fontFamily: MONO, fontSize: 14 }}>✓</span>
  ) : (
    <span aria-label="Not included" style={{ color: C.slash, fontFamily: MONO, fontSize: 14 }}>—</span>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ font: mono(11.5), letterSpacing: '.2em', color: C.cyan, marginBottom: 16 }}>{children}</div>
  );
}

function Cta({ cta, primary }: { cta: Tier['cta']; primary?: boolean }) {
  const common = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '13px 16px',
    fontSize: 12.5, letterSpacing: '.1em', whiteSpace: 'nowrap' as const,
    ...(primary
      ? { background: C.cyan, color: C.bg, fontWeight: 600, border: `1px solid ${C.cyan}` }
      : { color: C.navInk, border: `1px solid ${C.line}`, background: 'rgba(6,10,17,.7)' }),
  };
  const className = primary ? 'entry-cta' : 'entry-chip';
  return cta.internal ? (
    <Link href={cta.href} className={className} style={common}>
      {cta.label} <span style={{ fontFamily: MONO }}>→</span>
    </Link>
  ) : (
    <a href={cta.href} className={className} style={common}>
      {cta.label} <span style={{ fontFamily: MONO }}>→</span>
    </a>
  );
}

export default function PricingPage() {
  return (
    <div
      className="entry-stage fixed inset-0 overflow-hidden pointer-events-auto"
      style={{ background: C.bg, color: C.ink, fontFamily: SANS }}
    >
      <StarField />

      <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
        {/* ── Header (same bar as the landing page) ─────────────────── */}
        <header
          className="sticky top-0 z-20 flex items-center justify-between"
          style={{
            height: 'clamp(56px, 5.4vh, 66px)', paddingLeft: GUTTER, paddingRight: GUTTER,
            borderBottom: `1px solid ${C.lineFooter}`, background: 'rgba(3,6,11,.92)',
            backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          }}
        >
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 11 }} aria-label="Specter home">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="1.4" aria-hidden>
              <path d="M12 1.5L22.5 12 12 22.5 1.5 12z" />
              <path d="M12 7l5 5-5 5-5-5z" fill="rgba(79,216,240,.18)" />
              <path d="M12 10.5v3M10.5 12h3" />
            </svg>
            <span style={{ fontStretch: '125%', fontWeight: 700, fontSize: 13.5, letterSpacing: '.32em', color: C.wordmark }}>
              SPECTER
            </span>
          </Link>

          <nav style={{ display: 'flex', alignItems: 'center', gap: 22, font: mono(11), lineHeight: 1, letterSpacing: '.14em' }}>
            <Link href="/#engines" className="entry-navlink hidden sm:inline" style={{ color: C.navInk }}>ENGINES</Link>
            <span aria-current="page" style={{ color: C.cyan }}>PRICING</span>
            <Link href="/" className="entry-navlink" style={{ color: C.navInk }}>SCAN →</Link>
          </nav>
        </header>

        <div style={{ maxWidth: 1240, margin: '0 auto', padding: `0 ${GUTTER}` }}>
          {/* ── Intro ─────────────────────────────────────────────── */}
          <section style={{ paddingTop: 'clamp(40px, 8vh, 88px)', textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, font: mono(11.5), letterSpacing: '.2em', color: C.cyan }}>
              <span className="entry-live" style={{ width: 6, height: 6, background: C.green, borderRadius: '50%' }} />
              <span>PRICING</span>
            </div>

            <h1
              style={{
                margin: 'clamp(16px, 3vh, 28px) auto 0', maxWidth: 900, fontStretch: '125%', fontWeight: 600,
                fontSize: 'clamp(28px, 4.6vw, 64px)', lineHeight: 1.04, letterSpacing: '.07em',
                color: C.inkBright, textWrap: 'balance',
              }}
            >
              STOP BAD PACKAGES BEFORE THEY INSTALL
            </h1>

            <p
              style={{
                margin: 'clamp(16px, 3vh, 28px) auto 0', maxWidth: 640, fontSize: 'clamp(16px, 1.5vw, 21px)',
                lineHeight: 1.4, fontWeight: 300, color: C.inkSoft, textWrap: 'pretty',
              }}
            >
              Every npm package version gets a verdict: <span style={{ color: C.inkBright, fontWeight: 400 }}>allow, warn or block</span>.
              Start free, and add enforcement when your team needs it.
            </p>
          </section>

          {/* ── Tier cards ───────────────────────────────────────── */}
          <section
            aria-label="Plans"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
            style={{ marginTop: 'clamp(36px, 6vh, 64px)', gap: 1, background: C.lineSoft, border: `1px solid ${C.lineSoft}` }}
          >
            {TIERS.map((t, i) => {
              const own = FEATURES.filter((f) => f.home === t.id);
              return (
                <article
                  key={t.id}
                  className="entry-engine"
                  style={{
                    position: 'relative', display: 'flex', flexDirection: 'column',
                    padding: '22px clamp(18px, 1.7vw, 26px) 24px',
                    background: t.featured ? 'rgba(7,14,24,.97)' : 'rgba(4,8,14,.94)',
                  }}
                >
                  {t.featured && (
                    <>
                      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 2, background: C.cyan, boxShadow: '0 0 18px rgba(79,216,240,.45)' }} />
                      <div style={{ position: 'absolute', left: -1, top: -1, width: 10, height: 10, borderLeft: `1px solid ${C.cyan}`, borderTop: `1px solid ${C.cyan}` }} />
                      <div style={{ position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRight: `1px solid ${C.cyan}`, borderBottom: `1px solid ${C.cyan}` }} />
                    </>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 24, font: mono(10.5), letterSpacing: '.13em' }}>
                    <span style={{ color: t.featured ? C.cyan : C.muted }}>0{i + 1} / {t.code}</span>
                    {t.featured && (
                      <span style={{ padding: '3px 7px', color: C.cyan, border: '1px solid rgba(79,216,240,.4)' }}>FOR TEAMS</span>
                    )}
                  </div>

                  <div style={{ marginTop: 18, fontStretch: '112%', fontWeight: 600, fontSize: 'clamp(32px, 3vw, 44px)', lineHeight: 1, letterSpacing: '.02em', color: t.featured ? C.cyan : C.engineName }}>
                    {t.price}
                  </div>
                  <div style={{ marginTop: 8, font: mono(10.5), letterSpacing: '.1em', color: C.inkSoft }}>{t.unit}</div>

                  {/* Reserve four lines at desktop width so the CTAs line up across cards. */}
                  <p className="lg:min-h-[84px]" style={{ marginTop: 16, fontSize: 14, lineHeight: 1.5, color: C.inkSoft }}>{t.blurb}</p>

                  <div style={{ marginTop: 20 }}>
                    <Cta cta={t.cta} primary={t.featured} />
                  </div>

                  <div style={{ height: 1, margin: '24px 0 18px', background: C.lineSoft }} />

                  <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {t.includes && (
                      <li style={{ font: mono(11.5), letterSpacing: '.06em', color: C.inkBright }}>{t.includes}, plus:</li>
                    )}
                    {own.map((f) => (
                      <li key={f.name} style={{ display: 'flex', gap: 10, fontSize: 14, lineHeight: 1.4, color: C.ink }}>
                        <span aria-hidden style={{ color: C.cyan, fontFamily: MONO, lineHeight: 1.4 }}>✓</span>
                        <span>
                          {f.name}
                          {f.detail && <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: C.inkSoft }}>{f.detail}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </section>

          {/* ── How every version is checked ─────────────────────── */}
          <section style={{ marginTop: 'clamp(48px, 8vh, 88px)' }}>
            <Eyebrow>{'// HOW EVERY VERSION IS CHECKED'}</Eyebrow>
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
              style={{ gap: 1, background: C.lineSoft, border: `1px solid ${C.lineSoft}` }}
            >
              {CHECKS.map((c, i) => (
                <article key={c.title} className="entry-engine" style={{ padding: '20px clamp(16px, 1.6vw, 24px) 24px', background: 'rgba(4,8,14,.94)' }}>
                  <div style={{ font: mono(10.5), letterSpacing: '.13em', color: C.muted }}>0{i + 1}</div>
                  <h3 style={{ margin: '10px 0 0', fontStretch: '112%', fontWeight: 600, fontSize: 15, letterSpacing: '.1em', color: C.engineName }}>
                    {c.title}
                  </h3>
                  <p style={{ marginTop: 10, fontSize: 14, lineHeight: 1.5, color: C.inkSoft }}>{c.body}</p>
                </article>
              ))}
            </div>
          </section>

          {/* ── Comparison ───────────────────────────────────────── */}
          <section style={{ marginTop: 'clamp(48px, 8vh, 88px)' }}>
            <Eyebrow>{'// COMPARE PLANS'}</Eyebrow>
            <div style={{ overflowX: 'auto', border: `1px solid ${C.lineSoft}`, background: 'rgba(4,8,14,.85)' }}>
              <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      style={{ position: 'sticky', left: 0, zIndex: 1, background: '#04080E', textAlign: 'left', padding: '14px 18px', font: mono(10.5), letterSpacing: '.13em', color: C.muted, borderBottom: `1px solid ${C.lineSoft}` }}
                    >
                      FEATURE
                    </th>
                    {TIERS.map((t) => (
                      <th
                        key={t.id}
                        scope="col"
                        style={{ padding: '14px 12px', width: 118, textAlign: 'center', font: mono(10.5, 600), letterSpacing: '.13em', color: t.featured ? C.cyan : C.engineName, borderBottom: `1px solid ${C.lineSoft}` }}
                      >
                        {t.code}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEATURES.map((f) => (
                    <tr key={f.name}>
                      <th
                        scope="row"
                        style={{ position: 'sticky', left: 0, zIndex: 1, background: '#04080E', textAlign: 'left', fontWeight: 400, padding: '12px 18px', fontSize: 14, lineHeight: 1.4, color: C.ink, borderBottom: `1px solid ${C.lineSoft}` }}
                      >
                        {f.name}
                        {f.detail && <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: C.inkSoft }}>{f.detail}</span>}
                      </th>
                      {TIERS.map((t) => (
                        <td
                          key={t.id}
                          style={{ textAlign: 'center', padding: '12px', borderBottom: `1px solid ${C.lineSoft}`, background: t.featured ? 'rgba(79,216,240,.03)' : undefined }}
                        >
                          <Check on={hasFeature(t.id, f)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Closing CTA ──────────────────────────────────────── */}
          <section
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between"
            style={{ gap: 20, margin: 'clamp(48px, 8vh, 88px) 0 clamp(28px, 5vh, 56px)', padding: 'clamp(20px, 3vw, 32px)', border: `1px solid ${C.line}`, background: 'rgba(6,10,17,.9)' }}
          >
            <div>
              <p style={{ fontStretch: '112%', fontWeight: 600, fontSize: 'clamp(16px, 1.5vw, 21px)', letterSpacing: '.06em', color: C.inkBright }}>
                START FREE. UPGRADE WHEN YOU NEED ENFORCEMENT.
              </p>
              <p style={{ marginTop: 6, fontSize: 14, color: C.inkSoft }}>Not sure which plan fits? Talk to us.</p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ minWidth: 190 }}><Cta cta={TIERS[0].cta} primary /></div>
              <div style={{ minWidth: 190 }}><Cta cta={{ label: 'CONTACT US', href: CONTACT_HREF, internal: false }} /></div>
            </div>
          </section>
        </div>

        <footer
          style={{
            padding: `14px ${GUTTER}`, borderTop: `1px solid ${C.lineFooter}`, background: 'rgba(3,6,11,.9)',
            font: mono(10.5), letterSpacing: '.08em', color: C.dim,
          }}
        >
          <span style={{ color: C.red }}>■</span> VERDICTS ARE RISK SIGNALS, NOT GUARANTEES · BLOCK MODE IS OPT-IN
        </footer>
      </div>
    </div>
  );
}
