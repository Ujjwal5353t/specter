import { NextRequest, NextResponse } from 'next/server';
import { explainFindings } from '@/lib/ai';

export async function POST(req: NextRequest) {
  try {
    const { findings } = await req.json();
    const result = await explainFindings(findings);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}