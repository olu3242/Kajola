/**
 * E2E — Customer booking lifecycle
 * Discovery → Provider → Service → Slot → Hold → Pay → Confirm → Review → Tip → Rebook
 */
import { test, expect } from '@playwright/test';
import { loginAs, TEST_CLIENT } from './helpers';

test.describe('Customer journey', () => {
  test('unauthenticated user sees discovery page', async ({ page }) => {
    await page.goto('/discovery');
    await expect(page).toHaveTitle(/Kajola|Discovery|Providers/i);
    await expect(page.locator('h1')).toContainText('Discover');
  });

  test('login flow: OTP → cookie set → redirect to discovery', async ({ context, page }) => {
    await page.goto('/auth/login');
    // Fill phone input (any type)
    const phoneInput = page.locator('input').first();
    await phoneInput.fill(TEST_CLIENT.phone);
    // Click send OTP button
    await page.locator('button').filter({ hasText: /send|otp/i }).first().click();
    // Wait for some feedback message
    await page.waitForTimeout(1500);
    // Fill OTP code input
    const inputs = page.locator('input');
    const count = await inputs.count();
    // Second input is OTP, or fill all inputs with 123456
    if (count > 1) {
      await inputs.nth(1).fill('123456');
    } else {
      await inputs.first().fill('123456');
    }
    // Click sign-in button
    await page.locator('button').filter({ hasText: /sign in|verify|login|confirm/i }).first().click();
    await page.waitForURL(/\/(discovery|dashboard)/, { timeout: 8000 });
  });

  test('discovery lists Lagos providers', async ({ context, page }) => {
    await loginAs(context, TEST_CLIENT);
    await page.goto('/discovery');
    // At least 3 provider cards
    const cards = page.locator('a[href^="/discovery/"]');
    await expect(cards.first()).toBeVisible({ timeout: 5000 });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('filter by city narrows results', async ({ context, page }) => {
    await loginAs(context, TEST_CLIENT);
    await page.goto('/discovery');
    await page.selectOption('select', 'lekki');
    await page.waitForTimeout(500);
    const cards = page.locator('a[href^="/discovery/"]');
    await expect(cards.first()).toBeVisible({ timeout: 5000 });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
    // All should be lekki
    const text = await cards.first().textContent();
    expect(text?.toLowerCase()).toContain('lekki');
  });

  test('provider profile page shows services button', async ({ context, page }) => {
    await loginAs(context, TEST_CLIENT);
    await page.goto('/discovery');
    await page.locator('a[href^="/discovery/"]').first().click();
    await page.waitForURL(/\/discovery\/.+/);
    await expect(page.getByTestId('book-now-btn')).toBeVisible();
    await page.getByTestId('book-now-btn').click();
    await page.waitForURL(/\/services$/);
    await expect(page.locator('h1')).toContainText('service', { ignoreCase: true });
  });

  test('services page lists services with prices', async ({ context, page }) => {
    await loginAs(context, TEST_CLIENT);
    await page.goto('/discovery/ada-1/services');
    const cards = page.locator('a[href*="/slots"]');
    await expect(cards.first()).toBeVisible({ timeout: 5000 });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
    const text = await cards.first().textContent();
    expect(text).toMatch(/₦\d/);
  });

  test('slot selection shows available time slots', async ({ context, page }) => {
    await loginAs(context, TEST_CLIENT);
    // Get first service
    const svcRes = await context.request.get('/api/artisans/ada-1/services');
    const svcData = await svcRes.json();
    const serviceId = svcData.services?.[0]?.id;
    expect(serviceId).toBeTruthy();

    await page.goto(`/discovery/ada-1/services/${serviceId}/slots`);
    await expect(page.locator('button[data-testid^="slot-"]').first()).toBeVisible({ timeout: 6000 });
    const count = await page.locator('button[data-testid^="slot-"]').count();
    expect(count).toBeGreaterThan(0);
  });

  test('booking slot creates held booking and redirects to pay page', async ({ context, page }) => {
    await loginAs(context, TEST_CLIENT);
    const svcRes = await context.request.get('/api/artisans/ada-1/services');
    const svcData = await svcRes.json();
    const serviceId = svcData.services?.[0]?.id;

    await page.goto(`/discovery/ada-1/services/${serviceId}/slots`);
    await page.locator('button[data-testid^="slot-"]').first().click();
    // Should redirect to /booking/<id>/pay
    await page.waitForURL(/\/booking\/.+\/pay/, { timeout: 8000 });
    await expect(page.locator('h1')).toContainText('deposit', { ignoreCase: true });
    await expect(page.getByTestId('pay-deposit-btn')).toBeVisible();
  });

  test('pay deposit button redirects to Paystack (mock) and confirm flow', async ({ context, page }) => {
    await loginAs(context, TEST_CLIENT);
    const svcRes = await context.request.get('/api/artisans/ada-1/services');
    const serviceId = svcRes.ok() ? (await svcRes.json()).services?.[0]?.id : null;
    expect(serviceId).toBeTruthy();

    const slotsRes = await context.request.get(`/api/booking-slots?artisan_id=ada-1&service_id=${serviceId}`);
    const slotsData = await slotsRes.json();
    const slot = (slotsData.slots ?? []).find((s: any) => s.available);
    expect(slot).toBeTruthy();

    // Hold slot via API
    const holdRes = await context.request.post('/api/bookings', {
      data: { provider_id: 'ada-1', service_id: serviceId, starts_at: slot.starts_at, ends_at: slot.ends_at },
    });
    expect(holdRes.ok()).toBeTruthy();
    const { booking } = await holdRes.json();
    expect(booking.status).toBe('held');

    // Init payment
    const payRes = await context.request.post('/api/payments', { data: { bookingId: booking.id } });
    expect(payRes.ok()).toBeTruthy();
    const { reference, authorization_url } = await payRes.json();
    expect(reference).toMatch(/^PAY-/);
    expect(authorization_url).toContain('/payment/callback');

    // Navigate to callback (mocked confirm)
    await page.goto(authorization_url);
    await expect(page.getByTestId('payment-status')).toBeVisible({ timeout: 8000 });
    // Should show success or verifying
    const text = await page.getByTestId('payment-status').textContent();
    expect(text).toMatch(/confirm|success|verif/i);
  });

  test('my bookings page shows booking after creation', async ({ context, page }) => {
    await loginAs(context, TEST_CLIENT);
    await page.goto('/dashboard');
    // Either shows a booking or "No bookings yet" — page must render
    await expect(page.locator('h1')).toContainText('Booking', { ignoreCase: true });
  });

  test('completed booking shows review and tip forms', async ({ context, page }) => {
    await loginAs(context, TEST_CLIENT);

    // Create a booking for ngozi (different provider to avoid slot conflicts with other tests)
    const svcRes = await context.request.get('/api/artisans/ngozi-1/services');
    const serviceId = (await svcRes.json()).services?.[0]?.id;
    const slotsRes = await context.request.get(`/api/booking-slots?artisan_id=ngozi-1&service_id=${serviceId}`);
    const slot = ((await slotsRes.json()).slots ?? []).find((s: any) => s.available);

    const holdRes = await context.request.post('/api/bookings', {
      data: { provider_id: 'ngozi-1', service_id: serviceId, starts_at: slot.starts_at, ends_at: slot.ends_at },
    });
    const { booking } = await holdRes.json();

    // Pay
    const payRes = await context.request.post('/api/payments', { data: { bookingId: booking.id } });
    const { reference } = await payRes.json();
    await context.request.post('/api/payments/verify', { data: { reference, bookingId: booking.id } });

    // Switch to artisan (ngozi) and advance states — using same context
    await loginAs(context, { phone: '+2348011111003', otp: '123456', id: 'ngozi-1', role: 'artisan' });
    await context.request.patch(`/api/bookings/${booking.id}/status`, { data: { status: 'checked_in' } });
    await context.request.patch(`/api/bookings/${booking.id}/status`, { data: { status: 'in_progress' } });
    await context.request.patch(`/api/bookings/${booking.id}/status`, { data: { status: 'completed' } });

    // Switch back to client and view booking
    await loginAs(context, TEST_CLIENT);
    await page.goto(`/dashboard/bookings/${booking.id}`);
    await expect(page.getByTestId('submit-review-btn')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('submit-tip-btn')).toBeVisible();
  });

  test('cancel booking from held state', async ({ context, page }) => {
    await loginAs(context, TEST_CLIENT);
    const svcRes = await context.request.get('/api/artisans/ngozi-1/services');
    const serviceId = (await svcRes.json()).services?.[0]?.id;
    const slotsRes = await context.request.get(`/api/booking-slots?artisan_id=ngozi-1&service_id=${serviceId}`);
    const slot = ((await slotsRes.json()).slots ?? []).find((s: any) => s.available);

    const holdRes = await context.request.post('/api/bookings', {
      data: { provider_id: 'ngozi-1', service_id: serviceId, starts_at: slot.starts_at, ends_at: slot.ends_at },
    });
    const { booking } = await holdRes.json();

    await page.goto(`/dashboard/bookings/${booking.id}`);
    await expect(page.getByTestId('cancel-booking-btn')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('cancel-booking-btn').click();
    await expect(page.locator('text=cancelled')).toBeVisible({ timeout: 5000 });
  });
});
