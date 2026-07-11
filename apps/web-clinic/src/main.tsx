import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';

import { initI18n, SUPPORTED_LOCALES, type SupportedLocale } from '@clary/i18n';

import './styles.css';
import { router } from './router';
import { AuthProvider } from './providers/auth-provider';
import { ThemeProvider } from './providers/theme-provider';
import { AppearanceProvider } from './providers/appearance-provider';
import { initTelemetry } from './lib/telemetry';
import { supabase } from './lib/supabase';
import { isTauri } from './lib/platform';
import { checkForUpdates } from './lib/desktop-update';
import { setupDeepLinkAuth } from './lib/desktop-auth';

// Demo flow: clary.uz/demo magic link drops the user at
// app.clary.uz/dashboard?demo=1#access_token=...
// Two failure modes seen in the wild:
//   1. Browser already has a real-clinic session — Supabase ignores
//      the magic-link tokens.
//   2. Supabase's own redirect handler strips the ?demo=1 query
//      param, so we can't rely on it.
//
// We therefore detect a demo session by inspecting the JWT inside
// the URL fragment (sub field is the new auth user; email matches
// our demo+xxx@demo.clary.uz pattern from DemoService.spawn). If
// a magic-link token is present at all, we always:
//   - sign the previous user out,
//   - call setSession with the URL tokens,
//   - strip the tokens from the URL so a refresh won't replay them.
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
    const json = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function maybeResetSessionForDemo() {
  if (typeof window === 'undefined') return;
  const hash = window.location.hash || '';
  if (!hash.includes('access_token=')) return;

  const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const access_token = hashParams.get('access_token');
  const refresh_token = hashParams.get('refresh_token');
  if (!access_token || !refresh_token) return;

  const payload = decodeJwtPayload(access_token);
  const email = String(payload?.email ?? '');
  const isDemo =
    new URLSearchParams(window.location.search).get('demo') === '1' ||
    email.endsWith('@demo.clary.uz');

  if (!isDemo) return;

  try {
    // Avoid signOut() which fires a 'SIGNED_OUT' storage event the
    // AuthProvider is already listening to — that race was bouncing
    // the user to /auth before setSession() finished. Wipe the
    // persisted token directly, then setSession with the URL tokens.
    try {
      window.localStorage.removeItem('clary.auth');
      // Clear any stray sb-* keys Supabase JS may have written.
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i);
        if (k && (k.startsWith('sb-') || k === 'supabase.auth.token')) {
          window.localStorage.removeItem(k);
        }
      }
    } catch {}

    await supabase.auth.setSession({ access_token, refresh_token });
    const cleanUrl = `${window.location.pathname}?demo=1`;
    window.history.replaceState({}, '', cleanUrl);
  } catch (e) {
    console.warn('[demo] session bootstrap failed', e);
  }
}

// Kill switch for legacy service workers that still cache an old
// build's index.html and silently break navigation. Unregister any
// registered SW and clear its caches on every cold start until we
// ship a properly versioned SW again.
async function unregisterLegacyServiceWorkers() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {}
}

async function bootstrap() {
  await unregisterLegacyServiceWorkers();
  await maybeResetSessionForDemo();
  initTelemetry();
  // Saqlangan til tanlovini tiklaymiz (Sozlamalar > Ko'rinish orqali o'zgartiriladi).
  const savedLang = (() => {
    try {
      return localStorage.getItem('clary.lang');
    } catch {
      return null;
    }
  })();
  const initialLang: SupportedLocale =
    savedLang && (SUPPORTED_LOCALES as readonly string[]).includes(savedLang)
      ? (savedLang as SupportedLocale)
      : 'uz-Latn';
  await initI18n(initialLang);
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
  });

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider defaultTheme="system" storageKey="clary-theme">
        <AppearanceProvider>
          <QueryClientProvider client={qc}>
            <AuthProvider>
              <RouterProvider router={router} />
              <Toaster richColors position="top-right" />
            </AuthProvider>
          </QueryClientProvider>
        </AppearanceProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );

  // Desktop (Tauri) — deep-link Google OAuth listener + auto-update tekshiruvi.
  // Brauzerda ikkalasi ham no-op (isTauri() false).
  if (isTauri()) {
    void setupDeepLinkAuth(() => {
      void router.navigate('/dashboard');
    });
    void checkForUpdates();
  }
}

bootstrap();
