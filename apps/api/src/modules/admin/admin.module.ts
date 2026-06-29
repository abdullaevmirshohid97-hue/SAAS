import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { SupabaseService } from '../../common/services/supabase.service';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_JOURNAL_PIN_HASH } from '../auth/auth.service';

const CreateTenantSchema = z.object({
  name: z.string().min(2).max(160),
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, "Slug faqat kichik lotin harf, raqam va '-'"),
  city: z.string().max(80).optional(),
  plan: z.enum(['demo', '25pro', '50pro', '120pro']).optional(),
  owner_email: z.string().email(),
  owner_full_name: z.string().max(120).optional(),
});

const InsuranceProviderSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[a-z0-9_-]+$/, "Kod faqat kichik lotin harf, raqam, '-', '_'"),
  name: z.string().min(2).max(160),
  legal_name: z.string().max(200).optional(),
  type: z.enum(['dms', 'oms', 'other']).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional(),
  website: z.string().max(200).optional(),
  sort_order: z.number().int().optional(),
});

const ImpersonateSchema = z.object({
  target_clinic_id: z.string().uuid(),
  target_user_id: z.string().uuid(),
  reason: z.string().min(20),
  support_ticket_id: z.string().uuid().optional(),
});

const FeatureFlagSchema = z.object({
  clinic_id: z.string().uuid(),
  feature: z.string().min(1),
  enabled: z.boolean(),
  reason: z.string().optional(),
});

@Injectable()
class AdminService {
  constructor(private readonly supabase: SupabaseService) {}

  async listTenants(q?: string, includeDeleted = false) {
    let query = this.supabase.admin().from('clinics').select('*');
    if (!includeDeleted) query = query.is('deleted_at', null);
    if (q) query = query.ilike('name', `%${q}%`);
    const { data } = await query.order('created_at', { ascending: false }).limit(200);
    return data ?? [];
  }

  // Klinika tahriri — nom/slug. Slug uniqueligi tekshiriladi.
  async updateTenant(id: string, input: { name?: string; slug?: string }) {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) {
      const { data: existing } = await this.supabase
        .admin()
        .from('clinics')
        .select('id')
        .eq('slug', input.slug)
        .neq('id', id)
        .maybeSingle();
      if (existing) throw new BadRequestException("Bu slug allaqachon band");
      patch.slug = input.slug;
    }
    if (Object.keys(patch).length === 0) throw new BadRequestException('Hech narsa o\'zgartirilmadi');
    const { data, error } = await this.supabase.admin().from('clinics').update(patch).eq('id', id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Klinika yaratish — admin paneldan (signup oqimisiz). Auth user + clinic +
  // set_user_clinic RPC + default rasxot kategoriyalari; egasiga magic-link.
  async createTenant(input: {
    name: string;
    slug: string;
    city?: string;
    plan?: string;
    owner_email: string;
    owner_full_name?: string;
  }) {
    const admin = this.supabase.admin();

    // 1) Slug bandligini tekshirish
    const { data: slugTaken } = await admin
      .from('clinics')
      .select('id')
      .eq('slug', input.slug)
      .maybeSingle();
    if (slugTaken) throw new BadRequestException('Bu slug allaqachon band');

    // 2) Egasining auth useri — yangi yaratamiz; email band bo'lsa aniq xabar.
    //    (Mavjud userni boshqa klinikaga ulash xavfli — alohida oqim bo'lishi kerak.)
    const { data: created, error: userErr } = await admin.auth.admin.createUser({
      email: input.owner_email,
      email_confirm: true,
      user_metadata: { full_name: input.owner_full_name ?? input.name },
    });
    if (userErr) {
      const msg = /already|exist|registered/i.test(userErr.message)
        ? "Bu email allaqachon ro'yxatdan o'tgan — mavjud userni klinikaga ulash uchun signup oqimini ishlating"
        : userErr.message;
      throw new BadRequestException(msg);
    }
    const ownerId = created.user.id;

    // 3) Klinika — onboarding'dagi defaultlar bilan (PIN 0000, trialing).
    const { data: clinic, error: clinicErr } = await admin
      .from('clinics')
      .insert({
        slug: input.slug,
        name: input.name,
        country: 'UZ',
        city: input.city ?? null,
        timezone: 'Asia/Tashkent',
        default_locale: 'uz-Latn',
        organization_type: 'clinic',
        primary_color: '#2563EB',
        current_plan: input.plan ?? 'demo',
        subscription_status: 'trialing',
        // Admin yaratgan klinikaga 14 kun sinov — signup'dagi 3 kundan ko'proq,
        // chunki bu odatda kelishilgan mijoz.
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        journal_pin_hash: DEFAULT_JOURNAL_PIN_HASH,
        journal_pin_set_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (clinicErr) {
      // Klinika yaratilmadi — yetim auth user qoldirmaymiz.
      await admin.auth.admin.deleteUser(ownerId).catch(() => undefined);
      throw new BadRequestException(clinicErr.message);
    }

    // 4) Egasini clinic_admin sifatida ulash (JWT claims bilan)
    const { error: setErr } = await admin.rpc('set_user_clinic' as never, {
      p_user_id: ownerId,
      p_clinic_id: clinic.id,
      p_role: 'clinic_admin',
    } as never);
    if (setErr) throw new BadRequestException(setErr.message);

    // 5) Default rasxot kategoriyalari
    await admin.from('expense_categories').insert(
      DEFAULT_EXPENSE_CATEGORIES.map((c) => ({
        clinic_id: clinic.id,
        name_i18n: c.name_i18n,
        sort_order: c.sort_order,
        created_by: ownerId,
      })),
    );

    // 6) Egasiga magic-link — admin uni mijozga yuboradi.
    const origin = process.env.APP_URL ?? 'https://app.clary.uz';
    const { data: linkData } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: input.owner_email,
      options: { redirectTo: `${origin}/` },
    });

    return {
      clinic,
      owner_user_id: ownerId,
      magic_link: linkData?.properties?.action_link ?? null,
    };
  }

  // Soft delete — deleted_at to'ldiriladi, faol obuna bekor qilinadi.
  async softDeleteTenant(id: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin.from('clinics').update({ deleted_at: new Date().toISOString() }).eq('id', id).select().single();
    if (error) throw new BadRequestException(error.message);
    // Faol obunalarni bekor qilamiz — yangi to'lovlar olmaslik uchun.
    await admin.from('subscriptions').update({ status: 'canceled' }).eq('clinic_id', id).in('status', ['active', 'trialing', 'past_due']);
    return data;
  }

  async restoreTenant(id: string) {
    const { data, error } = await this.supabase.admin().from('clinics').update({ deleted_at: null }).eq('id', id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // 4020-kod bilan ARXIVGA o'tkazish (soft-delete) — ma'lumot saqlanadi, Arxiv
  // modulida ko'rinadi, qaytarish mumkin. Kod HARD_DELETE_CODE (default '4020').
  async archiveByCode(id: string, code: string) {
    const expected = process.env.HARD_DELETE_CODE ?? '4020';
    if ((code ?? '').trim() !== expected) {
      throw new ForbiddenException("Kod noto'g'ri — arxivga o'tkazilmadi");
    }
    return this.softDeleteTenant(id);
  }

  // Arxivlangan klinikalar (deleted_at NOT NULL) + bemor/tranzaksiya sanog'i.
  async listArchivedTenants() {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('clinics')
      .select('id, name, current_plan, deleted_at, created_at')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });
    const rows = (data ?? []) as Array<{
      id: string; name: string; current_plan: string | null; deleted_at: string; created_at: string;
    }>;
    return Promise.all(
      rows.map(async (c) => {
        const [p, t] = await Promise.all([
          admin.from('patients').select('id', { count: 'exact', head: true }).eq('clinic_id', c.id),
          admin.from('transactions').select('id', { count: 'exact', head: true }).eq('clinic_id', c.id),
        ]);
        return { ...c, patients: p.count ?? 0, transactions: t.count ?? 0 };
      }),
    );
  }

  // "Sudo mode" — xavfli amal oldidan adminning o'z parolini qayta tekshirish.
  // TOTP'ni server tomonda tekshirib bo'lmaydi; parol re-auth standart yechim.
  private async verifyAdminPassword(adminUserId: string, password: string) {
    if (!password) throw new ForbiddenException('Parol qayta-tasdiqlash talab qilinadi');
    const { data: profile } = await this.supabase
      .admin()
      .from('profiles')
      .select('email')
      .eq('id', adminUserId)
      .maybeSingle();
    const email = (profile as { email?: string } | null)?.email;
    if (!email) throw new ForbiddenException('Admin profili topilmadi');

    // Anon klient bilan signIn — parol noto'g'ri bo'lsa xato qaytadi.
    // Sessiya saqlanmaydi (persistSession: false), faqat tekshiruv.
    const probe = createClient(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_ANON_KEY ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error } = await probe.auth.signInWithPassword({ email, password });
    if (error) throw new ForbiddenException("Parol noto'g'ri — hard-delete bekor qilindi");
  }

  // Hard delete — klinika va uning BARCHA ma'lumotlari qaytarib bo'lmas
  // darajada o'chiriladi. Cascade DB FK'lari, auth.users, va Supabase Storage
  // fayllari ham tozalanadi. Qo'shimcha himoya: admin parolini qayta tasdiqlash.
  async hardDeleteTenant(id: string, confirmName: string, adminUserId: string, password: string) {
    await this.verifyAdminPassword(adminUserId, password);
    const admin = this.supabase.admin();

    // 1) Klinika nomi va deleted_at holatini tekshirish
    const { data: clinic, error: fetchErr } = await admin
      .from('clinics')
      .select('id, name, deleted_at')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) throw new BadRequestException(fetchErr.message);
    if (!clinic) throw new BadRequestException('Klinika topilmadi');
    const row = clinic as { id: string; name: string; deleted_at: string | null };
    if (!row.deleted_at) {
      throw new BadRequestException("Avval soft-delete qiling, keyin hard-delete amalga oshiriladi");
    }
    if (row.name.trim().toLowerCase() !== (confirmName ?? '').trim().toLowerCase()) {
      throw new BadRequestException('Klinika nomi tasdiqlash bilan mos kelmadi');
    }

    // 2) Storage + auth.users + clinics (CASCADE) — to'liq tozalash.
    await this.purgeClinic(id);
    return { ok: true, deleted_clinic_id: id, deleted_name: row.name };
  }

  // 4020-kod bilan to'g'ridan-to'g'ri hard-delete — super-admin "Batafsil > Tahrir"
  // ichidagi xavfli zona uchun. Soft-delete shart emas; HARD_DELETE_CODE (default
  // '4020') tasdiq vazifasini bajaradi. SuperAdminGuard controllerda himoyalaydi.
  async hardDeleteByCode(id: string, code: string) {
    const expected = process.env.HARD_DELETE_CODE ?? '4020';
    if ((code ?? '').trim() !== expected) {
      throw new ForbiddenException("Kod noto'g'ri — klinika o'chirilmadi");
    }
    const admin = this.supabase.admin();
    const { data: clinic, error: fetchErr } = await admin
      .from('clinics')
      .select('id, name')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) throw new BadRequestException(fetchErr.message);
    if (!clinic) throw new BadRequestException('Klinika topilmadi');
    const row = clinic as { id: string; name: string };
    await this.purgeClinic(id);
    return { ok: true, deleted_clinic_id: id, deleted_name: row.name };
  }

  // Klinika va BARCHA bog'liq ma'lumotni qaytarib bo'lmas darajada o'chiradi:
  // Storage fayllari, auth.users, clinics (DB FK CASCADE). hard-delete oqimlari ishlatadi.
  private async purgeClinic(id: string) {
    const admin = this.supabase.admin();
    // 1) Storage tozalash — staff-files va staff-documents (klinika ID prefiks)
    for (const bucket of ['staff-files', 'staff-documents']) {
      try {
        let offset = 0;
        while (true) {
          const { data: files, error: listErr } = await admin.storage
            .from(bucket)
            .list(id, { limit: 100, offset });
          if (listErr || !files || files.length === 0) break;
          const paths = files.map((f) => `${id}/${f.name}`);
          await admin.storage.from(bucket).remove(paths);
          if (files.length < 100) break;
          offset += 100;
        }
      } catch {
        // bucket bo'lmasa yoki ruxsat yo'q bo'lsa o'tkazib yuboramiz
      }
    }

    // 2) auth.users tozalash — profiles ON DELETE CASCADE orqali avtomatik o'chadi
    const { data: profiles } = await admin
      .from('profiles')
      .select('id')
      .eq('clinic_id', id);
    for (const p of ((profiles ?? []) as Array<{ id: string }>)) {
      try {
        await (admin as unknown as {
          auth: { admin: { deleteUser: (uid: string) => Promise<unknown> } };
        }).auth.admin.deleteUser(p.id);
      } catch {
        // ignore — profile soft-disable bo'lsa ham clinics delete'da CASCADE oladi
      }
    }

    // 3) clinics jadvalini o'chirish — barcha bog'liq jadvallar CASCADE bilan tozalanadi
    const { error: delErr } = await admin.from('clinics').delete().eq('id', id);
    if (delErr) throw new BadRequestException(`Klinika o'chirishda xato: ${delErr.message}`);
  }

  // ---------------------------------------------------------------------------
  // Plans (tariflar) — admin paneldan tahrir
  // ---------------------------------------------------------------------------
  async listPlansAdmin() {
    const { data } = await this.supabase
      .admin()
      .from('plans')
      .select('id, code, name, price_usd_cents, price_uzs, price_yearly_uzs, max_staff, max_devices, max_patients, features, is_active, sort_order')
      .order('sort_order');
    return data ?? [];
  }

  async updatePlan(
    code: string,
    input: {
      name?: string;
      price_uzs?: number;
      price_yearly_uzs?: number;
      max_staff?: number | null;
      max_devices?: number | null;
      max_patients?: number | null;
      is_active?: boolean;
    },
  ) {
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) if (v !== undefined) patch[k] = v;
    if (Object.keys(patch).length === 0) throw new BadRequestException('Hech narsa o\'zgartirilmadi');
    const { data, error } = await this.supabase.admin().from('plans').update(patch).eq('code', code).select().single();
    if (error) throw new BadRequestException(error.message);

    // Landing CMS sinxron: pricing sahifa narx/nomni site_entries plan.<code>
    // entrysidan oladi — bu yerda yangilamaslik saytda eski narx qolishiga olib
    // keladi. Xato bo'lsa plan saqlanishini buzmaymiz (best-effort).
    await this.syncPlanToSiteEntry(code, data as Record<string, unknown>).catch(() => undefined);

    return data;
  }

  /** plans jadvalidagi o'zgarishni site_entries plan.<code> ga ko'chiradi. */
  private async syncPlanToSiteEntry(code: string, plan: Record<string, unknown>) {
    const admin = this.supabase.admin();
    const { data: entry } = await admin
      .from('site_entries')
      .select('id, content_i18n, data')
      .eq('key', `plan.${code}`)
      .maybeSingle();
    if (!entry) return;

    const row = entry as {
      id: string;
      content_i18n: Record<string, Record<string, unknown>>;
      data: Record<string, unknown>;
    };
    const nextData = { ...row.data };
    if (typeof plan.price_usd_cents === 'number') nextData.price_usd = Math.round(plan.price_usd_cents / 100);
    if (typeof plan.price_uzs === 'number') nextData.price_uzs = plan.price_uzs;
    if (typeof plan.price_yearly_uzs === 'number') nextData.price_yearly_uzs = plan.price_yearly_uzs;

    const nextContent = { ...row.content_i18n };
    if (typeof plan.name === 'string' && plan.name) {
      for (const loc of Object.keys(nextContent)) {
        nextContent[loc] = { ...nextContent[loc], name: plan.name };
      }
    }

    // To'g'ridan-to'g'ri published holatga yozamiz (narx — texnik fakt, qoralama
    // bosqichi kerak emas); rebuild'dan keyin saytda ko'rinadi.
    await admin
      .from('site_entries')
      .update({ content_i18n: nextContent, data: nextData })
      .eq('id', row.id);
  }

  // ---------------------------------------------------------------------------
  // Insurance providers (markaziy direktoriya) — super-admin boshqaradi
  // ---------------------------------------------------------------------------
  async listInsuranceProviders() {
    const { data } = await this.supabase
      .admin()
      .from('insurance_providers')
      .select('id, code, name, legal_name, type, logo_url, phone, email, website, integration_mode, api_base, api_key, is_active, sort_order')
      .order('sort_order');
    return data ?? [];
  }

  async createInsuranceProvider(input: {
    code: string; name: string; legal_name?: string; type?: string;
    phone?: string; email?: string; website?: string; sort_order?: number;
  }) {
    const { data, error } = await this.supabase
      .admin()
      .from('insurance_providers')
      .insert({
        code: input.code, name: input.name, legal_name: input.legal_name ?? null,
        type: input.type ?? 'dms', phone: input.phone ?? null, email: input.email ?? null,
        website: input.website ?? null, sort_order: input.sort_order ?? 0,
      })
      .select('id').single();
    if (error) throw new BadRequestException(error.message);
    return { id: (data as { id: string }).id };
  }

  async updateInsuranceProvider(id: string, input: Record<string, unknown>) {
    const allowed = ['name', 'legal_name', 'type', 'logo_url', 'phone', 'email', 'website', 'integration_mode', 'api_base', 'api_key', 'is_active', 'sort_order'];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (input[k] !== undefined) patch[k] = input[k];
    if (Object.keys(patch).length === 0) throw new BadRequestException('Hech narsa o\'zgartirilmadi');
    const { data, error } = await this.supabase.admin().from('insurance_providers').update(patch).eq('id', id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ---------------------------------------------------------------------------
  // Support chat — admin xabar o'qish/yozish
  // ---------------------------------------------------------------------------
  async listSupportMessages(threadId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('support_messages')
      .select('id, thread_id, sender_user_id, sender_role, body, attachments, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async sendSupportMessage(threadId: string, senderId: string, body: string) {
    const admin = this.supabase.admin();
    const { data: thread } = await admin
      .from('support_threads')
      .select('id, clinic_id, status')
      .eq('id', threadId)
      .maybeSingle();
    if (!thread) throw new NotFoundException('Thread topilmadi');
    const clinicId = (thread as { clinic_id: string }).clinic_id;
    const { data, error } = await admin
      .from('support_messages')
      .insert({
        thread_id: threadId,
        clinic_id: clinicId,
        sender_user_id: senderId,
        sender_role: 'admin',
        body,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    // Thread holatini "open" qaytarish — agar closed bo'lsa.
    await admin.from('support_threads').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', threadId);
    return data;
  }

  // ---------------------------------------------------------------------------
  // Telegram bots — klinikalar botlari
  // ---------------------------------------------------------------------------
  async listTelegramBots() {
    const { data } = await this.supabase
      .admin()
      .from('telegram_bots')
      .select('id, clinic_id, bot_username, is_active, registered_at, clinic:clinics(id, name)')
      .order('registered_at', { ascending: false });
    return data ?? [];
  }

  async toggleTelegramBot(botId: string, isActive: boolean) {
    const { data, error } = await this.supabase
      .admin()
      .from('telegram_bots')
      .update({ is_active: isActive })
      .eq('id', botId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ---------------------------------------------------------------------------
  // Sales leads — web-sayt kontakt/demo formasidan
  // ---------------------------------------------------------------------------
  async listLeads(params: { status?: string; q?: string; limit?: number; offset?: number }) {
    let q = this.supabase
      .admin()
      .from('sales_leads')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 50) - 1);
    if (params.status) q = q.eq('status', params.status);
    if (params.q) q = q.or(`full_name.ilike.%${params.q}%,email.ilike.%${params.q}%,phone.ilike.%${params.q}%,clinic_name.ilike.%${params.q}%`);
    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return { items: data ?? [], total: count ?? 0 };
  }

  async updateLead(id: string, input: { status?: string; notes?: string; assigned_to?: string | null }) {
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) if (v !== undefined) patch[k] = v;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await this.supabase.admin().from('sales_leads').update(patch).eq('id', id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getTenant(id: string) {
    const { data } = await this.supabase.admin().from('clinics').select('*, profiles(id, email, full_name, role), current_subscription:subscriptions(*)').eq('id', id).single();
    return data;
  }

  async suspend(id: string, reason: string) {
    const { data } = await this.supabase.admin().from('clinics').update({ is_suspended: true, suspension_reason: reason }).eq('id', id).select().single();
    return data;
  }

  async unsuspend(id: string) {
    const { data } = await this.supabase.admin().from('clinics').update({ is_suspended: false, suspension_reason: null }).eq('id', id).select().single();
    return data;
  }

  // Impersonatsiya tarixi — kim qachon qaysi klinikaga kirgan (audit).
  async listImpersonations(params: { clinic_id?: string; days?: number; limit?: number }) {
    const since = new Date(Date.now() - (params.days ?? 90) * 24 * 60 * 60 * 1000).toISOString();
    let q = this.supabase
      .admin()
      .from('admin_impersonation_sessions')
      .select(
        'id, reason, started_at, ended_at, support_ticket_id, ' +
          'admin:profiles!admin_impersonation_sessions_super_admin_id_fkey(full_name, email), ' +
          'target:profiles!admin_impersonation_sessions_target_user_id_fkey(full_name, email), ' +
          'clinic:clinics(id, name)',
      )
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(Math.min(params.limit ?? 200, 500));
    if (params.clinic_id) q = q.eq('target_clinic_id', params.clinic_id);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((r) => {
      const row = r as unknown as {
        id: string; reason: string; started_at: string; ended_at: string | null;
        support_ticket_id: string | null;
        admin?: { full_name?: string | null; email?: string | null } | null;
        target?: { full_name?: string | null; email?: string | null } | null;
        clinic?: { id: string; name: string } | null;
      };
      return {
        id: row.id,
        reason: row.reason,
        started_at: row.started_at,
        ended_at: row.ended_at,
        support_ticket_id: row.support_ticket_id,
        admin_name: row.admin?.full_name ?? row.admin?.email ?? '—',
        target_name: row.target?.full_name ?? row.target?.email ?? '—',
        clinic_id: row.clinic?.id ?? null,
        clinic_name: row.clinic?.name ?? '—',
      };
    });
  }

  async impersonate(superAdminId: string, input: z.infer<typeof ImpersonateSchema>) {
    const { data: session } = await this.supabase.admin().from('admin_impersonation_sessions').insert({
      super_admin_id: superAdminId,
      target_clinic_id: input.target_clinic_id,
      target_user_id: input.target_user_id,
      reason: input.reason,
      support_ticket_id: input.support_ticket_id,
    }).select().single();
    // Real impl: mint a 30-min JWT with { sub: target_user, app_metadata: { clinic_id, role, impersonated_by } }
    return { session, note: 'JWT issuance pending secure signing setup' };
  }

  async setFeatureFlag(input: z.infer<typeof FeatureFlagSchema>, enabledBy: string) {
    const { data } = await this.supabase.admin().from('clinic_features').upsert({
      clinic_id: input.clinic_id,
      feature: input.feature,
      enabled: input.enabled,
      reason: input.reason,
      enabled_at: input.enabled ? new Date().toISOString() : null,
      enabled_by: enabledBy,
    }, { onConflict: 'clinic_id,feature' }).select().single();
    return data;
  }

  async revenue() {
    const { data: invoices } = await this.supabase.admin().from('invoices').select('amount_usd_cents, status, issued_at');
    const totalRevenueCents = (invoices ?? []).filter((i) => i['status'] === 'paid').reduce((s, i) => s + (i['amount_usd_cents'] as number), 0);
    const { count: activeSubs } = await this.supabase.admin().from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active');
    return { totalRevenueUsd: totalRevenueCents / 100, activeSubscriptions: activeSubs ?? 0 };
  }

  async overview() {
    const admin = this.supabase.admin();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();

    const [
      tenantsHead,
      activeTenantsHead,
      doctorsHead,
      medicationsHead,
      activeSubsHead,
      trialHead,
      openTicketsHead,
      paidInvoices,
      recentClinics,
      txAgg,
      debts,
    ] = await Promise.all([
      admin.from('clinics').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      admin.from('clinics').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('is_suspended', false),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'doctor'),
      admin.from('medications').select('id', { count: 'exact', head: true }),
      admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'trialing'),
      admin.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'pending']),
      admin.from('invoices').select('amount_usd_cents, issued_at').eq('status', 'paid'),
      admin.from('clinics').select('id, name, created_at, is_suspended').is('deleted_at', null).order('created_at', { ascending: false }).limit(8),
      admin.from('transactions').select('amount_uzs, created_at').eq('kind', 'payment').eq('is_void', false).gte('created_at', thirtyDaysAgo),
      admin.from('transactions').select('amount_uzs').eq('kind', 'payment').eq('is_void', false).lt('amount_uzs', 0),
    ]);

    const totalRevenueCents = (paidInvoices.data ?? []).reduce(
      (s, i) => s + Number((i as { amount_usd_cents: number }).amount_usd_cents ?? 0),
      0,
    );
    const last30Days = (txAgg.data ?? []).reduce(
      (s, t) => s + Number((t as { amount_uzs: number }).amount_uzs ?? 0),
      0,
    );
    const debtTotal = (debts.data ?? []).reduce(
      (s, t) => s + Number((t as { amount_uzs: number }).amount_uzs ?? 0),
      0,
    );

    // Daily revenue series (last 30 days, UZS)
    const dailyMap = new Map<string, number>();
    for (const t of txAgg.data ?? []) {
      const day = String((t as { created_at: string }).created_at).slice(0, 10);
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + Number((t as { amount_uzs: number }).amount_uzs ?? 0));
    }
    const daily = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, amount]) => ({ day, amount_uzs: amount }));

    return {
      totals: {
        tenants: tenantsHead.count ?? 0,
        active_tenants: activeTenantsHead.count ?? 0,
        doctors: doctorsHead.count ?? 0,
        medications: medicationsHead.count ?? 0,
        active_subscriptions: activeSubsHead.count ?? 0,
        trial_subscriptions: trialHead.count ?? 0,
        open_tickets: openTicketsHead.count ?? 0,
        total_revenue_usd: totalRevenueCents / 100,
        last_30d_uzs: last30Days,
        debt_uzs: Math.abs(debtTotal),
      },
      recent_clinics: recentClinics.data ?? [],
      daily_revenue: daily,
    };
  }

  async listDoctors(q?: string, clinicId?: string) {
    const admin = this.supabase.admin();
    let query = admin
      .from('profiles')
      .select('id, full_name, email, phone, role, clinic_id, is_active, last_sign_in_at, created_at, clinic:clinics(id, name)')
      .eq('role', 'doctor')
      .order('full_name');
    if (clinicId) query = query.eq('clinic_id', clinicId);
    if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
    const { data } = await query.limit(500);
    return data ?? [];
  }

  async listPharmacies(clinicId?: string) {
    const admin = this.supabase.admin();
    let clinicsQ = admin.from('clinics').select('id, name').is('deleted_at', null);
    if (clinicId) clinicsQ = clinicsQ.eq('id', clinicId);
    const { data: clinics } = await clinicsQ;

    const out: Array<{
      clinic_id: string;
      clinic_name: string;
      medications_count: number;
      low_stock: number;
      sales_30d_uzs: number;
    }> = [];
    for (const c of (clinics as Array<{ id: string; name: string }> | null) ?? []) {
      const [med, low, sales] = await Promise.all([
        admin.from('medications').select('id', { count: 'exact', head: true }).eq('clinic_id', c.id),
        admin.from('medication_stock_summary').select('medication_id, stock_qty, reorder_level').eq('clinic_id', c.id),
        admin
          .from('pharmacy_sales')
          .select('total_uzs')
          .eq('clinic_id', c.id)
          .gte('created_at', new Date(Date.now() - 30 * 86400 * 1000).toISOString()),
      ]);
      const lowCount = (low.data ?? []).filter(
        (r) => Number((r as { stock_qty: number }).stock_qty) <= Number((r as { reorder_level: number }).reorder_level ?? 0),
      ).length;
      const salesTotal = (sales.data ?? []).reduce(
        (s, r) => s + Number((r as { total_uzs: number }).total_uzs ?? 0),
        0,
      );
      out.push({
        clinic_id: c.id,
        clinic_name: c.name,
        medications_count: med.count ?? 0,
        low_stock: lowCount,
        sales_30d_uzs: salesTotal,
      });
    }
    return out.sort((a, b) => b.sales_30d_uzs - a.sales_30d_uzs);
  }

  async platformAnalytics(days: number) {
    const admin = this.supabase.admin();
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
    const [tx, exp, clinics] = await Promise.all([
      admin
        .from('transactions')
        .select('amount_uzs, created_at, clinic_id')
        .eq('kind', 'payment')
        .eq('is_void', false)
        .gte('created_at', since),
      admin.from('expenses').select('amount_uzs, created_at, clinic_id').gte('created_at', since),
      admin.from('clinics').select('id, name').is('deleted_at', null),
    ]);

    const clinicsMap = new Map<string, string>();
    for (const c of (clinics.data ?? []) as Array<{ id: string; name: string }>) {
      clinicsMap.set(c.id, c.name);
    }

    const daily: Record<string, { day: string; revenue: number; expenses: number }> = {};
    for (const t of (tx.data ?? []) as Array<{ amount_uzs: number; created_at: string }>) {
      const d = String(t.created_at).slice(0, 10);
      daily[d] ??= { day: d, revenue: 0, expenses: 0 };
      daily[d]!.revenue += Number(t.amount_uzs ?? 0);
    }
    for (const e of (exp.data ?? []) as Array<{ amount_uzs: number; created_at: string }>) {
      const d = String(e.created_at).slice(0, 10);
      daily[d] ??= { day: d, revenue: 0, expenses: 0 };
      daily[d]!.expenses += Number(e.amount_uzs ?? 0);
    }
    const series = Object.values(daily).sort((a, b) => a.day.localeCompare(b.day));

    const byClinic = new Map<string, { revenue: number; expenses: number }>();
    for (const t of (tx.data ?? []) as Array<{ amount_uzs: number; clinic_id: string }>) {
      const row = byClinic.get(t.clinic_id) ?? { revenue: 0, expenses: 0 };
      row.revenue += Number(t.amount_uzs ?? 0);
      byClinic.set(t.clinic_id, row);
    }
    for (const e of (exp.data ?? []) as Array<{ amount_uzs: number; clinic_id: string }>) {
      const row = byClinic.get(e.clinic_id) ?? { revenue: 0, expenses: 0 };
      row.expenses += Number(e.amount_uzs ?? 0);
      byClinic.set(e.clinic_id, row);
    }
    const leaderboard = Array.from(byClinic.entries())
      .map(([id, v]) => ({
        clinic_id: id,
        clinic_name: clinicsMap.get(id) ?? id,
        revenue: v.revenue,
        expenses: v.expenses,
        profit: v.revenue - v.expenses,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return { series, leaderboard };
  }

  private async logAdmin(
    actor: string,
    action: string,
    opts: {
      clinic?: string | null;
      resourceType?: string;
      resourceId?: string | null;
      reason?: string;
      query?: Record<string, unknown>;
      count?: number;
    } = {},
  ) {
    try {
      await this.supabase.admin().rpc('log_super_admin_action', {
        p_actor: actor,
        p_action: action,
        p_target_clinic: opts.clinic ?? null,
        p_resource_type: opts.resourceType ?? null,
        p_resource_id: opts.resourceId ?? null,
        p_reason: opts.reason ?? null,
        p_query: opts.query ?? {},
        p_count: opts.count ?? null,
      });
    } catch {
      // audit must never block the main flow
    }
  }

  // ---------------------------------------------------------------------------
  // Cross-tenant patients
  // ---------------------------------------------------------------------------
  async listPatients(
    actor: string,
    q?: string,
    clinicId?: string,
    limit = 50,
    offset = 0,
  ) {
    const admin = this.supabase.admin();
    let query = admin
      .from('patients')
      .select(
        'id, clinic_id, full_name, phone, birth_date:dob, gender, created_at, clinic:clinics(id, name)',
        { count: 'exact' },
      )
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (clinicId) query = query.eq('clinic_id', clinicId);
    if (q && q.trim()) {
      const esc = q.replace(/[%,]/g, ' ').trim();
      query = query.or(`full_name.ilike.%${esc}%,phone.ilike.%${esc}%`);
    }
    const { data, count } = await query.range(offset, offset + Math.min(limit, 200) - 1);
    await this.logAdmin(actor, 'patients.list', {
      clinic: clinicId ?? null,
      resourceType: 'patient',
      query: { q, clinic_id: clinicId, limit, offset },
      count: data?.length ?? 0,
    });
    return { data: data ?? [], total: count ?? 0 };
  }

  async patientTimeline(actor: string, patientId: string) {
    const admin = this.supabase.admin();
    const { data: patient } = await admin
      .from('patients')
      .select('id, clinic_id, full_name, phone, birth_date:dob, gender, created_at, clinic:clinics(id, name)')
      .eq('id', patientId)
      .single();
    if (!patient) throw new Error('patient not found');

    const [appts, labs, rx, diag, pay, visits] = await Promise.all([
      admin
        .from('appointments')
        .select('id, scheduled_at, status, doctor_id, service_id, created_at')
        .eq('patient_id', patientId)
        .order('scheduled_at', { ascending: false })
        .limit(100),
      admin
        .from('lab_orders')
        .select('id, status, created_at, test_ids:lab_order_tests(test_id)')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('prescriptions')
        .select('id, status, issued_at, doctor_id')
        .eq('patient_id', patientId)
        .order('issued_at', { ascending: false })
        .limit(100),
      admin
        .from('diagnostic_orders')
        .select('id, status, created_at, equipment_id')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('transactions')
        .select('id, kind, amount_uzs, method, created_at, is_void')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('home_nurse_visits')
        .select('id, status, scheduled_at, clinic_id')
        .eq('patient_id', patientId)
        .order('scheduled_at', { ascending: false })
        .limit(50),
    ]);

    await this.logAdmin(actor, 'patient.timeline', {
      clinic: (patient as { clinic_id: string }).clinic_id,
      resourceType: 'patient',
      resourceId: patientId,
      count: (appts.data?.length ?? 0) + (labs.data?.length ?? 0) + (rx.data?.length ?? 0),
    });

    return {
      patient,
      appointments: appts.data ?? [],
      lab_orders: labs.data ?? [],
      prescriptions: rx.data ?? [],
      diagnostic_orders: diag.data ?? [],
      transactions: pay.data ?? [],
      home_nurse_visits: visits.data ?? [],
    };
  }

  // ---------------------------------------------------------------------------
  // Finance deep-dive
  // ---------------------------------------------------------------------------
  async financeOverview(actor: string, days: number) {
    const admin = this.supabase.admin();
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
    const [tx, exp, invoices, clinics] = await Promise.all([
      admin.from('transactions').select('amount_uzs, kind, method, clinic_id, created_at, is_void').gte('created_at', since).eq('is_void', false),
      admin.from('expenses').select('amount_uzs, clinic_id, created_at').gte('created_at', since),
      admin.from('invoices').select('amount_usd_cents, status, issued_at').gte('issued_at', since),
      admin.from('clinics').select('id, name').is('deleted_at', null),
    ]);

    const clinicsMap = new Map<string, string>();
    for (const c of (clinics.data ?? []) as Array<{ id: string; name: string }>) clinicsMap.set(c.id, c.name);

    const byMethod = new Map<string, number>();
    const byClinic = new Map<string, { revenue: number; expenses: number; debts: number }>();
    let revenue = 0;
    let debts = 0;
    for (const t of (tx.data ?? []) as Array<{ amount_uzs: number; method: string; clinic_id: string; kind: string }>) {
      if (t.kind !== 'payment') continue;
      const amt = Number(t.amount_uzs ?? 0);
      revenue += amt;
      if (amt < 0) debts += Math.abs(amt);
      byMethod.set(t.method, (byMethod.get(t.method) ?? 0) + amt);
      const row = byClinic.get(t.clinic_id) ?? { revenue: 0, expenses: 0, debts: 0 };
      row.revenue += amt;
      if (amt < 0) row.debts += Math.abs(amt);
      byClinic.set(t.clinic_id, row);
    }
    let expensesTotal = 0;
    for (const e of (exp.data ?? []) as Array<{ amount_uzs: number; clinic_id: string }>) {
      const amt = Number(e.amount_uzs ?? 0);
      expensesTotal += amt;
      const row = byClinic.get(e.clinic_id) ?? { revenue: 0, expenses: 0, debts: 0 };
      row.expenses += amt;
      byClinic.set(e.clinic_id, row);
    }

    const leaderboard = Array.from(byClinic.entries())
      .map(([id, v]) => ({
        clinic_id: id,
        clinic_name: clinicsMap.get(id) ?? id,
        revenue: v.revenue,
        expenses: v.expenses,
        debts: v.debts,
        profit: v.revenue - v.expenses,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const subscriptions = (invoices.data ?? [])
      .filter((i) => (i as { status: string }).status === 'paid')
      .reduce((s, i) => s + Number((i as { amount_usd_cents: number }).amount_usd_cents ?? 0), 0) / 100;

    await this.logAdmin(actor, 'finance.overview', { query: { days }, count: leaderboard.length });

    return {
      totals: {
        revenue_uzs: revenue,
        expenses_uzs: expensesTotal,
        debts_uzs: debts,
        profit_uzs: revenue - expensesTotal,
        subscriptions_usd: subscriptions,
      },
      by_method: Array.from(byMethod.entries()).map(([method, amount_uzs]) => ({ method, amount_uzs })),
      leaderboard,
    };
  }

  async medicationsUsage(actor: string, limit = 100) {
    const admin = this.supabase.admin();
    const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const [sales, meds, clinics] = await Promise.all([
      admin
        .from('pharmacy_sale_items')
        .select('medication_id, quantity, subtotal_uzs, clinic_id')
        .gte('created_at', since),
      admin.from('medications').select('id, name, manufacturer, clinic_id'),
      admin.from('clinics').select('id, name'),
    ]);
    const clinicsMap = new Map<string, string>();
    for (const c of (clinics.data ?? []) as Array<{ id: string; name: string }>) clinicsMap.set(c.id, c.name);
    const medsMap = new Map<string, { name: string; manufacturer: string | null; clinic_id: string }>();
    for (const m of (meds.data ?? []) as Array<{ id: string; name: string; manufacturer: string | null; clinic_id: string }>)
      medsMap.set(m.id, { name: m.name, manufacturer: m.manufacturer, clinic_id: m.clinic_id });

    type Row = { name: string; manufacturer: string | null; qty: number; revenue: number; clinic_id: string; clinic_name: string };
    const byMed = new Map<string, Row>();
    for (const s of (sales.data ?? []) as Array<{ medication_id: string; quantity: number; subtotal_uzs: number }>) {
      const info = medsMap.get(s.medication_id);
      if (!info) continue;
      const key = `${info.clinic_id}::${s.medication_id}`;
      const row = byMed.get(key) ?? {
        name: info.name,
        manufacturer: info.manufacturer,
        qty: 0,
        revenue: 0,
        clinic_id: info.clinic_id,
        clinic_name: clinicsMap.get(info.clinic_id) ?? info.clinic_id,
      };
      row.qty += Number(s.quantity ?? 0);
      row.revenue += Number(s.subtotal_uzs ?? 0);
      byMed.set(key, row);
    }
    const ranked = Array.from(byMed.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, limit);
    await this.logAdmin(actor, 'medications.ranking', { count: ranked.length });
    return ranked;
  }

  async diagnosticsPopularity(actor: string) {
    const admin = this.supabase.admin();
    const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const [orders, equip, clinics] = await Promise.all([
      admin
        .from('diagnostic_orders')
        .select('equipment_id, clinic_id, created_at, status')
        .gte('created_at', since),
      admin.from('diagnostic_equipment').select('id, name_i18n, category, clinic_id'),
      admin.from('clinics').select('id, name'),
    ]);
    const clinicsMap = new Map<string, string>();
    for (const c of (clinics.data ?? []) as Array<{ id: string; name: string }>) clinicsMap.set(c.id, c.name);
    const equipMap = new Map<string, { name: string; modality: string; clinic_id: string }>();
    const pickName = (i18n: Record<string, string> | null | undefined) => {
      if (!i18n) return 'Noma‘lum uskuna';
      return i18n['uz-Latn'] ?? i18n['uz'] ?? i18n['ru'] ?? i18n['en'] ?? Object.values(i18n)[0] ?? 'Noma‘lum uskuna';
    };
    for (const e of (equip.data ?? []) as Array<{ id: string; name_i18n: Record<string, string>; category: string; clinic_id: string }>)
      equipMap.set(e.id, { name: pickName(e.name_i18n), modality: e.category, clinic_id: e.clinic_id });

    type Row = { equipment_id: string; name: string; modality: string; orders: number; clinic_id: string; clinic_name: string };
    const byEq = new Map<string, Row>();
    for (const o of (orders.data ?? []) as Array<{ equipment_id: string; clinic_id: string }>) {
      if (!o.equipment_id) continue;
      const info = equipMap.get(o.equipment_id);
      if (!info) continue;
      const row = byEq.get(o.equipment_id) ?? {
        equipment_id: o.equipment_id,
        name: info.name,
        modality: info.modality,
        orders: 0,
        clinic_id: info.clinic_id,
        clinic_name: clinicsMap.get(info.clinic_id) ?? info.clinic_id,
      };
      row.orders += 1;
      byEq.set(o.equipment_id, row);
    }
    const ranked = Array.from(byEq.values()).sort((a, b) => b.orders - a.orders);
    await this.logAdmin(actor, 'diagnostics.popularity', { count: ranked.length });
    return ranked;
  }

  // ---------------------------------------------------------------------------
  // Cross-clinic support threads
  // ---------------------------------------------------------------------------
  async listSupportThreads(
    actor: string,
    filters: { status?: string; category?: string; clinic_id?: string; q?: string; limit?: number; offset?: number },
  ) {
    const admin = this.supabase.admin();
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = filters.offset ?? 0;
    let query = admin
      .from('support_tickets')
      .select(
        'id, clinic_id, status, subject, priority, category, created_at, updated_at, clinic:clinics(id, name)',
        { count: 'exact' },
      )
      .order('updated_at', { ascending: false });
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.clinic_id) query = query.eq('clinic_id', filters.clinic_id);
    if (filters.q && filters.q.trim()) query = query.ilike('subject', `%${filters.q.trim()}%`);
    const { data, count } = await query.range(offset, offset + limit - 1);
    await this.logAdmin(actor, 'support.list', { query: filters as unknown as Record<string, unknown>, count: data?.length ?? 0 });
    return { data: data ?? [], total: count ?? 0 };
  }

  async patchSupportThread(actor: string, id: string, patch: { status?: string; priority?: string; category?: string }) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('support_tickets')
      .update(patch)
      .eq('id', id)
      .select('id, clinic_id, status, priority, category')
      .single();
    if (error) throw new Error(error.message);
    await this.logAdmin(actor, 'support.patch', {
      clinic: (data as { clinic_id: string } | null)?.clinic_id ?? null,
      resourceType: 'support_ticket',
      resourceId: id,
      query: patch as unknown as Record<string, unknown>,
    });
    return data;
  }

  async issueImpersonationToken(superAdminId: string, targetUserId: string, reason: string) {
    const admin = this.supabase.admin();
    const { data: target, error: tErr } = await admin
      .from('profiles')
      .select('id, email, full_name, clinic_id, role')
      .eq('id', targetUserId)
      .single();
    if (tErr || !target) throw new Error(tErr?.message ?? 'user not found');
    const t = target as { id: string; email: string; full_name: string; clinic_id: string; role: string };

    const { data: session } = await admin
      .from('admin_impersonation_sessions')
      .insert({
        super_admin_id: superAdminId,
        target_clinic_id: t.clinic_id,
        target_user_id: t.id,
        reason,
      })
      .select()
      .single();

    // Supabase Admin API: generate a magiclink for the target user
    const generated = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: t.email,
    });
    const actionLink =
      (generated.data as { properties?: { action_link?: string } } | null)?.properties?.action_link ?? null;

    return {
      session,
      target: { id: t.id, email: t.email, clinic_id: t.clinic_id, role: t.role },
      action_link: actionLink,
      note: 'Redirect super admin to action_link to consume magic link and impersonate',
    };
  }
}

@ApiTags('admin')
@Controller('admin')
@UseGuards(SuperAdminGuard)
// Admin endpointlar uchun alohida rate-limit — global 1000/min'dan tor.
@Throttle({ default: { ttl: 60_000, limit: 300 } })
class AdminController {
  constructor(private readonly svc: AdminService) {}

  @Get('tenants')
  tenants(@Query('q') q?: string, @Query('include_deleted') includeDeleted?: string) {
    return this.svc.listTenants(q, includeDeleted === 'true');
  }

  // Arxiv moduli — arxivlangan (soft-delete) klinikalar + ma'lumot sanog'i.
  // ':id' (UUID) route'idan OLDIN — "archived" param sifatida talqin qilinmasin.
  @Get('tenants/archived')
  archivedTenants() {
    return this.svc.listArchivedTenants();
  }

  @Post('tenants')
  createTenant(@Body() body: unknown) {
    return this.svc.createTenant(CreateTenantSchema.parse(body));
  }

  @Get('impersonations')
  impersonations(
    @Query('clinic_id') clinicId?: string,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listImpersonations({
      clinic_id: clinicId,
      days: days ? Number(days) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('tenants/:id')
  tenant(@Param('id', ParseUUIDPipe) id: string) { return this.svc.getTenant(id); }

  @Post('tenants/:id/suspend')
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body() body: { reason: string }) {
    return this.svc.suspend(id, body.reason);
  }

  @Post('tenants/:id/unsuspend')
  unsuspend(@Param('id', ParseUUIDPipe) id: string) { return this.svc.unsuspend(id); }

  @Patch('tenants/:id')
  updateTenant(@Param('id', ParseUUIDPipe) id: string, @Body() body: { name?: string; slug?: string }) {
    return this.svc.updateTenant(id, body ?? {});
  }

  @Delete('tenants/:id')
  deleteTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.softDeleteTenant(id);
  }

  @Delete('tenants/:id/hard')
  hardDeleteTenant(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { confirm_name?: string; password?: string },
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.hardDeleteTenant(id, body?.confirm_name ?? '', u.userId, body?.password ?? '');
  }

  // Kod (4020) bilan ARXIVGA o'tkazish (soft-delete) — "Batafsil > Tahrir > Xavfli zona".
  // Ma'lumot saqlanadi, Arxiv modulida ko'rinadi, qaytarish mumkin.
  @Post('tenants/:id/archive')
  archiveByCode(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { code?: string },
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.archiveByCode(id, body?.code ?? '');
  }

  // Kod (4020) bilan BUTUNLAY o'chirish (purge) — Arxiv modulidan, qaytarib bo'lmaydi.
  @Post('tenants/:id/hard-delete')
  hardDeleteByCode(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { code?: string },
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.hardDeleteByCode(id, body?.code ?? '');
  }

  @Post('tenants/:id/restore')
  restoreTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.restoreTenant(id);
  }

  // --- Plans (tariflar) ---
  @Get('plans')
  listPlans() { return this.svc.listPlansAdmin(); }

  @Patch('plans/:code')
  updatePlan(@Param('code') code: string, @Body() body: unknown) {
    return this.svc.updatePlan(code, (body ?? {}) as Parameters<AdminService['updatePlan']>[1]);
  }

  // --- Insurance providers (markaziy direktoriya) ---
  @Get('insurance-providers')
  listInsuranceProviders() { return this.svc.listInsuranceProviders(); }

  @Post('insurance-providers')
  createInsuranceProvider(@Body() body: unknown) {
    return this.svc.createInsuranceProvider(InsuranceProviderSchema.parse(body));
  }

  @Patch('insurance-providers/:id')
  updateInsuranceProvider(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.svc.updateInsuranceProvider(id, (body ?? {}) as Record<string, unknown>);
  }

  // --- Support chat messages ---
  @Get('support/threads/:id/messages')
  listSupportMessages(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.listSupportMessages(id);
  }

  @Post('support/threads/:id/messages')
  sendSupportMessage(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { body: string },
  ) {
    if (!u.userId) throw new ForbiddenException();
    if (!body?.body || body.body.trim().length === 0) throw new ForbiddenException('Xabar bo\'sh');
    return this.svc.sendSupportMessage(id, u.userId, body.body.trim());
  }

  // --- Telegram bots ---
  @Get('telegram-bots')
  listTelegramBots() { return this.svc.listTelegramBots(); }

  @Post('telegram-bots/:id/toggle')
  toggleTelegramBot(@Param('id', ParseUUIDPipe) id: string, @Body() body: { is_active: boolean }) {
    return this.svc.toggleTelegramBot(id, !!body?.is_active);
  }

  // --- Sales leads ---
  @Get('leads')
  listLeads(
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.listLeads({
      status,
      q,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
    });
  }

  @Patch('leads/:id')
  updateLead(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status?: string; notes?: string; assigned_to?: string | null },
  ) {
    return this.svc.updateLead(id, body ?? {});
  }

  @Post('impersonate')
  impersonate(@CurrentUser() u: { userId: string | null }, @Body() body: unknown) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.impersonate(u.userId, ImpersonateSchema.parse(body));
  }

  @Post('feature-flags')
  setFlag(@CurrentUser() u: { userId: string | null }, @Body() body: unknown) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.setFeatureFlag(FeatureFlagSchema.parse(body), u.userId);
  }

  @Get('revenue')
  revenue() { return this.svc.revenue(); }

  @Get('overview')
  overview() { return this.svc.overview(); }

  @Get('doctors')
  doctors(@Query('q') q?: string, @Query('clinic_id') clinicId?: string) {
    return this.svc.listDoctors(q, clinicId);
  }

  @Get('pharmacies')
  pharmacies(@Query('clinic_id') clinicId?: string) {
    return this.svc.listPharmacies(clinicId);
  }

  @Get('analytics')
  platformAnalytics(@Query('days') days?: string) {
    const n = Number(days ?? '30');
    return this.svc.platformAnalytics(Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 30);
  }

  @Post('impersonate/token')
  impersonationToken(
    @CurrentUser() u: { userId: string | null },
    @Body() body: { target_user_id: string; reason: string },
  ) {
    if (!u.userId) throw new ForbiddenException();
    if (!body?.target_user_id || !body?.reason || body.reason.length < 10) {
      throw new ForbiddenException('target_user_id and reason (>=10 chars) required');
    }
    return this.svc.issueImpersonationToken(u.userId, body.target_user_id, body.reason);
  }

  @Get('patients')
  listPatients(
    @CurrentUser() u: { userId: string | null },
    @Query('q') q?: string,
    @Query('clinic_id') clinicId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.listPatients(u.userId, q, clinicId, Number(limit) || 50, Number(offset) || 0);
  }

  @Get('patients/:id/timeline')
  patientTimeline(@CurrentUser() u: { userId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.patientTimeline(u.userId, id);
  }

  @Get('finance/overview')
  financeOverview(@CurrentUser() u: { userId: string | null }, @Query('days') days?: string) {
    if (!u.userId) throw new ForbiddenException();
    const n = Number(days ?? '30');
    return this.svc.financeOverview(u.userId, Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 30);
  }

  @Get('medications/ranking')
  medicationsRanking(@CurrentUser() u: { userId: string | null }, @Query('limit') limit?: string) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.medicationsUsage(u.userId, Number(limit) || 100);
  }

  @Get('diagnostics/popularity')
  diagnosticsPopularity(@CurrentUser() u: { userId: string | null }) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.diagnosticsPopularity(u.userId);
  }

  @Get('support/threads')
  listSupport(
    @CurrentUser() u: { userId: string | null },
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('clinic_id') clinicId?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.listSupportThreads(u.userId, {
      status,
      category,
      clinic_id: clinicId,
      q,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
    });
  }

  @Post('support/threads/:id')
  patchSupport(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status?: string; priority?: string; category?: string },
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.patchSupportThread(u.userId, id, body ?? {});
  }
}

import { AdminExtrasController } from './admin-extras.controller';
import { AdminExtrasService } from './admin-extras.service';

@Module({
  controllers: [AdminController, AdminExtrasController],
  providers: [AdminService, AdminExtrasService, SupabaseService],
})
export class AdminModule {}
