import { Page, BrowserContext } from '@playwright/test';

// Test credentials matching the local store seed
export const TEST_CLIENT  = { phone: '+2348012345678',  otp: '123456', id: 'client-1', role: 'client' };
export const TEST_ARTISAN = { phone: '+2348011111001',  otp: '123456', id: 'ada-1',    role: 'artisan' }; // Ada
export const TEST_OWNER   = { phone: '+2348098765432',  otp: '123456', id: 'owner-1',  role: 'owner' };

/** Log in a user via the API and inject the session cookie */
export async function loginAs(context: BrowserContext, user: typeof TEST_CLIENT) {
  // First send OTP (local mode always returns 123456)
  await context.request.post('/api/auth/send-otp', {
    data: { phone: user.phone, purpose: 'login' },
  });

  // Then login — sets the httpOnly kajola-session cookie
  const res = await context.request.post('/api/auth/login', {
    data: { phone: user.phone, otp_code: user.otp },
  });
  if (!res.ok()) throw new Error(`Login failed: ${await res.text()}`);
}

/** Log in and navigate to a page */
export async function loginAndNavigate(context: BrowserContext, page: Page, user: typeof TEST_CLIENT, path: string) {
  await loginAs(context, user);
  await page.goto(path);
}
