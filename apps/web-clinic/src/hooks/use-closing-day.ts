import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { resolveClosingDay } from '@/lib/finance-periods';

/**
 * Klinikaning oy yopish kuni (`clinics.settings.finance_closing_day`).
 * Sozlama bo'lmasa localStorage, u ham bo'lmasa 10 — batafsil izoh
 * `lib/finance-periods.ts` dagi `resolveClosingDay` da.
 */
export function useClosingDay(): number {
  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: () =>
      api.get<{ clinic?: { settings?: { finance_closing_day?: number } } }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
  return resolveClosingDay(data?.clinic?.settings?.finance_closing_day);
}
