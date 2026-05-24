import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';

import { type PermissionKey } from '@clary/schemas';

import { useAuth } from '@/providers/auth-provider';

/**
 * Foydalanuvchi role'ga qarab uy sahifasini tanlash.
 * Receptionist -> /reception, doctor -> /doctor, cashier -> /cashier,
 * boshqalar -> /dashboard.
 */
export function RoleHome() {
  const { role, loading } = useAuth();
  if (loading) return null;
  const home = roleHomePath(role);
  return <Navigate to={home} replace />;
}

export function roleHomePath(role: string): string {
  switch (role) {
    case 'receptionist':
      return '/reception';
    case 'doctor':
      return '/doctor';
    case 'cashier':
      return '/cashier';
    case 'nurse':
      return '/nurse';
    default:
      return '/dashboard';
  }
}

/**
 * Sahifa uchun permission tekshiruvi. Yo'q bo'lsa role uyiga qaytadi.
 * Foydalanuvchi URL'ni qo'lda kiritsa ham himoyalanadi.
 *
 * Strict PermissionKey — kompilyatsiya paytida noma'lum permission keys
 * (typo) aniqlanadi. Eski `as never` bypass olib tashlandi.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: PermissionKey;
  children: ReactNode;
}) {
  const { role, can, loading } = useAuth();
  if (loading) return null;
  if (!can(permission)) {
    return <Navigate to={roleHomePath(role)} replace />;
  }
  return <>{children}</>;
}
