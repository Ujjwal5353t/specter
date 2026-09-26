import { after, NextResponse, type NextRequest } from 'next/server';
import { checkLockfile, MAX_LOCKFILE_PACKAGES } from '@/lib/packages/checkService';
import { apiError, LOCKFILE_LIMIT_PER_HOUR, rateLimited, readJsonBody } from '@/lib/packages/http';
import { LockfileError, parseLockfile } from '@/lib/packages/lockfile';

export const maxDuration = 60;

// POST /api/v1/check/lockfile  <package-lock.json v2/v3>
//   →  { verdict, complete, counts, checked, skipped, packages[], analyzedAt }
export async function POST(req: NextRequest) {
  const limited = rateLimited(req, 'lockfile', LOCKFILE_LIMIT_PER_HOUR);
  if (limited) return limited;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  let parsed;
  try {
    parsed = parseLockfile(body.value);
  } catch (err) {
    if (err instanceof LockfileError) return apiError(400, 'invalid_lockfile', err.message);
    throw err;
  }
  if (parsed.packages.length > MAX_LOCKFILE_PACKAGES) {
    return apiError(413, 'too_many_packages', `Lockfile lists ${parsed.packages.length} packages; the limit is ${MAX_LOCKFILE_PACKAGES}.`);
  }

  const { result, background } = await checkLockfile(parsed.packages);
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
