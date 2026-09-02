import { NextRequest, NextResponse } from 'next/server';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL;
const COOKIE_NAME   = 'kajola-session';
const COOKIE_OPTS   = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path:     '/',
  maxAge:   60 * 60 * 24 * 7, // 7 days
};

async function proxyToFunction(action: string, body: unknown, req: NextRequest) {
  if (!FUNCTIONS_URL) {
    return NextResponse.json({ error: 'Auth service not configured' }, { status: 500 });
  }

  const upstream = await fetch(`${FUNCTIONS_URL}/auth/${action}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  const data = await upstream.json().catch(() => ({ error: 'Invalid upstream response' }));
  const res  = NextResponse.json(data, { status: upstream.status });

  if (action === 'login' && upstream.ok && data.access_token) {
    // Set session as httpOnly cookie so middleware can check it
    const sessionPayload = JSON.stringify({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
    });
    res.cookies.set(COOKIE_NAME, sessionPayload, COOKIE_OPTS);

    // Strip tokens from the JSON body — callers should rely on cookies
    return NextResponse.json(
      { ok: true, user: data.user },
      { status: 200, headers: res.headers }
    );
  }

  if (action === 'logout') {
    // Clear the session cookie
    res.cookies.set(COOKIE_NAME, '', { ...COOKIE_OPTS, maxAge: 0 });
  }

  return res;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { action: string } }
) {
  return proxyToFunction(params.action, await req.json(), req);
}
