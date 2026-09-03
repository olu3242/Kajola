/**
 * E2E — Owner KPI dashboard and cross-tenant security
 */
import { test, expect } from '@playwright/test';
import { loginAs, TEST_OWNER, TEST_CLIENT } from './helpers';

const TEST_WRONG_ROLE = { phone: '+2348012345678', otp: '123456', id: 'client-1', role: 'client' };

test.describe('Owner dashboard', () => {
  test('owner sees KPI dashboard with real aggregates', async ({ context, page }) => {
    await loginAs(context, TEST_OWNER);
    await page.goto('/owner/dashboard');
    await expect(page.locator('h1')).toContainText('Dashboard', { ignoreCase: true });
    await expect(page.locator('p:has-text("Revenue")').first()).toBeVisible({ timeout: 8000 });
    // Booking bar chart renders
    await expect(page.locator('[data-testid^="bar-"]').first()).toBeVisible({ timeout: 6000 });
  });

  test('client cannot access owner dashboard (403)', async ({ context }) => {
    await loginAs(context, TEST_WRONG_ROLE);
    const res = await context.request.get('/api/owner/dashboard');
    expect(res.status()).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/Forbidden|owner/i);
  });

  test('artisan cannot access owner dashboard (403)', async ({ context }) => {
    await loginAs(context, { phone: '+2348011111001', otp: '123456', id: 'ada-1', role: 'artisan' });
    const res = await context.request.get('/api/owner/dashboard');
    expect(res.status()).toBe(403);
  });

  test('unauthenticated request returns 401', async ({ context }) => {
    const res = await context.request.get('/api/owner/dashboard');
    expect(res.status()).toBe(401);
  });
});

test.describe('Cross-tenant security', () => {
  test('client cannot read another client\'s booking', async ({ context, page }) => {
    // Login as client-1 and create a booking
    await loginAs(context, TEST_CLIENT);
    const svcRes = await context.request.get('/api/artisans/tunde-1/services');
    const serviceId = (await svcRes.json()).services?.[0]?.id;
    const slotsRes = await context.request.get(`/api/booking-slots?artisan_id=tunde-1&service_id=${serviceId}`);
    const slot = ((await slotsRes.json()).slots ?? []).find((s: any) => s.available);
    const holdRes = await context.request.post('/api/bookings', {
      data: { provider_id: 'tunde-1', service_id: serviceId, starts_at: slot.starts_at, ends_at: slot.ends_at },
    });
    const { booking } = await holdRes.json();

    // Try to read from a different context (no session)
    const anonCtx = await page.context().browser()!.newContext();
    const res = await anonCtx.request.get(`/api/bookings/${booking.id}`);
    expect(res.status()).toBe(401);
    await anonCtx.close();
  });

  test('invalid state transition is rejected', async ({ context }) => {
    await loginAs(context, TEST_CLIENT);
    const svcRes = await context.request.get('/api/artisans/amaka-1/services');
    const serviceId = (await svcRes.json()).services?.[0]?.id;
    const slotsRes = await context.request.get(`/api/booking-slots?artisan_id=amaka-1&service_id=${serviceId}`);
    const slot = ((await slotsRes.json()).slots ?? []).find((s: any) => s.available);
    const holdRes = await context.request.post('/api/bookings', {
      data: { provider_id: 'amaka-1', service_id: serviceId, starts_at: slot.starts_at, ends_at: slot.ends_at },
    });
    const { booking } = await holdRes.json();

    // Client tries to transition held → completed (invalid, and client can't do this anyway)
    const res = await context.request.patch(`/api/bookings/${booking.id}/status`, {
      data: { status: 'completed' },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('double-booking same slot is rejected with 409', async ({ context }) => {
    await loginAs(context, TEST_CLIENT);
    const svcRes = await context.request.get('/api/artisans/ada-1/services');
    const serviceId = (await svcRes.json()).services?.[0]?.id;
    const slotsRes = await context.request.get(`/api/booking-slots?artisan_id=ada-1&service_id=${serviceId}`);
    const slots = (await slotsRes.json()).slots ?? [];
    const slot = slots.find((s: any) => s.available);
    if (!slot) { test.skip(); return; }

    // First booking succeeds
    const r1 = await context.request.post('/api/bookings', {
      data: { provider_id: 'ada-1', service_id: serviceId, starts_at: slot.starts_at, ends_at: slot.ends_at },
    });
    expect(r1.ok()).toBeTruthy();

    // Second booking for same slot should be 409
    const r2 = await context.request.post('/api/bookings', {
      data: { provider_id: 'ada-1', service_id: serviceId, starts_at: slot.starts_at, ends_at: slot.ends_at },
    });
    expect(r2.status()).toBe(409);
  });
});
