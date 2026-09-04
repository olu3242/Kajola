export type PaymentMethod = 'bank_transfer' | 'card' | 'ussd' | 'bank_account' | 'pay_at_venue';
export type PaymentPurpose = 'deposit' | 'balance' | 'full' | 'tip';
export type PaymentStatus = 'unpaid' | 'pending' | 'partially_paid' | 'paid' | 'failed' | 'refunded';
export type SettlementStatus = 'not_due' | 'pending' | 'available' | 'settled' | 'reversed';
export type DepositPolicy =
  | { type: 'none' }
  | { type: 'fixed'; amount_kobo: number }
  | { type: 'percentage'; percentage: number }
  | { type: 'full' }
  | { type: 'optional'; percentage: number };
export type FeeBearer = 'BUSINESS_ABSORBS' | 'CUSTOMER_PAYS' | 'PLATFORM_SUBSIDIZES' | 'SPLIT';

export interface CommercePolicy {
  version: string;
  currency: 'NGN';
  deposit: DepositPolicy;
  fee_bearer: FeeBearer;
  platform_fee_bps: number;
  allowed_methods: PaymentMethod[];
  pay_at_venue_enabled: boolean;
}

// Operational defaults are versioned. Gateway pricing is intentionally supplied
// through environment/configuration rather than embedded in booking logic.
export const DEFAULT_COMMERCE_POLICY: CommercePolicy = {
  version: 'ng-v1',
  currency: 'NGN',
  deposit: { type: 'percentage', percentage: 30 },
  fee_bearer: 'BUSINESS_ABSORBS',
  platform_fee_bps: 0,
  allowed_methods: ['bank_transfer', 'card', 'ussd', 'bank_account', 'pay_at_venue'],
  pay_at_venue_enabled: true,
};

function clampKobo(value: number, max: number) {
  return Math.max(0, Math.min(max, Math.round(value)));
}

export function depositFor(totalKobo: number, policy: CommercePolicy, chooseOptional = false) {
  const deposit = policy.deposit;
  if (deposit.type === 'none' || (deposit.type === 'optional' && !chooseOptional)) return 0;
  if (deposit.type === 'full') return totalKobo;
  if (deposit.type === 'fixed') return clampKobo(deposit.amount_kobo, totalKobo);
  return clampKobo(totalKobo * deposit.percentage / 100, totalKobo);
}

export interface CheckoutQuote {
  policy_version: string;
  currency: 'NGN';
  purpose: Exclude<PaymentPurpose, 'tip'>;
  service_amount_kobo: number;
  previously_paid_kobo: number;
  subtotal_due_kobo: number;
  gateway_fee_kobo: number;
  platform_fee_kobo: number;
  customer_total_kobo: number;
  provider_net_kobo: number;
  balance_after_payment_kobo: number;
  methods: PaymentMethod[];
}

export function quoteCheckout(input: {
  totalKobo: number;
  paidKobo: number;
  policy: CommercePolicy;
  purpose?: Exclude<PaymentPurpose, 'tip'>;
  chooseOptionalDeposit?: boolean;
  gatewayFeeKobo?: number;
}): CheckoutQuote {
  const remaining = Math.max(0, input.totalKobo - input.paidKobo);
  const deposit = depositFor(input.totalKobo, input.policy, input.chooseOptionalDeposit);
  const purpose = input.purpose ?? (input.paidKobo > 0 ? 'balance' : deposit > 0 ? 'deposit' : 'full');
  const subtotal = purpose === 'deposit' ? Math.min(deposit, remaining) : remaining;
  const gatewayFee = Math.max(0, Math.round(input.gatewayFeeKobo ?? 0));
  const platformFee = Math.round(subtotal * input.policy.platform_fee_bps / 10_000);
  const customerGateway = input.policy.fee_bearer === 'CUSTOMER_PAYS' ? gatewayFee : input.policy.fee_bearer === 'SPLIT' ? Math.round(gatewayFee / 2) : 0;
  const providerGateway = input.policy.fee_bearer === 'BUSINESS_ABSORBS' ? gatewayFee : input.policy.fee_bearer === 'SPLIT' ? gatewayFee - customerGateway : 0;
  return {
    policy_version: input.policy.version,
    currency: input.policy.currency,
    purpose,
    service_amount_kobo: input.totalKobo,
    previously_paid_kobo: input.paidKobo,
    subtotal_due_kobo: subtotal,
    gateway_fee_kobo: gatewayFee,
    platform_fee_kobo: platformFee,
    customer_total_kobo: subtotal + customerGateway,
    provider_net_kobo: Math.max(0, subtotal - platformFee - providerGateway),
    balance_after_payment_kobo: Math.max(0, remaining - subtotal),
    methods: input.policy.allowed_methods.filter((method) => method !== 'pay_at_venue' || input.policy.pay_at_venue_enabled),
  };
}
