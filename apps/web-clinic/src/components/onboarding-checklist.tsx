import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, X, Sparkles } from 'lucide-react';

import { api } from '@/lib/api';

interface Status {
  clinic: boolean;
  staff: boolean;
  service: boolean;
  queue: boolean;
  completedSteps: number;
  totalSteps: number;
}

const DISMISS_KEY = 'clary.onboardingChecklistDismissed';

const ITEMS: Array<{ key: keyof Omit<Status, 'completedSteps' | 'totalSteps'>; label: string; cta: string; href: string }> = [
  { key: 'clinic', label: 'Klinika sozlandi', cta: 'Sozlash', href: '/settings' },
  { key: 'staff', label: 'Birinchi xodim qo\'shildi', cta: 'Xodim qo\'shish', href: '/settings/staff' },
  { key: 'service', label: 'Birinchi xizmat qo\'shildi', cta: 'Xizmat qo\'shish', href: '/settings/services' },
  { key: 'queue', label: 'Birinchi navbat ochildi', cta: 'Navbat ochish', href: '/queue' },
];

export function OnboardingChecklist() {
  const [status, setStatus] = useState<Status | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1',
  );

  useEffect(() => {
    if (dismissed) return;
    api
      .get<Status>('/api/v1/auth/onboarding-status')
      .then(setStatus)
      .catch(() => {});
  }, [dismissed]);

  if (dismissed || !status) return null;
  if (status.completedSteps === status.totalSteps) {
    // Auto-dismiss when complete
    if (typeof window !== 'undefined') localStorage.setItem(DISMISS_KEY, '1');
    return null;
  }

  const pct = Math.round((status.completedSteps / status.totalSteps) * 100);

  return (
    <section className="mb-6 overflow-hidden rounded-xl border bg-gradient-to-br from-primary/5 via-card to-card shadow-sm">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Klinikangizni ishga tushiring</h3>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
              {status.completedSteps} / {status.totalSteps}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <ChevronRight
          className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${collapsed ? '' : 'rotate-90'}`}
        />
        <button
          type="button"
          aria-label="Yopish"
          onClick={(e) => {
            e.stopPropagation();
            localStorage.setItem(DISMISS_KEY, '1');
            setDismissed(true);
          }}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </button>

      {!collapsed && (
        <ul className="border-t">
          {ITEMS.map((item) => {
            const done = status[item.key];
            return (
              <li key={item.key} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                    done ? 'bg-emerald-500 text-white' : 'border-2 border-muted-foreground/30'
                  }`}
                  aria-hidden="true"
                >
                  {done && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className={`flex-1 text-sm ${done ? 'text-muted-foreground line-through' : 'font-medium'}`}>
                  {item.label}
                </span>
                {!done && (
                  <Link
                    to={item.href}
                    className="rounded-md border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5"
                  >
                    {item.cta}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
