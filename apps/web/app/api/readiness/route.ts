import { NextRequest, NextResponse } from 'next/server';
import { isDurableMode, isLocalMode, runtimeConfigurationErrors, runtimeMode } from '@/lib/local-mode';
import { getRuntimeUser } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requiredSchemaVersion = '20260904010000_rc1_durable_runtime';

async function authorized(req: NextRequest) {
  const probeToken = process.env.READINESS_PROBE_TOKEN;
  const supplied = req.headers.get('x-kajola-readiness-token');
  if (probeToken && supplied === probeToken) return true;
  return (await getRuntimeUser(req))?.isPlatformOperator === true;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });

  const configuration = runtimeConfigurationErrors();
  if (isLocalMode) {
    return NextResponse.json({
      status: 'BLOCKED', mode: runtimeMode,
      checks: { database: 'LOCAL_ONLY', migration_state: 'LOCAL_ONLY', orchestration_repository: 'LOCAL_ONLY', worker: 'UNAVAILABLE', timers: 'LOCAL_ONLY', outbox: 'LOCAL_ONLY' },
      errors: configuration,
      deployment_sha: process.env.DEPLOYMENT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    }, { status: 503 });
  }

  if (!isDurableMode || configuration.length) {
    return NextResponse.json({ status: 'BLOCKED', mode: runtimeMode, checks: { configuration: 'BLOCKED' }, errors: configuration }, { status: 503 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const checks: Record<string, 'READY' | 'BLOCKED' | 'DEGRADED' | 'UNAVAILABLE' | 'LOCAL_ONLY'> = {};
  const details: Record<string, unknown> = {};

  try {
    const [schemaRows, flowRows, workerRows, timerRows, outboxRows] = await Promise.all([
      dbFetch(`${baseUrl}/rest/v1/runtime_schema_versions?version=eq.${requiredSchemaVersion}&select=version&limit=1`, headers),
      dbFetch(`${baseUrl}/rest/v1/flow_instances?select=id&limit=1`, headers),
      dbFetch(`${baseUrl}/rest/v1/runtime_worker_heartbeats?worker_type=eq.flow-workflow&select=worker_id,heartbeat_at,deployment_sha&order=heartbeat_at.desc&limit=1`, headers),
      dbFetch(`${baseUrl}/rest/v1/flow_timers?status=eq.SCHEDULED&wake_at=lte.${encodeURIComponent(new Date().toISOString())}&select=id&limit=100`, headers),
      dbFetch(`${baseUrl}/rest/v1/system_events?status=eq.pending&select=id,created_at&order=created_at.asc&limit=100`, headers),
    ]);
    checks.database = 'READY';
    checks.migration_state = schemaRows.length === 1 ? 'READY' : 'BLOCKED';
    checks.orchestration_repository = flowRows ? 'READY' : 'BLOCKED';
    const heartbeat = workerRows[0] as { heartbeat_at?: string; deployment_sha?: string } | undefined;
    const heartbeatAge = heartbeat?.heartbeat_at ? Date.now() - new Date(heartbeat.heartbeat_at).getTime() : Number.POSITIVE_INFINITY;
    checks.worker = !heartbeat ? 'UNAVAILABLE' : heartbeatAge <= 120_000 ? 'READY' : 'DEGRADED';
    checks.timers = timerRows.length < 100 ? 'READY' : 'DEGRADED';
    checks.outbox = outboxRows.length < 100 ? 'READY' : 'DEGRADED';
    details.worker_heartbeat_at = heartbeat?.heartbeat_at ?? null;
    details.worker_deployment_sha = heartbeat?.deployment_sha ?? null;
    details.due_timer_sample_count = timerRows.length;
    details.pending_outbox_sample_count = outboxRows.length;
  } catch (error) {
    checks.database = 'UNAVAILABLE';
    checks.migration_state = 'UNAVAILABLE';
    checks.orchestration_repository = 'UNAVAILABLE';
    checks.worker = 'UNAVAILABLE';
    checks.timers = 'UNAVAILABLE';
    checks.outbox = 'UNAVAILABLE';
    details.dependency_error = error instanceof Error ? error.message : 'DEPENDENCY_UNAVAILABLE';
  }

  checks.paystack = process.env.PAYSTACK_SECRET_KEY && process.env.PAYSTACK_PUBLIC_KEY ? 'READY' : 'BLOCKED';
  checks.notifications = (process.env.TERMII_API_KEY && process.env.TERMII_SENDER_ID) || (process.env.AT_API_KEY && process.env.AT_USERNAME) ? 'READY' : 'BLOCKED';
  const ready = Object.values(checks).every((value) => value === 'READY');
  return NextResponse.json({
    status: ready ? 'READY' : Object.values(checks).some((value) => value === 'UNAVAILABLE' || value === 'BLOCKED') ? 'BLOCKED' : 'DEGRADED', mode: runtimeMode, checks, details,
    errors: ready ? [] : [...configuration, 'DEPENDENCY_UNAVAILABLE'],
    deployment_sha: process.env.DEPLOYMENT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  }, { status: ready ? 200 : 503 });
}

async function dbFetch(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error(`SUPABASE_${response.status}`);
  return await response.json() as unknown[];
}
