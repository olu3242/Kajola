import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { isLocalMode, runtimeConfigurationErrors, runtimeMode } from '@/lib/local-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const probeToken = process.env.READINESS_PROBE_TOKEN;
  const supplied = req.headers.get('x-kajola-readiness-token');
  if (probeToken && supplied === probeToken) return true;
  return getSessionUser(req)?.role === 'admin';
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  }

  const configuration = runtimeConfigurationErrors();
  if (isLocalMode) {
    return NextResponse.json({ status: 'not_ready', mode: runtimeMode, checks: { durable_runtime: 'local_only' }, errors: configuration }, { status: 503 });
  }

  let upstream: 'ready' | 'unreachable' = 'unreachable';
  if (process.env.SUPABASE_FUNCTIONS_URL) {
    try {
      const response = await fetch(`${process.env.SUPABASE_FUNCTIONS_URL}/health`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      upstream = response.ok ? 'ready' : 'unreachable';
    } catch {
      upstream = 'unreachable';
    }
  }

  const ready = configuration.length === 0 && upstream === 'ready';
  return NextResponse.json({ status: ready ? 'ready' : 'not_ready', mode: runtimeMode, checks: { configuration: configuration.length ? 'invalid' : 'ready', upstream } }, { status: ready ? 200 : 503 });
}
