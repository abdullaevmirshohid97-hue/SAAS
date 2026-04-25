import { test, expect } from '@playwright/test';

const LANDING = process.env.BASE_URL_LANDING ?? 'http://localhost:4321';

const PAGES: Array<{ path: string; expectText: RegExp }> = [
  { path: '/', expectText: /Klinika|Manage|Boshlash/i },
  { path: '/features', expectText: /imkoniyat|Features/i },
  { path: '/pricing', expectText: /Pricing|Tarif/i },
  { path: '/blog', expectText: /Blog|Maqola/i },
  { path: '/docs', expectText: /Hujjat|Docs|Boshlash/i },
  { path: '/changelog', expectText: /v\d|O.zgarish|Changelog/i },
  { path: '/use-cases', expectText: /Use case|Foydalanish/i },
  { path: '/download', expectText: /Yuklab|Download|Bemor/i },
  { path: '/book-demo', expectText: /Demo|so.rash|book/i },
];

for (const p of PAGES) {
  test(`@smoke landing page ${p.path} renders`, async ({ page }) => {
    const resp = await page.goto(`${LANDING}${p.path}`);
    expect(resp?.status(), `expected non-error status for ${p.path}`).toBeLessThan(400);
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.locator('body')).toContainText(p.expectText);
  });
}

test('@smoke landing /book-demo form contains required fields', async ({ page }) => {
  await page.goto(`${LANDING}/book-demo`);
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.locator('input[name="phone"]')).toBeVisible();
  await expect(page.locator('input[name="clinic_name"]')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});

test('@smoke landing /download exposes at least one platform card', async ({ page }) => {
  await page.goto(`${LANDING}/download`);
  await expect(page.locator('a[href*="expo.dev"], a[href*="testflight"], a[href*="patient.clary"]').first()).toBeVisible();
});

test('@smoke landing language switcher offers ru', async ({ page }) => {
  await page.goto(`${LANDING}/`);
  await expect(page.locator('text=/Русский|English/').first()).toBeVisible();
});
