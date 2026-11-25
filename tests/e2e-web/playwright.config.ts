import { defineConfig, devices } from '@playwright/test';

// =============================================================================
// E2E smoke — clinic va admin ilovalari Vite dev serverida ko'tariladi.
// =============================================================================
// Ilgari CI sinovlarni ishga tushirardi-yu, ilovalarning o'zini ko'tarmasdi →
// har sinov `ERR_CONNECTION_REFUSED`. Endi `webServer` ikkala ilovani
// ishga tushiradi (soxta Supabase manzili bilan — sinovlar faqat login'siz
// sahifalar va /login ga yo'naltirishni tekshiradi, tarmoq kerak emas).
// Landing (Astro + CMS API) — faqat BASE_URL_LANDING berilganda sinaladi.
// Tayyor serverlarga qarshi (staging): E2E_NO_SERVER=1 BASE_URL_APP=... .
// =============================================================================

const CLINIC = process.env.BASE_URL_CLINIC ?? process.env.BASE_URL_APP ?? 'http://localhost:5173';

const viteEnv = {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? 'e2e-anon-key',
  VITE_API_URL: process.env.VITE_API_URL ?? 'http://127.0.0.1:4000',
};

export default defineConfig({
  testDir: './specs',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: CLINIC,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Planshet ko'rinishi — CI'da faqat Chromium o'rnatiladi (WebKit emas).
    { name: 'tablet', use: { ...devices['iPad Pro 11'], browserName: 'chromium' } },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        {
          command: 'pnpm --dir ../../apps/web-clinic exec vite --port 5173 --strictPort',
          url: 'http://localhost:5173/login',
          env: viteEnv,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
        {
          command: 'pnpm --dir ../../apps/web-admin exec vite --port 5174 --strictPort',
          url: 'http://localhost:5174/login',
          env: viteEnv,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      ],
});
