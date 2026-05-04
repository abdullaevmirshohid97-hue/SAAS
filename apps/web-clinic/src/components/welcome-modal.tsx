import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';

import { Button } from '@clary/ui-web';

import { Confetti } from './confetti';

export function WelcomeModal() {
  const [params, setParams] = useSearchParams();
  const isWelcome = params.get('welcome') === '1';
  const [open, setOpen] = useState(isWelcome);
  const [showConfetti, setShowConfetti] = useState(isWelcome);

  useEffect(() => {
    if (isWelcome) {
      try {
        // @ts-expect-error PostHog optional
        window.posthog?.capture?.('welcome_modal_shown');
      } catch {}
    }
  }, [isWelcome]);

  function close() {
    setOpen(false);
    setShowConfetti(false);
    const next = new URLSearchParams(params);
    next.delete('welcome');
    setParams(next, { replace: true });
  }

  if (!open) return null;

  return (
    <>
      <Confetti active={showConfetti} />
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        onClick={close}
      >
        <div
          className="relative w-full max-w-lg rounded-2xl border bg-card p-8 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Yopish"
            onClick={close}
            className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-emerald-500 text-white shadow-lg">
              <Sparkles className="h-8 w-8" />
            </div>
            <h2 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">
              Tabriklaymiz! 🎉
            </h2>
            <p className="mt-3 text-muted-foreground">
              Klinikangiz Clary'da ishga tushdi. Endi keyingi 3 ta qadam bilan
              birinchi bemoringizni qabul qilishga tayyor bo'lasiz.
            </p>
          </div>

          <ol className="mt-6 space-y-3">
            {[
              { n: 1, t: "Birinchi xodimni qo'shing", d: 'Reception, shifokor yoki hamshira' },
              { n: 2, t: "Birinchi xizmatni qo'shing", d: "Konsultatsiya, USG yoki har qanday xizmat" },
              { n: 3, t: "Birinchi navbatni oching", d: 'Bemor qabul qilishga tayyorsiz' },
            ].map((s) => (
              <li key={s.n} className="flex gap-3 rounded-lg border bg-muted/30 p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {s.n}
                </div>
                <div>
                  <div className="font-semibold">{s.t}</div>
                  <div className="text-xs text-muted-foreground">{s.d}</div>
                </div>
              </li>
            ))}
          </ol>

          <Button onClick={close} className="mt-6 h-11 w-full text-base">
            Boshlaymiz &rarr;
          </Button>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            Yuqoridagi checklist orqali har doim qaytib kelishingiz mumkin
          </p>
        </div>
      </div>
    </>
  );
}
