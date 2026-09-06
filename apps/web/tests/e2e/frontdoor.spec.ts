import { expect, test } from '@playwright/test';
import { loginAs, TEST_ADMIN, TEST_ARTISAN, TEST_CLIENT, TEST_OWNER } from './helpers';

test.describe('Kajola front door', () => {
  test('cinematic hero presents the three-statement sequence and video contract', async ({ page }) => {
    await page.goto('/');
    const hero = page.getByTestId('cinematic-frontdoor');
    const title = page.getByTestId('hero-title');
    await expect(hero).toBeVisible();
    await expect(title).toHaveText('Be Seen.');
    await expect(title).toHaveText('Be Heard.', { timeout: 4000 });
    await expect(title).toHaveText('Believe in Kajola.', { timeout: 4000 });
    const video = hero.locator('video');
    await expect(video).toHaveAttribute('muted', '');
    await expect(video).toHaveAttribute('loop', '');
    await expect(video).toHaveAttribute('playsinline', '');
    await expect(video).toHaveAttribute('preload', 'metadata');
    await expect(page.getByRole('link', { name: 'Explore Kajola services' })).toBeVisible();
  });

  test('reduced motion disables automatic slide changes', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const title = page.getByTestId('hero-title');
    await expect(title).toHaveText('Believe in Kajola.');
    await page.waitForTimeout(3500);
    await expect(title).toHaveText('Believe in Kajola.');
  });

  test('landing intent reaches filtered discovery and booking entry', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('What do you need?').fill('Hair');
    await page.getByLabel('Where?').selectOption('lekki');
    await page.getByRole('button', { name: /Find services/i }).click();
    await page.waitForURL(/\/discovery\?.*q=Hair.*city=lekki|\/discovery\?.*city=lekki.*q=Hair/);
    await expect(page.getByTestId('provider-card-ada-1')).toBeVisible();
    await page.getByTestId('provider-card-ada-1').click();
    await expect(page.getByRole('heading', { name: "Ada's Glow Studio" })).toBeVisible();
    await page.getByRole('link', { name: /Choose a service/i }).click();
    await expect(page.getByRole('heading', { name: 'Choose a service' })).toBeVisible();
    await page.locator('[data-testid^="service-card-"]').first().click();
    await expect(page.getByRole('heading', { name: 'Pick a date and time' })).toBeVisible();
    await expect(page.locator('[data-testid^="slot-"]').first()).toBeVisible();
  });

  test('public calls to action reach real routes', async ({ context, page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Log in' }).first().click();
    await expect(page).toHaveURL(/\/auth\/login/);
    await page.goto('/');
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/auth\/signup/);
    await page.goto('/');
    await loginAs(context, TEST_ARTISAN);
    await page.getByRole('link', { name: 'List your business' }).click();
    await expect(page).toHaveURL(/\/artisan\/onboarding/);
  });

  test('mobile front door has no horizontal overflow', async ({ page }) => {
    for (const width of [320, 375, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 600 ? 780 : 900 });
      for (const path of ['/', '/discovery?city=lekki&category=Beauty', '/discovery/ada-1']) {
        await page.goto(path);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
    }
  });

  test('keyboard focus enters visible navigation', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const primaryLogo = page.getByRole('link', { name: 'Kajola home' }).first();
    await expect(primaryLogo).toBeFocused();
    const focusStyle = await primaryLogo.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(focusStyle).not.toBe('none');
  });

  test('nationwide location source covers every state and the FCT', async ({ page }) => {
    await page.goto('/');
    const location = page.getByLabel('Where?');
    await expect(location.locator('optgroup')).toHaveCount(37);
    await expect(location.locator('optgroup[label="Abia"] option')).toContainText(['Aba', 'Umuahia']);
    await expect(location.locator('optgroup[label="Federal Capital Territory"] option')).toContainText(['Abaji', 'Wuse']);
    await expect(location.locator('optgroup[label="Lagos"] option')).toContainText(['Ikeja', 'Lekki', 'Victoria Island']);
    await location.selectOption('port-harcourt');
    await page.getByRole('button', { name: /Find services/i }).click();
    await expect(page).toHaveURL(/\/discovery\?city=port-harcourt/);
    await expect(page.getByLabel('Location')).toHaveValue('port-harcourt');
  });

  test('Kajola logo is the global home link and preserves authenticated sessions', async ({ context, page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

    for (const path of ['/discovery', '/discovery/ada-1']) {
      await page.goto(path);
      consoleErrors.length = 0;
      await page.getByRole('link', { name: 'Kajola home' }).first().click();
      await expect(page).toHaveURL('/');
      await expect(page.getByTestId('hero-title')).toBeVisible();
    }

    const authenticatedSurfaces = [
      { user: TEST_CLIENT, path: '/dashboard' },
      { user: TEST_OWNER, path: '/owner/dashboard' },
      { user: TEST_ARTISAN, path: '/artisan/dashboard' },
      { user: TEST_ADMIN, path: '/admin/dashboard' },
      { user: TEST_ARTISAN, path: '/artisan/onboarding' },
    ];

    for (const { user, path } of authenticatedSurfaces) {
      await context.clearCookies();
      await loginAs(context, user);
      await page.goto(path);
      const logo = page.getByRole('link', { name: 'Kajola home' }).first();
      await logo.focus();
      await expect(logo).toBeFocused();
      consoleErrors.length = 0;
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/');
      await expect(page.getByTestId('hero-title')).toBeVisible();
      await expect.poll(async () => (await context.cookies()).some((cookie) => cookie.name === 'kajola-session')).toBe(true);
    }

    expect(consoleErrors).toEqual([]);
  });

  test('primary and More categories reach persisted marketplace results', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('category-hair').click();
    await expect(page).toHaveURL(/category=Hair/);
    await expect(page.getByTestId('provider-card-ada-1')).toBeVisible();

    await page.goto('/');
    await page.getByTestId('category-barber').click();
    await expect(page).toHaveURL(/category=Barber/);
    await expect(page.getByTestId('provider-card-tunde-1')).toBeVisible();

    await page.goto('/');
    await page.getByRole('button', { name: 'More...' }).click();
    await expect(page.getByRole('dialog', { name: 'More categories' })).toBeVisible();
    await page.getByRole('link', { name: /Home services/i }).click();
    await expect(page).toHaveURL(/category=Home(?:\+|%20)services/);
    await expect(page.getByTestId('provider-card-chinedu-1')).toBeVisible();
  });

  test('popular services and Other hand off to discovery', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('service-box-braids').click();
    await expect(page).toHaveURL(/q=Box(?:\+|%20)Braids/);
    await expect(page.getByTestId('provider-card-ada-1')).toBeVisible();

    await page.goto('/');
    await page.getByTestId('service-haircut-beard').click();
    await expect(page).toHaveURL(/q=Haircut/);
    await expect(page.getByTestId('provider-card-tunde-1')).toBeVisible();

    await page.goto('/');
    await page.getByRole('button', { name: 'More...' }).click();
    await page.getByRole('link', { name: /^Other$/ }).click();
    await expect(page.getByLabel('Describe the service you need')).toBeVisible();
    await page.getByLabel('Describe the service you need').fill('Drone camera repair');
    await expect(page.getByText(/Showing related professionals/i)).toBeVisible();
  });

  test('business onboarding supports searchable known and custom business types', async ({ context, page }) => {
    await loginAs(context, TEST_ARTISAN);
    await page.goto('/artisan/onboarding');
    await page.getByLabel('Business name').fill('Ada Test Studio');
    await page.getByLabel('Search business types').fill('barber');
    await page.getByLabel('What type of business do you run?').selectOption('Barber Shop');
    await page.getByLabel('Business location').selectOption('lekki');
    await page.getByRole('button', { name: /Save and continue/i }).click();
    await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Haircut & Beard' })).toBeVisible();

    await page.reload();
    await page.getByLabel('Business name').fill('Ada Custom Services');
    await page.getByLabel('What type of business do you run?').selectOption('other');
    await page.getByLabel('Tell us what your business does').fill('Mobile textile restoration');
    await page.getByLabel('Business location').selectOption('abuja');
    await page.getByRole('button', { name: /Save and continue/i }).click();
    await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible();
  });

  test('Kajola footer destinations resolve successfully', async ({ page, request }) => {
    await page.goto('/');
    const hrefs = await page.locator('footer a').evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute('href')).filter((href): href is string => Boolean(href)))]);
    expect(hrefs.length).toBeGreaterThanOrEqual(15);
    for (const href of hrefs) {
      const response = await request.get(href);
      expect(response.status(), `${href} should resolve`).toBeLessThan(400);
    }
  });

  test('mobile discovery navigation, category strip, More sheet, and search remain usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Customer mobile navigation' })).toBeVisible();
    await page.getByRole('button', { name: 'More...' }).click();
    await expect(page.getByRole('dialog', { name: 'More categories' })).toBeVisible();
    await page.getByLabel('Search categories').fill('automotive');
    await expect(page.getByRole('link', { name: /Automotive/i })).toBeVisible();
    await page.getByRole('button', { name: 'Close more categories' }).click();
    await page.getByLabel('What do you need?').fill('Massage');
    await page.getByLabel('Where?').selectOption('wuse');
    await page.getByRole('button', { name: /Find services/i }).click();
    await expect(page.getByTestId('provider-card-zainab-1')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
