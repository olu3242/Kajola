import { NextRequest } from 'next/server';
import { isLocalMode } from './local-mode';
import { getSessionUser } from './session';

export type RuntimeUser = {
  id: string;
  role: string;
  tenant_id: string | null;
  isPlatformOperator: boolean;
};

export async function getRuntimeUser(req: NextRequest): Promise<RuntimeUser | null> {
  if (isLocalMode) {
    const user = getSessionUser(req);
    return user ? { id: user.id, role: user.role, tenant_id: user.tenant_id, isPlatformOperator: user.role === 'admin' } : null;
  }
  const token = extractToken(req);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !url || !anonKey || !serviceKey) return null;

  const authResponse = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(4000),
  });
  if (!authResponse.ok) return null;
  const authUser = await authResponse.json() as { id?: string };
  if (!authUser.id) return null;
  const profileResponse = await fetch(`${url}/rest/v1/users?or=(auth_uid.eq.${encodeURIComponent(authUser.id)},id.eq.${encodeURIComponent(authUser.id)})&select=id,role,sorf_role,tenant_id&limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, cache: 'no-store', signal: AbortSignal.timeout(4000),
  });
  if (!profileResponse.ok) return null;
  const profiles = await profileResponse.json() as Array<{ id: string; role: string; sorf_role?: string; tenant_id: string | null }>;
  const profile = profiles[0];
  if (!profile) return null;
  const role = profile.sorf_role ?? profile.role;
  return { id: profile.id, role, tenant_id: profile.tenant_id, isPlatformOperator: role === 'super_admin' };
}

function extractToken(req: NextRequest) {
  const authorization = req.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  const cookie = req.cookies.get('kajola-session')?.value;
  if (!cookie) return null;
  try { return String(JSON.parse(cookie)?.access_token ?? '') || null; } catch { return null; }
}
