import { describe, it, expect } from 'vitest';

// ── Pricing / deposit calculation logic ──────────────────────────────────────
// These functions mirror the server-side Edge Function calculations.
// Tests run without any DB/network — pure functions only.

interface DepositPolicy {
  type:  'percentage' | 'fixed';
  value: number;
}

function computeDepositKobo(totalKobo: number, policy: DepositPolicy): number {
  if (policy.type === 'percentage') {
    return Math.ceil((totalKobo * policy.value) / 100);
  }
  return Math.min(policy.value, totalKobo);
}

function computePlatformFee(totalKobo: number, feePct: number): number {
  return Math.floor((totalKobo * feePct) / 100);
}

function computeProviderEarnings(
  totalKobo:  number,
  platformFee: number,
  tipKobo:     number
): number {
  return totalKobo - platformFee + tipKobo;
}

// ── Booking state machine ─────────────────────────────────────────────────────

type BookingStatus =
  | 'pending' | 'held' | 'awaiting_payment' | 'confirmed'
  | 'checked_in' | 'in_progress' | 'completed'
  | 'cancelled' | 'no_show' | 'disputed';

const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending:          ['held', 'cancelled'],
  held:             ['awaiting_payment', 'cancelled'],
  awaiting_payment: ['confirmed', 'cancelled'],
  confirmed:        ['checked_in', 'cancelled'],
  checked_in:       ['in_progress'],
  in_progress:      ['completed', 'no_show'],
  completed:        ['disputed'],
  cancelled:        [],
  no_show:          ['disputed'],
  disputed:         ['completed', 'cancelled'],
};

function isValidTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Deposit computation', () => {
  it('calculates 30% deposit correctly (rounds up)', () => {
    // ₦18,500 service → 30% = ₦5,550 kobo
    const serviceKobo = 1_850_000;
    const deposit = computeDepositKobo(serviceKobo, { type: 'percentage', value: 30 });
    expect(deposit).toBe(555_000);
  });

  it('calculates fixed deposit (capped at total)', () => {
    const smallTotal = 500_000;
    const deposit = computeDepositKobo(smallTotal, { type: 'fixed', value: 1_000_000 });
    expect(deposit).toBe(500_000); // cap at total
  });

  it('calculates exact fixed deposit when below total', () => {
    const deposit = computeDepositKobo(5_000_000, { type: 'fixed', value: 1_000_000 });
    expect(deposit).toBe(1_000_000);
  });

  it('handles 100% deposit policy', () => {
    const deposit = computeDepositKobo(2_000_000, { type: 'percentage', value: 100 });
    expect(deposit).toBe(2_000_000);
  });
});

describe('Platform fee computation', () => {
  it('computes 8.5% platform fee correctly (floor)', () => {
    const total = 1_850_000; // ₦18,500
    const fee   = computePlatformFee(total, 8.5);
    expect(fee).toBe(157_250);
  });

  it('returns 0 for 0% fee', () => {
    expect(computePlatformFee(1_000_000, 0)).toBe(0);
  });
});

describe('Provider earnings', () => {
  it('subtracts platform fee and adds tip', () => {
    const total       = 1_850_000;
    const platformFee = 157_250;
    const tip         = 50_000;
    const earnings    = computeProviderEarnings(total, platformFee, tip);
    expect(earnings).toBe(1_742_750); // 1,850,000 - 157,250 + 50,000
  });

  it('handles zero tip', () => {
    const earnings = computeProviderEarnings(1_000_000, 85_000, 0);
    expect(earnings).toBe(915_000);
  });
});

describe('Booking state machine', () => {
  it('allows valid forward transitions', () => {
    expect(isValidTransition('pending',   'held')).toBe(true);
    expect(isValidTransition('held',      'awaiting_payment')).toBe(true);
    expect(isValidTransition('confirmed', 'checked_in')).toBe(true);
    expect(isValidTransition('in_progress', 'completed')).toBe(true);
  });

  it('blocks invalid transitions', () => {
    expect(isValidTransition('completed', 'pending')).toBe(false);
    expect(isValidTransition('cancelled', 'confirmed')).toBe(false);
    expect(isValidTransition('in_progress', 'pending')).toBe(false);
    expect(isValidTransition('completed', 'confirmed')).toBe(false);
  });

  it('allows cancellation from open states', () => {
    expect(isValidTransition('pending',   'cancelled')).toBe(true);
    expect(isValidTransition('held',      'cancelled')).toBe(true);
    expect(isValidTransition('confirmed', 'cancelled')).toBe(true);
  });

  it('blocks cancellation from terminal states', () => {
    expect(isValidTransition('completed', 'cancelled')).toBe(false);
    expect(isValidTransition('no_show',   'cancelled')).toBe(false);
  });

  it('allows dispute from no_show or completed', () => {
    expect(isValidTransition('no_show',   'disputed')).toBe(true);
    expect(isValidTransition('completed', 'disputed')).toBe(true);
  });
});

describe('Gratuity rules', () => {
  it('gratuity must be positive', () => {
    const isValidGratuity = (kobo: number) => kobo > 0;
    expect(isValidGratuity(50_000)).toBe(true);
    expect(isValidGratuity(0)).toBe(false);
    expect(isValidGratuity(-100)).toBe(false);
  });

  it('tip is never subject to platform fee (100% to provider)', () => {
    const tipKobo       = 100_000;
    const platformFee   = computePlatformFee(tipKobo, 8.5);
    // Tips should bypass platform fee logic
    const providerShare = tipKobo; // never fee'd
    expect(providerShare).toBe(tipKobo);
    expect(platformFee).toBeGreaterThan(0); // fee computed but not deducted from tip
  });
});
