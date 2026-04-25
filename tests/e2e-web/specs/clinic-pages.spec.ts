import { test, expect } from '@playwright/test';

const CLINIC = process.env.BASE_URL_CLINIC ?? 'http://localhost:5173';

// The clinic app is gated; we assert the route renders or redirects to login.
const ROUTES = [
  '/nurse',
  '/diagnostics',
  '/lab',
  '/pharmacy',
  '/cashier',
  '/marketing',
  '/payroll',
  '/settings/catalog',
  '/settings/integrations',
];

for (const path of ROUTES) {
  test(`@smoke clinic ${path} responds`, async ({ page }) => {
    const resp = await page.goto(`${CLINIC}${path}`);
    expect(resp?.status(), `expected non-error status for ${path}`).toBeLessThan(500);
    await expect(page).toHaveURL(new RegExp(`(${path.replace(/\//g, '\\/')}|/login)`));
  });
}

test('@smoke clinic login form renders username/password inputs', async ({ page }) => {
  await page.goto(`${CLINIC}/login`);
  await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
});
