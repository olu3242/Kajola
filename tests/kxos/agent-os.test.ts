/**
 * Agentic OS — unit certification tests
 * Section 15.3 of the KXOS superprompt
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentRegistry,
  AgentRunner,
  InMemoryAgentRunRepository,
  ToolRegistry,
  MemoryService,
  InMemoryMemoryRepository,
  ModelGateway,
  createInMemoryAgentOS,
} from '@kajola/agent-os';
import { ApprovalService, InMemoryApprovalRepository } from '@kajola/runtime-os';
import type { AgentDefinition } from '@kajola/contracts';
import type { ModelRequest, ModelResponse } from '@kajola/agent-os';

function makeDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id:       'agt_test_v1',
    name:     'Test Agent',
    purpose:  'A test agent for certification',
    active:   true,
    version:  1,
    riskLimit:         'R2',
    allowedTools:      ['tool.provider.search', 'tool.availability.read', 'tool.booking.hold'],
    prohibitedActions: [],
    memoryScopes:      ['request'],
    maxSteps:          5,
    ...overrides,
  };
}

function makeFallback(response: Record<string, unknown>) {
  return (_req: ModelRequest): ModelResponse => ({
    content: JSON.stringify(response),
    inputTokens: 0, outputTokens: 0, model: 'deterministic-fallback', fallback: true,
  });
}

describe('Agentic OS', () => {
  let registry: AgentRegistry;
  let tools:    ToolRegistry;
  let memory:   MemoryService;
  let approval: ApprovalService;
  let runRepo:  InMemoryAgentRunRepository;
  let approvalRepo: InMemoryApprovalRepository;

  beforeEach(() => {
    registry     = new AgentRegistry();
    tools        = new ToolRegistry();
    memory       = new MemoryService(new InMemoryMemoryRepository());
    approvalRepo = new InMemoryApprovalRepository();
    approval     = new ApprovalService(approvalRepo);
    runRepo      = new InMemoryAgentRunRepository();

    // Register test tools
    tools.register(
      { name: 'tool.provider.search', description: 'Search providers', inputSchema: {}, outputSchema: {}, riskLevel: 'R0', allowedRoles: ['*'] },
      async () => ({ providers: [{ id: 'p1', name: 'Test Provider' }] }),
    );
    tools.register(
      { name: 'tool.availability.read', description: 'Read availability', inputSchema: {}, outputSchema: {}, riskLevel: 'R0', allowedRoles: ['*'] },
      async () => ({ slots: ['2026-09-10T09:00:00Z'] }),
    );
    tools.register(
      { name: 'tool.booking.hold', description: 'Hold booking slot', inputSchema: {}, outputSchema: {}, riskLevel: 'R1', allowedRoles: ['*'] },
      async (input, tenantId) => ({ bookingId: `bk_${Date.now()}`, status: 'held', tenantId, ...input }),
    );
    tools.register(
      { name: 'tool.payment.process', description: 'Process payment (R3)', inputSchema: {}, outputSchema: {}, riskLevel: 'R3', allowedRoles: ['*'] },
      async () => ({ processed: true }),
    );
  });

  function makeRunner(fallback: (_: ModelRequest) => ModelResponse) {
    const model = new ModelGateway(undefined, fallback);
    return new AgentRunner(registry, tools, model, memory, approval, runRepo);
  }

  // ── 15.3 Test 1 ──────────────────────────────────────────────────────────
  it('agent completes with deterministic fallback when no API key', async () => {
    registry.register(makeDef());
    const runner = makeRunner(makeFallback({ response: 'I found providers', providers: [], fallbackMode: true }));

    const run = await runner.run({
      agentId: 'agt_test_v1', tenantId: 'ada-1-tenant',
      correlationId: 'cor_test', input: { query: 'search providers near Lagos' },
      actorId: 'client-1', role: 'client',
    });

    expect(run.status).toBe('completed');
    expect(run.degraded).toBe(true);
    expect(run.output).toBeDefined();
  });

  // ── 15.3 Test 2 ──────────────────────────────────────────────────────────
  it('agent calls a registered tool and records ToolInvocation', async () => {
    registry.register(makeDef());
    // Fallback that emits a tool call JSON
    const fallback = makeFallback({
      tool: 'tool.provider.search',
      input: { category: 'beauty', location: 'Lagos' },
    });
    const runner = makeRunner(fallback);

    const run = await runner.run({
      agentId: 'agt_test_v1', tenantId: 'ada-1-tenant',
      correlationId: 'cor_test', input: { query: 'find beauty providers' },
      actorId: 'client-1', role: 'client',
    });

    expect(run.toolCalls.length).toBeGreaterThan(0);
    const tlc = run.toolCalls[0];
    expect(tlc.id).toMatch(/^tlc_/);
    expect(tlc.toolName).toBe('tool.provider.search');
    expect(tlc.output).toBeDefined();
  });

  // ── 15.3 Test 3 ──────────────────────────────────────────────────────────
  it('agent blocked from calling a tool outside allowedTools', async () => {
    registry.register(makeDef({ allowedTools: ['tool.provider.search'] }));
    // Fallback that tries to call a disallowed tool
    const fallback = makeFallback({
      tool: 'tool.booking.hold',
      input: { providerId: 'p1', startsAt: '2026-09-10T09:00:00Z' },
    });
    const runner = makeRunner(fallback);

    const run = await runner.run({
      agentId: 'agt_test_v1', tenantId: 'ada-1-tenant',
      correlationId: 'cor_test', input: { query: 'hold a booking' },
      actorId: 'client-1', role: 'client',
    });

    expect(run.status).toBe('failed');
    expect(run.error).toContain('not permitted to call tool');
  });

  // ── 15.3 Test 4 ──────────────────────────────────────────────────────────
  it('agent cannot exceed its risk limit — creates approval request instead', async () => {
    registry.register(makeDef({
      allowedTools: ['tool.payment.process'],
      riskLimit: 'R1',  // R3 tool would exceed R1 limit
    }));
    const fallback = makeFallback({
      tool: 'tool.payment.process',
      input: { amount: 5000 },
    });
    const runner = makeRunner(fallback);

    const run = await runner.run({
      agentId: 'agt_test_v1', tenantId: 'ada-1-tenant',
      correlationId: 'cor_test', input: { query: 'process payment' },
      actorId: 'client-1', role: 'client',
    });

    expect(run.status).toBe('awaiting_approval');
    expect(run.output?.approvalRequired).toBe(true);
    expect(String(run.output?.approvalRequestId)).toMatch(/^apr_/);
  });

  // ── 15.3 Test 5 ──────────────────────────────────────────────────────────
  it('agent memory is scoped to tenant and scope type', async () => {
    registry.register(makeDef({ memoryScopes: ['preference'] }));

    await memory.remember('ada-1-tenant', 'agt_test_v1', 'preference', 'client-1', { preferredTime: 'morning' });
    const recalled = await memory.recall('ada-1-tenant', 'agt_test_v1', 'preference', 'client-1');
    expect(recalled?.preferredTime).toBe('morning');

    // Different tenant cannot access the same memory
    const crossTenant = await memory.recall('other-tenant', 'agt_test_v1', 'preference', 'client-1');
    expect(crossTenant).toBeNull();
  });

  // ── 15.3 Test 6 ──────────────────────────────────────────────────────────
  it('agent run is recorded with agr_ prefixed id', async () => {
    registry.register(makeDef());
    const runner = makeRunner(makeFallback({ response: 'done' }));

    const run = await runner.run({
      agentId: 'agt_test_v1', tenantId: 'ada-1-tenant',
      correlationId: 'cor_test', input: {},
      actorId: 'client-1', role: 'client',
    });

    expect(run.id).toMatch(/^agr_/);
    const fetched = await runner.getRun(run.id);
    expect(fetched?.id).toBe(run.id);
  });

  // ── 15.3 Test 7 ──────────────────────────────────────────────────────────
  it('inactive agent cannot be run', async () => {
    registry.register(makeDef({ active: false }));
    const runner = makeRunner(makeFallback({ response: 'done' }));

    await expect(
      runner.run({ agentId: 'agt_test_v1', tenantId: 'ada-1-tenant', correlationId: 'cor_test', input: {}, actorId: 'client-1', role: 'client' }),
    ).rejects.toThrow('inactive');
  });

  // ── 15.3 Test 8 ──────────────────────────────────────────────────────────
  it('prohibited action prevents tool execution', async () => {
    registry.register(makeDef({
      allowedTools:      ['tool.booking.hold'],
      prohibitedActions: ['tool.booking.hold'],
    }));
    const fallback = makeFallback({
      tool: 'tool.booking.hold',
      input: { providerId: 'p1' },
    });
    const runner = makeRunner(fallback);

    const run = await runner.run({
      agentId: 'agt_test_v1', tenantId: 'ada-1-tenant',
      correlationId: 'cor_test', input: { query: 'hold slot' },
      actorId: 'client-1', role: 'client',
    });

    expect(run.status).toBe('failed');
    expect(run.error).toContain('prohibited');
  });

  // ── 15.3 Test 9 ──────────────────────────────────────────────────────────
  it('all 8 P0 agents are registered in createInMemoryAgentOS', () => {
    const agentOS = createInMemoryAgentOS(approval);
    const p0agents = [
      'agt_customer_concierge_v1',
      'agt_booking_coordinator_v1',
      'agt_schedule_optimizer_v1',
      'agt_payment_recovery_v1',
      'agt_provider_success_v1',
      'agt_customer_retention_v1',
      'agt_trust_risk_v1',
      'agt_support_resolution_v1',
    ];
    for (const id of p0agents) {
      expect(agentOS.registry.get(id)).toBeDefined();
      expect(agentOS.registry.isActive(id)).toBe(true);
    }
  });

  // ── 15.3 Test 10 ─────────────────────────────────────────────────────────
  it('model gateway is degraded when no API key is provided', () => {
    const model = new ModelGateway(undefined, makeFallback({ response: 'fallback' }));
    expect(model.isDegraded).toBe(true);
  });
});
