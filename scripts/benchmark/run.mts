// Accuracy benchmark for the two scanners that have ground truth (issue #8).
//
//   npm run benchmark                 # print the report
//   npm run benchmark -- --write      # also write scripts/benchmark/RESULTS.md
//   npm run benchmark -- --only=ghostcommit   (or --only=depchain)
//
// DepChain runs the real registry + OSV pipeline (network required) against
// pinned vulnerable/patched versions. GhostCommit runs the real detection code
// against a labelled, fully offline corpus. Exits 1 if DepChain misses a
// labelled advisory, reports it on the patched version, or reports anything
// OSV doesn't list for that exact version. GhostCommit is reported, not gated:
// it's a heuristic, and its numbers are the point.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeManifests } from '../../src/lib/scanners/depchain';
import { scanCommitFiles, dedupeSecretFindings } from '../../src/lib/scanners/ghostcommit';
import type { SecretFinding } from '../../src/types';
import { DEP_FIXTURES } from './depchain-fixtures';
import { buildCorpus, toPatch, type CorpusLine } from './ghostcommit-corpus';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];
const write = args.includes('--write');
const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);

// ── DepChain ─────────────────────────────────────────────────────────────

/** OSV's own answer for exact versions, queried independently of DepChain's code. */
async function osvTruth(pkgs: { name: string; version: string }[]): Promise<Map<string, Set<string>>> {
  const res = await fetch('https://api.osv.dev/v1/querybatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries: pkgs.map((p) => ({ package: { name: p.name, ecosystem: 'npm' }, version: p.version })) }),
  });
  if (!res.ok) throw new Error(`OSV querybatch failed: ${res.status}`);
  const data = await res.json();
  const out = new Map<string, Set<string>>();
  pkgs.forEach((p, i) => out.set(`${p.name}@${p.version}`, new Set((data.results[i]?.vulns ?? []).map((v: { id: string }) => v.id))));
  return out;
}

async function runDepChainBenchmark(): Promise<{ md: string; pass: boolean }> {
  const sides = ['vulnerable', 'patched'] as const;
  // What DepChain reported for each direct package, keyed by name@pinned-version.
  const reported = new Map<string, { resolved: string | null; ids: Set<string> }>();

  for (const side of sides) {
    const manifest = JSON.stringify({ dependencies: Object.fromEntries(DEP_FIXTURES.map((f) => [f.name, f[side]])) });
    const result = await analyzeManifests(`benchmark/${side}`, [manifest]);
    for (const f of DEP_FIXTURES) {
      const node = result.nodes.find((n) => n.isDirect && n.name === f.name);
      reported.set(`${f.name}@${f[side]}`, { resolved: node?.version ?? null, ids: new Set((node?.cves ?? []).map((c) => c.id)) });
    }
  }

  const all = DEP_FIXTURES.flatMap((f) => sides.map((s) => ({ name: f.name, version: f[s] })));
  const truth = await osvTruth(all);

  let detected = 0, patchedFalse = 0, exact = 0, osvTotal = 0, osvFound = 0, extra = 0, resolvedOk = 0, cleanControls = 0, cleanOk = 0;
  const rows: string[] = [];
  const problems: string[] = [];
  for (const f of DEP_FIXTURES) {
    for (const side of sides) {
      const key = `${f.name}@${f[side]}`;
      const r = reported.get(key)!;
      const t = truth.get(key)!;
      if (r.resolved === f[side]) resolvedOk++;
      else problems.push(`${key}: resolved to ${r.resolved ?? 'nothing'}`);
      const missing = [...t].filter((id) => !r.ids.has(id));
      const extraIds = [...r.ids].filter((id) => !t.has(id));
      osvTotal += t.size; osvFound += t.size - missing.length; extra += extraIds.length;
      if (missing.length === 0 && extraIds.length === 0) exact++;
      if (missing.length) problems.push(`${key}: missed ${missing.join(', ')}`);
      if (extraIds.length) problems.push(`${key}: reported ${extraIds.join(', ')} which OSV does not list`);
      if (t.size === 0) { cleanControls++; if (r.ids.size === 0) cleanOk++; }
    }
    const vHas = reported.get(`${f.name}@${f.vulnerable}`)!.ids.has(f.advisory);
    const pHas = reported.get(`${f.name}@${f.patched}`)!.ids.has(f.advisory);
    if (vHas) detected++;
    if (pHas) patchedFalse++;
    rows.push(`| ${f.name} | ${f.vulnerable} → ${f.patched} | ${f.advisory} (${f.what}) | ${vHas ? 'yes' : '**NO**'} | ${pHas ? '**YES**' : 'no'} | ${reported.get(`${f.name}@${f.patched}`)!.ids.size} |`);
  }

  const n = DEP_FIXTURES.length;
  const pass = detected === n && patchedFalse === 0 && extra === 0;
  const md = [
    '## DepChain (known CVEs via npm registry + OSV.dev)',
    '',
    `${n} packages, each pinned to a version with a known advisory and to the release that fixed it (${n * 2} package versions).`,
    '',
    '| Metric | Result |',
    '| --- | --- |',
    `| Labelled advisory detected on the vulnerable version | **${detected}/${n} (${pct(detected, n)})** |`,
    `| Labelled advisory reported on the patched version (false positive) | **${patchedFalse}/${n}** |`,
    `| Advisories reported that OSV does not list for that exact version | **${extra}** |`,
    `| All OSV advisories for the exact version found (recall vs OSV) | ${osvFound}/${osvTotal} (${pct(osvFound, osvTotal)}) |`,
    `| Package versions where DepChain matches OSV exactly | ${exact}/${n * 2} |`,
    `| Clean controls (versions with no advisories) reported clean | ${cleanOk}/${cleanControls} |`,
    `| Pinned version resolved correctly from the registry | ${resolvedOk}/${n * 2} |`,
    '',
    '| Package | Vulnerable → patched | Labelled advisory | Detected | On patched | Other advisories still on patched |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    problems.length ? `Discrepancies:\n\n${problems.map((p) => `- ${p}`).join('\n')}` : 'No discrepancies against OSV.',
    '',
    'Some "patched" releases still carry later, unrelated advisories (listed in the last column). Those are correct findings, not false positives.',
    '',
    'Scope: this verifies that DepChain resolves pinned versions and reports what OSV.dev knows, with nothing invented or misattributed. It does not measure detection of undisclosed (zero-day) compromises; DepChain can only report what OSV has catalogued.',
  ].join('\n');
  return { md, pass };
}

// ── GhostCommit ──────────────────────────────────────────────────────────

async function runGhostCommitBenchmark(): Promise<{ md: string }> {
  const corpus = buildCorpus();
  const labelled: { file: string; line: number; l: CorpusLine }[] = [];
  let findings: SecretFinding[] = [];

  for (const commit of corpus) {
    const files = commit.files.map((f) => {
      f.lines.forEach((l, i) => labelled.push({ file: f.filename, line: i + 1, l }));
      return { filename: f.filename, patch: toPatch(f.lines) };
    });
    findings.push(...await scanCommitFiles(files, { sha: commit.sha, message: commit.message, author: 'benchmark', date: '' }));
  }
  findings = dedupeSecretFindings(findings);

  const hits = new Map<string, string[]>();
  for (const f of findings) {
    const k = `${f.file}:${f.line}`;
    hits.set(k, [...(hits.get(k) ?? []), f.type]);
  }
  const typesFor = (x: { file: string; line: number }) => hits.get(`${x.file}:${x.line}`) ?? [];

  const secrets = labelled.filter((x) => x.l.tag.label === 'secret');
  const cleans = labelled.filter((x) => x.l.tag.label === 'clean');
  const hard = cleans.filter((x) => x.l.tag.label === 'clean' && x.l.tag.hard);
  const tp = secrets.filter((x) => typesFor(x).length > 0);
  const fp = cleans.filter((x) => typesFor(x).length > 0);
  const byKind = (k: string) => secrets.filter((x) => x.l.tag.label === 'secret' && x.l.tag.kind === k);
  const vendor = byKind('vendor'), unstructured = byKind('unstructured');
  const caught = (xs: typeof secrets) => xs.filter((x) => typesFor(x).length > 0).length;
  const flaggedLines = tp.length + fp.length;

  const secretRows = secrets.map((x) => {
    const t = x.l.tag as Extract<CorpusLine['tag'], { label: 'secret' }>;
    const ty = typesFor(x);
    return `| ${t.what} | ${t.kind} | ${ty.length ? `yes (${ty.join(', ')})` : '**missed**'} |`;
  });
  const fpRows = fp.map((x) => {
    const t = x.l.tag as Extract<CorpusLine['tag'], { label: 'clean' }>;
    return `| ${t.hard ?? 'ordinary code'} | \`${x.file}\` | ${typesFor(x).join(', ')} |`;
  });

  const md = [
    '## GhostCommit (secrets in commit diffs)',
    '',
    `Labelled corpus of ${corpus.length} synthetic commits: ${secrets.length} lines with planted fake secrets and ${cleans.length} clean lines, ${hard.length} of them hard negatives that look like secrets (hashes, public keys, placeholders). Values are generated from a fixed seed, so runs are reproducible. A secret counts as detected if its line is flagged at all.`,
    '',
    '| Metric | Result |',
    '| --- | --- |',
    `| Recall, all planted secrets | **${tp.length}/${secrets.length} (${pct(tp.length, secrets.length)})** |`,
    `| Recall, vendor-format secrets (known prefix or shape) | ${caught(vendor)}/${vendor.length} (${pct(caught(vendor), vendor.length)}) |`,
    `| Recall, unstructured secrets (passwords, hex, random strings) | ${caught(unstructured)}/${unstructured.length} (${pct(caught(unstructured), unstructured.length)}) |`,
    `| False-positive rate, all clean lines | **${fp.length}/${cleans.length} (${pct(fp.length, cleans.length)})** |`,
    `| False-positive rate, hard negatives only | ${hard.filter((x) => typesFor(x).length > 0).length}/${hard.length} (${pct(hard.filter((x) => typesFor(x).length > 0).length, hard.length)}) |`,
    `| Precision (flagged lines that really are secrets) | ${tp.length}/${flaggedLines} (${pct(tp.length, flaggedLines)}) |`,
    '',
    '| Planted secret | Kind | Detected |',
    '| --- | --- | --- |',
    ...secretRows,
    '',
    fp.length ? '| False positive | File | Flagged as |\n| --- | --- | --- |\n' + fpRows.join('\n') : 'No false positives.',
  ].join('\n');
  return { md };
}

// ── Main ─────────────────────────────────────────────────────────────────

const sections: string[] = [];
let pass = true;
if (only !== 'ghostcommit') {
  const d = await runDepChainBenchmark();
  sections.push(d.md);
  pass = d.pass;
}
if (only !== 'depchain') sections.push((await runGhostCommitBenchmark()).md);

const report = [
  '# SPECTER scanner benchmark',
  '',
  `Generated ${new Date().toISOString().slice(0, 10)} by \`npm run benchmark\`. DepChain results depend on OSV.dev's live data and can change as advisories are published; GhostCommit results are fully deterministic.`,
  '',
  ...sections.flatMap((s) => [s, '']),
].join('\n');

console.log(report);
if (write && !only) {
  writeFileSync(join(import.meta.dirname, 'RESULTS.md'), report);
  console.error('\nWrote scripts/benchmark/RESULTS.md');
}
if (!pass) {
  console.error('\nDepChain benchmark FAILED (see discrepancies above).');
  process.exit(1);
}
