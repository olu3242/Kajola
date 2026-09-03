/**
 * E2E — Provider fulfillment lifecycle
 * Login → Workspace → Check-in → Start → Complete
 */
import { test, expect } from '@playwright/test';
import { loginAs, TEST_CLIENT, TEST_ARTISAN } from './helpers';

// Create a confirmed booking for ada-1 (artisan) by client-1
async function createConfirmedBooking(context: any) {
  // Login as client, book, pay
  const svcRes = await context.request.get('/api/artisans/ada-1/services');
  const serviceId = (await svcRes.json()).services?.[0]?.id;
  const slotsRes = await context.request.get(`/api/booking-slots?artisan_id=ada-1&service_id=${serviceId}`);
  const slots = (await slotsRes.json()).slots ?? [];
  // Pick a slot that hasn't been used yet
  const slot = slots.find((s: any) => s.available);
  if (!slot) throw new Error('No available slot for test setup');

  const holdRes = await context.request.post('/api/bookings', {
    data: { provider_id: 'ada-1', service_id: serviceId, starts_at: slot.starts_at, ends_at: slot.ends_at },
  });
  const { booking } = await holdRes.json();

  const payRes = await context.request.post('/api/payments', { data: { bookingId: booking.id } });
  const { reference } = await payRes.json();
  await context.request.post('/api/payments/verify', { data: { reference, bookingId: booking.id } });

  return booking.id;
}

test.describe('Provider workspace', () => {
  test('artisan dashboard shows metrics', async ({ context, page }) => {
    await loginAs(context, TEST_ARTISAN);
    await page.goto('/artisan/dashboard');
    await expect(page.locator('h1')).toContainText('Dashboard', { ignoreCase: true });
    await expect(page.locator('text=Completed')).toBeVisible({ timeout: 5000 });
  });

  test('workspace shows confirmed bookings', async ({ context, page }) => {
    // Login as client and book
    await loginAs(context, TEST_CLIENT);
    await createConfirmedBooking(context);

    // Switch to artisan
    await loginAs(context, TEST_ARTISAN);
    await page.goto('/artisan/workspace');
    await expect(page.locator('h1')).toContainText('Workspace', { ignoreCase: true });
    // Confirmed bookings should appear
    await expect(page.locator('[data-testid^="workspace-booking-"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('full fulfillment: confirmed → checked_in → in_progress → completed', async ({ context, page }) => {
    // Setup: client books
    await loginAs(context, TEST_CLIENT);
    const bookingId = await createConfirmedBooking(context);

    // Switch to artisan
    await loginAs(context, TEST_ARTISAN);
    await page.goto('/artisan/workspace');
    await page.waitForLoadState('networkidle');

    // Click check-in
    const checkinBtn = page.getByTestId(`action-${bookingId}-checked_in`);
    await expect(checkinBtn).toBeVisible({ timeout: 5000 });
    await checkinBtn.click();

    // Click start service
    const startBtn = page.getByTestId(`action-${bookingId}-in_progress`);
    await expect(startBtn).toBeVisible({ timeout: 5000 });
    await startBtn.click();

    // Click mark complete
    const completeBtn = page.getByTestId(`action-${bookingId}-completed`);
    await expect(completeBtn).toBeVisible({ timeout: 5000 });
    await completeBtn.click();

    // Booking should now show completed status
    await expect(page.locator(`[data-testid="workspace-booking-${bookingId}"] :text("completed")`)).toBeVisible({ timeout: 5000 });
  });

  test('artisan cannot access another tenant booking', async ({ context }) => {
    // Create booking for kofi's tenant but try to update as ada (different tenant)
    await loginAs(context, TEST_CLIENT);
    const svcRes = await context.request.get('/api/artisans/kofi-1/services');
    const serviceId = (await svcRes.json()).services?.[0]?.id;
    const slotsRes = await context.request.get(`/api/booking-slots?artisan_id=kofi-1&service_id=${serviceId}`);
    const slot = ((await slotsRes.json()).slots ?? []).find((s: any) => s.available);
    const holdRes = await context.request.post('/api/bookings', {
      data: { provider_id: 'kofi-1', service_id: serviceId, starts_at: slot.starts_at, ends_at: slot.ends_at },
    });
    const { booking } = await holdRes.json();
    // Pay to confirm
    const payRes = await context.request.post('/api/payments', { data: { bookingId: booking.id } });
    const { reference } = await payRes.json();
    await context.request.post('/api/payments/verify', { data: { reference, bookingId: booking.id } });

    // Login as ada (different provider) and try to update kofi's booking
    await loginAs(context, TEST_ARTISAN);
    const res = await context.request.patch(`/api/bookings/${booking.id}/status`, {
      data: { status: 'checked_in' },
    });
    // Should be 403 or error
    expect(res.status()).toBeGreaterThanOrEqual(400);
    const data = await res.json();
    expect(data.error).toMatch(/Forbidden|not found/i);
  });
});
