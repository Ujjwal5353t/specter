import type { Metadata } from 'next';
import Link from 'next/link';
import StarField from '@/components/landing/StarField';
import { C, GUTTER, SANS, mono } from '@/lib/entryTheme';

export const metadata: Metadata = {
  title: 'API docs — Specter',
  description: 'Check an npm package or a whole lockfile before it is installed: the verdict API, the specter-guard CLI and the signal glossary.',
};

/**
 * Docs for the pre-install check API (POST /api/v1/check, /api/v1/check/lockfile)
 * and the specter-guard CLI. Every command below is meant to be pasted as-is
 * against `npm run dev` (http://localhost:3000).
 */

const BASE = 'http://localhost:3000';

const SECTIONS = [
  ['overview', 'Overview'],
  ['verdicts', 'Verdicts'],
  ['check', 'Check a package'],
  ['lockfile', 'Check a lockfile'],
  ['errors', 'Errors and limits'],
  ['cli', 'CLI: specter-guard'],
  ['signals', 'Signal glossary'],
  ['scoring', 'Scoring'],
] as const;

const VERDICTS = [
  { name: 'allow', color: C.green, body: 'Nothing that stands out. Install as usual.' },
  { name: 'warn', color: C.orange, body: 'Risk signals worth a look, such as a stack of known vulnerabilities or a suspicious release pattern. Installs are not stopped by default.' },
  { name: 'block', color: C.red, body: 'Reported as malicious, or enough serious signals stack up that installing is not advised. The CLI stops the install.' },
  { name: 'pending', color: C.cyan, body: 'The time budget ran out before this version was analyzed. Send the same request again: finished work is cached, so the retry is fast.' },
];

const ERRORS = [
  ['202', 'pending', 'Accepted but incomplete: some packages are still pending. Repeat the request.'],
  ['400', 'invalid_json', 'The body is not valid JSON.'],
  ['400', 'invalid_name', 'name is not a valid npm package name.'],
  ['400', 'invalid_version', 'version is not one exact semver version. Ranges and tags like "latest" are rejected.'],
  ['400', 'invalid_lockfile', 'Not a package-lock.json with lockfileVersion 2 or 3.'],
  ['404', 'version_not_found', 'The version is not on the npm registry (never published, or unpublished) and no advisory is known for it.'],
  ['413', 'body_too_large', 'The body is over 6 MB.'],
  ['413', 'too_many_packages', 'The lockfile lists more than 2000 packages.'],
  ['429', 'rate_limited', 'Over the per-IP hourly limit.'],
];

const LIMITS = [
  ['POST /api/v1/check', '120 requests per hour per IP', '30 s'],
  ['POST /api/v1/check/lockfile', '10 requests per hour per IP', '45 s'],
];

const FLAGS = [
  ['--warn-only', 'Report problems but never stop the install.'],
  ['--allow <pkg@ver>', 'Accept one specific version. Repeat the flag for more, e.g. --allow lodash@4.17.21.'],
  ['--json', 'Print the report as JSON on stdout. npm’s own output moves to stderr so the JSON stays clean.'],
  ['--api-url <url>', 'API base URL. Defaults to $SPECTER_API_URL, then the hosted API.'],
];

const SIGNALS = [
  ['osv_malicious', 'critical', 'OSV lists this version as malicious code (a MAL- advisory, or CWE-506 “embedded malicious code”). Always a block.'],
  ['osv_advisory', 'varies', 'A known vulnerability. Severity comes from the advisory; the three most severe are scored.'],
  ['young_dependency', 'high', 'A dependency added in this release was brand new (under 30 days old) when it was added. The event-stream / flatmap-stream pattern.'],
  ['provenance_dropped', 'high', 'The previous release had signed build provenance and this one does not; it may have been published from a stolen account.'],
  ['typosquat', 'high', 'The name is one typo away from a popular package.'],
  ['young_package', 'medium', 'The package itself was first published under 30 days ago.'],
  ['new_publisher', 'low / medium', 'First release by someone who never published this package before. Medium when other signals corroborate it.'],
  ['new_dependency', 'low / medium', 'This release added dependencies the previous one did not have.'],
  ['install_script', 'low / medium', 'Runs preinstall, install or postinstall. Medium when the previous release had none.'],
  ['fresh_release', 'low', 'Published in the last 7 days. Compromised versions are usually caught within days.'],
  ['unverified', 'medium', 'Added by the API when a source could not be reached (registry or OSV) or the version is not on the registry. An unverifiable result is a warn, never an allow.'],
];

const WEIGHTS = [
  ['critical', '15'],
  ['high', '8'],
  ['medium', '4'],
  ['low', '1'],
];

// ── Example payloads (real responses, trimmed) ──────────────────────────

const CURL_CHECK = `curl -s -X POST ${BASE}/api/v1/check \\
  -H 'content-type: application/json' \\
  -d '{"name":"event-stream","version":"3.3.6"}'`;

const RES_CHECK = `{
  "name": "event-stream",
  "version": "3.3.6",
  "verdict": "block",
  "score": 15,
  "signals": [
    {
      "type": "osv_malicious",
      "severity": "critical",
      "title": "Reported as malicious code",
      "detail": "GHSA-mh6f-8j2x-4483: Critical severity vulnerability that affects event-stream and flatmap-stream",
      "advisoryId": "GHSA-mh6f-8j2x-4483"
    }
  ],
  "analyzedAt": "2026-09-25T19:56:18.363Z"
}`;

const CURL_LOCKFILE = `curl -s -X POST ${BASE}/api/v1/check/lockfile \\
  -H 'content-type: application/json' \\
  --data-binary @package-lock.json`;

const RES_LOCKFILE = `{
  "verdict": "block",
  "complete": true,
  "counts": { "allow": 2, "warn": 1, "block": 1, "pending": 0 },
  "packages": [
    {
      "name": "event-stream",
      "version": "3.3.6",
      "verdict": "block",
      "score": 15,
      "signals": [ { "type": "osv_malicious", "severity": "critical", "advisoryId": "GHSA-mh6f-8j2x-4483", "…": "…" } ],
      "analyzedAt": "2026-09-25T19:56:17.656Z"
    },
    { "name": "lodash", "version": "4.17.21", "verdict": "warn", "score": 16, "…": "…" }
  ],
  "checked": 4,
  "skipped": 2,
  "analyzedAt": "2026-09-25T19:56:18.153Z"
}`;

const CLI_LINK = `cd cli
npm link`;

const CLI_USE = `specter-guard --api-url ${BASE} npm install lodash@4.17.21`;

const CLI_CI = `specter-guard --api-url ${BASE} npm ci`;

const CLI_ENV = `SPECTER_API_URL=${BASE} specter-guard npm install lodash@4.17.21 --json`;

// ── Small building blocks ───────────────────────────────────────────────

function Code({ label, children }: { label: string; children: string }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, background: 'rgba(6,10,17,.94)', margin: '14px 0' }}>
      <div style={{ padding: '7px 14px', borderBottom: `1px solid ${C.lineSoft}`, font: mono(10.5), letterSpacing: '.15em', color: C.muted }}>{label}</div>
      <pre style={{ margin: 0, padding: '14px', overflowX: 'auto', font: mono(12.5), lineHeight: 1.6, color: C.ink, whiteSpace: 'pre' }}>
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Inline({ children }: { children: React.ReactNode }) {
  return <code style={{ font: mono(12.5), color: C.cyan, background: 'rgba(79,216,240,.07)', padding: '1px 5px' }}>{children}</code>;
}

function H2({ id, index, children }: { id: string; index: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      style={{ scrollMarginTop: 84, margin: '0 0 16px', fontStretch: '112%', fontWeight: 600, fontSize: 'clamp(20px, 2vw, 26px)', letterSpacing: '.08em', color: C.inkBright }}
    >
      <span style={{ font: mono(11.5), letterSpacing: '.15em', color: C.slash, marginRight: 10 }}>{index} /</span>
      {children}
    </h2>
  );
}

const P = ({ children }: { children: React.ReactNode }) => (
  <p style={{ margin: '0 0 14px', maxWidth: 720, fontSize: 15, lineHeight: 1.65, color: C.inkSoft }}>{children}</p>
);

function Table({ head, rows, widths }: { head: string[]; rows: React.ReactNode[][]; widths?: (string | undefined)[] }) {
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${C.lineSoft}`, background: 'rgba(4,8,14,.85)', margin: '14px 0' }}>
      <table style={{ width: '100%', minWidth: 520, borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" style={{ width: widths?.[i], padding: '10px 14px', font: mono(10.5), letterSpacing: '.13em', color: C.muted, borderBottom: `1px solid ${C.lineSoft}` }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} style={{ padding: '10px 14px', verticalAlign: 'top', fontSize: 14, lineHeight: 1.5, color: C.inkSoft, borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${C.lineSoft}` }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const mk = (s: string) => <Inline>{s}</Inline>;

export default function DocsPage() {
  return (
    <div className="entry-stage fixed inset-0 overflow-hidden pointer-events-auto" style={{ background: C.bg, color: C.ink, fontFamily: SANS }}>
      <StarField />

      <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
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
            <span style={{ fontStretch: '125%', fontWeight: 700, fontSize: 13.5, letterSpacing: '.32em', color: C.wordmark }}>SPECTER</span>
          </Link>
          <nav style={{ display: 'flex', alignItems: 'center', gap: 22, font: mono(11), lineHeight: 1, letterSpacing: '.14em' }}>
            <span aria-current="page" style={{ color: C.cyan }}>DOCS</span>
            <Link href="/" className="entry-navlink" style={{ color: C.navInk }}>SCAN →</Link>
          </nav>
        </header>

        <div className="lg:flex lg:gap-14" style={{ maxWidth: 1240, margin: '0 auto', padding: `clamp(32px, 6vh, 64px) ${GUTTER} 0` }}>
          {/* Sidebar (desktop) */}
          <aside className="hidden lg:block shrink-0" style={{ width: 210 }}>
            <nav aria-label="On this page" style={{ position: 'sticky', top: 96, display: 'flex', flexDirection: 'column', gap: 4, font: mono(11.5), letterSpacing: '.08em' }}>
              <span style={{ marginBottom: 8, letterSpacing: '.2em', color: C.cyan }}>{'// ON THIS PAGE'}</span>
              {SECTIONS.map(([id, label]) => (
                <a key={id} href={`#${id}`} className="entry-navlink" style={{ padding: '5px 0', color: C.navInk }}>{label}</a>
              ))}
            </nav>
          </aside>

          <main style={{ minWidth: 0, flex: 1, maxWidth: 820 }}>
            {/* Overview */}
            <section id="overview" style={{ scrollMarginTop: 84 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, font: mono(11.5), letterSpacing: '.2em', color: C.cyan }}>
                <span className="entry-live" style={{ width: 6, height: 6, background: C.green, borderRadius: '50%' }} />
                <span>API DOCS</span>
              </div>
              <h1 style={{ margin: 'clamp(14px, 2.4vh, 22px) 0 0', fontStretch: '125%', fontWeight: 600, fontSize: 'clamp(26px, 3.6vw, 46px)', lineHeight: 1.05, letterSpacing: '.07em', color: C.inkBright, textWrap: 'balance' }}>
                CHECK BEFORE YOU INSTALL
              </h1>
              <p style={{ margin: 'clamp(14px, 2.4vh, 22px) 0 0', maxWidth: 680, fontSize: 'clamp(16px, 1.4vw, 19px)', lineHeight: 1.45, fontWeight: 300, color: C.inkSoft }}>
                Two endpoints give any npm package version a verdict: one for a single <Inline>name@version</Inline>, one for a whole <Inline>package-lock.json</Inline>. The <Inline>specter-guard</Inline> CLI wraps them around <Inline>npm install</Inline>.
              </p>

              <div style={{ margin: '22px 0 0', maxWidth: 720, padding: '12px 14px', font: mono(12), color: C.orange, border: '1px solid rgba(255,138,43,.35)', background: 'rgba(255,138,43,.06)' }}>
                <span style={{ letterSpacing: '.14em' }}>[!]</span> A verdict is a risk signal, not a guarantee. Blocking is opt-in on the CLI, and no API key is needed.
              </div>

              <P>
                {'The examples on this page use the address of '}{mk('npm run dev')}{', '}{mk(BASE)}{', and run as written in bash or zsh. On Windows PowerShell, use '}{mk('curl.exe')}{' and put the JSON body in a file.'}
              </P>

              {/* Phone: inline contents in place of the sidebar */}
              <nav aria-label="On this page" className="lg:hidden" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', margin: '6px 0 0', font: mono(11.5), letterSpacing: '.06em' }}>
                {SECTIONS.map(([id, label]) => (
                  <a key={id} href={`#${id}`} style={{ color: C.cyan, textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 4 }}>{label}</a>
                ))}
              </nav>
            </section>

            {/* Verdicts */}
            <section style={{ marginTop: 'clamp(40px, 7vh, 72px)' }}>
              <H2 id="verdicts" index="01">VERDICTS</H2>
              <P>Every package version gets one of four verdicts.</P>
              <Table
                head={['VERDICT', 'MEANING']}
                widths={['120px', undefined]}
                rows={VERDICTS.map((v) => [<span key={v.name} style={{ font: mono(12, 600), letterSpacing: '.12em', color: v.color }}>{v.name.toUpperCase()}</span>, v.body])}
              />
              <P>A lockfile also gets one overall verdict: <Inline>block</Inline> if any package is blocked, otherwise <Inline>warn</Inline> if any is warned or still pending, otherwise <Inline>allow</Inline>. An incomplete result never reports <Inline>allow</Inline>.</P>
            </section>

            {/* Check a package */}
            <section style={{ marginTop: 'clamp(40px, 7vh, 72px)' }}>
              <H2 id="check" index="02">CHECK A PACKAGE</H2>
              <P>{mk('POST /api/v1/check')} takes an exact name and version. Ranges and tags such as <Inline>^4.0.0</Inline> or <Inline>latest</Inline> are rejected, because resolving them would need a registry lookup first.</P>
              <Code label="REQUEST">{CURL_CHECK}</Code>
              <Code label="RESPONSE 200">{RES_CHECK}</Code>
              <Table
                head={['FIELD', 'TYPE', 'DESCRIPTION']}
                widths={['130px', '130px', undefined]}
                rows={[
                  [mk('verdict'), 'string', 'One of allow, warn, block or pending.'],
                  [mk('score'), 'number | null', 'Sum of the signal weights. null while pending. See Scoring.'],
                  [mk('signals'), 'array', 'Why: each has type, severity, title, detail and, for advisories, advisoryId. See the glossary.'],
                  [mk('review'), 'object', 'Only for flagged versions whose changed code was reviewed by an LLM (a tiebreaker, never the sole reason to block). status is ok, with malicious (likely, possible or unlikely), reasons, suspiciousSnippets and model, or failed, with error. An unlikely review can lower a warn to an allow (loweredVerdict) unless a malicious-package advisory exists, a source failed, or the package text tried to instruct the reviewer (injectionSuspected). Absent when no AI key is configured.'],
                  [mk('analyzedAt'), 'string | null', 'ISO time the verdict was produced. Verdicts are cached for 6 hours.'],
                  [mk('retryAfterSeconds'), 'number', 'Only on a 202 pending response: how long to wait before repeating the request.'],
                ]}
              />
            </section>

            {/* Check a lockfile */}
            <section style={{ marginTop: 'clamp(40px, 7vh, 72px)' }}>
              <H2 id="lockfile" index="03">CHECK A LOCKFILE</H2>
              <P>{mk('POST /api/v1/check/lockfile')} takes the contents of a <Inline>package-lock.json</Inline> (lockfileVersion 2 or 3, npm 7 or newer) as the request body. Every registry package in it is checked. Workspace links, git and file sources, and private-registry packages are skipped and counted in <Inline>skipped</Inline>.</P>
              <Code label="REQUEST (run in a folder that has a package-lock.json)">{CURL_LOCKFILE}</Code>
              <Code label="RESPONSE 200 (trimmed)">{RES_LOCKFILE}</Code>
              <P>
                {mk('packages')} lists every checked package, worst first. A large lockfile may not finish inside the time budget; the API then answers <Inline>202</Inline> with <Inline>complete: false</Inline> and the unfinished packages marked <Inline>pending</Inline>. Send the same request again: everything analyzed so far is cached, so each retry gets further.
              </P>
            </section>

            {/* Errors and limits */}
            <section style={{ marginTop: 'clamp(40px, 7vh, 72px)' }}>
              <H2 id="errors" index="04">ERRORS AND LIMITS</H2>
              <P>Errors are JSON: {mk('{ "error": "<code>", "message": "<explanation>" }')}.</P>
              <Table
                head={['STATUS', 'CODE', 'MEANING']}
                widths={['80px', '170px', undefined]}
                rows={ERRORS.map(([s, c, m]) => [s, mk(c), m])}
              />
              <P>There are no accounts or API keys. Access is limited per IP address:</P>
              <Table head={['ENDPOINT', 'LIMIT', 'TIME BUDGET']} rows={LIMITS.map(([e, l, t]) => [mk(e), l, t])} />
              <P>Request bodies are capped at 6 MB and lockfiles at 2000 packages. If a source such as the npm registry or OSV cannot be reached, the affected package is reported as <Inline>warn</Inline> with an <Inline>unverified</Inline> signal rather than <Inline>allow</Inline>, and that partial result is not cached.</P>
            </section>

            {/* CLI */}
            <section style={{ marginTop: 'clamp(40px, 7vh, 72px)' }}>
              <H2 id="cli" index="05">CLI: SPECTER-GUARD</H2>
              <P>
                The cheapest place to enforce a verdict is right before the install. <Inline>specter-guard npm install</Inline> resolves the dependency tree without running any package code (<Inline>npm install --package-lock-only --ignore-scripts</Inline>), sends the lockfile to the API, and runs the real install only if nothing is blocked. Your <Inline>package.json</Inline> and lockfile are restored to how they were if it stops. npm only, Node 18 or newer.
              </P>
              <Code label="ONE-TIME SETUP (from the repository root)">{CLI_LINK}</Code>
              <Code label="INSTALL A PACKAGE, CHECKED FIRST (run in your project)">{CLI_USE}</Code>
              <Code label="INSTALL FROM AN EXISTING LOCKFILE">{CLI_CI}</Code>
              <Table head={['OPTION', 'DESCRIPTION']} widths={['200px', undefined]} rows={FLAGS.map(([f, d]) => [mk(f), d])} />
              <Code label="SAME THING, API URL FROM THE ENVIRONMENT">{CLI_ENV}</Code>
              <Table
                head={['EXIT CODE', 'MEANING']}
                widths={['110px', undefined]}
                rows={[
                  ['0', 'Checked and installed, or nothing to flag.'],
                  ['1', 'Stopped: a package was blocked.'],
                  ['2', 'Could not check (API unreachable, rate limited, bad lockfile) or a usage error. By default nothing is installed; --warn-only installs anyway.'],
                ]}
              />
            </section>

            {/* Signals */}
            <section style={{ marginTop: 'clamp(40px, 7vh, 72px)' }}>
              <H2 id="signals" index="06">SIGNAL GLOSSARY</H2>
              <P>Signals are the reasons behind a verdict. Most come from registry metadata alone, which is available before anything is downloaded.</P>
              <Table
                head={['SIGNAL', 'SEVERITY', 'MEANING']}
                widths={['180px', '110px', undefined]}
                rows={SIGNALS.map(([t, s, m]) => [mk(t), s, m])}
              />
            </section>

            {/* Scoring */}
            <section style={{ marginTop: 'clamp(40px, 7vh, 72px)' }}>
              <H2 id="scoring" index="07">SCORING</H2>
              <P>The score is the sum of a fixed weight per signal, the same scale as the repository threat score:</P>
              <Table head={['SEVERITY', 'WEIGHT']} widths={['160px', undefined]} rows={WEIGHTS.map(([s, w]) => [s, w])} />
              <P>A score of <Inline>8</Inline> or more is <Inline>warn</Inline> and <Inline>23</Inline> or more is <Inline>block</Inline>. A malicious-code match (<Inline>osv_malicious</Inline>) is a <Inline>block</Inline> whatever the score. Known-vulnerability advisories count only up to the three most severe, so a long list cannot inflate a score. The thresholds are hand-picked, not statistical.</P>
            </section>

            <div style={{ height: 'clamp(40px, 8vh, 80px)' }} />
          </main>
        </div>

        <footer style={{ padding: `14px ${GUTTER}`, borderTop: `1px solid ${C.lineFooter}`, background: 'rgba(3,6,11,.9)', font: mono(10.5), letterSpacing: '.08em', color: C.dim }}>
          <span style={{ color: C.red }}>■</span> VERDICTS ARE RISK SIGNALS, NOT GUARANTEES · NPM ONLY
        </footer>
      </div>
    </div>
  );
}
