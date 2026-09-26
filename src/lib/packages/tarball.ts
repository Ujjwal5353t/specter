import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

/*
 * Safe reading of an npm tarball (.tgz) that we do NOT trust.
 *
 * Nothing here ever executes package code or writes to disk: the archive is
 * decompressed into memory with a hard output cap (zip-bomb protection) and
 * parsed as plain bytes. File paths are only used as map keys, so a hostile
 * path ("../../etc/passwd", absolute paths, symlinks) has nothing to escape
 * into; such entries are skipped and counted.
 *
 * Failures come in two kinds so the caller can cache correctly:
 *   skipped  the tarball itself is unusable and always will be (too big,
 *            corrupt): deterministic, safe to remember.
 *   failed   we just couldn't fetch it right now (network, 5xx): retry later.
 */

const gunzipAsync = promisify(gunzip);

export const TARBALL_LIMITS = {
  maxDownloadBytes: 5 * 1024 * 1024,
  maxUnpackedBytes: 25 * 1024 * 1024,
  maxFiles: 3000,
  maxTextFileBytes: 512 * 1024,
  timeoutMs: 15_000,
} as const;

const TRUSTED_ORIGIN = 'https://registry.npmjs.org';

export interface TarFile {
  size: number;
  sha256: string;
  /** File contents when it is a readable text file within the size cap, else null. */
  text: string | null;
}

export interface Tarball {
  /** Regular files, keyed by path with the leading "package/" folder removed. */
  files: Map<string, TarFile>;
  /** Entries dropped for an unsafe path (absolute, "..", NUL). */
  unsafeEntries: number;
}

export type TarballResult =
  | { ok: true; tarball: Tarball }
  | { ok: false; kind: 'skipped' | 'failed'; reason: string };

class TarError extends Error {}
class TooManyFiles extends Error {}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`;
const skipped = (reason: string): TarballResult => ({ ok: false, kind: 'skipped', reason });
const failed = (reason: string): TarballResult => ({ ok: false, kind: 'failed', reason });

/**
 * Downloads and unpacks one tarball. `unpackedSize` is the registry's own
 * dist.unpackedSize: a package declaring itself too big is skipped before any download.
 */
export async function fetchTarball(url: string, unpackedSize?: number): Promise<TarballResult> {
  const { maxDownloadBytes, maxUnpackedBytes, timeoutMs } = TARBALL_LIMITS;
  if (unpackedSize !== undefined && unpackedSize > maxUnpackedBytes) {
    return skipped(`declared unpacked size ${mb(unpackedSize)} exceeds the ${mb(maxUnpackedBytes)} limit`);
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return failed('invalid tarball url');
  }
  if (target.origin !== TRUSTED_ORIGIN) return failed('tarball is not served by the npm registry');

  let compressed: Buffer;
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok || !res.body) return failed(`registry returned ${res.status} for the tarball`);
    const declared = Number(res.headers.get('content-length'));
    if (declared > maxDownloadBytes) {
      await res.body.cancel();
      return skipped(`download of ${mb(declared)} exceeds the ${mb(maxDownloadBytes)} limit`);
    }
    // Read in chunks so an undeclared or lying content-length is still capped
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxDownloadBytes) {
        await reader.cancel();
        return skipped(`download exceeds the ${mb(maxDownloadBytes)} limit`);
      }
      chunks.push(value);
    }
    compressed = Buffer.concat(chunks);
  } catch (err) {
    return failed(`download failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return unpackTarball(compressed);
}

/** Decompresses (with an output cap) and parses a gzipped tar held in memory. */
export async function unpackTarball(compressed: Buffer): Promise<TarballResult> {
  let raw: Buffer;
  try {
    raw = await gunzipAsync(compressed, { maxOutputLength: TARBALL_LIMITS.maxUnpackedBytes });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      return skipped(`unpacks to more than ${mb(TARBALL_LIMITS.maxUnpackedBytes)} (possible zip bomb)`);
    }
    return skipped('malformed archive: not a valid gzip stream');
  }
  try {
    return { ok: true, tarball: parseTar(raw) };
  } catch (err) {
    if (err instanceof TooManyFiles) return skipped(`more than ${TARBALL_LIMITS.maxFiles} files`);
    if (err instanceof TarError) return skipped(`malformed archive: ${err.message}`);
    throw err;
  }
}

// ── tar parsing ──────────────────────────────────────────────────────────

const BLOCK = 512;

function cString(buf: Uint8Array, start: number, length: number): string {
  let end = start;
  const limit = start + length;
  while (end < limit && buf[end] !== 0) end++;
  return Buffer.from(buf.subarray(start, end)).toString('utf8');
}

function parseOctal(header: Uint8Array, start: number, length: number): number {
  // Bit 7 set means base-256 (sizes past 8 GB): far beyond our caps
  if (header[start] & 0x80) throw new TarError('unsupported size encoding');
  const n = parseInt(cString(header, start, length).trim() || '0', 8);
  if (Number.isNaN(n) || n < 0) throw new TarError('bad number in header');
  return n;
}

function checksumOk(header: Uint8Array): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
  try {
    return sum === parseOctal(header, 148, 8);
  } catch {
    return false;
  }
}

function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < BLOCK; i++) if (block[i] !== 0) return false;
  return true;
}

/** `path` record of a pax extended header ("<len> path=<value>\n"). */
function paxPath(data: Uint8Array): string | null {
  for (const record of Buffer.from(data).toString('utf8').split('\n')) {
    const eq = record.indexOf('=');
    if (eq > 0 && record.slice(record.indexOf(' ') + 1, eq) === 'path') return record.slice(eq + 1);
  }
  return null;
}

/** Path without its leading package folder, or null if it could escape or is nonsense. */
function normalizePath(name: string): string | null {
  if (!name || name.includes('\0')) return null;
  const parts = name.replace(/\\/g, '/').split('/');
  if (parts[0] === '' || /^[a-zA-Z]:$/.test(parts[0])) return null; // absolute
  if (parts.includes('..')) return null;
  const inner = parts.slice(1).filter((p) => p !== '' && p !== '.');
  if (inner.length === 0) return null;
  return inner.join('/');
}

const TEXT_EXT = /\.(?:[cm]?js|jsx|tsx?|json|sh|bash|zsh|ps1|bat|cmd|py)$/i;

function isTextPath(path: string): boolean {
  if (path.startsWith('node_modules/') || path.endsWith('.d.ts')) return false;
  if (TEXT_EXT.test(path)) return true;
  // Extensionless launchers (bin/cli) are code too
  const base = path.slice(path.lastIndexOf('/') + 1);
  return !base.includes('.') && (path.startsWith('bin/') || path.startsWith('scripts/'));
}

function describeFile(path: string, data: Uint8Array): TarFile {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  let text: string | null = null;
  if (isTextPath(path) && buf.length <= TARBALL_LIMITS.maxTextFileBytes && !buf.subarray(0, 8000).includes(0)) {
    text = buf.toString('utf8');
  }
  return { size: buf.length, sha256, text };
}

function parseTar(raw: Buffer): Tarball {
  const files = new Map<string, TarFile>();
  let unsafeEntries = 0;
  let offset = 0;
  let longName: string | null = null;
  let extendedPath: string | null = null;

  while (offset + BLOCK <= raw.length) {
    const header = raw.subarray(offset, offset + BLOCK);
    if (isZeroBlock(header)) break;
    if (!checksumOk(header)) throw new TarError('bad header checksum');

    const typeflag = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    const size = parseOctal(header, 124, 12);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > raw.length) throw new TarError('entry runs past the end of the archive');
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
    const data = raw.subarray(dataStart, dataEnd);

    if (typeflag === 'x') { extendedPath = paxPath(data); continue; }
    if (typeflag === 'g') continue;
    if (typeflag === 'L') { longName = cString(data, 0, data.length); continue; }

    let name = cString(header, 0, 100);
    const prefix = cString(header, 345, 155);
    if (prefix && cString(header, 257, 5) === 'ustar') name = `${prefix}/${name}`;
    name = extendedPath ?? longName ?? name;
    extendedPath = longName = null;

    // Directories, symlinks, hard links and devices carry nothing to read
    if (typeflag !== '0') continue;

    const path = normalizePath(name);
    if (path === null) { unsafeEntries++; continue; }
    if (files.size >= TARBALL_LIMITS.maxFiles) throw new TooManyFiles();
    files.set(path, describeFile(path, data));
  }
  return { files, unsafeEntries };
}
