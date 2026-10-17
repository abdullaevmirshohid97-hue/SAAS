import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_ENTITLEMENTS,
  moduleEnabled,
  moduleLabel,
  normalizeEntitlements,
  paymentMethodAllowed,
  roleAllowed,
  type Entitlements,
} from '@clary/schemas';

import { SupabaseService } from '../services/supabase.service';

// =============================================================================
// Klinikaning amaldagi tarif imkoniyatlari — YAGONA o'qish nuqtasi.
// Manba: bazadagi clinic_effective_entitlements() (tarif + HQ + klinika
// kelishuvi). Qisqa kesh: har so'rovda bazaga bormaslik uchun; super-admin
// o'zgartirsa invalidate() chaqiriladi (bitta jarayon — darhol amal qiladi).
//
// FAIL-OPEN: imkoniyatlarni o'qib bo'lmasa (masalan migratsiya hali
// qo'llanmagan) — cheklov qo'yilmaydi. Tarif cheklovi xizmat to'xtashiga
// sabab bo'lmasligi kerak.
// =============================================================================

@Injectable()
export class EntitlementsService {
  private readonly log = new Logger('Entitlements');
  private readonly cache = new Map<string, { at: number; value: Entitlements | null }>();
  private readonly TTL = 60_000;

  constructor(private readonly supabase: SupabaseService) {}

  /** Amaldagi imkoniyatlar; o'qib bo'lmasa null (= cheklovsiz). */
  async get(clinicId: string): Promise<Entitlements | null> {
    const hit = this.cache.get(clinicId);
    if (hit && Date.now() - hit.at < this.TTL) return hit.value;
    let value: Entitlements | null = null;
    try {
      const { data, error } = await this.supabase
        .admin()
        .rpc('clinic_effective_entitlements' as never, { p_clinic: clinicId } as never);
      if (error) throw new Error(error.message);
      value = data ? normalizeEntitlements(data) : null;
    } catch (e) {
      // Bir marta ogohlantirish — keyingi TTL davomida kesh (null) ishlaydi
      this.log.warn(`clinic_effective_entitlements(${clinicId}): ${(e as Error).message}`);
      value = null;
    }
    this.cache.set(clinicId, { at: Date.now(), value });
    return value;
  }

  /** Frontend uchun: hech qachon null emas (cheklovsiz = DEFAULT). */
  async getOrDefault(clinicId: string): Promise<Entitlements> {
    return (await this.get(clinicId)) ?? DEFAULT_ENTITLEMENTS;
  }

  invalidate(clinicId?: string) {
    if (clinicId) this.cache.delete(clinicId);
    else this.cache.clear();
  }

  async assertModule(clinicId: string, key: string) {
    const e = await this.get(clinicId);
    if (!moduleEnabled(e, key)) throw moduleDisabled(key);
  }

  async assertRole(clinicId: string, role: string) {
    const e = await this.get(clinicId);
    if (!roleAllowed(e, role)) {
      throw new ForbiddenException({
        error: 'ROLE_NOT_ALLOWED',
        message: `"${role}" roli tarifingizga kirmaydi. Tarifni yangilang yoki Clary bilan bog'laning.`,
      });
    }
  }

  async assertCustomRoles(clinicId: string) {
    const e = await this.get(clinicId);
    if (e && !e.roles.custom_roles) {
      throw new ForbiddenException({
        error: 'CUSTOM_ROLES_NOT_ALLOWED',
        message: 'Maxsus rollar tarifingizga kirmaydi. Tarifni yangilang.',
      });
    }
  }

  async assertPaymentMethods(clinicId: string, methods: Array<string | null | undefined>) {
    const e = await this.get(clinicId);
    for (const m of methods) {
      if (m && !paymentMethodAllowed(e, m)) {
        throw new BadRequestException({
          error: 'PAYMENT_METHOD_NOT_ALLOWED',
          message: `To'lov turi tarifingizda ruxsat etilmagan: ${m}`,
        });
      }
    }
  }

  /** Jurnal/hisobot oralig'ini tarif chegarasiga qisadi (YYYY-MM-DD yoki ISO). */
  async clampHistoryFrom(clinicId: string, from: string | undefined): Promise<string | undefined> {
    const e = await this.get(clinicId);
    const days = e?.journal.history_days;
    if (days == null || !from) return from;
    const min = new Date(Date.now() - days * 86_400_000);
    const minDay = new Date(min.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
    const day = from.slice(0, 10);
    return day < minDay ? (from.length > 10 ? `${minDay}${from.slice(10)}` : minDay) : from;
  }

  async assertMaxPatients(clinicId: string) {
    const e = await this.get(clinicId);
    const max = e?.limits.max_patients;
    if (max == null) return;
    const { count } = await this.supabase
      .admin()
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .is('deleted_at', null);
    if ((count ?? 0) >= max) {
      throw new ForbiddenException({
        error: 'PATIENT_LIMIT',
        message: `Tarif cheklovi: ${max} ta bemor. Tarifni yangilang.`,
      });
    }
  }
}

export function moduleDisabled(key: string) {
  return new ForbiddenException({
    error: 'MODULE_DISABLED',
    message: `"${moduleLabel(key)}" moduli tarifingizga kirmaydi`,
    details: { module: key },
  });
}
