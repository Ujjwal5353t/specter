import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit } from '@/lib/rateLimit';
import { MAX_BODY_BYTES } from './checkService';

/** Small helpers shared by the /api/v1/check routes. */

// Per IP per hour, tracked in the existing in-memory limiter (best-effort on
// serverless, and x-forwarded-for is trusted as-is, like /api/scan/start). A
// lockfile check fans out to many registry calls, so its budget is far lower.
export const CHECK_LIMIT_PER_HOUR = 120;
export const LOCKFILE_LIMIT_PER_HOUR = 10;

export function apiError(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/** Returns a 429 response when this IP is over `max` for `bucket`, else null. */
export function rateLimited(req: NextRequest, bucket: 'check' | 'lockfile', max: number) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  // Namespaced so these budgets don't drain the 5/hour repo-scan limit (or each other)
  if (rateLimit(`v1:${bucket}:${ip}`, max)) return null;
  return apiError(429, 'rate_limited', `Rate limit reached (${max} requests per hour per IP). Try again later.`);
}

/** Reads and parses a JSON body, refusing anything over the size cap. */
export async function readJsonBody(req: NextRequest): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const tooLarge = () =>
    ({ ok: false, response: apiError(413, 'body_too_large', `Request body must be at most ${MAX_BODY_BYTES / 1024 / 1024} MB.`) }) as const;

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();

  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return tooLarge();
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: apiError(400, 'invalid_json', 'Request body must be valid JSON.') };
  }
}
