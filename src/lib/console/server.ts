import { supabaseAdmin } from '@/lib/supabase';
import { resultFromStatus, type ScanStatusResponse } from '@/store/scanStore';
import type { ScanResult } from '@/types';

// Must match the TTL /run writes into scan_cache.expires_at (see /status).
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface ScanRow {
  id: string;
  repo_url: string;
  repo_owner: string;
  repo_name: string;
  status: 'pending' | 'scanning' | 'completed' | 'failed';
  threat_score: number | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  from_cache?: boolean;
}

export interface ScanContext {
  scan: ScanRow;
  /** Engine results while the 6h cache for this repo is fresh; null once expired. */
  result: ScanResult | null;
  scannedAt: string | null;
}

/**
 * Loads a scan and — exactly like /api/scan/[scanId]/status — its engine
 * results from scan_cache, only while that cache is fresh.
 */
export async function loadScanContext(scanId: string): Promise<ScanContext | null> {
  if (!/^[0-9a-f-]{36}$/i.test(scanId)) return null;
  const { data: scan } = await supabaseAdmin.from('scans').select('*').eq('id', scanId).maybeSingle();
  if (!scan) return null;
  const { data: cache } = await supabaseAdmin
    .from('scan_cache')
    .select('*')
    .eq('repo_url', scan.repo_url)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  const scannedAt = cache ? new Date(new Date(cache.expires_at).getTime() - CACHE_TTL_MS).toISOString() : null;
  const result = scan.status === 'completed' && cache
    ? resultFromStatus(scanId, { scan, cache, scannedAt } as ScanStatusResponse)
    : null;
  return { scan: scan as ScanRow, result, scannedAt };
}

export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/** Tiny per-instance TTL cache for GitHub lookups the views make. */
const memo = new Map<string, { at: number; value: unknown }>();
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  if (memo.size > 500) memo.delete(memo.keys().next().value!);
  memo.set(key, { at: Date.now(), value });
  return value;
}

/** Masks credential-shaped tokens before source text leaves the server. */
const TOKEN_RE = /(AKIA[0-9A-Z]{16}|sk_live_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9_]{30,}|sk-(?:ant-|or-v1-)?[A-Za-z0-9\-_]{24,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}|(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+)/g;
export function maskTokens(text: string): string {
  return text.replace(TOKEN_RE, (m) => `${m.slice(0, 6)}••••••••`);
}
