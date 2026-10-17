import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_ENTITLEMENTS,
  moduleEnabled,
  normalizeEntitlements,
  paymentMethodAllowed,
  resolveRouteModule,
  roleAllowed,
  type Entitlements,
} from '@clary/schemas';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

/**
 * Klinikaning amaldagi tarif imkoniyatlari (super-admin tarif muharriri +
 * individual kelishuv). Yuklanmaguncha / xato bo'lsa — hammasi ochiq (server
 * baribir o'zi tekshiradi; UI faqat keraksiz tugmalarni yashiradi).
 * Alohida dorixona kirishi tarif cheklovlariga bog'liq emas.
 */
export function useEntitlements() {
  const { clinicId, workspace } = useAuth();
  const enabled = !!clinicId && workspace === 'clinic';
  const q = useQuery({
    queryKey: ['entitlements', clinicId],
    queryFn: () => api.entitlements.me(),
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const ent: Entitlements | null = useMemo(
    () => (enabled && q.data ? normalizeEntitlements(q.data) : null),
    [enabled, q.data],
  );

  const hasModule = useCallback((key: string) => moduleEnabled(ent, key), [ent]);
  const routeAllowed = useCallback(
    (path: string) => {
      const m = resolveRouteModule(path);
      return !m || moduleEnabled(ent, m);
    },
    [ent],
  );
  const payAllowed = useCallback((method: string) => paymentMethodAllowed(ent, method), [ent]);
  const canUseRole = useCallback((role: string) => roleAllowed(ent, role), [ent]);

  return {
    ent,
    loaded: !enabled || q.isFetched,
    hasModule,
    routeAllowed,
    payAllowed,
    canUseRole,
    journal: ent?.journal ?? DEFAULT_ENTITLEMENTS.journal,
    customRoles: ent?.roles.custom_roles ?? true,
  };
}
