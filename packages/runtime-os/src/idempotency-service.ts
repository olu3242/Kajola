import type { OperationResult } from '@kajola/contracts';

type IdempotencyRecord = {
  key:    string;
  result: OperationResult;
  storedAt: string;
};

export interface IdempotencyRepository {
  get(key: string): Promise<IdempotencyRecord | null>;
  set(key: string, result: OperationResult): Promise<void>;
}

export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private store = new Map<string, IdempotencyRecord>();

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async set(key: string, result: OperationResult) {
    this.store.set(key, { key, result, storedAt: new Date().toISOString() });
  }
}

export class IdempotencyService {
  constructor(private repo: IdempotencyRepository) {}

  async check(key: string): Promise<OperationResult | null> {
    const record = await this.repo.get(key);
    return record?.result ?? null;
  }

  async store(key: string, result: OperationResult): Promise<void> {
    await this.repo.set(key, result);
  }
}
