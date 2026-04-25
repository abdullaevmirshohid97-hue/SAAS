import type { ReactNode } from 'react';

import type { PermissionKey } from '@clary/schemas';

export interface PermissionsContext {
  role: string;
  permissions: Partial<Record<PermissionKey, boolean>>;
}

export interface CanProps {
  /** Current user's effective permission map (from usePermissions()) */
  ctx: PermissionsContext;
  /** Require ALL listed permissions */
  perm?: PermissionKey | PermissionKey[];
  /** Require ANY of the listed permissions */
  anyOf?: PermissionKey[];
  /** Require ALL of the listed permissions (alias of `perm` when array) */
  allOf?: PermissionKey[];
  /** Role(s) that are also allowed (short-circuit; e.g. 'clinic_owner') */
  roles?: string[];
  /** Render when the check fails */
  fallback?: ReactNode;
  /** Invert the check */
  not?: boolean;
  children: ReactNode;
}

/**
 * Declarative permission gate. Usage:
 *
 *   const perms = usePermissions();
 *   <Can ctx={perms} perm="medications.create"><AddBtn /></Can>
 *   <Can ctx={perms} anyOf={['pharmacy.view','cashier.view']}>...</Can>
 */
export function Can({ ctx, perm, anyOf, allOf, roles, fallback = null, not = false, children }: CanProps) {
  const allowed = isAllowed(ctx, { perm, anyOf, allOf, roles });
  const ok = not ? !allowed : allowed;
  return <>{ok ? children : fallback}</>;
}

export function isAllowed(
  ctx: PermissionsContext,
  opts: { perm?: PermissionKey | PermissionKey[]; anyOf?: PermissionKey[]; allOf?: PermissionKey[]; roles?: string[] },
): boolean {
  if (opts.roles && opts.roles.includes(ctx.role)) return true;

  const all: PermissionKey[] = [];
  if (opts.perm) {
    all.push(...(Array.isArray(opts.perm) ? opts.perm : [opts.perm]));
  }
  if (opts.allOf) all.push(...opts.allOf);

  if (all.length > 0 && !all.every((k) => ctx.permissions[k] === true)) return false;
  if (opts.anyOf && opts.anyOf.length > 0 && !opts.anyOf.some((k) => ctx.permissions[k] === true)) return false;
  if (all.length === 0 && !opts.anyOf) return true;
  return true;
}
