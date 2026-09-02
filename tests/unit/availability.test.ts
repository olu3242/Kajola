import { describe, it, expect } from 'vitest';

// ── Availability slot generation logic ───────────────────────────────────────
// Pure functions that mirror the slot-generation logic used in the API.

interface TimeWindow { start: string; end: string; } // 'HH:MM' format
interface AvailabilitySlot { starts_at: Date; ends_at: Date; }

function generateSlots(
  date:          Date,
  window:        TimeWindow,
  durationMins:  number,
  existingSlots: Array<{ starts_at: Date; ends_at: Date }> = []
): AvailabilitySlot[] {
  const [startH, startM] = window.start.split(':').map(Number);
  const [endH,   endM]   = window.end.split(':').map(Number);

  const windowStart = new Date(date);
  windowStart.setHours(startH, startM, 0, 0);
  const windowEnd = new Date(date);
  windowEnd.setHours(endH, endM, 0, 0);

  const slots: AvailabilitySlot[] = [];
  let current = new Date(windowStart);

  while (current.getTime() + durationMins * 60_000 <= windowEnd.getTime()) {
    const slotEnd = new Date(current.getTime() + durationMins * 60_000);

    // Check conflict with existing bookings
    const hasConflict = existingSlots.some(
      (b) => current < b.ends_at && slotEnd > b.starts_at
    );

    if (!hasConflict) {
      slots.push({ starts_at: new Date(current), ends_at: slotEnd });
    }
    current = slotEnd;
  }

  return slots;
}

function isPastSlot(slot: AvailabilitySlot, now: Date = new Date()): boolean {
  return slot.starts_at <= now;
}

function isHoldExpired(heldUntil: Date, now: Date = new Date()): boolean {
  return heldUntil < now;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);

describe('Slot generation', () => {
  it('generates correct number of 60-min slots in a 4-hour window', () => {
    const slots = generateSlots(tomorrow, { start: '08:00', end: '12:00' }, 60);
    expect(slots).toHaveLength(4); // 08:00, 09:00, 10:00, 11:00
  });

  it('generates correct number of 30-min slots in a 2-hour window', () => {
    const slots = generateSlots(tomorrow, { start: '09:00', end: '11:00' }, 30);
    expect(slots).toHaveLength(4);
  });

  it('slot starts_at and ends_at are correct', () => {
    const slots = generateSlots(tomorrow, { start: '08:00', end: '09:00' }, 60);
    expect(slots).toHaveLength(1);
    expect(slots[0].starts_at.getHours()).toBe(8);
    expect(slots[0].ends_at.getHours()).toBe(9);
  });

  it('excludes slots that conflict with existing bookings', () => {
    const existingBooking = {
      starts_at: new Date(tomorrow.setHours(9, 0, 0, 0)),
      ends_at:   new Date(tomorrow.setHours(10, 0, 0, 0)),
    };
    const slots = generateSlots(tomorrow, { start: '08:00', end: '12:00' }, 60, [existingBooking]);
    // Should be: 08:00, 10:00, 11:00 (not 09:00)
    expect(slots).toHaveLength(3);
    const slotTimes = slots.map((s) => s.starts_at.getHours());
    expect(slotTimes).not.toContain(9);
  });

  it('returns no slots when window duration equals service duration exactly', () => {
    const slots = generateSlots(tomorrow, { start: '08:00', end: '09:00' }, 60);
    expect(slots).toHaveLength(1);
  });

  it('returns empty array when service duration exceeds window', () => {
    const slots = generateSlots(tomorrow, { start: '08:00', end: '08:30' }, 60);
    expect(slots).toHaveLength(0);
  });
});

describe('Past slot blocking', () => {
  it('blocks slots in the past', () => {
    const pastSlot: AvailabilitySlot = {
      starts_at: new Date(Date.now() - 60 * 60_000),
      ends_at:   new Date(Date.now() - 30 * 60_000),
    };
    expect(isPastSlot(pastSlot)).toBe(true);
  });

  it('allows future slots', () => {
    const futureSlot: AvailabilitySlot = {
      starts_at: new Date(Date.now() + 60 * 60_000),
      ends_at:   new Date(Date.now() + 90 * 60_000),
    };
    expect(isPastSlot(futureSlot)).toBe(false);
  });
});

describe('Hold expiry', () => {
  it('detects expired hold', () => {
    const expiredAt = new Date(Date.now() - 1000);
    expect(isHoldExpired(expiredAt)).toBe(true);
  });

  it('allows active hold', () => {
    const futureExpiry = new Date(Date.now() + 10 * 60_000);
    expect(isHoldExpired(futureExpiry)).toBe(false);
  });

  it('15-minute hold window', () => {
    const holdCreatedAt = new Date();
    const holdUntil     = new Date(holdCreatedAt.getTime() + 15 * 60_000);
    expect(isHoldExpired(holdUntil)).toBe(false);
  });
});
