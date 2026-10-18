export * from './agent-registry';
export * from './agent-runner';
export * from './agent-definitions';
export * from './tool-registry';
export * from './memory-service';
export * from './model-gateway';

import { AgentRegistry }               from './agent-registry';
import { AgentRunner, InMemoryAgentRunRepository } from './agent-runner';
import { ToolRegistry }                from './tool-registry';
import { MemoryService, InMemoryMemoryRepository } from './memory-service';
import { ModelGateway }                from './model-gateway';
import { ALL_AGENTS }                  from './agent-definitions';
import { ApprovalService }             from '@kajola/runtime-os';
import type { ModelRequest, ModelResponse } from './model-gateway';

function deterministicFallback(req: ModelRequest): ModelResponse {
  const input = req.messages[req.messages.length - 1]?.content ?? '';

  // Provider search fallback
  if (input.toLowerCase().includes('search') || input.toLowerCase().includes('provider')) {
    return {
      content: JSON.stringify({ response: 'I found several highly rated providers in Lagos. Please use the search filters to narrow down by category and location.', providers: [], fallbackMode: true }),
      inputTokens: 0, outputTokens: 0, model: 'deterministic-fallback', fallback: true,
    };
  }

  // Rebooking recommendation fallback
  if (input.toLowerCase().includes('rebook') || input.toLowerCase().includes('retention')) {
    return {
      content: JSON.stringify({ rebookingRecommended: true, message: 'Based on your last service, we recommend booking your next appointment within 4 weeks.', fallbackMode: true }),
      inputTokens: 0, outputTokens: 0, model: 'deterministic-fallback', fallback: true,
    };
  }

  // Generic fallback
  return {
    content: JSON.stringify({ response: 'I can help you with that. Please provide more details or use the search features.', fallbackMode: true }),
    inputTokens: 0, outputTokens: 0, model: 'deterministic-fallback', fallback: true,
  };
}

export function createInMemoryAgentOS(approval: ApprovalService, apiKey?: string) {
  const registry = new AgentRegistry();
  const tools    = new ToolRegistry();
  const memory   = new MemoryService(new InMemoryMemoryRepository());
  const model    = new ModelGateway(apiKey, deterministicFallback);
  const runRepo  = new InMemoryAgentRunRepository();
  const runner   = new AgentRunner(registry, tools, model, memory, approval, runRepo);

  // Register all agents
  for (const def of ALL_AGENTS) { registry.register(def); }

  // Register domain tools (read-only defaults — mutations go through Runtime OS)
  tools.register(
    { name: 'tool.provider.search', description: 'Search providers by category and location', inputSchema: {}, outputSchema: {}, riskLevel: 'R0', allowedRoles: ['*'] },
    async (input, tenantId) => ({ providers: [], tenantId, query: input }),
  );
  tools.register(
    { name: 'tool.availability.read', description: 'Read provider availability windows', inputSchema: {}, outputSchema: {}, riskLevel: 'R0', allowedRoles: ['*'] },
    async (input, _tenantId) => ({ slots: [], providerId: input.providerId }),
  );
  tools.register(
    { name: 'tool.booking.hold', description: 'Hold a booking slot (creates held booking)', inputSchema: {}, outputSchema: {}, riskLevel: 'R1', allowedRoles: ['client', 'owner', 'system'] },
    async (input, tenantId) => ({ bookingId: `bk_${Date.now()}`, status: 'held', tenantId, ...input }),
  );
  tools.register(
    { name: 'tool.booking.cancel', description: 'Cancel a booking', inputSchema: {}, outputSchema: {}, riskLevel: 'R2', allowedRoles: ['client', 'owner', 'artisan', 'system'] },
    async (input, tenantId) => ({ bookingId: input.bookingId, status: 'cancelled', tenantId }),
  );
  tools.register(
    { name: 'tool.booking.read', description: 'Read booking details', inputSchema: {}, outputSchema: {}, riskLevel: 'R0', allowedRoles: ['*'] },
    async (input, tenantId) => ({ bookingId: input.bookingId, tenantId }),
  );
  tools.register(
    { name: 'tool.payment.read', description: 'Read payment status', inputSchema: {}, outputSchema: {}, riskLevel: 'R0', allowedRoles: ['client', 'owner', 'system'] },
    async (input, tenantId) => ({ reference: input.reference, status: 'pending', tenantId }),
  );
  tools.register(
    { name: 'tool.notification.send', description: 'Send a notification', inputSchema: {}, outputSchema: {}, riskLevel: 'R1', allowedRoles: ['*'] },
    async (input, tenantId) => ({ sent: true, to: input.to, tenantId }),
  );
  tools.register(
    { name: 'tool.feedback.request', description: 'Request customer feedback', inputSchema: {}, outputSchema: {}, riskLevel: 'R0', allowedRoles: ['*'] },
    async (input, tenantId) => ({ requested: true, customerId: input.customerId, tenantId }),
  );
  tools.register(
    { name: 'tool.rebooking.create', description: 'Create a rebooking suggestion', inputSchema: {}, outputSchema: {}, riskLevel: 'R1', allowedRoles: ['client', 'owner', 'system'] },
    async (input, tenantId) => ({ created: true, originalBookingId: input.bookingId, tenantId }),
  );

  return { registry, tools, memory, model, runner };
}
