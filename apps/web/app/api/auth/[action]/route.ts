import { NextRequest, NextResponse } from 'next/server';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL;

async function proxyToFunction(action: string, body: unknown) {
  if (!FUNCTIONS_URL) {
    return NextResponse.json({ error: 'SUPABASE_FUNCTIONS_URL is not configured' }, { status: 500 });
  }

  const response = await fetch(`${FUNCTIONS_URL}/auth/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

export async function POST(req: NextRequest, { params }: { params: { action: string } }) {
  return proxyToFunction(params.action, await req.json());
}
