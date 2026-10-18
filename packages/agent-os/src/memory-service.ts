type MemoryEntry = {
  key:       string;
  tenantId:  string;
  agentId:   string;
  scope:     'request' | 'conversation' | 'preference' | 'business';
  value:     unknown;
  expiresAt?: string;
  createdAt: string;
};

export interface MemoryRepository {
  get(tenantId: string, agentId: string, scope: string, key: string): Promise<MemoryEntry | null>;
  set(entry: MemoryEntry): Promise<void>;
  delete(tenantId: string, agentId: string, scope: string, key: string): Promise<void>;
  listByAgent(tenantId: string, agentId: string): Promise<MemoryEntry[]>;
  purgeExpired(): Promise<void>;
}

export class InMemoryMemoryRepository implements MemoryRepository {
  private store = new Map<string, MemoryEntry>();
  private key   = (t: string, a: string, s: string, k: string) => `${t}:${a}:${s}:${k}`;

  async get(t: string, a: string, s: string, k: string) { return this.store.get(this.key(t, a, s, k)) ?? null; }
  async set(e: MemoryEntry) { this.store.set(this.key(e.tenantId, e.agentId, e.scope, e.key), e); }
  async delete(t: string, a: string, s: string, k: string) { this.store.delete(this.key(t, a, s, k)); }
  async listByAgent(t: string, a: string) {
    return [...this.store.values()].filter((e) => e.tenantId === t && e.agentId === a);
  }
  async purgeExpired() {
    const now = new Date().toISOString();
    for (const [k, e] of this.store) {
      if (e.expiresAt && e.expiresAt < now) this.store.delete(k);
    }
  }
}

export class MemoryService {
  constructor(private repo: MemoryRepository) {}

  async remember(
    tenantId: string,
    agentId:  string,
    scope:    MemoryEntry['scope'],
    key:      string,
    value:    unknown,
    ttlMs?:   number,
  ) {
    await this.repo.set({
      key, tenantId, agentId, scope, value,
      expiresAt: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : undefined,
      createdAt: new Date().toISOString(),
    });
  }

  async recall(tenantId: string, agentId: string, scope: MemoryEntry['scope'], key: string) {
    const e = await this.repo.get(tenantId, agentId, scope, key);
    if (!e) return null;
    if (e.expiresAt && e.expiresAt < new Date().toISOString()) return null;
    return e.value;
  }

  async forget(tenantId: string, agentId: string, scope: MemoryEntry['scope'], key: string) {
    await this.repo.delete(tenantId, agentId, scope, key);
  }

  async listMemory(tenantId: string, agentId: string) {
    return this.repo.listByAgent(tenantId, agentId);
  }
}
