import type { TelemetryEvent } from '@kajola/contracts';

export interface TelemetryRepository {
  emit(event: TelemetryEvent): Promise<void>;
  query(name: string, from: string, to: string): Promise<TelemetryEvent[]>;
}

export class InMemoryTelemetryRepository implements TelemetryRepository {
  private events: TelemetryEvent[] = [];

  async emit(event: TelemetryEvent) { this.events.push(event); }

  async query(name: string, from: string, to: string) {
    return this.events.filter(
      (e) => e.name === name && e.timestamp >= from && e.timestamp <= to,
    );
  }
}

export class TelemetryService {
  constructor(private repo: TelemetryRepository) {}

  async count(name: string, tags: Record<string, string> = {}) {
    await this.repo.emit({ name, value: 1, unit: 'count', tags, timestamp: new Date().toISOString() });
  }

  async duration(name: string, ms: number, tags: Record<string, string> = {}) {
    await this.repo.emit({ name, value: ms, unit: 'ms', tags, timestamp: new Date().toISOString() });
  }

  async query(name: string, from: string, to: string) {
    return this.repo.query(name, from, to);
  }
}
