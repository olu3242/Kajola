import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeferredRuntime,
  InMemoryFlowRepository,
  PersistentFlowOrchestrator,
  SupabaseOrchestrationRepository,
  defineFlow,
} from '@kajola/orchestration';

const originalMode = process.env.KAJOLA_RUNTIME_MODE;
const originalAppEnv = process.env.APP_ENV;
const originalFunctionsUrl = process.env.SUPABASE_FUNCTIONS_URL;
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const originalService = process.env.SUPABASE_SERVICE_ROLE_KEY;

afterEach(() => {
  setEnv('KAJOLA_RUNTIME_MODE', originalMode);
  setEnv('APP_ENV', originalAppEnv);
  setEnv('SUPABASE_FUNCTIONS_URL', originalFunctionsUrl);
  setEnv('NEXT_PUBLIC_SUPABASE_URL', originalSupabaseUrl);
  setEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', originalAnon);
  setEnv('SUPABASE_SERVICE_ROLE_KEY', originalService);
  vi.resetModules();
});

describe('RC1 durable runtime', () => {
  it('never treats sandbox as local and reports missing durable dependencies', async () => {
    process.env.KAJOLA_RUNTIME_MODE = 'sandbox';
    delete process.env.SUPABASE_FUNCTIONS_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const mode = await import('../../apps/web/lib/local-mode');
    expect(mode.runtimeMode).toBe('sandbox');
    expect(mode.isLocalMode).toBe(false);
    expect(mode.isDurableMode).toBe(true);
    expect(mode.runtimeConfigurationErrors()).toEqual(expect.arrayContaining([
      'SUPABASE_FUNCTIONS_URL_MISSING', 'NEXT_PUBLIC_SUPABASE_URL_MISSING',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY_MISSING', 'SUPABASE_SERVICE_ROLE_KEY_MISSING',
    ]));
    expect(() => new SupabaseOrchestrationRepository({ url: '', serviceRoleKey: '' })).toThrow('DEPENDENCY_UNAVAILABLE');
    const { forwardToFunction } = await import('../../apps/web/app/api/_proxy');
    const { NextRequest } = await import('next/server');
    const response = await forwardToFunction('bookings', new NextRequest('http://localhost/api/bookings', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('persists a deferred step before worker completion advances the graph', async () => {
    let sequence = 0;
    const repository = new InMemoryFlowRepository();
    const orchestrator = new PersistentFlowOrchestrator(repository, new DeferredRuntime(), undefined, undefined, undefined,
      () => new Date('2026-09-04T12:00:00.000Z'), () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`);
    const flow = defineFlow({
      key: 'durable.test', version: 1, name: 'Durable test', flowTypes: ['LONG_RUNNING'],
      nodes: [{ id: 'start', type: 'START' }, { id: 'work', type: 'SYSTEM_TASK', handler: 'durable.work' }, { id: 'end', type: 'END' }],
      edges: [{ from: 'start', to: 'work' }, { from: 'work', to: 'end' }],
    });
    await orchestrator.registerFlow(flow);
    const waiting = await orchestrator.startFlow({ flowKey: flow.key, flowVersion: 1, workflowType: 'test', workflowId: 'one', tenantId: null, actor: { type: 'SYSTEM', id: 'test' } });
    const work = waiting.steps.find((step) => step.nodeId === 'work')!;
    expect(waiting.status).toBe('WAITING');
    expect(work.status).toBe('READY');
    expect((await repository.getInstance(waiting.id))?.steps[1].status).toBe('READY');
    expect((await orchestrator.completeWork(waiting.id, work.id, { durable: true })).status).toBe('COMPLETED');
  });

  it('maps durable definitions, aggregates, correlation and receipts to Supabase endpoints', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? String(init.body) : undefined });
      if (url.includes('flow_definitions?flow_key=')) return Response.json([]);
      if (url.includes('flow_instances?id=')) return Response.json([{
        id: '00000000-0000-4000-8000-000000000001', flow_key: 'test', flow_version: 1,
        workflow_type: 'booking', workflow_id: 'b1', tenant_id: null, status: 'WAITING', context: {},
        actor: { type: 'SYSTEM', id: 'test' }, correlation_id: '00000000-0000-4000-8000-000000000002',
        lock_version: 2, created_at: '2026-09-04T00:00:00Z', updated_at: '2026-09-04T00:00:00Z',
        flow_step_instances: [], flow_checkpoints: [],
      }]);
      if (url.includes('flow_event_receipts?')) return Response.json([]);
      return new Response(null, { status: 204 });
    };
    const repository = new SupabaseOrchestrationRepository({ url: 'https://example.supabase.co', serviceRoleKey: 'test-key', fetch: fetcher });
    await repository.registerDefinition(defineFlow({ key: 'test', version: 1, name: 'Test', flowTypes: ['SEQUENTIAL'], nodes: [{ id: 'start', type: 'START' }, { id: 'end', type: 'END' }], edges: [{ from: 'start', to: 'end' }] }));
    const instance = await repository.getInstance('00000000-0000-4000-8000-000000000001');
    expect(instance?.correlationId).toBe('00000000-0000-4000-8000-000000000002');
    expect(calls.some((call) => call.url.endsWith('/rest/v1/flow_definitions') && call.method === 'POST')).toBe(true);
    expect(calls.every((call) => !call.url.includes('test-key'))).toBe(true);
  });

  it('defines real exclusion constraints plus row locking and idempotent webhook evidence', () => {
    const migration = readFileSync(resolve('supabase/migrations/20260904010000_rc1_durable_runtime.sql'), 'utf8');
    const webhook = readFileSync(resolve('supabase/functions/payments_webhook/index.ts'), 'utf8');
    expect(migration).toContain('ADD CONSTRAINT bookings_staff_no_active_overlap');
    expect(migration).toContain('EXCLUDE USING gist');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('UNIQUE (provider, provider_event_id)');
    expect(webhook).toContain("crypto.subtle.verify('HMAC'");
    expect(webhook).toContain("onConflict: 'provider,provider_event_id'");
  });
});

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
