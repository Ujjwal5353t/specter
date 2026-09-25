// Accuracy evaluation for the package verdict engine (issue #26): how many
// known-malicious npm versions analyzePackage() catches (warn/block), and
// how many popular, legitimate packages it wrongly flags.
//
//   npm run eval-verdicts                 # print the report
//   npm run eval-verdicts -- --write       # also write scripts/eval-verdicts-results.md
//   npm run eval-verdicts -- --limit=40    # fewer popular packages, for a quick run
//
// Runs the real analyzePackage() from src/lib/packages/analyze.ts — the same
// code path the check API uses — against two sets:
//
//  1. Known-bad: a short list of npm PACKAGE NAMES with a public supply-chain
//     history (event-stream, node-ipc, ua-parser-js, ...). For each name this
//     script queries OSV *at run time* for every advisory OSV or OpenSSF's
//     malicious-packages feed tags as actually-malicious code (a `MAL-` id,
//     or CWE-506 "Embedded Malicious Code"), and extracts the exact affected
//     version(s) from that advisory. Nothing about *which versions are bad*
//     is hardcoded here — only the list of package names to ask OSV about,
//     which is not a vendored dataset, just an index of what to look up.
//
//  2. Popular: POPULAR_PACKAGES from src/lib/scanners/popularPackages.ts (the
//     same list DepChain's typosquat check uses), each at whatever version
//     is currently `latest` on the npm registry — fetched live, not pinned.
//
// A note on why some named incidents can't be fully exercised: npm removes
// (unpublishes) a malicious version's own package.json from the registry
// once it's taken down, so registry-metadata signals (new publisher, new
// dependency, install script, dropped provenance) that need that manifest
// are unavailable for most classic incidents — only OSV's permanent record
// remains. See the report's own tally of how many test cases still had a
// live manifest. This is a real constraint of npm's registry, not a gap in
// analyzePackage: it matters far less for the engine's actual job, which is
// screening a version *as it's published*, while the manifest still exists.
import { writeFileSync } from 'node:fs';
import { analyzePackage } from '../src/lib/packages/analyze.ts';
import { POPULAR_PACKAGES } from '../src/lib/scanners/popularPackages.ts';

const args = process.argv.slice(2);
const write = args.includes('--write');
const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? Infinity);
const pct = (n, d) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);

const REGISTRY = 'https://registry.npmjs.org';
const OSV_QUERY = 'https://api.osv.dev/v1/query';

/** Runs `limit` async tasks at a time, in order, no more concurrent than that. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

async function fetchJson(url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── 1. Known-bad set: discovered live from OSV, not hardcoded ────────────

// Package NAMES with a documented public supply-chain-attack history. This
// is an index of what to look up, not the malicious-version data itself —
// see the module doc above.
const KNOWN_BAD_NAMES = [
  'event-stream', 'flatmap-stream', 'node-ipc', 'ua-parser-js', 'coa', 'rc',
  'colors', 'faker', 'eslint-scope', 'getcookies', 'crossenv',
  'electron-native-notify', 'ionic-plugin-alpha', 'jqueryv3', 'http-fetch-dns',
  'mongose',
];

const isMalicious = (v) => v.id.startsWith('MAL-') || (v.database_specific?.cwe_ids ?? []).includes('CWE-506');

/** Every concrete version a malicious-package advisory names for this package, via OSV's own record. */
async function discoverMaliciousVersions(name) {
  const data = await fetchJson(OSV_QUERY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ package: { name, ecosystem: 'npm' } }),
  });
  const vulns = (data?.vulns ?? []).filter(isMalicious);
  const found = new Map(); // version -> advisory id
  for (const v of vulns) {
    for (const aff of v.affected ?? []) {
      if (aff.package?.name !== name) continue;
      for (const version of aff.versions ?? []) {
        if (!found.has(version)) found.set(version, v.id);
      }
      for (const range of aff.ranges ?? []) {
        const introduced = range.events?.find((e) => e.introduced)?.introduced;
        // "0" means "since the beginning of time" — not a single version we
        // can point analyzePackage at, so those are left for the versions[]
        // list above (or skipped if OSV only gave a range for this one).
        if (introduced && introduced !== '0' && !found.has(introduced)) found.set(introduced, v.id);
      }
    }
  }
  return [...found.entries()].map(([version, advisory]) => ({ name, version, advisory }));
}

async function buildKnownBadSet() {
  const perName = await mapLimit(KNOWN_BAD_NAMES, 6, discoverMaliciousVersions);
  const cases = perName.flat();
  const namesWithNoHit = KNOWN_BAD_NAMES.filter((n, i) => perName[i].length === 0);
  return { cases, namesWithNoHit };
}

// ── 2. Popular set: current `latest`, fetched live ────────────────────────

async function latestVersionOf(name) {
  const data = await fetchJson(`${REGISTRY}/${encodeURIComponent(name)}/latest`);
  return data?.version ?? null;
}

async function buildPopularSet() {
  const names = POPULAR_PACKAGES.slice(0, Math.min(limit, POPULAR_PACKAGES.length));
  const versions = await mapLimit(names, 12, latestVersionOf);
  return names.map((name, i) => ({ name, version: versions[i] })).filter((p) => p.version);
}

// ── Run ─────────────────────────────────────────────────────────────────

async function evalCase({ name, version }) {
  const v = await analyzePackage(name, version);
  return { name, version, verdict: v.verdict, signals: v.signals, sourceFailures: v.sourceFailures, hadManifest: v.integrity !== '' || v.signals.length > 0 };
}

if (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Note: if supabase/schema.sql\'s package_verdicts table has not been applied yet,');
  console.error('every analyzePackage() call logs a "write failed" warning below — that is the');
  console.error('engine degrading to "always compute fresh" as designed, not a fatal error.\n');
}
console.error('Discovering known-malicious versions from OSV...');
const { cases: badCases, namesWithNoHit } = await buildKnownBadSet();
console.error(`  ${badCases.length} version(s) found across ${KNOWN_BAD_NAMES.length - namesWithNoHit.length}/${KNOWN_BAD_NAMES.length} names.`);

console.error('Fetching latest versions of popular packages...');
const popularSet = await buildPopularSet();
console.error(`  ${popularSet.length} package(s).`);

console.error(`Running analyzePackage() over ${badCases.length + popularSet.length} versions...`);
const badResults = await mapLimit(badCases, 6, evalCase);
const popularResults = await mapLimit(popularSet, 6, evalCase);

// ── Report ──────────────────────────────────────────────────────────────

const caught = badResults.filter((r) => r.verdict !== 'allow');
const blocked = badResults.filter((r) => r.verdict === 'block');
const falseAlarms = popularResults.filter((r) => r.verdict !== 'allow');
const signalTally = new Map();
for (const r of [...badResults, ...popularResults]) {
  for (const s of r.signals) signalTally.set(s.type, (signalTally.get(s.type) ?? 0) + 1);
}

const lines = [];
const out = (s = '') => lines.push(s);

out('# Package verdict engine — evaluation (issue #26)');
out();
out(`Generated ${new Date().toISOString().slice(0, 10)} by \`npm run eval-verdicts\`. Known-malicious versions are discovered live from OSV.dev each run, so exact case counts vary as OSV's malicious-packages database grows.`);
out();
out('## Catch rate — known-malicious versions');
out();
out(`${badCases.length} versions, across ${KNOWN_BAD_NAMES.length} candidate package names (${namesWithNoHit.length} had no OSV malicious-package advisory at run time: ${namesWithNoHit.join(', ') || 'none'}).`);
out();
out('| Metric | Result |');
out('| --- | --- |');
out(`| Caught (warn or block) | **${caught.length}/${badResults.length} (${pct(caught.length, badResults.length)})** |`);
out(`| Blocked outright | ${blocked.length}/${badResults.length} (${pct(blocked.length, badResults.length)}) |`);
out(`| Still had a live registry manifest | ${badResults.filter((r) => r.hadManifest).length}/${badResults.length} |`);
out();
out('| Package@version | Advisory | Verdict | Signals |');
out('| --- | --- | --- | --- |');
for (const r of badResults) {
  const advisory = badCases.find((c) => c.name === r.name && c.version === r.version)?.advisory ?? '';
  out(`| ${r.name}@${r.version} | ${advisory} | ${r.verdict === 'allow' ? '**MISSED**' : r.verdict} | ${r.signals.map((s) => s.type).join(', ') || '(none — no registry manifest, OSV-only)'} |`);
}
out();
out('## False-alarm rate — popular packages (latest version)');
out();
out(`${popularResults.length} packages from the app's own popular-package list, each at its current \`latest\` release.`);
out();
out('| Metric | Result |');
out('| --- | --- |');
out(`| Wrongly flagged (warn or block) | **${falseAlarms.length}/${popularResults.length} (${pct(falseAlarms.length, popularResults.length)})** |`);
out(`| Wrongly blocked | ${popularResults.filter((r) => r.verdict === 'block').length}/${popularResults.length} |`);
out();
if (falseAlarms.length > 0) {
  out('Sample false alarms, for tuning:');
  out();
  out('| Package@version | Verdict | Signals |');
  out('| --- | --- | --- |');
  for (const r of falseAlarms.slice(0, 20)) {
    out(`| ${r.name}@${r.version} | ${r.verdict} | ${r.signals.map((s) => `${s.type} (${s.severity})`).join(', ')} |`);
  }
} else {
  out('No false alarms.');
}
out();
out('## Signals fired, across both sets');
out();
out('| Signal | Count |');
out('| --- | --- |');
for (const [type, n] of [...signalTally.entries()].sort((a, b) => b[1] - a[1])) out(`| ${type} | ${n} |`);
out();
out('## Tiers active in this run');
out();
out('Only the **metadata** tier exists so far (#27 registry heuristics + #28 OSV malicious/provenance checks). The diff, LLM and sandbox tiers (#39/#43/#45) are separate, not-yet-built work — re-run this script after each one lands to see its incremental effect on the numbers above.');

const report = lines.join('\n');
console.log(report);
if (write) {
  writeFileSync(new URL('./eval-verdicts-results.md', import.meta.url), report + '\n');
  console.error('\nWrote scripts/eval-verdicts-results.md');
}
