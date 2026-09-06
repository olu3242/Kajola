const secretKeys = /(^|_)(authorization|token|secret|password|api_key|card|pan|cvv)($|_)/i;

export interface OperationalEvent {
  event: string;
  correlation_id: string;
  causation_id?: string | null;
  workflow_instance_id?: string | null;
  booking_id?: string | null;
  payment_id?: string | null;
  recovery_case_id?: string | null;
  provider_id?: string | null;
  customer_id?: string | null;
  tenant_id?: string | null;
  actor_id?: string | null;
  runtime_mode: string;
  deployment_sha?: string | null;
  state_from?: string | null;
  state_to?: string | null;
  attempt_number?: number;
  retry_count?: number;
  latency_ms?: number;
  failure_category?: string | null;
  provider_reference?: string | null;
  dead_letter_status?: string | null;
  metadata?: Record<string, unknown>;
}

export function redactOperationalMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactOperationalMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) =>
    [key, secretKeys.test(key) ? '[REDACTED]' : redactOperationalMetadata(item)]));
}

export function structuredOperationalEvent(event: OperationalEvent) {
  if (!event.correlation_id) throw new Error('CORRELATION_ID_REQUIRED');
  return { ...event, metadata: redactOperationalMetadata(event.metadata ?? {}), occurred_at: new Date().toISOString() };
}
