import { expect, test } from '@playwright/test';
import { loginAs, TEST_ADMIN, TEST_CLIENT, TEST_OWNER } from './helpers';

test.describe('Connected commerce runtime', () => {
  test('deposit, fulfilment, balance, optional tip, and operator evidence share one booking', async ({ context, page }) => {
    await loginAs(context, TEST_CLIENT);
    const services = await (await context.request.get('/api/artisans/zainab-1/services')).json();
    const serviceId = services.services[0].id;
    const slots = await (await context.request.get(`/api/booking-slots?artisan_id=zainab-1&service_id=${serviceId}`)).json();
    const slot = slots.slots.find((item: { available: boolean }) => item.available);
    const held = await context.request.post('/api/bookings', { data: { provider_id: 'zainab-1', service_id: serviceId, starts_at: slot.starts_at, ends_at: slot.ends_at } });
    expect(held.ok()).toBeTruthy();
    const booking = (await held.json()).booking;

    const checkout = await (await context.request.get(`/api/bookings/${booking.id}`)).json();
    expect(checkout.quote.methods[0]).toBe('bank_transfer');
    expect(checkout.quote.purpose).toBe('deposit');

    const firstIntent = await (await context.request.post('/api/payments', { data: { bookingId: booking.id, method: 'bank_transfer', purpose: 'deposit' } })).json();
    const retryIntent = await (await context.request.post('/api/payments', { data: { bookingId: booking.id, method: 'bank_transfer', purpose: 'deposit' } })).json();
    expect(retryIntent.reference).toBe(firstIntent.reference);
    const firstVerify = await context.request.post('/api/payments/verify', { data: { reference: firstIntent.reference, bookingId: booking.id } });
    const duplicateVerify = await context.request.post('/api/payments/verify', { data: { reference: firstIntent.reference, bookingId: booking.id } });
    expect(firstVerify.ok()).toBeTruthy(); expect(duplicateVerify.ok()).toBeTruthy();
    expect((await duplicateVerify.json()).booking.payment_status).toBe('partially_paid');

    await loginAs(context, { phone: '+2348011111007', otp: '123456', id: 'zainab-1', role: 'artisan' });
    for (const status of ['checked_in', 'in_progress', 'completed']) {
      expect((await context.request.patch(`/api/bookings/${booking.id}/status`, { data: { status } })).ok()).toBeTruthy();
    }

    await loginAs(context, TEST_CLIENT);
    await page.goto(`/dashboard/bookings/${booking.id}`);
    await expect(page.getByRole('button', { name: 'Choose a tip amount' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'No tip' })).toBeVisible();
    const balanceQuote = await (await context.request.get(`/api/bookings/${booking.id}`)).json();
    expect(balanceQuote.quote.purpose).toBe('balance');
    const balance = await (await context.request.post('/api/payments', { data: { bookingId: booking.id, method: 'ussd', purpose: 'balance' } })).json();
    const paid = await (await context.request.post('/api/payments/verify', { data: { reference: balance.reference, bookingId: booking.id } })).json();
    expect(paid.booking.payment_status).toBe('paid');
    expect(paid.booking.balance_due_kobo).toBe(0);

    const tipOne = await (await context.request.post('/api/gratuities', { data: { booking_id: booking.id, amount_kobo: 50_000 } })).json();
    const tipRetry = await (await context.request.post('/api/gratuities', { data: { booking_id: booking.id, amount_kobo: 50_000 } })).json();
    expect(tipRetry.gratuity.id).toBe(tipOne.gratuity.id);

    await loginAs(context, TEST_ADMIN);
    const runtime = await context.request.get('/api/operator/runtime');
    expect(runtime.ok()).toBeTruthy();
    const evidence = (await runtime.json()).evidence;
    expect(evidence.events).toBeGreaterThanOrEqual(8);
    expect(evidence.ledger_entries).toBeGreaterThanOrEqual(6);
    expect(evidence.audits).toBeGreaterThanOrEqual(8);
  });

  test('owner payment policy is protected and versioned', async ({ context, page }) => {
    await loginAs(context, TEST_CLIENT);
    expect((await context.request.get('/api/owner/payment-settings')).status()).toBe(403);
    await loginAs(context, TEST_OWNER);
    await page.goto('/owner/payment-settings');
    await expect(page.getByRole('heading', { name: 'Payment settings' })).toBeVisible();
    await page.getByLabel('Deposit policy').selectOption('full');
    await page.getByRole('button', { name: 'Save payment settings' }).click();
    await expect(page.getByRole('status')).toContainText('saved');
    const policy = await (await context.request.get('/api/owner/payment-settings')).json();
    expect(policy.policy.deposit.type).toBe('full');
    expect(policy.policy.version).toMatch(/^ng-v1-/);
    await context.request.put('/api/owner/payment-settings', { data: { ...policy.policy, deposit: { type: 'percentage', percentage: 30 } } });
  });
});
