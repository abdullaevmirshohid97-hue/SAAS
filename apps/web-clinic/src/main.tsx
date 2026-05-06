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
// app.clary.uz/dashboard?demo=1. If the browser already has a
// session for a real clinic, the magic link silently keeps it,
// so we proactively sign out before letting Supabase pick up
// the new tokens from the URL fragment.
async function maybeResetSessionForDemo() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const isDemoEntry = params.get('demo') === '1';
  const hash = window.location.hash || '';
  const isFreshAuth = hash.includes('access_token=') || hash.includes('type=magiclink');
  if (isDemoEntry && isFreshAuth) {
    try {
      await supabase.auth.signOut();
    } catch {}
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
