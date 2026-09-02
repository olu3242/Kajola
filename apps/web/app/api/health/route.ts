import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const checks: Record<string, 'ok' | 'missing'> = {
    supabase_url:      process.env.NEXT_PUBLIC_SUPABASE_URL  ? 'ok' : 'missing',
    supabase_anon_key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'ok' : 'missing',
    functions_url:     process.env.SUPABASE_FUNCTIONS_URL ? 'ok' : 'missing',
    paystack_key:      process.env.PAYSTACK_SECRET_KEY ? 'ok' : 'missing',
    anthropic_key:     process.env.ANTHROPIC_API_KEY   ? 'ok' : 'missing',
  };

  const allOk = Object.values(checks).every((v) => v === 'ok');

  return NextResponse.json(
    { status: allOk ? 'healthy' : 'degraded', checks, ts: new Date().toISOString() },
    { status: allOk ? 200 : 200 } // always 200 for liveness; callers inspect `status`
  );
}
