import { after, NextResponse, type NextRequest } from 'next/server';
import { checkPackage, isValidPackageName, isValidVersion } from '@/lib/packages/checkService';
import { apiError, CHECK_LIMIT_PER_HOUR, rateLimited, readJsonBody } from '@/lib/packages/http';

export const maxDuration = 60;

// POST /api/v1/check  { name, version }  →  { verdict, score, signals[], analyzedAt }
export async function POST(req: NextRequest) {
  const limited = rateLimited(req, 'check', CHECK_LIMIT_PER_HOUR);
  if (limited) return limited;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const { name, version } = (body.value ?? {}) as { name?: unknown; version?: unknown };

  if (!isValidPackageName(name)) {
    return apiError(400, 'invalid_name', '`name` must be a valid npm package name, e.g. "lodash" or "@scope/pkg".');
  }
  if (!isValidVersion(version)) {
    return apiError(400, 'invalid_version', '`version` must be one exact semver version, e.g. "4.17.21" (no ranges or tags).');
  }

  const out = await checkPackage(name, version);
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
