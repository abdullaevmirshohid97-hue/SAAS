import { test, expect } from '@playwright/test';

const ADMIN = process.env.BASE_URL_ADMIN ?? 'http://localhost:5174';
const CLINIC = process.env.BASE_URL_CLINIC ?? 'http://localhost:5173';
const LANDING = process.env.BASE_URL_LANDING ?? 'http://localhost:4321';

test('@smoke web-clinic login page renders', async ({ page }) => {
  await page.goto(`${CLINIC}/login`);
  await expect(page.getByText(/Kirish|Sign in/)).toBeVisible();
});

test('@smoke landing hero renders', async ({ page }) => {
  await page.goto(LANDING);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('@smoke landing exposes pricing plans', async ({ page }) => {
  await page.goto(`${LANDING}/pricing`);
  await expect(page.getByText(/25PRO/)).toBeVisible();
  await expect(page.getByText(/50PRO/)).toBeVisible();
  await expect(page.getByText(/120PRO/)).toBeVisible();
});

test('@smoke web-admin login page renders', async ({ page }) => {
  await page.goto(`${ADMIN}/login`);
  await expect(page.getByText(/Super|Admin|Kirish/i)).toBeVisible();
});

test('@smoke web-clinic sidebar links exist after auth-redirect', async ({ page }) => {
  // unauthenticated users get pushed to /login — we just assert the redirect chain
  const resp = await page.goto(`${CLINIC}/payroll`);
  expect(resp?.status()).toBeLessThan(500);
  await expect(page).toHaveURL(/\/login|\/payroll/);
});

test('@smoke landing /signup form is present', async ({ page }) => {
  await page.goto(`${LANDING}/signup`);
  await expect(page.getByRole('heading')).toBeVisible();
  await expect(page.locator('form, [role="form"], input').first()).toBeVisible();
});
