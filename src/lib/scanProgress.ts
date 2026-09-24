import { supabaseAdmin } from '@/lib/supabase';
import type { ScannerKey, ScannerProgress } from '@/types';

export type ProgressFn = (detail: string) => void;

type ProgressRow = Partial<ScannerProgress> & { scan_id: string; scanner: ScannerKey };

// Mid-run step updates are throttled to this, so a chatty scanner can't
// flood the database; the loader polls at roughly the same rate anyway.
const STEP_WRITE_INTERVAL_MS = 1000;

/**
 * Progress is best effort: a failed write (e.g. scan_progress not migrated
 * yet) is logged and never affects the scan itself.
 */
async function writeProgress(row: ProgressRow): Promise<void> {
  const { error } = await supabaseAdmin.from('scan_progress').upsert(row, { onConflict: 'scan_id,scanner' });
  if (error) console.warn(`scan_progress write failed (${row.scanner}):`, error.message);
}

/** Marks every scanner as running, so the loader shows all rows from the start. */
export async function startProgress(scanId: string, scanners: ScannerKey[]): Promise<void> {
  const started_at = new Date().toISOString();
  const { error } = await supabaseAdmin.from('scan_progress').upsert(
    scanners.map((scanner) => ({
      scan_id: scanId, scanner, status: 'running', detail: null,
      finding_count: null, started_at, duration_ms: null,
    })),
    { onConflict: 'scan_id,scanner' },
  );
  if (error) console.warn('scan_progress init failed:', error.message);
}

/**
 * Runs one scanner and records its progress: step details while it runs
 * (via the onProgress callback it receives), then done/failed with a
 * summary and duration. Resolves or rejects exactly like the scanner.
 */
export async function trackScanner<T>(
  scanId: string,
  scanner: ScannerKey,
  run: (onProgress: ProgressFn) => Promise<T>,
  summarize: (result: T) => { detail: string; count: number },
): Promise<T> {
  const started = Date.now();
  // Writes are chained so a late step update can never land after (and
  // overwrite) the final done/failed row.
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (row: Omit<ProgressRow, 'scan_id' | 'scanner'>) => {
    chain = chain.then(() => writeProgress({ scan_id: scanId, scanner, ...row }));
  };

  let finished = false;
  let latest: string | null = null;
  let lastWrite = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onProgress: ProgressFn = (detail) => {
    if (finished) return;
    latest = detail;
    if (timer) return;
    // Trailing throttle: the newest step is always written, at most once a second.
    timer = setTimeout(() => {
      timer = null;
      if (finished || latest === null) return;
      lastWrite = Date.now();
      enqueue({ status: 'running', detail: latest });
    }, Math.max(0, lastWrite + STEP_WRITE_INTERVAL_MS - Date.now()));
  };

  const finish = () => {
    finished = true;
    if (timer) clearTimeout(timer);
  };

  try {
    const result = await run(onProgress);
    finish();
    const { detail, count } = summarize(result);
    enqueue({ status: 'done', detail, finding_count: count, duration_ms: Date.now() - started });
    await chain;
    return result;
  } catch (err) {
    finish();
    enqueue({ status: 'failed', detail: 'could not finish', duration_ms: Date.now() - started });
    await chain;
    throw err;
  }
}
