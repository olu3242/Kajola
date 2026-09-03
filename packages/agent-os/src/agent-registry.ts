import type { AgentDefinition } from '@kajola/contracts';

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  register(def: AgentDefinition) {
    this.agents.set(def.id, def);
    return this;
  }

  get(id: string): AgentDefinition | undefined { return this.agents.get(id); }
  list(): AgentDefinition[]                     { return [...this.agents.values()]; }
  isActive(id: string): boolean                 { return this.agents.get(id)?.active ?? false; }

  canUseTool(agentId: string, toolName: string): boolean {
    const def = this.agents.get(agentId);
    if (!def) return false;
    return def.allowedTools.includes(toolName) || def.allowedTools.includes('*');
  }

  isActionProhibited(agentId: string, action: string): boolean {
    const def = this.agents.get(agentId);
    if (!def) return true;
    return def.prohibitedActions.some((p) => action.startsWith(p));
  }
}
