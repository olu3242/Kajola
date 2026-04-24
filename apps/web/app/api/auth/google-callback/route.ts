import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const user = body.user;
  if (!user || !user.id) {
    return NextResponse.json({ error: 'Invalid Google user payload' }, { status: 400 });
  }

  const response = await fetch(`${process.env.SUPABASE_FUNCTIONS_URL}/auth/google-callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user })
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
