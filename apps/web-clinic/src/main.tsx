import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';

import { initI18n } from '@clary/i18n';

import './styles.css';
import { router } from './router';
import { AuthProvider } from './providers/auth-provider';
import { ThemeProvider } from './providers/theme-provider';
import { initTelemetry } from './lib/telemetry';
import { supabase } from './lib/supabase';

// Demo flow: clary.uz/demo magic link drops the user at
// app.clary.uz/dashboard?demo=1#access_token=...&refresh_token=...
// If the browser already has a session for a real clinic, the magic
// link tokens are silently ignored. Detect the demo entry and
// manually parse + apply the URL tokens so the demo session always
// wins.
async function maybeResetSessionForDemo() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const isDemoEntry = params.get('demo') === '1';
  if (!isDemoEntry) return;

  const hash = window.location.hash || '';
  if (!hash.includes('access_token=')) return;

  const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const access_token = hashParams.get('access_token');
  const refresh_token = hashParams.get('refresh_token');
  if (!access_token || !refresh_token) return;

  try {
    await supabase.auth.signOut();
    await supabase.auth.setSession({ access_token, refresh_token });
    // Clean the tokens out of the URL so a refresh won't replay them.
    const cleanUrl = `${window.location.pathname}${window.location.search}`;
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
  await initI18n('uz-Latn');
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
  });

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider defaultTheme="system" storageKey="clary-theme">
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <RouterProvider router={router} />
            <Toaster richColors position="top-right" />
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
}

bootstrap();
