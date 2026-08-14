import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { getContext } from '../context/request-context';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_PERM_KEY } from '../decorators/require-perm.decorator';
import { type PermissionKey, computeEffectivePermissions } from '../rbac/permissions';
import { SupabaseService } from '../services/supabase.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private cache = new Map<string, { at: number; map: Record<PermissionKey, boolean> }>();
  private readonly TTL = 60_000;

  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(
      REQUIRE_PERM_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required || required.length === 0) return true;

    const c = getContext();

    if (c.role === 'super_admin' || c.role === 'clinic_owner' || c.role === 'clinic_admin') {
      return true;
    }

    if (!c.userId) throw new ForbiddenException('Anonymous');

    const perms = await this.resolveForUser(c.userId);
    for (const k of required) {
      if (!perms[k]) {
        throw new ForbiddenException(`Missing permission: ${k}`);
      }
    }
    return true;
  }

  private async resolveForUser(userId: string): Promise<Record<PermissionKey, boolean>> {
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.at < this.TTL) return cached.map;

    const admin = this.supabase.admin();
    // Bog'lanish AYNIQ ko'rsatiladi — profiles↔custom_roles orasida 3 ta FK bor
    // (created_by, updated_by, custom_role_id). Nomsiz embed PGRST201 beradi.
    const { data, error } = await admin
      .from('profiles')
      .select('role, permissions_override, custom_role:custom_roles!fk_profiles_custom_role(permissions)')
      .eq('id', userId)
      .maybeSingle();

    // Xato bo'lsa JIM QOLMAYMIZ. Ilgari `data` null bo'lib, rol 'staff' ga
    // tushib qolardi va foydalanuvchi o'z ruxsatlarini sababsiz yo'qotardi
    // (dental va payroll modullari admin bo'lmagan hammaga 403 berardi).
    if (error) {
      throw new ForbiddenException(`Ruxsatlarni aniqlab bo'lmadi: ${error.message}`);
    }

    const row = data as unknown as {
      role: string;
      permissions_override: Record<string, boolean> | null;
      custom_role:
        | { permissions: Record<string, boolean> }
        | { permissions: Record<string, boolean> }[]
        | null;
    } | null;

    const cr = Array.isArray(row?.custom_role)
      ? (row?.custom_role[0] ?? null)
      : (row?.custom_role ?? null);
    const map = computeEffectivePermissions({
      role: row?.role ?? 'staff',
      customRolePermissions: cr?.permissions ?? null,
      permissionsOverride: row?.permissions_override ?? null,
    });
    this.cache.set(userId, { at: Date.now(), map });
    return map;
  }
}
