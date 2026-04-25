import { useMemo } from 'react';

import {
  computeEffectivePermissions,
  type PermissionKey,
} from '@clary/schemas';
import type { PermissionsContext } from '@clary/ui-web';

import { useAuth } from '@/providers/auth-provider';

/**
 * Returns the effective permission map for the currently logged-in user.
 * Combines base-role defaults with any custom_role + personal override that
 * were pushed into the session's app_metadata by the Supabase Auth hook.
 */
export function usePermissions(): PermissionsContext & {
  can: (perm: PermissionKey) => boolean;
  canAny: (perms: PermissionKey[]) => boolean;
  canAll: (perms: PermissionKey[]) => boolean;
} {
  const { role, session } = useAuth();
  const meta = (session?.user?.app_metadata ?? {}) as {
    custom_role_permissions?: Record<string, boolean> | null;
    permissions_override?: Record<string, boolean> | null;
  };

  const permissions = useMemo(
    () =>
      computeEffectivePermissions({
        role,
        customRolePermissions: meta.custom_role_permissions ?? null,
        permissionsOverride: meta.permissions_override ?? null,
      }),
    [role, meta.custom_role_permissions, meta.permissions_override],
  );

  return {
    role,
    permissions,
    can: (p) => permissions[p] === true,
    canAny: (ps) => ps.some((p) => permissions[p] === true),
    canAll: (ps) => ps.every((p) => permissions[p] === true),
  };
}
