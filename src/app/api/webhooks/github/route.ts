import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { appOrigin, createAndRunScan } from '@/lib/scanTrigger';

export const maxDuration = 60;

// GitHub signs each delivery with the secret configured on the webhook:
// X-Hub-Signature-256: sha256=<hex hmac of the raw body>
function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

interface PushPayload {
  ref?: string;
  after?: string;
  deleted?: boolean;
  pusher?: { name?: string };
  head_commit?: { id?: string; message?: string } | null;
  repository?: {
    name?: string;
    private?: boolean;
    default_branch?: string;
    owner?: { login?: string; name?: string };
  };
}

export async function POST(req: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  // Signature is over the exact bytes GitHub sent, so read raw text before parsing
  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers.get('x-hub-signature-256'), secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = req.headers.get('x-github-event');
  if (event === 'ping') return NextResponse.json({ ok: true, pong: true });
  if (event !== 'push') return NextResponse.json({ ok: true, ignored: `event ${event}` });

  let payload: PushPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const repository = payload.repository;
  const owner = repository?.owner?.login ?? repository?.owner?.name;
  const repo = repository?.name;
  if (!owner || !repo) return NextResponse.json({ error: 'Missing repository' }, { status: 400 });

  // Scanners read the default branch, so other branches wouldn't change the result.
  // Non-2xx responses make GitHub mark the delivery failed, so skips return 200.
  if (payload.deleted) return NextResponse.json({ ok: true, ignored: 'branch deleted' });
  if (repository?.private) return NextResponse.json({ ok: true, ignored: 'private repository' });
  if (repository?.default_branch && payload.ref !== `refs/heads/${repository.default_branch}`) {
    return NextResponse.json({ ok: true, ignored: `push to ${payload.ref}, not default branch` });
  }

  // Deliberately skips the 6h scan_cache: a push is exactly when the cache is stale
  const result = await createAndRunScan(owner, repo, appOrigin(req.nextUrl?.origin), {
    source: 'github-push',
    commitSha: payload.head_commit?.id ?? payload.after,
    commitMessage: payload.head_commit?.message,
    pusher: payload.pusher?.name,
    ref: payload.ref,
  });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({ ok: true, scanId: result.scanId }, { status: 202 });
}
