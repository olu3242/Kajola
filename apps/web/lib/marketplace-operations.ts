export type FulfillmentState = 'NOT_SCHEDULED' | 'SCHEDULED' | 'PROVIDER_ACKNOWLEDGED' | 'CUSTOMER_CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' | 'DISPUTED';
export type SettlementState = 'NOT_ELIGIBLE' | 'PENDING_ELIGIBILITY' | 'ELIGIBLE' | 'QUEUED' | 'PROCESSING' | 'SETTLED' | 'FAILED' | 'RETRY_REQUIRED' | 'HELD' | 'REVERSED';
export type OperationalRole = 'customer' | 'provider' | 'staff' | 'tenant_admin' | 'operator' | 'super_admin';

const fulfillmentTransitions: Record<FulfillmentState, Partial<Record<FulfillmentState, OperationalRole[]>>> = {
  NOT_SCHEDULED: { CANCELLED: ['customer', 'provider', 'tenant_admin'] },
  SCHEDULED: { PROVIDER_ACKNOWLEDGED: ['provider', 'staff', 'tenant_admin'], CUSTOMER_CHECKED_IN: ['customer', 'provider', 'staff'], CANCELLED: ['customer', 'provider', 'tenant_admin'] },
  PROVIDER_ACKNOWLEDGED: { CUSTOMER_CHECKED_IN: ['customer', 'provider', 'staff'], CANCELLED: ['customer', 'provider', 'tenant_admin'], NO_SHOW: ['provider', 'staff'] },
  CUSTOMER_CHECKED_IN: { IN_PROGRESS: ['provider', 'staff'], CANCELLED: ['provider', 'tenant_admin'] },
  IN_PROGRESS: { COMPLETED: ['provider', 'staff'], DISPUTED: ['customer', 'provider', 'tenant_admin'] },
  COMPLETED: { DISPUTED: ['customer', 'provider', 'tenant_admin'] },
  NO_SHOW: { DISPUTED: ['customer', 'tenant_admin'] },
  CANCELLED: {},
  DISPUTED: {},
};

export function authorizeFulfillmentTransition(from: FulfillmentState, to: FulfillmentState, role: OperationalRole) {
  if (from === to) return { allowed: true, idempotent: true } as const;
  const allowed = fulfillmentTransitions[from][to]?.includes(role) ?? false;
  return allowed
    ? ({ allowed: true, idempotent: false } as const)
    : ({ allowed: false, idempotent: false, reason: `ROLE_${role.toUpperCase()}_CANNOT_${from}_TO_${to}` } as const);
}

export interface SettlementEligibilityInput {
  paymentConfirmed: boolean;
  fulfillmentState: FulfillmentState;
  activeRefund: boolean;
  activeDispute: boolean;
  activeRecovery: boolean;
  providerEligible: boolean;
  riskPassed: boolean;
}

export function evaluateSettlementEligibility(input: SettlementEligibilityInput) {
  const blockers: string[] = [];
  if (!input.paymentConfirmed) blockers.push('PAYMENT_NOT_CONFIRMED');
  if (input.fulfillmentState !== 'COMPLETED') blockers.push('SERVICE_NOT_COMPLETED');
  if (input.activeRefund) blockers.push('ACTIVE_REFUND');
  if (input.activeDispute) blockers.push('ACTIVE_DISPUTE');
  if (input.activeRecovery) blockers.push('ACTIVE_RECOVERY');
  if (!input.providerEligible) blockers.push('PROVIDER_NOT_ELIGIBLE');
  if (!input.riskPassed) blockers.push('RISK_NOT_PASSED');
  return { eligible: blockers.length === 0, state: blockers.length ? 'NOT_ELIGIBLE' as const : 'ELIGIBLE' as const, blockers };
}

export interface SettlementCommand {
  idempotencyKey: string;
  bookingId: string;
  providerId: string;
  amountKobo: number;
  state: SettlementState;
}

export function settlementCommand(input: Omit<SettlementCommand, 'idempotencyKey' | 'state'>): SettlementCommand {
  if (!Number.isInteger(input.amountKobo) || input.amountKobo < 0) throw new Error('INVALID_SETTLEMENT_AMOUNT');
  return { ...input, idempotencyKey: `settlement:${input.bookingId}:${input.providerId}`, state: 'QUEUED' };
}

export function advanceSettlement(current: SettlementState, outcome: 'CLAIM' | 'SUCCESS' | 'FAILURE' | 'RETRY' | 'HOLD' | 'REVERSE') {
  const next: Partial<Record<SettlementState, Partial<Record<typeof outcome, SettlementState>>>> = {
    ELIGIBLE: { CLAIM: 'PROCESSING', HOLD: 'HELD' }, QUEUED: { CLAIM: 'PROCESSING', HOLD: 'HELD' },
    PROCESSING: { SUCCESS: 'SETTLED', FAILURE: 'FAILED' }, FAILED: { RETRY: 'RETRY_REQUIRED', HOLD: 'HELD' },
    RETRY_REQUIRED: { CLAIM: 'PROCESSING', HOLD: 'HELD' }, SETTLED: { REVERSE: 'REVERSED' },
    HELD: { RETRY: 'RETRY_REQUIRED' },
  };
  const state = next[current]?.[outcome];
  if (!state) return { allowed: false, state: current, reason: `INVALID_SETTLEMENT_TRANSITION:${current}:${outcome}` } as const;
  return { allowed: true, state, reason: null } as const;
}

export function refundCompensationKey(bookingId: string, settlementId: string, refundId: string) {
  return `settlement-compensation:${bookingId}:${settlementId}:${refundId}`;
}

export type ReconciliationExceptionType = 'EXTERNAL_PAYMENT_MISSING_INTERNAL' | 'INTERNAL_CONFIRMATION_MISSING_PROOF' | 'AMOUNT_MISMATCH' | 'CURRENCY_MISMATCH' | 'SETTLEMENT_MISMATCH' | 'FAILED_TRANSFER' | 'ORPHAN_PAYMENT' | 'UNRESOLVED_OFFLINE_PAYMENT';

export function reconcilePayment(input: {
  internalExists: boolean; externalExists: boolean; internalAmount: number; externalAmount: number;
  internalCurrency: string; externalCurrency: string; transferFailed?: boolean; offlineUnverified?: boolean;
}) {
  const exceptions: ReconciliationExceptionType[] = [];
  if (input.externalExists && !input.internalExists) exceptions.push('EXTERNAL_PAYMENT_MISSING_INTERNAL');
  if (input.internalExists && !input.externalExists) exceptions.push('INTERNAL_CONFIRMATION_MISSING_PROOF');
  if (input.internalExists && input.externalExists && input.internalAmount !== input.externalAmount) exceptions.push('AMOUNT_MISMATCH');
  if (input.internalExists && input.externalExists && input.internalCurrency !== input.externalCurrency) exceptions.push('CURRENCY_MISMATCH');
  if (input.transferFailed) exceptions.push('FAILED_TRANSFER');
  if (input.offlineUnverified) exceptions.push('UNRESOLVED_OFFLINE_PAYMENT');
  return { reconciled: exceptions.length === 0, exceptions };
}

export type AgentActionRisk = 'AUTO_EXECUTE' | 'POLICY_GATED' | 'HUMAN_APPROVAL_REQUIRED' | 'FORBIDDEN';
const forbiddenAgentActions = new Set(['settlement.execute', 'ledger.mutate', 'slot.override', 'permission.grant', 'tenant.transfer', 'audit.delete']);
const humanApprovalActions = new Set(['refund.issue', 'settlement.override', 'subsidy.major', 'dispute.resolve', 'provider.suspend', 'financial.adjust']);
const policyGatedActions = new Set(['recovery.offer', 'fee_policy.recommend', 'settlement.retry', 'customer.credit']);

export function classifyAgentAction(action: string): AgentActionRisk {
  if (forbiddenAgentActions.has(action)) return 'FORBIDDEN';
  if (humanApprovalActions.has(action)) return 'HUMAN_APPROVAL_REQUIRED';
  if (policyGatedActions.has(action)) return 'POLICY_GATED';
  return 'AUTO_EXECUTE';
}

export function authorizeAgentAction(input: { action: string; policyPassed: boolean; humanApproved: boolean }) {
  const risk = classifyAgentAction(input.action);
  const allowed = risk === 'AUTO_EXECUTE'
    || (risk === 'POLICY_GATED' && input.policyPassed)
    || (risk === 'HUMAN_APPROVAL_REQUIRED' && input.policyPassed && input.humanApproved);
  return { risk, allowed, failure: allowed ? null : risk === 'FORBIDDEN' ? 'AGENT_ACTION_FORBIDDEN' : 'APPROVAL_REQUIRED' };
}

export function automationIdempotencyKey(tenantId: string, eventId: string, ruleId: string, actionIndex: number) {
  return `automation:${tenantId}:${eventId}:${ruleId}:${actionIndex}`;
}

export function cancellationPolicy(input: { cancelledBy: 'CUSTOMER' | 'PROVIDER'; paymentCaptured: boolean; withinPenaltyWindow: boolean }) {
  if (input.cancelledBy === 'PROVIDER') return { releaseSlot: true, recoveryRequired: true, refundRequired: input.paymentCaptured, cancellationFeeKobo: 0 };
  return { releaseSlot: true, recoveryRequired: false, refundRequired: input.paymentCaptured, cancellationFeeKobo: input.withinPenaltyWindow ? 1 : 0 };
}
