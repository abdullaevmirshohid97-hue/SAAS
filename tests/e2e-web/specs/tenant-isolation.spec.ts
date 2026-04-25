import { test, expect } from '@playwright/test';

test('@isolation clinic A cannot see clinic B patient', async ({ page }) => {
  test.skip(!process.env.TEST_CLINIC_A_EMAIL, 'requires seeded test users');

  await page.goto('/login');
  await page.getByPlaceholder(/email/i).fill(process.env.TEST_CLINIC_A_EMAIL!);
  await page.getByPlaceholder(/parol|password/i).fill(process.env.TEST_CLINIC_A_PASSWORD!);
  await page.getByRole('button', { name: /Kirish|Sign in/ }).click();
  await expect(page).toHaveURL(/dashboard/);

  const response = await page.request.get(`${process.env.API_URL}/api/v1/patients/${process.env.CLINIC_B_PATIENT_ID}`, {
    headers: { Authorization: `Bearer ${await page.evaluate(() => JSON.parse(localStorage.getItem('clary.auth') ?? '{}').access_token)}` },
  });
  expect([403, 404]).toContain(response.status());
});
