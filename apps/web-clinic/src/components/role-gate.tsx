import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';

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
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const { role, can, loading } = useAuth();
  if (loading) return null;
  // PermissionKey strict tip — bizda runtime string. Cast: o'lcham
  // dinamik (route'da har xil), can() o'zi noma'lum kalitni false beradi.
  if (!can(permission as never)) {
    return <Navigate to={roleHomePath(role)} replace />;
  }
  return <>{children}</>;
}
