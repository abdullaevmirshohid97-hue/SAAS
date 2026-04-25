describe('Login flow', () => {
  beforeAll(async () => { await device.launchApp(); });
  beforeEach(async () => { await device.reloadReactNative(); });

  it('should show the login screen', async () => {
    await expect(element(by.text('Clary'))).toBeVisible();
  });

  it('should sign in with valid credentials', async () => {
    await element(by.placeholder('Email')).typeText(process.env.TEST_EMAIL || 'test@clary.uz');
    await element(by.placeholder('Parol')).typeText(process.env.TEST_PASSWORD || 'password123');
    await element(by.text('Kirish')).tap();
    await waitFor(element(by.text('Boshqaruv paneli'))).toBeVisible().withTimeout(5000);
  });
});
