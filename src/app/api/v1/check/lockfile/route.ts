import { after, NextResponse, type NextRequest } from 'next/server';
import { checkLockfile, MAX_LOCKFILE_PACKAGES } from '@/lib/packages/checkService';
import { apiError, LOCKFILE_LIMIT_PER_HOUR, rateLimited, readJsonBody } from '@/lib/packages/http';
import { LockfileError, parseLockfile } from '@/lib/packages/lockfile';
import { parseCooldownOptions } from '@/lib/packages/cooldown';

export const maxDuration = 60;

/**
 * POST /api/v1/check/lockfile
 *
 * Body: { lockfile: <package-lock.json v2/v3 object>, minReleaseAgeHours?, strict?, allow? }
 *
 * The cooldown options (minReleaseAgeHours, strict, allow) are the same as for
 * POST /api/v1/check and are applied individually to every package in the lockfile.
 * An allow-listed package is marked with "allowlisted" in its entry so the caller
 * can display the override in CI output or CLI summaries.
 *
 * Response: { verdict, complete, counts, checked, skipped, packages[], analyzedAt }
 *   status 200 when complete, 202 when some packages are still pending.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimited(req, 'lockfile', LOCKFILE_LIMIT_PER_HOUR);
  if (limited) return limited;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  // The body can be either the raw lockfile JSON (legacy) or a wrapper object
  // { lockfile: <...>, minReleaseAgeHours?, ... } when cooldown options are used.
  // We detect the wrapper by checking whether the body has a `lockfile` key.
  const raw = body.value as Record<string, unknown>;
  const isWrapped = raw !== null && typeof raw === 'object' && !Array.isArray(raw) && 'lockfile' in raw;
  const lockfileValue = isWrapped ? raw['lockfile'] : body.value;

  let parsed;
  try {
    parsed = parseLockfile(lockfileValue);
  } catch (err) {
    if (err instanceof LockfileError) return apiError(400, 'invalid_lockfile', err.message);
    throw err;
  }
  if (parsed.packages.length > MAX_LOCKFILE_PACKAGES) {
    return apiError(413, 'too_many_packages', `Lockfile lists ${parsed.packages.length} packages; the limit is ${MAX_LOCKFILE_PACKAGES}.`);
  }

  // Parse cooldown options from the wrapper object (no-op when the body is the raw lockfile)
  const cooldownParsed = parseCooldownOptions(isWrapped ? raw : {});
  if (!cooldownParsed.ok) return apiError(400, cooldownParsed.error, cooldownParsed.message);
  const { opts: cooldown } = cooldownParsed;

  const { result, background } = await checkLockfile(parsed.packages, undefined, cooldown);
  if (!result.complete) after(() => background);

  return NextResponse.json(
    {
      ...result,
      checked: parsed.packages.length,
      skipped: parsed.skipped,
      analyzedAt: new Date().toISOString(),
    },
    { status: result.complete ? 200 : 202 },
  );
}

