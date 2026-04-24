import { serve, json, errorResponse, createSupabaseClient, getEnv } from '../_shared.ts';
import { create, getNumericDate, verify, Payload } from 'https://deno.land/x/djwt@v2.12/mod.ts';

const JWT_SECRET = getEnv('SUPABASE_JWT_SECRET');
const ACCESS_TOKEN_TTL_SECONDS = 60 * 15;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const OTP_TTL_SECONDS = 60 * 10;

serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/auth\/?/, '');
  const method = req.method.toUpperCase();

  try {
    if (method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    const body = await req.json();
    const supabase = createSupabaseClient();

    switch (path) {
      case 'signup':
        return await handleSignup(supabase, body);
      case 'login':
        return await handleLogin(supabase, body);
      case 'logout':
        return await handleLogout(body);
      case 'refresh':
        return await handleRefresh(body);
      case 'send-otp':
        return await handleSendOtp(supabase, body);
      default:
        return errorResponse('Unknown auth action', 404);
    }
  } catch (err) {
    console.error(err);
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500);
  }
});

function getSigningKey() {
  return new TextEncoder().encode(JWT_SECRET);
}

async function signJwt(payload: Payload, expiresInSeconds: number) {
  return await create({ alg: 'HS256', typ: 'JWT' }, { ...payload, exp: getNumericDate(expiresInSeconds) }, getSigningKey());
}

async function verifyJwt(token: string) {
  try {
    return await verify(token, getSigningKey()) as Payload;
  } catch {
    return null;
  }
}

async function createTokens(user: any) {
  const access_token = await signJwt({ sub: user.id, role: user.role, tenant_id: user.tenant_id, type: 'access' }, ACCESS_TOKEN_TTL_SECONDS);
  const refresh_token = await signJwt({ sub: user.id, role: user.role, tenant_id: user.tenant_id, type: 'refresh' }, REFRESH_TOKEN_TTL_SECONDS);
  return { access_token, refresh_token };
}

async function validateOtp(supabase: ReturnType<typeof createSupabaseClient>, phone: string, code: string, purpose: string) {
  const now = new Date().toISOString();
  const { data: otp, error } = await supabase
    .from('auth_otps')
    .select('*')
    .eq('phone', phone)
    .eq('code', code)
    .eq('purpose', purpose)
    .eq('is_used', false)
    .gte('expires_at', now)
    .single();

  if (error || !otp) {
    return false;
  }

  await supabase.from('auth_otps').update({ is_used: true }).eq('id', otp.id);
  return true;
}

async function createOtp(supabase: ReturnType<typeof createSupabaseClient>, phone: string, purpose: string) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

  await supabase.from('auth_otps').insert({
    phone,
    code,
    purpose,
    expires_at: expiresAt,
    metadata: {}
  });

  return code;
}

async function handleSendOtp(supabase: ReturnType<typeof createSupabaseClient>, body: any) {
  const { phone, purpose = 'login' } = body;
  if (!phone) {
    return errorResponse('phone is required', 400);
  }

  const code = await createOtp(supabase, phone, purpose);

  // TODO: integrate with SMS / WhatsApp provider for real OTP delivery.
  return json({ sent: true, debug_code: code });
}

async function handleSignup(supabase: ReturnType<typeof createSupabaseClient>, body: any) {
  const { phone, otp_code, full_name, email, tenant_slug } = body;
  if (!phone || !otp_code) {
    return errorResponse('phone and otp_code are required', 400);
  }

  if (!(await validateOtp(supabase, phone, otp_code, 'signup'))) {
    return errorResponse('Invalid or expired OTP', 401);
  }

  const { data: existingUser } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .single();

  if (existingUser) {
    return errorResponse('Phone number is already registered', 409);
  }

  const tenant = tenant_slug
    ? await supabase.from('tenants').select('*').eq('slug', tenant_slug).single()
    : null;

  const tenantId = tenant_slug ? tenant.data?.id : null;
  const authUid = crypto.randomUUID();

  const { data: user, error } = await supabase.from('users').insert({
    tenant_id: tenantId,
    auth_uid: authUid,
    role: 'client',
    phone,
    email,
    full_name,
    is_active: true,
    metadata: {}
  }).select().single();

  if (error || !user) {
    return errorResponse(error?.message ?? 'Failed to create user', 500);
  }

  const tokens = await createTokens(user);
  return json({ user, ...tokens });
}

async function handleLogin(supabase: ReturnType<typeof createSupabaseClient>, body: any) {
  const { phone, otp_code } = body;
  if (!phone || !otp_code) {
    return errorResponse('phone and otp_code are required', 400);
  }

  if (!(await validateOtp(supabase, phone, otp_code, 'login'))) {
    return errorResponse('Invalid or expired OTP', 401);
  }

  const { data: user, error } = await supabase.from('users').select('*').eq('phone', phone).single();
  if (error || !user) {
    return errorResponse('Invalid phone or OTP', 401);
  }

  const tokens = await createTokens(user);
  return json({ user, ...tokens });
}

async function handleLogout(body: any) {
  return json({ success: true });
}

async function handleRefresh(body: any) {
  const { refresh_token } = body;
  if (!refresh_token) {
    return errorResponse('refresh_token is required', 400);
  }

  const payload = await verifyJwt(refresh_token);
  if (!payload || payload.type !== 'refresh') {
    return errorResponse('Invalid refresh token', 401);
  }

  const userId = payload.sub as string;
  const { data: user, error } = await createSupabaseClient().from('users').select('*').eq('id', userId).single();
  if (error || !user) {
    return errorResponse('User not found', 401);
  }

  const tokens = await createTokens(user);
  return json(tokens);
}
