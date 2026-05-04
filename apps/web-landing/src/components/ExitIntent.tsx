import { useEffect, useState } from 'react';

const apiBase = import.meta.env.PUBLIC_API_BASE_URL ?? 'https://api.clary.uz';
const COOKIE = 'clary.exitIntentShown';

function getUtm(): Record<string, string | undefined> {
  if (typeof window === 'undefined') return {};
  const p = new URLSearchParams(window.location.search);
  return {
    source: p.get('utm_source') || undefined,
    medium: p.get('utm_medium') || undefined,
    campaign: p.get('utm_campaign') || undefined,
    content: p.get('utm_content') || undefined,
    term: p.get('utm_term') || undefined,
  };
}

export function ExitIntent() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(COOKIE) === '1') return;

    let armed = false;
    const armTimer = setTimeout(() => { armed = true; }, 8000);

    function trigger() {
      if (!armed) return;
      setOpen(true);
      localStorage.setItem(COOKIE, '1');
      cleanup();
      try {
        // @ts-expect-error PostHog optional
        window.posthog?.capture?.('exit_intent_shown');
      } catch {}
    }

    function onMouseLeave(e: MouseEvent) {
      if (e.clientY <= 0) trigger();
    }
    let touchStartY = 0;
    function onTouchStart(e: TouchEvent) { touchStartY = e.touches[0]?.clientY ?? 0; }
    function onTouchMove(e: TouchEvent) {
      const y = e.touches[0]?.clientY ?? 0;
      if (window.scrollY < 50 && y - touchStartY > 80) trigger();
    }

    document.addEventListener('mouseleave', onMouseLeave);
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });

    function cleanup() {
      clearTimeout(armTimer);
      document.removeEventListener('mouseleave', onMouseLeave);
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
    }

    return cleanup;
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`${apiBase}/api/v1/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          phone: form.get('phone'),
          clinicName: form.get('clinic'),
          source: 'exit_intent',
          utm: getUtm(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      setDone(true);
      try {
        // @ts-expect-error PostHog optional
        window.posthog?.capture?.('exit_intent_submitted');
      } catch {}
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border bg-card p-7 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Yopish"
          onClick={() => setOpen(false)}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>

        {!done ? (
          <>
            <div className="text-3xl">🎁</div>
            <h2 className="mt-3 text-xl font-bold tracking-tight sm:text-2xl">
              Ketishdan oldin — bir taklif
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Telefon raqamingizni qoldiring — 24 soat ichida demo akkaunt + 1 oy bepul taklif yuboramiz.
            </p>
            <form onSubmit={submit} className="mt-5 space-y-3">
              <input
                name="name"
                placeholder="Ism (ixtiyoriy)"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              <input
                name="phone"
                required
                type="tel"
                placeholder="+998 90 123 45 67"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              <input
                name="clinic"
                placeholder="Klinika nomi (ixtiyoriy)"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              {error && <p className="text-xs text-rose-600">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-[#2563EB] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
              >
                {submitting ? 'Yuborilmoqda…' : 'Taklifni olish'}
              </button>
            </form>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              Spam yo'q. Faqat siz uchun bitta taklif.
            </p>
          </>
        ) : (
          <div className="text-center">
            <div className="text-4xl">✅</div>
            <h2 className="mt-3 text-xl font-bold">Rahmat!</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              24 soat ichida bog'lanamiz. Tezroq boshlash uchun{' '}
              <a href="/demo" className="text-[#2563EB] hover:underline">
                demoni hozir oching
              </a>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
