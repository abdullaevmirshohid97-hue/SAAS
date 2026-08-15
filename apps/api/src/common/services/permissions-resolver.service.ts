import { ForbiddenException, Injectable } from '@nestjs/common';

import { computeEffectivePermissions } from '../rbac/permissions';
import { SupabaseService } from './supabase.service';

// =============================================================================
// Foydalanuvchining amaldagi ruxsatlari — YAGONA manba
// =============================================================================
// Ilgari bu mantiq PermissionsGuard ichida, xususiy kesh bilan turardi.
// Maydon darajasidagi filtr (FieldSecurityInterceptor) ham aynan shu
// ma'lumotga muhtoj — takrorlash bazaga ikki barobar so'rov degani edi.
//
// Kesh so'rov davomida emas, TTL bo'yicha (guard'dagi bilan bir xil).

@Injectable()
export class PermissionsResolver {
  private cache = new Map<string, { at: number; map: Record<string, boolean> }>();
  private readonly TTL = 60_000;

  constructor(private readonly supabase: SupabaseService) {}

  /** Keshdagi qiymat; bo'lmasa null (interceptor bloklamasligi uchun). */
  cached(userId: string): Record<string, boolean> | null {
    const hit = this.cache.get(userId);
    return hit && Date.now() - hit.at < this.TTL ? hit.map : null;
  }

  async resolve(userId: string): Promise<Record<string, boolean>> {
    const hit = this.cached(userId);
    if (hit) return hit;

    // Bog'lanish AYNIQ ko'rsatiladi — profiles↔custom_roles orasida 3 ta FK
    // bor va nomsiz embed PGRST201 beradi (2026-08-14 hodisasi).
    const { data, error } = await this.supabase
      .admin()
      .from('profiles')
      .select(
        'role, permissions_override, custom_role:custom_roles!fk_profiles_custom_role(permissions)',
      )
      .eq('id', userId)
      .maybeSingle();

    // Xatoni yutmaymiz: jimgina 'staff' ga tushib qolish huquqlarni
    // sababsiz pasaytirardi.
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
    }) as unknown as Record<string, boolean>;

    // `field.*` kalitlari ham shu xaritada keladi (custom rol / override
    // orqali), chunki ular bir xil Record<string, boolean> da saqlanadi.
    this.cache.set(userId, { at: Date.now(), map });
    return map;
  }

  /** Rol yoki ruxsat o'zgarganda chaqiriladi. */
  invalidate(userId: string) {
    this.cache.delete(userId);
  }
}
