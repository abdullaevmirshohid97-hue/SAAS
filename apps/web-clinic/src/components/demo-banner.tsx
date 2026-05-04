import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

import { api } from '@/lib/api';

interface MeResponse {
  clinic?: {
    is_demo?: boolean;
    demo_expires_at?: string | null;
  };
}

function formatRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'tugadi';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours} soat ${minutes} daqiqa`;
  return `${minutes} daqiqa`;
}

export function DemoBanner() {
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<MeResponse>('/api/v1/auth/me')
      .then((res) => {
        if (cancelled) return;
        if (res.clinic?.is_demo && res.clinic.demo_expires_at) {
          setExpiresAt(res.clinic.demo_expires_at);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [expiresAt]);

  if (!expiresAt) return null;

  return (
    <div className="flex items-center justify-center gap-3 border-b border-amber-300/40 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-2 text-sm dark:from-amber-950/40 dark:to-orange-950/40">
      <Sparkles className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="font-medium text-amber-900 dark:text-amber-100">
        Demo rejim — {formatRemaining(expiresAt)} qoldi
      </span>
      <span className="hidden text-amber-800/80 dark:text-amber-200/80 sm:inline">
        · Ma'lumotlar avtomatik o'chiriladi
      </span>
      <a
        href="https://clary.uz/signup"
        className="ml-auto rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
      >
        Saqlab qolish &rarr;
      </a>
    </div>
  );
}
