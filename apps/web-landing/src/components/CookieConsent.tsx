import { useEffect, useState } from 'react';

const KEY = 'clary.cookieConsent';

export function CookieConsent() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!localStorage.getItem(KEY)) setOpen(true);
  }, []);

  function decide(value: 'all' | 'essential') {
    localStorage.setItem(KEY, value);
    setOpen(false);
    if (value === 'essential') {
      try {
        // @ts-expect-error PostHog optional
        window.posthog?.opt_out_capturing?.();
      } catch {}
    } else {
      try {
        // @ts-expect-error PostHog optional
        window.posthog?.opt_in_capturing?.();
      } catch {}
    }
  }

  if (!open) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-2xl rounded-xl border bg-card p-4 shadow-2xl md:left-auto md:right-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1 text-sm">
          <strong className="block">🍪 Cookie va analitika</strong>
          <p className="mt-1 text-muted-foreground">
            Saytni yaxshilash uchun analitika cookie'lardan foydalanamiz (PostHog, Microsoft Clarity).
            Faqat zarur cookie'larni saqlash mumkin —{' '}
            <a href="/legal/cookies" className="text-[#2563EB] hover:underline">batafsil</a>.
          </p>
        </div>
        <div className="flex gap-2 sm:flex-col">
          <button
            type="button"
            onClick={() => decide('all')}
            className="flex-1 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
          >
            Roziman
          </button>
          <button
            type="button"
            onClick={() => decide('essential')}
            className="flex-1 rounded-md border px-4 py-2 text-sm font-semibold hover:bg-muted"
          >
            Faqat zarur
          </button>
        </div>
      </div>
    </div>
  );
}
