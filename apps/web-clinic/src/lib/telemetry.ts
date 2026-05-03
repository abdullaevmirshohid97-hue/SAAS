import posthog from 'posthog-js';

export function initTelemetry() {
  const phKey = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  const phHost = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.i.posthog.com';

  if (phKey && import.meta.env.PROD) {
    posthog.init(phKey, {
      api_host: phHost,
      person_profiles: 'identified_only',
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: false,
      disable_session_recording: true,
    });
  }
}

export function identifyUser(userId: string, email?: string, clinicId?: string | null) {
  if (!import.meta.env.VITE_POSTHOG_KEY) return;
  posthog.identify(userId, { email, clinic_id: clinicId ?? undefined });
}

export function resetTelemetry() {
  if (!import.meta.env.VITE_POSTHOG_KEY) return;
  posthog.reset();
}

export function trackEvent(event: string, props?: Record<string, unknown>) {
  if (!import.meta.env.VITE_POSTHOG_KEY) return;
  posthog.capture(event, props);
}
