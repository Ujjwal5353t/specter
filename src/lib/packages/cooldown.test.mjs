// Acceptance tests for resolveCooldown logic (issue #42)
// Run with: node src/lib/packages/cooldown.test.mjs

const resolveCooldown = (name, version, publishedAt, now, opts) => {
  const minHours = opts.minReleaseAgeHours ?? 0;
  if (minHours <= 0) return { kind: 'pass' };
  const minAgeMs = minHours * 60 * 60 * 1000;
  const target = `${name}@${version}`.trim();
  for (const entry of (opts.allow ?? [])) {
    if (entry.trim() === target) return { kind: 'allowed', entry };
  }
  const ageMs = publishedAt !== null ? now - publishedAt : 0;
  if (ageMs >= minAgeMs) return { kind: 'pass' };
  return { kind: 'held', ageMs, minAgeMs };
};

let passed = 0; let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓  ${msg}`); passed++; }
  else       { console.error(`  ✗  ${msg}`); failed++; }
}

const now = Date.now();
const thirtyMinAgo = now - 30 * 60 * 1000;
const twoDaysAgo   = now - 2 * 24 * 60 * 60 * 1000;

console.log('\nCooldown acceptance tests — issue #42\n');

// Acceptance criterion 1: 30-min old held with 24h cooldown
const r1 = resolveCooldown('foo', '1.0.0', thirtyMinAgo, now, { minReleaseAgeHours: 24 });
assert(r1.kind === 'held', `30-min version → held (got ${r1.kind})`);
assert(r1.kind === 'held' && r1.ageMs === 30 * 60 * 1000, `  ageMs === 30 min in ms (got ${r1?.ageMs})`);

// 2-day-old version passes
const r2 = resolveCooldown('foo', '1.0.0', twoDaysAgo, now, { minReleaseAgeHours: 24 });
assert(r2.kind === 'pass', `2-day version → pass (got ${r2.kind})`);

// Acceptance criterion 2: allowlisted version bypasses cooldown
const r3 = resolveCooldown('foo', '1.0.0', thirtyMinAgo, now, { minReleaseAgeHours: 24, allow: ['foo@1.0.0'] });
assert(r3.kind === 'allowed', `allowlisted → allowed (got ${r3.kind})`);
assert(r3.kind === 'allowed' && r3.entry === 'foo@1.0.0', `  entry is "foo@1.0.0" (got ${r3?.entry})`);

// Feature off by default (no minReleaseAgeHours)
const r4 = resolveCooldown('bar', '2.0.0', thirtyMinAgo, now, {});
assert(r4.kind === 'pass', `feature off → pass (got ${r4.kind})`);

// Unknown publish time → held (unknown = treat as new)
const r5 = resolveCooldown('baz', '1.0.0', null, now, { minReleaseAgeHours: 24 });
assert(r5.kind === 'held', `unknown publish time → held (got ${r5.kind})`);

// Scoped package allowlist
const r6 = resolveCooldown('@scope/pkg', '1.0.0', thirtyMinAgo, now, { minReleaseAgeHours: 24, allow: ['@scope/pkg@1.0.0'] });
assert(r6.kind === 'allowed', `scoped package allowlist (got ${r6.kind})`);

// Allowlist entry must be exact version — different version not matched
const r7 = resolveCooldown('foo', '2.0.0', thirtyMinAgo, now, { minReleaseAgeHours: 24, allow: ['foo@1.0.0'] });
assert(r7.kind === 'held', `wrong allowlist version → still held (got ${r7.kind})`);

// strict mode: held result is the same (block verdict applied by analyze.ts)
const r8 = resolveCooldown('foo', '1.0.0', thirtyMinAgo, now, { minReleaseAgeHours: 24, strict: true });
assert(r8.kind === 'held', `strict mode → still held by resolveCooldown (signal severity set by caller) (got ${r8.kind})`);

// Exactly at boundary (old enough by 1ms)
const r9 = resolveCooldown('foo', '1.0.0', now - 24 * 3600 * 1000 - 1, now, { minReleaseAgeHours: 24 });
assert(r9.kind === 'pass', `exactly at boundary → pass (got ${r9.kind})`);

// 1ms short of boundary
const r10 = resolveCooldown('foo', '1.0.0', now - 24 * 3600 * 1000 + 1, now, { minReleaseAgeHours: 24 });
assert(r10.kind === 'held', `1ms short of boundary → held (got ${r10.kind})`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
