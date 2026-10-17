import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button } from '@clary/ui-web';
import { ENTITLEMENT_MODULES, resolveRouteModule } from '@clary/schemas';

import { useEntitlements } from '@/hooks/use-entitlements';

/**
 * Tarifda yopiq modul sahifasi — bo'sh/xato ekran o'rniga tushunarli xabar.
 * Menyudan yashiriladi, lekin to'g'ridan-to'g'ri havola bilan ochilsa shu
 * oyna chiqadi (server baribir 403 MODULE_DISABLED qaytaradi).
 */
export function ModuleGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { hasModule, loaded } = useEntitlements();
  const key = resolveRouteModule(pathname);
  if (!loaded || !key || hasModule(key)) return <>{children}</>;
  const mod = ENTITLEMENT_MODULES.find((m) => m.key === key);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="bg-card w-full max-w-md rounded-2xl border p-8 text-center shadow-sm">
        <div className="bg-primary/10 mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full">
          <Lock className="text-primary h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold">“{mod?.label ?? key}” tarifingizga kirmaydi</h1>
        {mod?.description && (
          <p className="text-muted-foreground mt-2 text-sm">{mod.description}.</p>
        )}
        <p className="text-muted-foreground mt-3 text-sm">
          Bu bo‘limni yoqish uchun tarifni kengaytiring yoki Clary bilan bog‘laning. Avval
          kiritilgan ma’lumotlaringiz o‘chirilmagan — modul yoqilganda hammasi joyida bo‘ladi.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link to="/settings/subscription">
            <Button className="w-full sm:w-auto">Tariflar va obuna</Button>
          </Link>
          <Link to="/dashboard">
            <Button variant="outline" className="w-full sm:w-auto">
              Bosh sahifa
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
