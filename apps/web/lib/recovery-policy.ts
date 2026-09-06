export type RecoveryResponsibility = 'CUSTOMER' | 'PROVIDER' | 'KAJOLA' | 'SPLIT' | 'REFUND';

export type RecoveryPolicyInput = {
  bookingId: string;
  recoveryCaseId: string;
  policyVersion: string;
  failureReason: 'LATE_PAYMENT_AFTER_HOLD_EXPIRY' | 'PROVIDER_CANCELLATION' | 'SYSTEM_FAILURE';
  originalPrice: number;
  replacementPrice: number;
  marketplaceResponsible: boolean;
  riskDecision: 'ALLOW' | 'REVIEW' | 'DENY';
  recoveryBudget: number;
};

export type RecoveryDecision = {
  responsibility: RecoveryResponsibility;
  customerDelta: number;
  providerDelta: number;
  kajolaSubsidy: number;
  decisionReason: string;
  riskDecision: RecoveryPolicyInput['riskDecision'];
  financialEffectKey: string | null;
};

export function recoveryFinancialEffectKey(input: Pick<RecoveryPolicyInput, 'bookingId' | 'recoveryCaseId' | 'policyVersion'>, effect: string) {
  return `${effect.toLowerCase()}:${input.bookingId}:${input.recoveryCaseId}:${input.policyVersion}`;
}

export function evaluateRecoveryPolicy(input: RecoveryPolicyInput): RecoveryDecision {
  const delta = Math.max(0, Math.round(input.replacementPrice - input.originalPrice));
  if (input.riskDecision !== 'ALLOW') {
    return { responsibility: 'REFUND', customerDelta: 0, providerDelta: 0, kajolaSubsidy: 0,
      decisionReason: 'Risk policy requires refund or operator review', riskDecision: input.riskDecision, financialEffectKey: null };
  }
  if (delta === 0) {
    return { responsibility: 'CUSTOMER', customerDelta: 0, providerDelta: 0, kajolaSubsidy: 0,
      decisionReason: 'Equivalent replacement has no price delta', riskDecision: input.riskDecision, financialEffectKey: null };
  }
  if (input.marketplaceResponsible && input.recoveryBudget >= delta) {
    return { responsibility: 'KAJOLA', customerDelta: 0, providerDelta: 0, kajolaSubsidy: delta,
      decisionReason: 'Kajola caused the recovery and budget covers the replacement delta', riskDecision: input.riskDecision,
      financialEffectKey: recoveryFinancialEffectKey(input, 'recovery_subsidy') };
  }
  return { responsibility: 'CUSTOMER', customerDelta: delta, providerDelta: 0, kajolaSubsidy: 0,
    decisionReason: 'Customer approval is required for an uncovered replacement delta', riskDecision: input.riskDecision,
    financialEffectKey: recoveryFinancialEffectKey(input, 'recovery_customer_delta') };
}
