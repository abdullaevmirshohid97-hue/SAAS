import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import { networkPatientScope } from '../../common/network/network-scope';
import { SupabaseService } from '../../common/services/supabase.service';
import { CashierService } from '../cashier/cashier.module';
import { NetworkAccessService, type CompanyUser } from './network-access.service';

export const CatalogPushInput = z.object({
  source_clinic_id: z.string().uuid().optional(),
  target_clinic_ids: z.array(z.string().uuid()).min(1).max(10),
  kinds: z
    .array(z.enum(['services', 'lab', 'diagnostics']))
    .min(1)
    .default(['services']),
  update_prices: z.boolean().default(false),
});
export const SettingsPushInput = z.object({
  source_clinic_id: z.string().uuid().optional(),
  target_clinic_ids: z.array(z.string().uuid()).min(1).max(10),
  keys: z.array(z.enum(['receipt', 'document', 'logo', 'workflow'])).min(1),
});
/** HQ'dan tarqatiladigan ish tartibi kalitlari (clinics.settings) */
const WORKFLOW_KEYS = [
  'reception_pharmacy_enabled',
  'reception_parallel_enabled',
  'queue_skip_all_enabled',
  'lab_mode',
] as const;
export const StockSendInput = z.object({
  to_clinic_id: z.string().uuid(),
  items: z
    .array(z.object({ medication_id: z.string().uuid(), quantity: z.number().int().positive() }))
    .min(1)
    .max(500),
  notes: z.string().max(500).optional(),
});
export const CashSendInput = z.object({
  to_clinic_id: z.string().uuid().optional(),
  amount_uzs: z.number().int().positive(),
  register: z.enum(['reception', 'inpatient']).default('reception'),
  notes: z.string().max(300).optional(),
});
export const CancelInput = z.object({ reason: z.string().trim().min(2).max(300) });
export const MoveStaffInput = z.object({ to_clinic_id: z.string().uuid() });
export const ReferralInput = z.object({
  target_clinic_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  target_service_id: z.string().uuid().optional(),
  urgency: z.enum(['routine', 'urgent', 'stat']).default('routine'),
  clinical_indication: z.string().max(1000).optional(),
  notes: z.string().max(1000).optional(),
});
export const MergeInput = z.object({
  keep_id: z.string().uuid(),
  drop_id: z.string().uuid(),
});

type TransferRow = {
  id: string;
  company_id: string;
  from_clinic_id: string;
  to_clinic_id: string;
  status: string;
};

// =============================================================================
// Tarmoq amallari: HQ'dan katalog/sozlama, filiallararo zaxira va pul,
// boshqa filialga yo'llanma, bemor dublikatlari. Pul va zaxira MAVJUD yo'llar
// (seyf, prixod) orqali — hisobotlar o'zgarishsiz to'g'ri.
// =============================================================================
@Injectable()
export class NetworkOpsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly access: NetworkAccessService,
    private readonly cashier: CashierService,
  ) {}

  private async hqOf(companyId: string): Promise<string> {
    const { data } = await this.supabase
      .admin()
      .from('clinics')
      .select('id')
      .eq('company_id', companyId)
      .eq('is_hq', true)
      .is('deleted_at', null)
      .maybeSingle();
    const id = (data as { id: string } | null)?.id;
    if (!id) throw new BadRequestException('Tarmoqda asosiy filial (HQ) belgilanmagan');
    return id;
  }

  /** Faol filial va tarmoq (a'zolik talab qilinmaydi — filial xodimlari uchun) */
  private async ctx(u: CompanyUser) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    const companyId = await this.access.companyOf(u.clinicId);
    return { clinicId: u.clinicId, userId: u.userId, companyId };
  }

  private async assertInCompany(companyId: string, clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('clinics')
      .select('id')
      .eq('id', clinicId)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!data) throw new BadRequestException('Filial shu tarmoqda emas');
  }

  private rpcError(error: { message: string }): never {
    throw new BadRequestException(error.message);
  }

  private async clinicName(id: string): Promise<string> {
    const { data } = await this.supabase
      .admin()
      .from('clinics')
      .select('name')
      .eq('id', id)
      .maybeSingle();
    return (data as { name: string } | null)?.name ?? 'Filial';
  }

  /**
   * Filial bo'ylab (recipient_id NULL) bildirishnoma — header qo'ng'irog'ida
   * chiqadi. Best-effort: bildirishnoma xatosi asosiy amalni buzmaydi.
   */
  private async notifyClinic(
    clinicId: string,
    kind: string,
    title: string,
    body: string,
    refResource: string,
    refId: string | null,
  ): Promise<void> {
    await this.supabase
      .admin()
      .from('notifications_inapp')
      .insert({
        clinic_id: clinicId,
        kind,
        severity: 'info',
        title,
        body,
        ref_resource: refResource,
        ref_id: refId,
      })
      .then(undefined, () => undefined);
  }

  // ── Faza 4: katalog va sozlamalar ──────────────────────────────────────────
  async pushCatalog(u: CompanyUser, body: z.infer<typeof CatalogPushInput>) {
    const v = await this.access.requireManager(u);
    const source = body.source_clinic_id ?? (await this.hqOf(v.companyId));
    const targets = [...new Set(body.target_clinic_ids)].filter((id) => id !== source);
    if (targets.length === 0) throw new BadRequestException('Qabul qiluvchi filial tanlanmagan');
    this.access.assertBranches(v, [source, ...targets]);
    const { data, error } = await this.supabase.admin().rpc(
      'network_push_catalog' as never,
      {
        p_source: source,
        p_targets: targets,
        p_actor: u.userId,
        p_kinds: body.kinds,
        p_update_prices: body.update_prices,
      } as never,
    );
    if (error) this.rpcError(error);
    return { source_clinic_id: source, result: data };
  }

  async pushSettings(u: CompanyUser, body: z.infer<typeof SettingsPushInput>) {
    const v = await this.access.requireManager(u);
    const admin = this.supabase.admin();
    const source = body.source_clinic_id ?? (await this.hqOf(v.companyId));
    const targets = [...new Set(body.target_clinic_ids)].filter((id) => id !== source);
    if (targets.length === 0) throw new BadRequestException('Qabul qiluvchi filial tanlanmagan');
    this.access.assertBranches(v, [source, ...targets]);
    const { data: src } = await admin
      .from('clinics')
      .select('receipt_settings, document_settings, logo_url, primary_color, settings')
      .eq('id', source)
      .maybeSingle();
    if (!src) throw new NotFoundException('Manba filial topilmadi');
    const s = src as {
      receipt_settings: Record<string, unknown>;
      document_settings: Record<string, unknown>;
      logo_url: string | null;
      primary_color: string | null;
      settings: Record<string, unknown> | null;
    };
    const patch: Record<string, unknown> = {};
    if (body.keys.includes('receipt')) patch.receipt_settings = s.receipt_settings;
    if (body.keys.includes('document')) patch.document_settings = s.document_settings;
    if (body.keys.includes('logo')) {
      patch.logo_url = s.logo_url;
      patch.primary_color = s.primary_color;
    }
    if (Object.keys(patch).length > 0) {
      const { error } = await admin.from('clinics').update(patch).in('id', targets);
      if (error) throw new BadRequestException(error.message);
    }
    // Ish tartibi (qabulxonada "Dori bilan", parallel qabul, navbat, lab rejimi) —
    // filial settings JSON'iga QO'SHIB yoziladi (filialga xos boshqa kalitlar,
    // masalan dorixona tezkor tugmalari, saqlanadi).
    if (body.keys.includes('workflow')) {
      const picked: Record<string, unknown> = {};
      for (const k of WORKFLOW_KEYS) {
        if (s.settings && k in s.settings) picked[k] = s.settings[k];
      }
      const { data: rows } = await admin.from('clinics').select('id, settings').in('id', targets);
      for (const r of (rows ?? []) as Array<{
        id: string;
        settings: Record<string, unknown> | null;
      }>) {
        const { error } = await admin
          .from('clinics')
          .update({ settings: { ...(r.settings ?? {}), ...picked } })
          .eq('id', r.id);
        if (error) throw new BadRequestException(error.message);
      }
    }
    await this.access.audit(v.companyId, source, u.userId, 'settings_push', {
      targets,
      keys: body.keys,
    });
    return { ok: true, updated: targets.length };
  }

  // ── Faza 4b: xodimni boshqa filialga ko'chirish ────────────────────────────
  async moveStaff(u: CompanyUser, staffId: string, toClinicId: string) {
    const v = await this.access.requireManager(u);
    const admin = this.supabase.admin();
    const { data: s } = await admin
      .from('staff_profiles')
      .select('id, clinic_id, profile_id')
      .eq('id', staffId)
      .maybeSingle();
    const row = s as { id: string; clinic_id: string; profile_id: string | null } | null;
    if (!row) throw new NotFoundException('Xodim topilmadi');
    this.access.assertBranches(v, [row.clinic_id, toClinicId]);
    const { data, error } = await admin.rpc(
      'network_move_staff' as never,
      { p_staff: staffId, p_to: toClinicId, p_actor: u.userId } as never,
    );
    if (error) this.rpcError(error);
    // Ruxsatlar keshi (maxsus rol uzildi) 60 soniyada o'zi yangilanadi; xodim
    // ilovasi keyingi token yangilanishida yangi filialga o'tadi.
    return data;
  }

  // ── Boshqa filial xizmatlari (yo'llanma uchun) ─────────────────────────────
  async branchServices(u: CompanyUser, clinicId: string) {
    const c = await this.ctx(u);
    await this.assertInCompany(c.companyId, clinicId);
    const { data } = await this.supabase
      .admin()
      .from('services')
      .select('id, name_i18n, price_uzs, category:service_categories(name_i18n)')
      .eq('clinic_id', clinicId)
      .eq('is_archived', false)
      .order('sort_order')
      .limit(500);
    return data ?? [];
  }

  // ── Faza 5c: boshqa filialga yo'llanma ─────────────────────────────────────
  async createReferral(u: CompanyUser, body: z.infer<typeof ReferralInput>) {
    const c = await this.ctx(u);
    if (body.target_clinic_id === c.clinicId) {
      throw new BadRequestException("O'z filialingiz uchun oddiy yo'llanmadan foydalaning");
    }
    await this.assertInCompany(c.companyId, body.target_clinic_id);
    const admin = this.supabase.admin();
    const scope = await networkPatientScope(admin, c.clinicId);
    const { data: patient } = await admin
      .from('patients')
      .select('id')
      .eq('id', body.patient_id)
      .in('clinic_id', scope)
      .is('deleted_at', null)
      .maybeSingle();
    if (!patient) throw new BadRequestException('Bemor topilmadi');
    if (body.target_service_id) {
      const { data: svc } = await admin
        .from('services')
        .select('id')
        .eq('id', body.target_service_id)
        .eq('clinic_id', body.target_clinic_id)
        .maybeSingle();
      if (!svc) throw new BadRequestException('Xizmat qabul qiluvchi filialda topilmadi');
    }
    const { data, error } = await admin
      .from('service_referrals')
      .insert({
        clinic_id: body.target_clinic_id,
        source_clinic_id: c.clinicId,
        patient_id: body.patient_id,
        doctor_id: c.userId,
        created_by: c.userId,
        referral_kind: body.target_service_id ? 'service' : 'other',
        target_service_id: body.target_service_id ?? null,
        urgency: body.urgency,
        clinical_indication: body.clinical_indication ?? null,
        notes: body.notes ?? null,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    await this.access.audit(c.companyId, c.clinicId, c.userId, 'referral_sent', {
      referral_id: (data as { id: string }).id,
      to: body.target_clinic_id,
    });
    await this.notifyClinic(
      body.target_clinic_id,
      'network_referral',
      `${await this.clinicName(c.clinicId)} filialidan yo'llanma`,
      "Bemor yo'llandi — qabulxonadagi yo'llanmalar ro'yxatida",
      'service_referrals',
      (data as { id: string }).id,
    );
    return data;
  }

  async listReferrals(u: CompanyUser) {
    const c = await this.ctx(u);
    const sel =
      'id, clinic_id, source_clinic_id, status, urgency, referral_kind, notes, clinical_indication, created_at, ' +
      'patient:patients(id, full_name, phone), doctor:profiles!doctor_id(id, full_name), ' +
      'service:services(id, name_i18n, price_uzs)';
    const admin = this.supabase.admin();
    const [outgoing, incoming] = await Promise.all([
      admin
        .from('service_referrals')
        .select(sel)
        .eq('source_clinic_id', c.clinicId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('service_referrals')
        .select(sel)
        .eq('clinic_id', c.clinicId)
        .not('source_clinic_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);
    return { outgoing: outgoing.data ?? [], incoming: incoming.data ?? [] };
  }

  // ── Faza 5a: dorixona zaxirasi transferi ───────────────────────────────────
  private async loadTransfer(table: string, id: string): Promise<TransferRow> {
    const { data } = await this.supabase
      .admin()
      .from(table)
      .select('id, company_id, from_clinic_id, to_clinic_id, status')
      .eq('id', id)
      .maybeSingle();
    if (!data) throw new NotFoundException('Transfer topilmadi');
    return data as TransferRow;
  }

  private async listTransfers(table: string, u: CompanyUser, extraSelect: string) {
    const c = await this.ctx(u);
    const v = await this.access.viewer(u);
    let q = this.supabase
      .admin()
      .from(table)
      .select(
        `*, ${extraSelect}from_clinic:clinics!${table}_from_clinic_id_fkey(id, name), to_clinic:clinics!${table}_to_clinic_id_fkey(id, name)`,
      )
      .eq('company_id', c.companyId)
      .order('sent_at', { ascending: false })
      .limit(200);
    // Tarmoq rahbariyati hammasini, filial xodimi faqat o'z filialinikini ko'radi
    if (!v?.canManage || v.branchIds.length <= 1) {
      q = q.or(`from_clinic_id.eq.${c.clinicId},to_clinic_id.eq.${c.clinicId}`);
    }
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async stockTransfers(u: CompanyUser) {
    return this.listTransfers('network_stock_transfers', u, '');
  }

  async stockTransfer(u: CompanyUser, id: string) {
    const c = await this.ctx(u);
    const t = await this.loadTransfer('network_stock_transfers', id);
    if (t.company_id !== c.companyId) throw new NotFoundException('Transfer topilmadi');
    const { data: items } = await this.supabase
      .admin()
      .from('network_stock_transfer_items')
      .select('*')
      .eq('transfer_id', id)
      .order('name');
    return { ...t, items: items ?? [] };
  }

  async sendStock(u: CompanyUser, body: z.infer<typeof StockSendInput>) {
    const c = await this.ctx(u);
    const { data, error } = await this.supabase.admin().rpc(
      'network_transfer_send' as never,
      {
        p_from: c.clinicId,
        p_to: body.to_clinic_id,
        p_user: c.userId,
        p_items: body.items,
        p_notes: body.notes ?? null,
      } as never,
    );
    if (error) this.rpcError(error);
    const r = data as { transfer_id: string; lines: number };
    await this.notifyClinic(
      body.to_clinic_id,
      'network_stock_transfer',
      `${await this.clinicName(c.clinicId)} filialidan dori jo'natildi`,
      `${r.lines} partiya qatori yo'lda — Tarmoq → Transferlar bo'limida qabul qiling`,
      'network_stock_transfers',
      r.transfer_id,
    );
    return data;
  }

  async receiveStock(u: CompanyUser, id: string) {
    const c = await this.ctx(u);
    const t = await this.loadTransfer('network_stock_transfers', id);
    if (t.to_clinic_id !== c.clinicId) {
      throw new ForbiddenException('Transferni qabul qiluvchi filialda qabul qiling');
    }
    const { data, error } = await this.supabase
      .admin()
      .rpc('network_transfer_receive' as never, { p_transfer: id, p_user: c.userId } as never);
    if (error) this.rpcError(error);
    await this.notifyClinic(
      t.from_clinic_id,
      'network_stock_transfer',
      `${await this.clinicName(c.clinicId)} dorilarni qabul qildi`,
      "Jo'natilgan dori transferi qabul qiluvchi omborga kirdi",
      'network_stock_transfers',
      id,
    );
    return data;
  }

  async cancelStock(u: CompanyUser, id: string, reason: string) {
    const c = await this.ctx(u);
    const t = await this.loadTransfer('network_stock_transfers', id);
    await this.assertCanCancel(u, c.clinicId, t);
    const { data, error } = await this.supabase
      .admin()
      .rpc(
        'network_transfer_cancel' as never,
        { p_transfer: id, p_user: c.userId, p_reason: reason } as never,
      );
    if (error) this.rpcError(error);
    return data;
  }

  private async assertCanCancel(u: CompanyUser, clinicId: string, t: TransferRow) {
    if (t.from_clinic_id === clinicId) return;
    const v = await this.access.viewer(u);
    if (v?.canManage && v.companyId === t.company_id) return;
    throw new ForbiddenException('Bekor qilishni jo‘natgan filial yoki tarmoq rahbariyati qiladi');
  }

  // ── Faza 5b: filial seyfidan HQ'ga pul ─────────────────────────────────────
  async cashTransfers(u: CompanyUser) {
    return this.listTransfers('network_cash_transfers', u, '');
  }

  async sendCash(u: CompanyUser, body: z.infer<typeof CashSendInput>) {
    const c = await this.ctx(u);
    const to = body.to_clinic_id ?? (await this.hqOf(c.companyId));
    if (to === c.clinicId) throw new BadRequestException('O‘z filialingizga o‘tkazib bo‘lmaydi');
    const bal = (await this.cashier.safeBalance(c.clinicId, body.register)) as {
      safe_balance_uzs?: number;
    };
    const avail = Number(bal.safe_balance_uzs ?? 0);
    if (body.amount_uzs > avail) {
      throw new BadRequestException(
        `Seyfda yetarli mablag' yo'q. Mavjud: ${avail.toLocaleString('uz-UZ')} so'm`,
      );
    }
    const { data, error } = await this.supabase.admin().rpc(
      'network_cash_send' as never,
      {
        p_from: c.clinicId,
        p_to: to,
        p_user: c.userId,
        p_amount: body.amount_uzs,
        p_register: body.register,
        p_notes: body.notes ?? null,
      } as never,
    );
    if (error) this.rpcError(error);
    await this.notifyClinic(
      to,
      'network_cash_transfer',
      `${await this.clinicName(c.clinicId)} filialidan ${body.amount_uzs.toLocaleString('uz-UZ')} so'm`,
      'Pul seyfga yetib kelgach Tarmoq → Transferlar bo\'limida "Seyfga oldim" bosing',
      'network_cash_transfers',
      (data as { transfer_id: string }).transfer_id,
    );
    return data;
  }

  async receiveCash(u: CompanyUser, id: string) {
    const c = await this.ctx(u);
    const t = await this.loadTransfer('network_cash_transfers', id);
    if (t.to_clinic_id !== c.clinicId) {
      throw new ForbiddenException('Pulni qabul qiluvchi filialda qabul qiling');
    }
    const { data, error } = await this.supabase
      .admin()
      .rpc('network_cash_receive' as never, { p_transfer: id, p_user: c.userId } as never);
    if (error) this.rpcError(error);
    await this.notifyClinic(
      t.from_clinic_id,
      'network_cash_transfer',
      `${await this.clinicName(c.clinicId)} pulni seyfga oldi`,
      "Jo'natilgan pul qabul qiluvchi seyfga kirim qilindi",
      'network_cash_transfers',
      id,
    );
    return data;
  }

  async cancelCash(u: CompanyUser, id: string, reason: string) {
    const c = await this.ctx(u);
    const t = await this.loadTransfer('network_cash_transfers', id);
    await this.assertCanCancel(u, c.clinicId, t);
    const { data, error } = await this.supabase
      .admin()
      .rpc(
        'network_cash_cancel' as never,
        { p_transfer: id, p_user: c.userId, p_reason: reason } as never,
      );
    if (error) this.rpcError(error);
    return data;
  }

  // ── Faza 5d: bemor dublikatlari ────────────────────────────────────────────
  /** Rahbariyat — tarmoq doirasi; filial rahbari — faqat o'z filiali */
  private async dupScope(u: CompanyUser): Promise<string[]> {
    const v = await this.access.viewer(u);
    if (v?.canManage) return v.branchIds;
    if (u.clinicId && ['clinic_owner', 'clinic_admin'].includes(u.role)) return [u.clinicId];
    throw new ForbiddenException('Dublikatlarni klinika rahbariyati ko‘radi');
  }

  async duplicates(u: CompanyUser) {
    const scope = await this.dupScope(u);
    const { data, error } = await this.supabase
      .admin()
      .rpc('network_duplicate_patients' as never, { p_clinics: scope, p_limit: 200 } as never);
    if (error) this.rpcError(error);
    return data ?? [];
  }

  async merge(u: CompanyUser, body: z.infer<typeof MergeInput>) {
    const scope = await this.dupScope(u);
    const { data: rows } = await this.supabase
      .admin()
      .from('patients')
      .select('id, clinic_id')
      .in('id', [body.keep_id, body.drop_id]);
    const list = (rows ?? []) as Array<{ id: string; clinic_id: string }>;
    if (list.length !== 2 || list.some((r) => !scope.includes(r.clinic_id))) {
      throw new ForbiddenException('Bemorlar ruxsat doirangizdan tashqarida');
    }
    const { data, error } = await this.supabase
      .admin()
      .rpc(
        'network_merge_patients' as never,
        { p_keep: body.keep_id, p_drop: body.drop_id, p_actor: u.userId } as never,
      );
    if (error) this.rpcError(error);
    return data;
  }
}
