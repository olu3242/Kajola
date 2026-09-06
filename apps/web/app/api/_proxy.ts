import { NextRequest, NextResponse } from 'next/server';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL;
const SESSION_COOKIE = 'kajola-session';

function extractToken(req: NextRequest): string | null {
  // Prefer Authorization header (for non-browser API clients)
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);

  // Fall back to session cookie
  const cookie = req.cookies.get(SESSION_COOKIE);
  if (cookie?.value) {
    try {
      const parsed = JSON.parse(cookie.value);
      return parsed?.access_token ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function forwardToFunction(path: string, req: NextRequest) {
  if (!FUNCTIONS_URL) {
    return NextResponse.json({ code: 'DEPENDENCY_UNAVAILABLE', error: 'Backend service not configured' }, { status: 503 });
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = extractToken(req);
  if (token) headers.set('authorization', `Bearer ${token}`);

  // Forward webhook signature headers verbatim
  const paystackSig = req.headers.get('x-paystack-signature');
  if (paystackSig) headers.set('x-paystack-signature', paystackSig);

  try {
    const response = await fetch(`${FUNCTIONS_URL}/${path}`, {
      method:  req.method,
      headers,
      body:    req.method === 'GET' ? undefined : await req.text(),
    });
    const data = await response.json().catch(() => ({ error: 'Invalid upstream response' }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ code: 'DEPENDENCY_UNAVAILABLE', error: 'Service unavailable' }, { status: 503 });
  }
}

export async function forwardToFunctionWithQuery(path: string, req: NextRequest) {
  if (!FUNCTIONS_URL) {
    return NextResponse.json({ code: 'DEPENDENCY_UNAVAILABLE', error: 'Backend service not configured' }, { status: 503 });
  }

  const url   = new URL(req.url);
  const query = url.searchParams.toString();
  const headers = new Headers();
  const token = extractToken(req);
  if (token) headers.set('authorization', `Bearer ${token}`);

  try {
    const response = await fetch(
      `${FUNCTIONS_URL}/${path}${query ? `?${query}` : ''}`,
      { method: req.method, headers }
    );
    const data = await response.json().catch(() => ({ error: 'Invalid upstream response' }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ code: 'DEPENDENCY_UNAVAILABLE', error: 'Service unavailable' }, { status: 503 });
  }
}
