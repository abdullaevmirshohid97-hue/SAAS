import { test, expect } from '@playwright/test';

const ADMIN = process.env.BASE_URL_ADMIN ?? 'http://localhost:5174';

const ROUTES = [
  '/patients',
  '/medications',
  '/diagnostics',
  '/revenue',
  '/revenue/payments',
  '/revenue/debts',
  '/support',
  '/website',
  '/clinics',
];

for (const path of ROUTES) {
  test(`@smoke admin ${path} responds`, async ({ page }) => {
    const resp = await page.goto(`${ADMIN}${path}`);
    expect(resp?.status()).toBeLessThan(500);
    await expect(page).toHaveURL(new RegExp(`(${path.replace(/\//g, '\\/')}|/login)`));
  });
}

test('@smoke admin login renders', async ({ page }) => {
  await page.goto(`${ADMIN}/login`);
  await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
});
