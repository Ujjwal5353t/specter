import { after, NextResponse, type NextRequest } from 'next/server';
import { checkPackage, isValidPackageName, isValidVersion } from '@/lib/packages/checkService';
import { apiError, CHECK_LIMIT_PER_HOUR, rateLimited, readJsonBody } from '@/lib/packages/http';
import { parseCooldownOptions } from '@/lib/packages/cooldown';

export const maxDuration = 60;

/**
 * POST /api/v1/check
 *
 * Body: { name, version, minReleaseAgeHours?, strict?, allow? }
 *
 * minReleaseAgeHours (number, optional, default off)
 *   Minimum age in hours a version must be. A version newer than this returns
 *   warn (or block when strict=true) with signal type "too_new" and reason
 *   "too_new". Pass 0 or omit to disable the cooldown.
 *
 * strict (boolean, optional, default false)
 *   When true and the cooldown fires, the verdict is "block" instead of "warn".
 *
 * allow (string[], optional)
 *   Exact "name@version" entries that bypass the cooldown check. When a package
 *   is on this list the response includes "allowlisted": "<name@version>" so the
 *   caller can print the override.
 *
 * Response: { verdict, score, signals[], analyzedAt, allowlisted? }
 *   or       { ..., retryAfterSeconds: 10 }  with status 202 when still analysing.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimited(req, 'check', CHECK_LIMIT_PER_HOUR);
  if (limited) return limited;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const raw = (body.value ?? {}) as Record<string, unknown>;

  const { name, version } = raw as { name?: unknown; version?: unknown };

  if (!isValidPackageName(name)) {
    return apiError(400, 'invalid_name', '`name` must be a valid npm package name, e.g. "lodash" or "@scope/pkg".');
  }
  if (!isValidVersion(version)) {
    return apiError(400, 'invalid_version', '`version` must be one exact semver version, e.g. "4.17.21" (no ranges or tags).');
  }

  // Parse optional cooldown options; fail fast on bad input so the user gets a
  // clear error rather than silently ignoring unknown fields.
  const cooldownParsed = parseCooldownOptions(raw);
  if (!cooldownParsed.ok) return apiError(400, cooldownParsed.error, cooldownParsed.message);
  const { opts: cooldown } = cooldownParsed;

  const out = await checkPackage(name as string, version as string, undefined, cooldown);
  if (out.kind === 'not_found') {
    return apiError(404, 'version_not_found', `${name}@${version} is not published on the npm registry and no advisory is known for it.`);
  }
  if (out.kind === 'pending') {
    // Let the analysis finish after the response so the retry is a cache read
    after(() => out.background);
    return NextResponse.json({ ...out.check, retryAfterSeconds: 10 }, { status: 202 });
  }
  return NextResponse.json(out.check);
}

