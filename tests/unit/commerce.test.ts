import { describe, expect, it } from 'vitest';
import { DEFAULT_COMMERCE_POLICY, depositFor, quoteCheckout, type CommercePolicy } from '../../apps/web/lib/commerce';

describe('canonical commerce pricing', () => {
  it('supports every booking payment policy', () => {
    expect(depositFor(1_000_000, { ...DEFAULT_COMMERCE_POLICY, deposit: { type: 'none' } })).toBe(0);
    expect(depositFor(1_000_000, { ...DEFAULT_COMMERCE_POLICY, deposit: { type: 'fixed', amount_kobo: 200_000 } })).toBe(200_000);
    expect(depositFor(1_000_000, { ...DEFAULT_COMMERCE_POLICY, deposit: { type: 'percentage', percentage: 30 } })).toBe(300_000);
    expect(depositFor(1_000_000, { ...DEFAULT_COMMERCE_POLICY, deposit: { type: 'full' } })).toBe(1_000_000);
    expect(depositFor(1_000_000, { ...DEFAULT_COMMERCE_POLICY, deposit: { type: 'optional', percentage: 30 } })).toBe(0);
  });

  it('calculates deposits and remaining balances server-side', () => {
    const quote = quoteCheckout({ totalKobo: 2_000_000, paidKobo: 0, policy: DEFAULT_COMMERCE_POLICY });
    expect(quote.purpose).toBe('deposit');
    expect(quote.customer_total_kobo).toBe(600_000);
    expect(quote.balance_after_payment_kobo).toBe(1_400_000);
    expect(quote.methods[0]).toBe('bank_transfer');
  });

  it('keeps gateway fee allocation separate from platform fee', () => {
    const policy: CommercePolicy = { ...DEFAULT_COMMERCE_POLICY, fee_bearer: 'SPLIT', platform_fee_bps: 500 };
    const quote = quoteCheckout({ totalKobo: 1_000_000, paidKobo: 0, policy, purpose: 'full', gatewayFeeKobo: 20_000 });
    expect(quote.platform_fee_kobo).toBe(50_000);
    expect(quote.customer_total_kobo).toBe(1_010_000);
    expect(quote.provider_net_kobo).toBe(940_000);
  });
});
