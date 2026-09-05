export type PaymentMethod = 'bank_transfer' | 'card' | 'ussd' | 'bank_account' | 'payment_link' | 'pay_at_venue' | 'cash';
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
export type PaymentArrangement = 'FULL' | 'DEPOSIT' | 'PARTIAL' | 'PAY_AT_SERVICE' | 'CASH';

export interface CommercePolicy {
  version: string;
  currency: 'NGN';
  deposit: DepositPolicy;
  fee_bearer: FeeBearer;
  platform_fee_bps: number;
  allowed_methods: PaymentMethod[];
  pay_at_venue_enabled: boolean;
  customer_fee_bps?: number;
  provider_fee_bps?: number;
  customer_fee_cap_kobo?: number;
  provider_fee_cap_kobo?: number;
  tip_commission_bps?: number;
}

// Operational defaults are versioned. Gateway pricing is intentionally supplied
// through environment/configuration rather than embedded in booking logic.
export const DEFAULT_COMMERCE_POLICY: CommercePolicy = {
  version: 'ng-v1',
  currency: 'NGN',
  deposit: { type: 'percentage', percentage: 30 },
  fee_bearer: 'BUSINESS_ABSORBS',
  platform_fee_bps: 0,
  allowed_methods: ['bank_transfer', 'card', 'ussd', 'bank_account', 'payment_link', 'pay_at_venue', 'cash'],
  pay_at_venue_enabled: true,
};

function clampKobo(value: number, max: number) {
  return Math.max(0, Math.min(max, Math.round(value)));
}

export interface CommerceSnapshotInput {
  serviceBaseKobo: number;
  addOnsKobo?: number;
  discountKobo?: number;
  processingCostKobo?: number;
  transferCostKobo?: number;
  settlementCostKobo?: number;
  taxKobo?: number;
  tipKobo?: number;
  subsidyKobo?: number;
  recoveryCreditKobo?: number;
  amountPaidKobo?: number;
  amountDueNowKobo?: number;
  arrangement: PaymentArrangement;
  method: PaymentMethod;
  policy: CommercePolicy;
}

/** Immutable, server-authored economics. Every amount is integer kobo. */
export interface CommerceSnapshot {
  policy_version: string;
  currency: 'NGN';
  arrangement: PaymentArrangement;
  payment_method: PaymentMethod;
  service_base: number;
  add_ons: number;
  discount: number;
  service_price: number;
  customer_fee: number;
  provider_fee: number;
  payment_processing_cost: number;
  transfer_cost: number;
  settlement_cost: number;
  tax_if_applicable: number;
  tip: number;
  tip_commission: number;
  subsidy: number;
  recovery_credit: number;
  amount_due_now: number;
  amount_due_at_service: number;
  amount_paid: number;
  amount_outstanding: number;
  customer_total: number;
  provider_gross_entitlement: number;
  provider_net_entitlement: number;
  kajola_gross_revenue: number;
  kajola_net_revenue: number;
  settlement_amount: number;
}

const money = (value = 0) => Math.max(0, Math.round(value));
const bps = (amount: number, rate = 0) => money(amount * Math.max(0, Math.min(10_000, rate)) / 10_000);
const cap = (amount: number, maximum?: number) => maximum == null ? amount : Math.min(amount, money(maximum));

export function buildCommerceSnapshot(input: CommerceSnapshotInput): CommerceSnapshot {
  const serviceBase = money(input.serviceBaseKobo);
  const addOns = money(input.addOnsKobo);
  const discount = Math.min(serviceBase + addOns, money(input.discountKobo));
  const servicePrice = serviceBase + addOns - discount;
  const processing = money(input.processingCostKobo);
  const transfer = money(input.transferCostKobo);
  const settlement = money(input.settlementCostKobo);
  const externalCosts = processing + transfer + settlement;
  const platformFee = bps(servicePrice, input.policy.platform_fee_bps);
  const configuredCustomerFee = bps(servicePrice, input.policy.customer_fee_bps);
  const configuredProviderFee = bps(servicePrice, input.policy.provider_fee_bps) + platformFee;

  let customerCostShare = 0;
  let providerCostShare = 0;
  if (input.policy.fee_bearer === 'CUSTOMER_PAYS') customerCostShare = externalCosts;
  if (input.policy.fee_bearer === 'BUSINESS_ABSORBS') providerCostShare = externalCosts;
  if (input.policy.fee_bearer === 'SPLIT') {
    customerCostShare = Math.floor(externalCosts / 2);
    providerCostShare = externalCosts - customerCostShare;
  }

  const customerFee = cap(configuredCustomerFee + customerCostShare, input.policy.customer_fee_cap_kobo);
  const providerFee = cap(configuredProviderFee + providerCostShare, input.policy.provider_fee_cap_kobo);
  const allocatedCosts = Math.min(externalCosts, Math.max(0, customerFee - configuredCustomerFee) + Math.max(0, providerFee - configuredProviderFee));
  const subsidy = money(input.subsidyKobo) + (externalCosts - allocatedCosts);
  const recoveryCredit = money(input.recoveryCreditKobo);
  const tax = money(input.taxKobo);
  const tip = money(input.tipKobo);
  const tipCommission = bps(tip, input.policy.tip_commission_bps);
  const customerTotal = Math.max(0, servicePrice + customerFee + tax + tip - recoveryCredit);
  const alreadyPaid = Math.min(customerTotal, money(input.amountPaidKobo));
  const outstanding = customerTotal - alreadyPaid;
  const dueNow = Math.min(outstanding, money(input.amountDueNowKobo));
  const providerGross = servicePrice + tip - tipCommission;
  const providerNet = Math.max(0, providerGross - providerFee);
  const kajolaGross = customerFee + providerFee + tipCommission;
  // Unallocated processor/transfer costs are classified as subsidy, but are
  // subtracted only once from margin. Explicit campaign subsidy is additional.
  const kajolaNet = kajolaGross - externalCosts - money(input.subsidyKobo);

  return {
    policy_version: input.policy.version, currency: input.policy.currency,
    arrangement: input.arrangement, payment_method: input.method,
    service_base: serviceBase, add_ons: addOns, discount, service_price: servicePrice,
    customer_fee: customerFee, provider_fee: providerFee,
    payment_processing_cost: processing, transfer_cost: transfer, settlement_cost: settlement,
    tax_if_applicable: tax, tip, tip_commission: tipCommission, subsidy, recovery_credit: recoveryCredit,
    amount_due_now: dueNow, amount_due_at_service: outstanding - dueNow,
    amount_paid: alreadyPaid, amount_outstanding: outstanding,
    customer_total: customerTotal, provider_gross_entitlement: providerGross,
    provider_net_entitlement: providerNet, kajola_gross_revenue: kajolaGross,
    kajola_net_revenue: kajolaNet, settlement_amount: providerNet,
  };
}

export function commerceSnapshotBalances(snapshot: CommerceSnapshot) {
  return snapshot.customer_total === snapshot.amount_paid + snapshot.amount_outstanding
    && snapshot.amount_outstanding === snapshot.amount_due_now + snapshot.amount_due_at_service
    && snapshot.provider_net_entitlement === snapshot.settlement_amount;
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
