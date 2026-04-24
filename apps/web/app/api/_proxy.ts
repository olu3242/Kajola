import { NextRequest, NextResponse } from 'next/server';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL;

export async function forwardToFunction(path: string, req: NextRequest) {
  if (!FUNCTIONS_URL) {
    return NextResponse.json({ error: 'SUPABASE_FUNCTIONS_URL is not configured' }, { status: 500 });
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  const auth = req.headers.get('authorization');
  if (auth) {
    headers.set('authorization', auth);
  }

  const response = await fetch(`${FUNCTIONS_URL}/${path}`, {
    method: req.method,
    headers,
    body: req.method === 'GET' ? undefined : await req.text()
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

export async function forwardToFunctionWithQuery(path: string, req: NextRequest) {
  if (!FUNCTIONS_URL) {
    return NextResponse.json({ error: 'SUPABASE_FUNCTIONS_URL is not configured' }, { status: 500 });
  }

  const url = new URL(req.url);
  const query = url.searchParams.toString();
  const headers = new Headers();
  const auth = req.headers.get('authorization');
  if (auth) {
    headers.set('authorization', auth);
  }

  const response = await fetch(`${FUNCTIONS_URL}/${path}${query ? `?${query}` : ''}`, {
    method: req.method,
    headers
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
