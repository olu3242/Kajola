import type { AgentDefinition, ToolInvocation } from '@kajola/contracts';
import { newAgentRunId, newToolCallId } from '@kajola/runtime-os';
import type { AgentRegistry } from './agent-registry';
import type { ToolRegistry }  from './tool-registry';
import type { ModelGateway }  from './model-gateway';
import type { MemoryService } from './memory-service';
import type { ApprovalService } from '@kajola/runtime-os';

export type AgentRun = {
  id:          string;   // agr_<ulid>
  agentId:     string;
  tenantId:    string;
  correlationId: string;
  input:       Record<string, unknown>;
  output?:     Record<string, unknown>;
  toolCalls:   ToolInvocation[];
  steps:       number;
  status:      'running' | 'completed' | 'failed' | 'awaiting_approval';
  error?:      string;
  degraded:    boolean;
  startedAt:   string;
  endedAt?:    string;
};

export interface AgentRunRepository {
  save(run: AgentRun): Promise<void>;
  get(id: string): Promise<AgentRun | null>;
  list(tenantId: string): Promise<AgentRun[]>;
}

export class InMemoryAgentRunRepository implements AgentRunRepository {
  private store = new Map<string, AgentRun>();
  async save(run: AgentRun) { this.store.set(run.id, run); }
  async get(id: string)     { return this.store.get(id) ?? null; }
  async list(tenantId: string) {
    return [...this.store.values()].filter((r) => r.tenantId === tenantId);
  }
}

export type RunAgentInput = {
  agentId:      string;
  tenantId:     string;
  correlationId: string;
  input:        Record<string, unknown>;
  actorId:      string;
  role:         string;
};

export class AgentRunner {
  constructor(
    private registry: AgentRegistry,
    private tools:    ToolRegistry,
    private model:    ModelGateway,
    private memory:   MemoryService,
    private approval: ApprovalService,
    private repo:     AgentRunRepository,
  ) {}

  async run(req: RunAgentInput): Promise<AgentRun> {
    const def = this.registry.get(req.agentId);
    if (!def)           throw new Error(`Agent not found: ${req.agentId}`);
    if (!def.active)    throw new Error(`Agent inactive: ${req.agentId}`);

    const run: AgentRun = {
      id:           newAgentRunId(),
      agentId:      req.agentId,
      tenantId:     req.tenantId,
      correlationId: req.correlationId,
      input:        req.input,
      toolCalls:    [],
      steps:        0,
      status:       'running',
      degraded:     this.model.isDegraded,
      startedAt:    new Date().toISOString(),
    };
    await this.repo.save(run);

    try {
      const result = await this.planAndExecute(def, run, req);
      run.output = result;
      if (run.status === 'running') run.status = 'completed';
      run.endedAt = new Date().toISOString();
    } catch (err: unknown) {
      run.status  = 'failed';
      run.error   = err instanceof Error ? err.message : String(err);
      run.endedAt = new Date().toISOString();
    }

    await this.repo.save(run);
    return run;
  }

  private async planAndExecute(
    def: AgentDefinition,
    run: AgentRun,
    req: RunAgentInput,
  ): Promise<Record<string, unknown>> {
    // Recall relevant memory
    const prefs = await this.memory.recall(req.tenantId, def.id, 'preference', req.actorId);

    const systemPrompt = `You are ${def.id} — ${def.purpose}.
Tenant: ${req.tenantId}. Actor role: ${req.role}.
Available tools: ${def.allowedTools.join(', ')}.
Risk limit: ${def.riskLimit}. Never exceed it.
${prefs ? `User preferences: ${JSON.stringify(prefs)}` : ''}
Prohibited: ${def.prohibitedActions.join(', ')}.
You must request human approval for any R3/R4 action.
Return a JSON object as your final answer.`;

    const messages = [
      { role: 'user' as const, content: JSON.stringify(req.input) },
    ];

    // Agentic loop — up to maxSteps
    for (let step = 0; step < def.maxSteps; step++) {
      run.steps = step + 1;

      const response = await this.model.invoke({ systemPrompt, messages, maxTokens: 2048 });

      // Parse tool calls from response (simple heuristic for deterministic fallback)
      const toolCall = this.extractToolCall(response.content, def, req.tenantId);

      if (toolCall) {
        // Validate tool is allowed
        if (!this.registry.canUseTool(def.id, toolCall.tool)) {
          throw new Error(`Agent ${def.id} is not permitted to call tool: ${toolCall.tool}`);
        }
        if (this.registry.isActionProhibited(def.id, toolCall.tool)) {
          throw new Error(`Tool ${toolCall.tool} is prohibited for agent ${def.id}`);
        }
        // Check risk
        const riskLevel = this.tools.getRiskLevel(toolCall.tool);
        const riskOrder = ['R0', 'R1', 'R2', 'R3', 'R4'];
        if (riskOrder.indexOf(riskLevel) > riskOrder.indexOf(def.riskLimit)) {
          // Create approval request instead of executing
          const ctx = {
            operationId: run.id, correlationId: run.correlationId, tenantId: req.tenantId,
            actor: { actorType: 'agent' as const, actorId: def.id, agentId: def.id },
            role: req.role, permissions: [], channel: 'agent' as const,
            idempotencyKey: `agr:${run.id}:tool:${toolCall.tool}`,
            requestTimestamp: new Date().toISOString(), traceId: run.id,
          };
          const aprReq = await this.approval.request(ctx, toolCall.tool, toolCall.input, riskLevel);
          run.status = 'awaiting_approval';
          return { approvalRequired: true, approvalRequestId: aprReq.id, tool: toolCall.tool };
        }

        const callId = newToolCallId();
        const tlc: ToolInvocation = {
          id: callId, agentRunId: run.id, toolName: toolCall.tool,
          input: toolCall.input, startedAt: new Date().toISOString(),
        };
        run.toolCalls.push(tlc);

        try {
          const output = await this.tools.invoke(toolCall.tool, toolCall.input, req.tenantId);
          tlc.output  = output;
          tlc.endedAt = new Date().toISOString();
          messages.push({ role: 'assistant', content: response.content });
          messages.push({ role: 'user', content: `Tool result: ${JSON.stringify(output)}` });
        } catch (err) {
          tlc.error   = err instanceof Error ? err.message : String(err);
          tlc.endedAt = new Date().toISOString();
          messages.push({ role: 'assistant', content: response.content });
          messages.push({ role: 'user', content: `Tool error: ${tlc.error}. Adjust and retry or return a final answer.` });
        }

        await this.repo.save(run);
        continue;
      }

      // No tool call — parse final answer
      return this.parseFinalAnswer(response.content);
    }

    throw new Error(`Agent ${def.id} exceeded maxSteps (${def.maxSteps})`);
  }

  private extractToolCall(
    content: string,
    _def: AgentDefinition,
    _tenantId: string,
  ): { tool: string; input: Record<string, unknown> } | null {
    // Look for JSON tool call pattern: {"tool": "...", "input": {...}}
    const match = content.match(/\{"tool"\s*:\s*"([^"]+)"\s*,\s*"input"\s*:\s*(\{[^}]*\})/);
    if (match) {
      try {
        return { tool: match[1], input: JSON.parse(match[2]) as Record<string, unknown> };
      } catch { /* ignore parse errors */ }
    }
    return null;
  }

  private parseFinalAnswer(content: string): Record<string, unknown> {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as Record<string, unknown>; } catch { /* fall through */ }
    }
    return { response: content };
  }

  async getRun(id: string) { return this.repo.get(id); }
  async listRuns(tenantId: string) { return this.repo.list(tenantId); }
}
