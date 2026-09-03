import type { ToolDefinition, RiskLevel } from '@kajola/contracts';

type ToolHandler = (input: Record<string, unknown>, tenantId: string) => Promise<Record<string, unknown>>;

export class ToolRegistry {
  private tools    = new Map<string, ToolDefinition>();
  private handlers = new Map<string, ToolHandler>();

  register(def: ToolDefinition, handler: ToolHandler) {
    this.tools.set(def.name, def);
    this.handlers.set(def.name, handler);
    return this;
  }

  get(name: string): ToolDefinition | undefined { return this.tools.get(name); }
  list(): ToolDefinition[]                       { return [...this.tools.values()]; }

  isAllowed(toolName: string, role: string): boolean {
    const t = this.tools.get(toolName);
    if (!t) return false;
    return t.allowedRoles.includes('*') || t.allowedRoles.includes(role);
  }

  async invoke(toolName: string, input: Record<string, unknown>, tenantId: string): Promise<Record<string, unknown>> {
    const handler = this.handlers.get(toolName);
    if (!handler) throw new Error(`Tool not found: ${toolName}`);
    return handler(input, tenantId);
  }

  getRiskLevel(toolName: string): RiskLevel {
    return this.tools.get(toolName)?.riskLevel ?? 'R4';
  }
}
