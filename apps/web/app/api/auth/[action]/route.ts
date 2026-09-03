import { NextRequest, NextResponse } from 'next/server';
import { isLocalMode } from '@/lib/local-mode';
import { handleLogin } from '@/lib/local-handlers';

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
    const sessionPayload = JSON.stringify({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
    });
    res.cookies.set(COOKIE_NAME, sessionPayload, COOKIE_OPTS);

    return NextResponse.json(
      { ok: true, user: data.user },
      { status: 200, headers: res.headers }
    );
  }

  if (action === 'logout') {
    res.cookies.set(COOKIE_NAME, '', { ...COOKIE_OPTS, maxAge: 0 });
  }

  return res;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { action: string } }
) {
  const action = params.action;

  if (isLocalMode) {
    if (action === 'send-otp') {
      return NextResponse.json({ ok: true, message: 'OTP sent (test: 123456)' });
    }

    if (action === 'login') {
      const body = await req.json();
      // Accept both `otp_code` (frontend) and `otp` (tests)
      const result = await handleLogin({ phone: body.phone, otp: body.otp_code ?? body.otp ?? '' });
      if (!result.ok || !result.user) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 401 });
      }
      const user = result.user;
      const accessToken = `local:${user.id}:${user.role}`;
      const sessionPayload = JSON.stringify({ access_token: accessToken, refresh_token: '' });
      const res = NextResponse.json({ ok: true, user });
      res.cookies.set(COOKIE_NAME, sessionPayload, COOKIE_OPTS);
      return res;
    }

    if (action === 'logout') {
      const res = NextResponse.json({ ok: true });
      res.cookies.set(COOKIE_NAME, '', { ...COOKIE_OPTS, maxAge: 0 });
      return res;
    }

    return NextResponse.json({ error: 'Unknown auth action' }, { status: 400 });
  }

  return proxyToFunction(action, await req.json(), req);
}
