import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { SupabaseService } from '../../common/services/supabase.service';

// 0000 SHA-256 — default jurnal PIN'i. Migration bilan mos:
// 9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0
// Export: admin paneldan klinika yaratishda ham xuddi shu defaultlar ishlatiladi.
export const DEFAULT_JOURNAL_PIN_HASH = createHash('sha256').update('0000').digest('hex');

// Yangi klinika uchun default rasxot kategoriyalari.
export const DEFAULT_EXPENSE_CATEGORIES: Array<{ name_i18n: Record<string, string>; sort_order: number }> = [
  { name_i18n: { 'uz-Latn': 'Ish haqi',         ru: 'Зарплата' },           sort_order: 1 },
  { name_i18n: { 'uz-Latn': 'Ijara',            ru: 'Аренда' },             sort_order: 2 },
  { name_i18n: { 'uz-Latn': 'Kommunal',         ru: 'Коммунальные' },       sort_order: 3 },
  { name_i18n: { 'uz-Latn': 'Soliq',            ru: 'Налоги' },             sort_order: 4 },
  { name_i18n: { 'uz-Latn': 'Reklama',          ru: 'Реклама' },            sort_order: 5 },
  { name_i18n: { 'uz-Latn': 'Xizmat ko‘rsatish', ru: 'Обслуживание' }, sort_order: 6 },
  { name_i18n: { 'uz-Latn': 'Boshqa',           ru: 'Другое' },             sort_order: 7 },
];

@Injectable()
export class AuthService {
  constructor(private readonly supabase: SupabaseService) {}

  async me(user: { userId: string | null; clinicId: string | null; role: string }) {
    if (!user.userId) throw new ForbiddenException();
    const { data, error } = await this.supabase
      .admin()
      .from('profiles')
      .select('*, clinic:clinics(*)')
      .eq('id', user.userId)
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async onboardingStatus(clinicId: string | null) {
    if (!clinicId) {
      return {
        clinic: false,
        staff: false,
        service: false,
        queue: false,
        completedSteps: 0,
        totalSteps: 4,
      };
    }
    const admin = this.supabase.admin();
    const [staffRes, svcRes, queueRes] = await Promise.all([
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId),
      admin.from('services').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId),
      admin.from('queues').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId),
    ]);

    const status = {
      clinic: true,
      staff: (staffRes.count ?? 0) > 1, // more than just the owner
      service: (svcRes.count ?? 0) > 0,
      queue: (queueRes.count ?? 0) > 0,
    };
    const completedSteps = Object.values(status).filter(Boolean).length;
    return { ...status, completedSteps, totalSteps: 4 };
  }

  async slugAvailable(slug: string) {
    const { data } = await this.supabase.admin().from('clinics').select('id').eq('slug', slug).maybeSingle();
    return { available: !data };
  }

  // Chek printer sozlamalari — qog'oz kengligi, shrift, brend, QR va boshqalar.
  // Mavjud receipt_settings JSON'i bilan birlashtiriladi (partial update).
  async updateReceiptSettings(
    clinicId: string,
    patch: Record<string, unknown>,
  ) {
    const admin = this.supabase.admin();
    const { data: current } = await admin
      .from('clinics')
      .select('receipt_settings')
      .eq('id', clinicId)
      .single();
    const merged = {
      ...(((current as { receipt_settings: Record<string, unknown> } | null)?.receipt_settings) ?? {}),
      ...patch,
    };
    const { data, error } = await admin
      .from('clinics')
      .update({ receipt_settings: merged })
      .eq('id', clinicId)
      .select('receipt_settings')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Umumiy klinika sozlamalari (clinics.settings JSONB) — partial merge.
  // Hozircha: reception_pharmacy_enabled (qabulxonada "Dori bilan" tugmasi).
  async updateClinicSettings(clinicId: string, patch: Record<string, unknown>) {
    const admin = this.supabase.admin();
    const { data: current } = await admin
      .from('clinics')
      .select('settings')
      .eq('id', clinicId)
      .single();
    const merged = {
      ...(((current as { settings: Record<string, unknown> } | null)?.settings) ?? {}),
      ...patch,
    };
    const { data, error } = await admin
      .from('clinics')
      .update({ settings: merged })
      .eq('id', clinicId)
      .select('settings')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async completeOnboarding(userId: string, input: {
    clinicName: string; slug: string; country: string; region?: string; city?: string;
    timezone: string; defaultLocale: string; organizationType: string;
    logoUrl?: string; primaryColor?: string;
  }) {
    const admin = this.supabase.admin();

    // 1. Create clinic — default jurnal PIN '0000' bilan
    const { data: clinic, error: clinicErr } = await admin
      .from('clinics')
      .insert({
        slug: input.slug,
        name: input.clinicName,
        country: input.country,
        region: input.region,
        city: input.city,
        timezone: input.timezone,
        default_locale: input.defaultLocale,
        organization_type: input.organizationType,
        logo_url: input.logoUrl,
        primary_color: input.primaryColor ?? '#2563EB',
        current_plan: 'demo',
        subscription_status: 'trialing',
        // Demo: 3 kun — bu vaqtda xodim/qurilma bog'lanadi, test qilinadi.
        // Keyin tarif tanlab "1 oy bepul" trial (start_trial RPC).
        trial_ends_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        // Default PIN: 0000 — yangi klinika jurnalga darhol kira oladi
        journal_pin_hash: DEFAULT_JOURNAL_PIN_HASH,
        journal_pin_set_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (clinicErr) throw new BadRequestException(clinicErr.message);

    // 2. Attach user as clinic_admin + set JWT claims
    const { error: setErr } = await admin.rpc('set_user_clinic' as never, {
      p_user_id: userId,
      p_clinic_id: clinic.id,
      p_role: 'clinic_admin',
    } as never);
    if (setErr) throw new BadRequestException(setErr.message);

    // 3. Default rasxot kategoriyalari — kassada darhol ko'rinadi
    const categoryRows = DEFAULT_EXPENSE_CATEGORIES.map((c) => ({
      clinic_id: clinic.id,
      name_i18n: c.name_i18n,
      sort_order: c.sort_order,
      created_by: userId,
    }));
    await admin.from('expense_categories').insert(categoryRows);

    return { clinic };
  }
}
