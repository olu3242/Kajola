import { serve } from 'https://deno.land/std@0.205.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.30.0';
import { verify, Payload } from 'https://deno.land/x/djwt@v2.12/mod.ts';

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function errorResponse(message: string, status = 400) {
  return json({ error: message }, status);
}

export function getEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

const JWT_SECRET = getEnv('SUPABASE_JWT_SECRET');

function getJwtKey() {
  return new TextEncoder().encode(JWT_SECRET);
}

export async function authenticateRequest(req: Request) {
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Authorization header missing');
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');
  try {
    const payload = await verify(token, getJwtKey()) as Payload;
    if (!payload || payload.type !== 'access' || !payload.sub) {
      throw new Error('Invalid access token');
    }
    return payload;
  } catch (error) {
    throw new Error('Invalid access token');
  }
}

export function createSupabaseClient(): SupabaseClient {
  const url = getEnv('SUPABASE_URL');
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

export { serve };
