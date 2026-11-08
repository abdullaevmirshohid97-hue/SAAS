import { useEffect, useState } from 'react';

import { fetchLivePlans, type PublicPlans } from './plans';

/**
 * Build vaqtidagi tariflar bilan boshlanadi, so'ng brauzerda yangisini oladi
 * (super-admin o'zgartirsa — sayt qayta qurilmasdan ko'rinadi).
 */
export function useLivePlans(initial: PublicPlans | null): PublicPlans | null {
  const [pub, setPub] = useState(initial);
  useEffect(() => {
    let alive = true;
    void fetchLivePlans().then((fresh) => {
      if (alive && fresh) setPub(fresh);
    });
    return () => {
      alive = false;
    };
  }, []);
  return pub;
}

/** Xodim soniga sig'adigan eng arzon pullik tarif (ROI kalkulyatori uchun). */
export function pickPlanFor(
  pub: PublicPlans | null,
  staff: number,
): { name: string; code: string; uzs: number } | null {
  const paid = (pub?.plans ?? [])
    .filter((p) => (p.price_uzs ?? 0) > 0)
    .sort((a, b) => (a.price_uzs ?? 0) - (b.price_uzs ?? 0));
  const fit =
    paid.find((p) => p.limits.max_staff == null || p.limits.max_staff >= staff) ??
    paid[paid.length - 1];
  return fit ? { name: fit.name, code: fit.code, uzs: fit.price_uzs ?? 0 } : null;
}
