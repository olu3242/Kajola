import type { AgentDefinition } from '@kajola/contracts';

const base = {
  version: 1,
  tenantScope: 'tenant' as const,
  memoryPolicy: 'conversation_and_preference',
  approvalPolicy: 'owner_required_for_r3',
  modelPolicy:  'claude-sonnet-5',
  active:       true,
};

export const AGT_CUSTOMER_CONCIERGE: AgentDefinition = {
  ...base,
  id:      'agt_customer_concierge_v1',
  name:    'Customer Concierge',
  purpose: 'Help customers discover providers, understand services, and book appointments',
  riskLimit: 'R1',
  allowedTools: [
    'tool.provider.search',
    'tool.availability.read',
    'tool.booking.hold',
    'tool.notification.send',
  ],
  prohibitedActions: [
    'IssueRefund', 'ReleasePayout', 'SuspendProvider', 'ResolveDispute',
    'DeleteAuditRecord', 'ModifyTenantSettings',
  ],
  inputSchema:  { type: 'object', properties: { query: { type: 'string' }, tenantId: { type: 'string' } } },
  outputSchema: { type: 'object', properties: { recommendation: { type: 'object' }, providers: { type: 'array' } } },
  maxSteps:  10,
  timeoutMs: 30_000,
};

export const AGT_BOOKING_COORDINATOR: AgentDefinition = {
  ...base,
  id:      'agt_booking_coordinator_v1',
  name:    'Booking Coordinator',
  purpose: 'Coordinate booking selection, confirm slot choice, and initiate the hold workflow',
  riskLimit: 'R2',
  allowedTools: [
    'tool.provider.search',
    'tool.availability.read',
    'tool.booking.hold',
    'tool.booking.cancel',
    'tool.notification.send',
  ],
  prohibitedActions: ['IssueRefund', 'ReleasePayout', 'SuspendProvider', 'ResolveDispute', 'DeleteAuditRecord'],
  inputSchema:  { type: 'object', properties: { providerId: { type: 'string' }, serviceId: { type: 'string' } } },
  outputSchema: { type: 'object', properties: { bookingId: { type: 'string' }, status: { type: 'string' } } },
  maxSteps:  8,
  timeoutMs: 20_000,
};

export const AGT_SCHEDULE_OPTIMIZER: AgentDefinition = {
  ...base,
  id:      'agt_schedule_optimizer_v1',
  name:    'Schedule Optimizer',
  purpose: 'Suggest optimal appointment times based on provider availability and customer preferences',
  riskLimit: 'R0',
  allowedTools: [
    'tool.availability.read',
    'tool.provider.search',
  ],
  prohibitedActions: ['IssueRefund', 'ReleasePayout', 'SuspendProvider', 'ResolveDispute', 'DeleteAuditRecord', 'tool.booking.hold'],
  inputSchema:  { type: 'object', properties: { providerId: { type: 'string' }, preferredDays: { type: 'array' } } },
  outputSchema: { type: 'object', properties: { suggestedSlots: { type: 'array' } } },
  maxSteps:  5,
  timeoutMs: 10_000,
};

export const AGT_PAYMENT_RECOVERY: AgentDefinition = {
  ...base,
  id:      'agt_payment_recovery_v1',
  name:    'Payment Recovery Agent',
  purpose: 'Help customers resolve failed payments and prevent booking cancellation',
  riskLimit: 'R1',
  allowedTools: [
    'tool.payment.read',
    'tool.notification.send',
    'tool.booking.cancel',
  ],
  prohibitedActions: ['IssueRefund', 'ReleasePayout', 'SuspendProvider', 'ResolveDispute', 'DeleteAuditRecord'],
  inputSchema:  { type: 'object', properties: { bookingId: { type: 'string' }, paymentRef: { type: 'string' } } },
  outputSchema: { type: 'object', properties: { action: { type: 'string' }, message: { type: 'string' } } },
  maxSteps:  6,
  timeoutMs: 15_000,
};

export const AGT_PROVIDER_SUCCESS: AgentDefinition = {
  ...base,
  id:      'agt_provider_success_v1',
  name:    'Provider Success Agent',
  purpose: 'Help providers optimize schedules, draft customer communications, and identify opportunities',
  riskLimit: 'R1',
  allowedTools: [
    'tool.availability.read',
    'tool.feedback.request',
    'tool.notification.send',
  ],
  prohibitedActions: ['IssueRefund', 'ReleasePayout', 'SuspendProvider', 'ResolveDispute', 'DeleteAuditRecord'],
  inputSchema:  { type: 'object', properties: { providerId: { type: 'string' } } },
  outputSchema: { type: 'object', properties: { insights: { type: 'array' }, suggestions: { type: 'array' } } },
  maxSteps:  8,
  timeoutMs: 20_000,
};

export const AGT_CUSTOMER_RETENTION: AgentDefinition = {
  ...base,
  id:      'agt_customer_retention_v1',
  name:    'Customer Retention Agent',
  purpose: 'Recommend rebooking and send personalized follow-up messages after service completion',
  riskLimit: 'R1',
  allowedTools: [
    'tool.feedback.request',
    'tool.rebooking.create',
    'tool.notification.send',
  ],
  prohibitedActions: ['IssueRefund', 'ReleasePayout', 'SuspendProvider', 'ResolveDispute', 'DeleteAuditRecord'],
  inputSchema:  { type: 'object', properties: { customerId: { type: 'string' }, bookingId: { type: 'string' } } },
  outputSchema: { type: 'object', properties: { rebookingRecommended: { type: 'boolean' }, message: { type: 'string' } } },
  maxSteps:  5,
  timeoutMs: 10_000,
};

export const AGT_TRUST_RISK: AgentDefinition = {
  ...base,
  id:      'agt_trust_risk_v1',
  name:    'Trust & Risk Assessment Agent',
  purpose: 'Assess trust incidents, collect evidence, and prepare human review packages',
  riskLimit: 'R1',
  allowedTools: [
    'tool.booking.read' as string,
    'tool.payment.read',
  ],
  prohibitedActions: [
    'IssueRefund', 'ReleasePayout', 'SuspendProvider', 'ResolveDispute',
    'DeleteAuditRecord', 'ModifyIdentityVerification',
  ],
  inputSchema:  { type: 'object', properties: { incidentId: { type: 'string' }, description: { type: 'string' } } },
  outputSchema: { type: 'object', properties: { riskScore: { type: 'number' }, evidence: { type: 'array' }, recommendation: { type: 'string' } } },
  maxSteps:  8,
  timeoutMs: 30_000,
};

export const AGT_SUPPORT_RESOLUTION: AgentDefinition = {
  ...base,
  id:      'agt_support_resolution_v1',
  name:    'Support Resolution Agent',
  purpose: 'Triage customer support requests and draft resolution proposals for human review',
  riskLimit: 'R1',
  allowedTools: [
    'tool.booking.read' as string,
    'tool.payment.read',
    'tool.notification.send',
  ],
  prohibitedActions: ['IssueRefund', 'ReleasePayout', 'SuspendProvider', 'ResolveDispute', 'DeleteAuditRecord'],
  inputSchema:  { type: 'object', properties: { customerId: { type: 'string' }, issue: { type: 'string' } } },
  outputSchema: { type: 'object', properties: { triage: { type: 'string' }, proposal: { type: 'string' }, requiresHuman: { type: 'boolean' } } },
  maxSteps:  6,
  timeoutMs: 15_000,
};

export const ALL_AGENTS: AgentDefinition[] = [
  AGT_CUSTOMER_CONCIERGE,
  AGT_BOOKING_COORDINATOR,
  AGT_SCHEDULE_OPTIMIZER,
  AGT_PAYMENT_RECOVERY,
  AGT_PROVIDER_SUCCESS,
  AGT_CUSTOMER_RETENTION,
  AGT_TRUST_RISK,
  AGT_SUPPORT_RESOLUTION,
];
