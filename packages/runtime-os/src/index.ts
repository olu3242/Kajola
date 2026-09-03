export * from './ids';
export * from './idempotency-service';
export * from './audit-service';
export * from './telemetry-service';
export * from './event-outbox';
export * from './authorization-service';
export * from './approval-service';
export * from './operation-executor';

import { InMemoryIdempotencyRepository, IdempotencyService } from './idempotency-service';
import { InMemoryAuditRepository, AuditService }             from './audit-service';
import { InMemoryTelemetryRepository, TelemetryService }     from './telemetry-service';
import { InMemoryEventRepository, EventOutbox }              from './event-outbox';
import { InMemoryApprovalRepository, ApprovalService }       from './approval-service';
import { AuthorizationService }                              from './authorization-service';
import { OperationExecutor }                                 from './operation-executor';
import type { ExecutorServices }                             from './operation-executor';

/** Bootstrap a fully wired in-memory Runtime OS instance. */
export function createInMemoryRuntime() {
  const idempotency = new IdempotencyService(new InMemoryIdempotencyRepository());
  const audit       = new AuditService(new InMemoryAuditRepository());
  const telemetry   = new TelemetryService(new InMemoryTelemetryRepository());
  const events      = new EventOutbox(new InMemoryEventRepository());
  const approval    = new ApprovalService(new InMemoryApprovalRepository());
  const auth        = new AuthorizationService();

  const services: ExecutorServices = { idempotency, audit, telemetry, events, approval };
  const executor = new OperationExecutor(auth, services);

  return { executor, services, auth };
}
