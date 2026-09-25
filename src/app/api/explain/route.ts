import { NextRequest, NextResponse } from 'next/server';
import { explainFindings, AINotConfiguredError } from '@/lib/ai';

export async function POST(req: NextRequest) {
  let findings: unknown;
  try {
    ({ findings } = await req.json());
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  if (!Array.isArray(findings)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    const result = await explainFindings(findings);
    return NextResponse.json(result);
  } catch (e) {
    // No key set is a config state the UI shows quietly; a failed call is worth a retry.
    if (e instanceof AINotConfiguredError) {
      return NextResponse.json({ error: 'ai_not_configured' }, { status: 503 });
    }
    const detail = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: 'ai_failed', detail }, { status: 502 });
  }
}
