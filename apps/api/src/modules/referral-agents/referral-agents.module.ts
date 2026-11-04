import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { emitReportEvent } from '../../common/events/report-events';
import { fetchAllRows } from '../../common/fetch-all';
import { SupabaseService } from '../../common/services/supabase.service';
import { CashierModule, CashierService } from '../cashier/cashier.module';

// =============================================================================
// AGENTLAR — statsionarga yo'llanma bilan kelgan bemor.
//   * Ma'lumotnoma: agent va yo'llanma bergan (tashqi) shifokor — F.I.O.,
//     mutaxassislik, ish joyi, telefonlar, xona to'lovidan foiz.
//   * Qabulda stay'ga yo'llagan shifokor + agent va ularning foizi SNAPSHOT.
//   * Ulush har kuni xona to'lovi yozilganda hisoblanadi
//     (accrue_inpatient_referral_shares RPC, idempotent) — faqat xona narxidan.
//   * To'lov: statsionar kassasidan xarajat (CashierService.createExpense —
//     smena, yopilgan davr va kassa qoldig'i tekshiruvlari bilan).
// Foizni faqat admin belgilaydi; qabulxona yangi sherikni 0% bilan qo'sha oladi.
// =============================================================================

const ADMIN_ROLES = ['clinic_owner', 'clinic_admin', 'super_admin'] as const;
const isAdminRole = (role?: string | null) =>
  role === 'clinic_owner' || role === 'clinic_admin' || role === 'super_admin';

const optText = (max: number) => z.string().trim().max(max).nullable().optional();

export const PartnerCreateSchema = z.object({
  type: z.enum(['agent', 'doctor']),
  name: z.string().trim().min(2, "F.I.O. kamida 2 harf bo'lsin").max(200),
  specialty: optText(200),
  workplace: optText(200),
  phone: optText(50),
  phone2: optText(50),
  commission_percent: z.number().min(0).max(100).optional(),
  notes: optText(1000),
});

export const PartnerUpdateSchema = PartnerCreateSchema.partial().extend({
  is_archived: z.boolean().optional(),
});

/** Qabul (admit) so'rovidagi yo'llanma maydonlari. */
export const AdmitReferralFields = {
  admission_channel: z.enum(['self', 'referral']).optional(),
  referring_doctor_id: z.string().uuid().nullable().optional(),
  agent_id: z.string().uuid().nullable().optional(),
};

export const StayReferralUpdateSchema = z.object({
  admission_channel: z.enum(['self', 'referral']),
  referring_doctor_id: z.string().uuid().nullable().optional(),
  agent_id: z.string().uuid().nullable().optional(),
  // Admin shu bemor uchun foizni qo'lda o'zgartira oladi (kartadagidan farqli).
  referring_doctor_percent: z.number().min(0).max(100).optional(),
  agent_percent: z.number().min(0).max(100).optional(),
});

export const PayoutSchema = z.object({
  // Berilmasa — sherikning barcha to'lanmagan ulushi.
  stay_ids: z.array(z.string().uuid()).max(500).optional(),
  method: z.enum(['cash', 'card', 'transfer', 'click', 'payme', 'humo', 'uzcard']).default('cash'),
  source: z.enum(['cash_drawer', 'safe']).default('cash_drawer'),
  notes: z.string().trim().max(500).optional(),
});

export type PartnerType = 'agent' | 'doctor';

type PartnerRow = {
  id: string;
  type: PartnerType;
  name: string;
  specialty: string | null;
  workplace: string | null;
  phone: string | null;
  phone2: string | null;
  commission_percent: number;
  notes: string | null;
  is_archived: boolean;
  created_at?: string;
};

type AccrualRow = {
  id: string;
  stay_id: string;
  partner_id: string;
  role: PartnerType;
  charge_date: string;
  base_uzs: number;
  percent: number;
  amount_uzs: number;
  status: 'accrued' | 'paid' | 'void';
};

export type ResolvedReferral = {
  admission_channel: 'referral';
  referring_doctor_id: string | null;
  referring_doctor_percent: number;
  agent_id: string | null;
  agent_percent: number;
};

type Money = { days: number; accrued_uzs: number; paid_uzs: number; unpaid_uzs: number };

const PARTNER_COLS =
  'id, type, name, specialty, workplace, phone, phone2, commission_percent, notes, is_archived, created_at';

const EXPENSE_CATEGORY_NAME = "Agent / yo'llanma ulushi";

const emptyMoney = (): Money => ({ days: 0, accrued_uzs: 0, paid_uzs: 0, unpaid_uzs: 0 });

function addMoney(m: Money, a: Pick<AccrualRow, 'status' | 'amount_uzs'>) {
  const v = Number(a.amount_uzs ?? 0);
  m.days += 1;
  m.accrued_uzs += v;
  if (a.status === 'paid') m.paid_uzs += v;
  else m.unpaid_uzs += v;
}

function normalizePartner(r: Record<string, unknown>): PartnerRow {
  return {
    id: String(r.id),
    type: r.type === 'doctor' ? 'doctor' : 'agent',
    name: String(r.name ?? ''),
    specialty: (r.specialty as string | null) ?? null,
    workplace: (r.workplace as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    phone2: (r.phone2 as string | null) ?? null,
    commission_percent: Number(r.commission_percent ?? 0),
    notes: (r.notes as string | null) ?? null,
    is_archived: !!r.is_archived,
    created_at: r.created_at as string | undefined,
  };
}

const blankToNull = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const roleLabel = (t: PartnerType) => (t === 'doctor' ? "Yo'llagan shifokor" : 'Agent');

@Injectable()
export class ReferralAgentsService {
  private readonly log = new Logger('ReferralAgents');

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cashier: CashierService,
  ) {}

  // ---------------------------------------------------------------------------
  // Ma'lumotnoma
  // ---------------------------------------------------------------------------
  async listPartners(clinicId: string, opts: { type?: string; includeArchived?: boolean } = {}) {
    let q = this.supabase
      .admin()
      .from('referral_partners')
      .select(PARTNER_COLS)
      .eq('clinic_id', clinicId)
      .order('name', { ascending: true });
    if (opts.type === 'agent' || opts.type === 'doctor') q = q.eq('type', opts.type);
    if (!opts.includeArchived) q = q.eq('is_archived', false);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map(normalizePartner);
  }

  async createPartner(
    clinicId: string,
    userId: string,
    role: string | null | undefined,
    body: z.infer<typeof PartnerCreateSchema>,
  ) {
    const admin = this.supabase.admin();
    // Takror: shu turdagi, shu F.I.O.li faol sherik (telefon bo'lsa — mos kelsa).
    const { data: same } = await admin
      .from('referral_partners')
      .select('id, name, phone')
      .eq('clinic_id', clinicId)
      .eq('type', body.type)
      .eq('is_archived', false)
      .ilike('name', body.name);
    const twin = ((same ?? []) as Array<{ id: string; name: string; phone: string | null }>).find(
      (p) => !body.phone || !p.phone || digits(p.phone) === digits(body.phone),
    );
    if (twin) {
      throw new ConflictException(`"${twin.name}" ro'yxatda bor — o'shani tanlang`);
    }

    const { data, error } = await admin
      .from('referral_partners')
      .insert({
        clinic_id: clinicId,
        type: body.type,
        name: body.name,
        specialty: blankToNull(body.specialty),
        workplace: blankToNull(body.workplace),
        phone: blankToNull(body.phone),
        phone2: blankToNull(body.phone2),
        notes: blankToNull(body.notes),
        // Foizni faqat admin belgilaydi — qabulxona qo'shgan sherik 0% bilan.
        commission_percent: isAdminRole(role) ? (body.commission_percent ?? 0) : 0,
        created_by: userId,
        updated_by: userId,
      })
      .select(PARTNER_COLS)
      .single();
    if (error) throw new BadRequestException(error.message);
    return normalizePartner(data as Record<string, unknown>);
  }

  async updatePartner(
    clinicId: string,
    userId: string,
    id: string,
    body: z.infer<typeof PartnerUpdateSchema>,
  ) {
    const patch: Record<string, unknown> = { updated_by: userId };
    if (body.type !== undefined) patch.type = body.type;
    if (body.name !== undefined) patch.name = body.name;
    for (const k of ['specialty', 'workplace', 'phone', 'phone2', 'notes'] as const) {
      if (body[k] !== undefined) patch[k] = blankToNull(body[k]);
    }
    if (body.commission_percent !== undefined) patch.commission_percent = body.commission_percent;
    if (body.is_archived !== undefined) patch.is_archived = body.is_archived;

    const { data, error } = await this.supabase
      .admin()
      .from('referral_partners')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select(PARTNER_COLS)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Sherik topilmadi');
    const partner = normalizePartner(data as Record<string, unknown>);
    const applied_stays =
      body.commission_percent !== undefined
        ? await this.applyPercentToUnsetStays(clinicId, partner)
        : 0;
    return { ...partner, applied_stays };
  }

  /**
   * Qabulxona yangi sherikni 0% bilan qo'shadi — admin foizni keyin belgilaydi.
   * Shunda "foiz belgilanmagan" (0%) holatda yotqizilgan bemorlarga ham yangi
   * foiz qo'llanadi (faqat hali yotgan yoki oxirgi 60 kunda yotqizilganlar).
   * Foizi allaqachon belgilangan bemorlarga TEGILMAYDI (snapshot).
   */
  private async applyPercentToUnsetStays(clinicId: string, partner: PartnerRow): Promise<number> {
    if (partner.commission_percent <= 0 || partner.is_archived) return 0;
    const admin = this.supabase.admin();
    const isDoctor = partner.type === 'doctor';
    const { data, error } = await admin
      .from('inpatient_stays')
      .select('id, status, admitted_at, referring_doctor_percent, agent_percent')
      .eq('clinic_id', clinicId)
      .eq('admission_channel', 'referral')
      .eq(isDoctor ? 'referring_doctor_id' : 'agent_id', partner.id);
    if (error) return 0;
    const since = Date.now() - 60 * 86_400_000;
    let applied = 0;
    for (const s of (data ?? []) as Array<{
      id: string;
      status: string;
      admitted_at: string;
      referring_doctor_percent: number | string | null;
      agent_percent: number | string | null;
    }>) {
      const own = Number((isDoctor ? s.referring_doctor_percent : s.agent_percent) ?? 0);
      const other = Number((isDoctor ? s.agent_percent : s.referring_doctor_percent) ?? 0);
      if (own > 0) continue;
      if (s.status !== 'admitted' && new Date(s.admitted_at).getTime() < since) continue;
      const pct = Math.min(partner.commission_percent, 100 - other);
      if (pct <= 0) continue;
      const { error: upErr } = await admin
        .from('inpatient_stays')
        .update(isDoctor ? { referring_doctor_percent: pct } : { agent_percent: pct })
        .eq('clinic_id', clinicId)
        .eq('id', s.id);
      if (upErr) continue;
      await this.accrueSafe(s.id);
      applied += 1;
    }
    return applied;
  }

  private async loadPartners(clinicId: string, ids: string[]): Promise<Map<string, PartnerRow>> {
    const map = new Map<string, PartnerRow>();
    const uniq = [...new Set(ids.filter(Boolean))];
    if (uniq.length === 0) return map;
    for (const part of chunk(uniq, 150)) {
      const { data, error } = await this.supabase
        .admin()
        .from('referral_partners')
        .select(PARTNER_COLS)
        .eq('clinic_id', clinicId)
        .in('id', part);
      if (error) throw new BadRequestException(error.message);
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        const p = normalizePartner(r);
        map.set(p.id, p);
      }
    }
    return map;
  }

  /** Sherik shu klinikada, kerakli turda va (yangi tanlanganda) faol bo'lishi shart. */
  private checkPartner(
    partners: Map<string, PartnerRow>,
    id: string,
    type: PartnerType,
    allowArchived = false,
  ): PartnerRow {
    const p = partners.get(id);
    if (!p) throw new BadRequestException(`${roleLabel(type)} topilmadi`);
    if (p.type !== type) {
      throw new BadRequestException(
        type === 'doctor'
          ? `"${p.name}" agent sifatida yozilgan — shifokor ro'yxatidan tanlang`
          : `"${p.name}" shifokor sifatida yozilgan — agentlar ro'yxatidan tanlang`,
      );
    }
    if (p.is_archived && !allowArchived) {
      throw new BadRequestException(`"${p.name}" arxivlangan`);
    }
    return p;
  }

  // ---------------------------------------------------------------------------
  // Qabul (admit)
  // ---------------------------------------------------------------------------
  /**
   * Qabul formasidagi yo'llanmani tekshiradi va foizlarni sherik kartasidan
   * oladi (brauzerdan foiz QABUL QILINMAYDI). O'zi kelgan bemor uchun null.
   */
  async resolveForAdmit(
    clinicId: string,
    input: {
      admission_channel?: 'self' | 'referral';
      referring_doctor_id?: string | null;
      agent_id?: string | null;
    },
  ): Promise<ResolvedReferral | null> {
    if (input.admission_channel !== 'referral') return null;
    const doctorId = input.referring_doctor_id ?? null;
    const agentId = input.agent_id ?? null;
    if (!doctorId && !agentId) {
      throw new BadRequestException(
        "Yo'llanma tanlangan — yo'llagan shifokor yoki agentni tanlang",
      );
    }
    const partners = await this.loadPartners(clinicId, [doctorId ?? '', agentId ?? '']);
    const doctor = doctorId ? this.checkPartner(partners, doctorId, 'doctor') : null;
    const agent = agentId ? this.checkPartner(partners, agentId, 'agent') : null;
    const res: ResolvedReferral = {
      admission_channel: 'referral',
      referring_doctor_id: doctor?.id ?? null,
      referring_doctor_percent: doctor?.commission_percent ?? 0,
      agent_id: agent?.id ?? null,
      agent_percent: agent?.commission_percent ?? 0,
    };
    if (res.referring_doctor_percent + res.agent_percent > 100) {
      throw new BadRequestException(
        "Shifokor va agent foizlari yig'indisi 100% dan oshmasin (Sozlamalar → Agentlar)",
      );
    }
    return res;
  }

  /** Qabuldan keyin: bemor kartasida kelish manbai bo'sh bo'lsa to'ldiriladi + ulush. */
  async afterAdmit(clinicId: string, stayId: string, patientId: string, ref: ResolvedReferral) {
    const admin = this.supabase.admin();
    try {
      await admin
        .from('patients')
        .update({ referral_source: ref.referring_doctor_id ? 'doctor' : 'other' })
        .eq('clinic_id', clinicId)
        .eq('id', patientId)
        .is('referral_source', null);
      await admin
        .from('patients')
        .update({ referral_partner_id: ref.referring_doctor_id ?? ref.agent_id })
        .eq('clinic_id', clinicId)
        .eq('id', patientId)
        .is('referral_partner_id', null);
    } catch (e) {
      this.log.warn(`[afterAdmit] bemor kartasi: ${(e as Error).message}`);
    }
    await this.accrueSafe(stayId);
  }

  /** Kunlik ulushni yozish (idempotent). stayId berilmasa — barcha yo'llanmali stay'lar. */
  async accrue(stayId?: string): Promise<number> {
    const { data, error } = await this.supabase
      .admin()
      .rpc('accrue_inpatient_referral_shares' as never, { p_stay_id: stayId ?? null } as never);
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  }

  /** Xatoni yutadi — asosiy oqim (qabul, chiqarish, cron) yo'llanma tufayli yiqilmasin. */
  async accrueSafe(stayId?: string): Promise<number> {
    try {
      return await this.accrue(stayId);
    } catch (e) {
      this.log.warn(`[accrue] ${stayId ?? 'barchasi'}: ${(e as Error).message}`);
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Bemor (stay) yo'llanmasi
  // ---------------------------------------------------------------------------
  private async loadStayReferral(clinicId: string, stayId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('inpatient_stays')
      .select(
        'id, status, admission_channel, referring_doctor_id, referring_doctor_percent, agent_id, agent_percent',
      )
      .eq('clinic_id', clinicId)
      .eq('id', stayId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Statsionar yozuvi topilmadi');
    const s = data as {
      id: string;
      status: string;
      admission_channel: string | null;
      referring_doctor_id: string | null;
      referring_doctor_percent: number | string | null;
      agent_id: string | null;
      agent_percent: number | string | null;
    };
    return {
      id: s.id,
      status: s.status,
      admission_channel: (s.admission_channel === 'referral' ? 'referral' : 'self') as
        | 'self'
        | 'referral',
      referring_doctor_id: s.referring_doctor_id,
      referring_doctor_percent: Number(s.referring_doctor_percent ?? 0),
      agent_id: s.agent_id,
      agent_percent: Number(s.agent_percent ?? 0),
    };
  }

  async getStayReferral(clinicId: string, stayId: string, role?: string | null) {
    const s = await this.loadStayReferral(clinicId, stayId);
    if (s.admission_channel === 'referral') await this.accrueSafe(stayId);

    const partners = await this.loadPartners(clinicId, [
      s.referring_doctor_id ?? '',
      s.agent_id ?? '',
    ]);
    const canSeeMoney = isAdminRole(role);

    const totals = { doctor: emptyMoney(), agent: emptyMoney() };
    if (canSeeMoney && s.admission_channel === 'referral') {
      const { data } = await this.supabase
        .admin()
        .from('referral_accruals')
        .select('role, status, amount_uzs')
        .eq('clinic_id', clinicId)
        .eq('stay_id', stayId)
        .neq('status', 'void');
      for (const a of (data ?? []) as Array<Pick<AccrualRow, 'role' | 'status' | 'amount_uzs'>>) {
        addMoney(a.role === 'doctor' ? totals.doctor : totals.agent, a);
      }
    }

    const view = (id: string | null, percent: number) => {
      const p = id ? partners.get(id) : undefined;
      if (!id || !p) return null;
      return {
        id: p.id,
        name: p.name,
        specialty: p.specialty,
        workplace: p.workplace,
        phone: p.phone,
        phone2: p.phone2,
        is_archived: p.is_archived,
        percent,
      };
    };

    return {
      stay_id: s.id,
      admission_channel: s.admission_channel,
      doctor: view(s.referring_doctor_id, s.referring_doctor_percent),
      agent: view(s.agent_id, s.agent_percent),
      totals: canSeeMoney ? totals : null,
      can_edit: canSeeMoney,
    };
  }

  /**
   * Admin bemorning yo'llanmasini o'zgartiradi. To'lanmagan ulushlar bekor
   * qilinib, yangi ma'lumot bilan qayta hisoblanadi; to'langanlariga tegilmaydi
   * (o'sha kunlar uchun yangi ulush yozilmaydi).
   */
  async updateStayReferral(
    clinicId: string,
    stayId: string,
    body: z.infer<typeof StayReferralUpdateSchema>,
  ) {
    const admin = this.supabase.admin();
    const cur = await this.loadStayReferral(clinicId, stayId);

    let next: {
      admission_channel: 'self' | 'referral';
      referring_doctor_id: string | null;
      referring_doctor_percent: number;
      agent_id: string | null;
      agent_percent: number;
    };
    if (body.admission_channel === 'self') {
      next = {
        admission_channel: 'self',
        referring_doctor_id: null,
        referring_doctor_percent: 0,
        agent_id: null,
        agent_percent: 0,
      };
    } else {
      const doctorId = body.referring_doctor_id ?? null;
      const agentId = body.agent_id ?? null;
      if (!doctorId && !agentId) {
        throw new BadRequestException('Yo‘llagan shifokor yoki agentni tanlang');
      }
      const partners = await this.loadPartners(clinicId, [doctorId ?? '', agentId ?? '']);
      // Avvaldan biriktirilgan sherik arxivlangan bo'lsa ham qoldirsa bo'ladi.
      const doctor = doctorId
        ? this.checkPartner(partners, doctorId, 'doctor', doctorId === cur.referring_doctor_id)
        : null;
      const agent = agentId
        ? this.checkPartner(partners, agentId, 'agent', agentId === cur.agent_id)
        : null;
      const pick = (
        p: PartnerRow | null,
        override: number | undefined,
        curId: string | null,
        curPct: number,
      ) => {
        if (!p) return 0;
        if (override !== undefined) return override;
        // Sherik o'zgarmagan bo'lsa — qabuldagi snapshot foiz saqlanadi.
        return p.id === curId ? curPct : p.commission_percent;
      };
      next = {
        admission_channel: 'referral',
        referring_doctor_id: doctor?.id ?? null,
        referring_doctor_percent: pick(
          doctor,
          body.referring_doctor_percent,
          cur.referring_doctor_id,
          cur.referring_doctor_percent,
        ),
        agent_id: agent?.id ?? null,
        agent_percent: pick(agent, body.agent_percent, cur.agent_id, cur.agent_percent),
      };
      if (next.referring_doctor_percent + next.agent_percent > 100) {
        throw new BadRequestException("Foizlar yig'indisi 100% dan oshmasin");
      }
    }

    const { error } = await admin
      .from('inpatient_stays')
      .update(next)
      .eq('clinic_id', clinicId)
      .eq('id', stayId);
    if (error) throw new BadRequestException(error.message);

    const { error: voidErr } = await admin
      .from('referral_accruals')
      .update({ status: 'void', voided_at: new Date().toISOString() })
      .eq('clinic_id', clinicId)
      .eq('stay_id', stayId)
      .eq('status', 'accrued');
    if (voidErr) throw new BadRequestException(voidErr.message);

    await this.accrueSafe(stayId);
    return this.getStayReferral(clinicId, stayId, 'clinic_admin');
  }

  /** Savatchaga o'chirishdan oldin: ulushi to'langan bemor o'chirilmaydi. */
  async assertStayDeletable(clinicId: string, stayId: string) {
    const { count, error } = await this.supabase
      .admin()
      .from('referral_accruals')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('stay_id', stayId)
      .eq('status', 'paid');
    if (error) return; // migratsiya hali qo'llanmagan — tekshiruvsiz
    if ((count ?? 0) > 0) {
      throw new BadRequestException(
        "Bu bemor bo'yicha agent/shifokorga ulush to'langan. Avval Statsionar → Agentlar hisobi'da to'lovni bekor qiling.",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Hisob: sheriklar bo'yicha jamlanma, bemorlar kesimi, to'lov
  // ---------------------------------------------------------------------------
  private fetchAccruals(clinicId: string, partnerId?: string) {
    return fetchAllRows<AccrualRow>((a, b) => {
      let q = this.supabase
        .admin()
        .from('referral_accruals')
        .select('id, stay_id, partner_id, role, charge_date, base_uzs, percent, amount_uzs, status')
        .eq('clinic_id', clinicId)
        .neq('status', 'void');
      if (partnerId) q = q.eq('partner_id', partnerId);
      return q.order('id').range(a, b);
    });
  }

  async summary(clinicId: string) {
    await this.accrueSafe();
    const admin = this.supabase.admin();
    const [partners, accruals, staysRes, payoutsRes] = await Promise.all([
      this.listPartners(clinicId, { includeArchived: true }),
      this.fetchAccruals(clinicId),
      fetchAllRows<{ id: string; status: string }>((a, b) =>
        admin
          .from('inpatient_stays')
          .select('id, status')
          .eq('clinic_id', clinicId)
          .eq('admission_channel', 'referral')
          .order('id')
          .range(a, b),
      ),
      admin
        .from('referral_payouts')
        .select('partner_id, paid_at')
        .eq('clinic_id', clinicId)
        .eq('status', 'paid')
        .order('paid_at', { ascending: false })
        .limit(1000),
    ]);
    const stayStatus = new Map(staysRes.map((s) => [s.id, s.status]));
    const lastPaid = new Map<string, string>();
    for (const p of (payoutsRes.data ?? []) as Array<{ partner_id: string; paid_at: string }>) {
      if (!lastPaid.has(p.partner_id)) lastPaid.set(p.partner_id, p.paid_at);
    }

    const agg = new Map<string, Money & { stays: Set<string> }>();
    for (const a of accruals) {
      const m = agg.get(a.partner_id) ?? { ...emptyMoney(), stays: new Set<string>() };
      addMoney(m, a);
      m.stays.add(a.stay_id);
      agg.set(a.partner_id, m);
    }

    const rows = partners
      .map((p) => {
        const m = agg.get(p.id);
        const stays = m ? [...m.stays] : [];
        return {
          ...p,
          stays: stays.length,
          active_stays: stays.filter((id) => stayStatus.get(id) === 'admitted').length,
          accrued_uzs: m?.accrued_uzs ?? 0,
          paid_uzs: m?.paid_uzs ?? 0,
          unpaid_uzs: m?.unpaid_uzs ?? 0,
          last_paid_at: lastPaid.get(p.id) ?? null,
        };
      })
      .filter((r) => !r.is_archived || r.accrued_uzs > 0)
      .sort((x, y) => y.unpaid_uzs - x.unpaid_uzs || x.name.localeCompare(y.name));

    return {
      partners: rows,
      totals: {
        accrued_uzs: rows.reduce((s, r) => s + r.accrued_uzs, 0),
        paid_uzs: rows.reduce((s, r) => s + r.paid_uzs, 0),
        unpaid_uzs: rows.reduce((s, r) => s + r.unpaid_uzs, 0),
      },
    };
  }

  async partnerDetail(clinicId: string, partnerId: string) {
    const admin = this.supabase.admin();
    const partners = await this.loadPartners(clinicId, [partnerId]);
    const partner = partners.get(partnerId);
    if (!partner) throw new NotFoundException('Sherik topilmadi');
    await this.accrueSafe();

    const accruals = await this.fetchAccruals(clinicId, partnerId);
    const stayIds = [...new Set(accruals.map((a) => a.stay_id))];

    type StayInfo = {
      id: string;
      admitted_at: string;
      discharged_at: string | null;
      status: string;
      patient: { full_name: string; phone: string | null } | null;
      room: { number: string } | null;
    };
    const stays = new Map<string, StayInfo>();
    const balance = new Map<string, number>();
    for (const part of chunk(stayIds, 150)) {
      const [{ data: sd }, ledger] = await Promise.all([
        admin
          .from('inpatient_stays')
          .select(
            'id, admitted_at, discharged_at, status, patient:patients(full_name, phone), room:rooms(number)',
          )
          .eq('clinic_id', clinicId)
          .in('id', part),
        fetchAllRows<{ id: string; stay_id: string; amount_uzs: number }>((a, b) =>
          admin
            .from('patient_ledger')
            .select('id, stay_id, amount_uzs')
            .eq('clinic_id', clinicId)
            .in('stay_id', part)
            .order('id')
            .range(a, b),
        ),
      ]);
      for (const s of (sd ?? []) as unknown as StayInfo[]) stays.set(s.id, s);
      for (const l of ledger) {
        balance.set(l.stay_id, (balance.get(l.stay_id) ?? 0) + Number(l.amount_uzs ?? 0));
      }
    }

    const byKey = new Map<
      string,
      Money & { stay_id: string; role: PartnerType; percent: number; last_date: string }
    >();
    for (const a of accruals) {
      const key = `${a.stay_id}:${a.role}`;
      const m = byKey.get(key) ?? {
        ...emptyMoney(),
        stay_id: a.stay_id,
        role: a.role,
        percent: Number(a.percent ?? 0),
        last_date: a.charge_date,
      };
      addMoney(m, a);
      if (a.charge_date >= m.last_date) {
        m.last_date = a.charge_date;
        m.percent = Number(a.percent ?? 0);
      }
      byKey.set(key, m);
    }

    const rows = [...byKey.values()]
      .map((m) => {
        const s = stays.get(m.stay_id);
        const bal = balance.get(m.stay_id) ?? 0;
        return {
          stay_id: m.stay_id,
          role: m.role,
          percent: m.percent,
          days: m.days,
          accrued_uzs: m.accrued_uzs,
          paid_uzs: m.paid_uzs,
          unpaid_uzs: m.unpaid_uzs,
          patient_name: s?.patient?.full_name ?? '—',
          patient_phone: s?.patient?.phone ?? null,
          room_number: s?.room?.number ?? null,
          admitted_at: s?.admitted_at ?? null,
          discharged_at: s?.discharged_at ?? null,
          status: s?.status ?? 'unknown',
          // Bemorning shu yotishdagi to'lanmagan summasi (to'lovni bloklamaydi).
          patient_debt_uzs: bal < 0 ? -bal : 0,
        };
      })
      .sort((x, y) => (y.admitted_at ?? '').localeCompare(x.admitted_at ?? ''));

    const { data: payouts } = await admin
      .from('referral_payouts')
      .select(
        'id, amount_uzs, method, source, status, notes, paid_at, canceled_at, payer:profiles!paid_by(full_name)',
      )
      .eq('clinic_id', clinicId)
      .eq('partner_id', partnerId)
      .order('paid_at', { ascending: false })
      .limit(200);

    return {
      partner,
      stays: rows,
      payouts: (
        (payouts ?? []) as unknown as Array<
          Record<string, unknown> & { payer: { full_name: string } | null }
        >
      ).map((p) => ({
        id: String(p.id),
        amount_uzs: Number(p.amount_uzs ?? 0),
        method: String(p.method ?? 'cash'),
        source: String(p.source ?? 'cash_drawer'),
        status: String(p.status ?? 'paid'),
        notes: (p.notes as string | null) ?? null,
        paid_at: String(p.paid_at),
        canceled_at: (p.canceled_at as string | null) ?? null,
        paid_by_name: p.payer?.full_name ?? null,
      })),
      totals: {
        accrued_uzs: rows.reduce((s, r) => s + r.accrued_uzs, 0),
        paid_uzs: rows.reduce((s, r) => s + r.paid_uzs, 0),
        unpaid_uzs: rows.reduce((s, r) => s + r.unpaid_uzs, 0),
      },
    };
  }

  private async ensureExpenseCategory(clinicId: string, userId: string): Promise<string | null> {
    const admin = this.supabase.admin();
    try {
      const { data } = await admin
        .from('expense_categories')
        .select('id, name_i18n')
        .eq('clinic_id', clinicId)
        .eq('is_archived', false);
      const found = ((data ?? []) as Array<{ id: string; name_i18n: Record<string, string> }>).find(
        (c) => c.name_i18n?.['uz-Latn'] === EXPENSE_CATEGORY_NAME,
      );
      if (found) return found.id;
      const { data: created } = await admin
        .from('expense_categories')
        .insert({
          clinic_id: clinicId,
          name_i18n: { 'uz-Latn': EXPENSE_CATEGORY_NAME, ru: 'Агентские (направления)' },
          sort_order: 50,
          created_by: userId,
        })
        .select('id')
        .single();
      return (created as { id: string } | null)?.id ?? null;
    } catch (e) {
      this.log.warn(`[expense-category] ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Sherikka to'lov: to'lanmagan ulushlar "to'landi" deb belgilanadi va
   * statsionar kassasidan xarajat yoziladi. Xarajat yozilmasa (smena yopiq,
   * kassada pul yetmaydi, davr yopilgan) — hammasi orqaga qaytariladi.
   */
  async pay(
    clinicId: string,
    userId: string,
    partnerId: string,
    body: z.infer<typeof PayoutSchema>,
  ) {
    const admin = this.supabase.admin();
    const partners = await this.loadPartners(clinicId, [partnerId]);
    const partner = partners.get(partnerId);
    if (!partner) throw new NotFoundException('Sherik topilmadi');

    const only = body.stay_ids?.length ? new Set(body.stay_ids) : null;
    const unpaid = (await this.fetchAccruals(clinicId, partnerId)).filter(
      (a) => a.status === 'accrued' && (!only || only.has(a.stay_id)),
    );
    const total = unpaid.reduce((s, a) => s + Number(a.amount_uzs ?? 0), 0);
    if (unpaid.length === 0 || total <= 0) {
      throw new BadRequestException("To'lanadigan ulush yo'q");
    }
    const source = body.method === 'cash' ? body.source : 'cash_drawer';

    const { data: payoutRow, error: payoutErr } = await admin
      .from('referral_payouts')
      .insert({
        clinic_id: clinicId,
        partner_id: partnerId,
        amount_uzs: total,
        method: body.method,
        source,
        status: 'paid',
        notes: body.notes ?? null,
        paid_by: userId,
      })
      .select('id')
      .single();
    if (payoutErr || !payoutRow) {
      throw new BadRequestException(payoutErr?.message ?? "To'lov yozilmadi");
    }
    const payoutId = (payoutRow as { id: string }).id;

    const release = async () => {
      await admin
        .from('referral_accruals')
        .update({ status: 'accrued', payout_id: null })
        .eq('clinic_id', clinicId)
        .eq('payout_id', payoutId);
      await admin.from('referral_payouts').delete().eq('clinic_id', clinicId).eq('id', payoutId);
    };

    // Ulushlarni shu to'lovga bog'laymiz (parallel to'lov bilan to'qnashmasin —
    // faqat hali 'accrued' bo'lganlari olinadi).
    let claimed = 0;
    const claimedStays = new Set<string>();
    try {
      for (const part of chunk(
        unpaid.map((a) => a.id),
        150,
      )) {
        const { data, error } = await admin
          .from('referral_accruals')
          .update({ status: 'paid', payout_id: payoutId })
          .eq('clinic_id', clinicId)
          .eq('status', 'accrued')
          .in('id', part)
          .select('stay_id, amount_uzs');
        if (error) throw new BadRequestException(error.message);
        for (const r of (data ?? []) as Array<{ stay_id: string; amount_uzs: number }>) {
          claimed += Number(r.amount_uzs ?? 0);
          claimedStays.add(r.stay_id);
        }
      }
    } catch (e) {
      await release();
      throw e;
    }
    if (claimed <= 0) {
      await release();
      throw new ConflictException("Ulush allaqachon to'langan — sahifani yangilang");
    }
    if (claimed !== total) {
      await admin
        .from('referral_payouts')
        .update({ amount_uzs: claimed })
        .eq('clinic_id', clinicId)
        .eq('id', payoutId);
    }

    const label = partner.type === 'doctor' ? "Yo'llanma shifokori ulushi" : 'Agent ulushi';
    const description =
      `${label}: ${partner.name} (${claimedStays.size} bemor)` +
      (body.notes ? ` — ${body.notes}` : '');
    let expenseId: string | null = null;
    try {
      const categoryId = await this.ensureExpenseCategory(clinicId, userId);
      const expense = await this.cashier.createExpense(clinicId, userId, {
        category_id: categoryId ?? undefined,
        amount_uzs: claimed,
        description,
        payment_method: body.method,
        source,
        register: 'inpatient',
      });
      expenseId = (expense as { id?: string } | null)?.id ?? null;
    } catch (e) {
      await release();
      throw e;
    }

    await admin
      .from('referral_payouts')
      .update({ expense_id: expenseId })
      .eq('clinic_id', clinicId)
      .eq('id', payoutId);

    emitReportEvent({ type: 'expense', clinicId, amountUzs: claimed, notes: description });

    return {
      payout_id: payoutId,
      amount_uzs: claimed,
      stays: claimedStays.size,
      partner: { id: partner.id, name: partner.name, type: partner.type },
      method: body.method,
      source,
      paid_at: new Date().toISOString(),
    };
  }

  /** To'lovni bekor qilish: xarajat bekor bo'ladi, ulushlar yana "to'lanmagan". */
  async cancelPayout(clinicId: string, userId: string, payoutId: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('referral_payouts')
      .select('id, status, expense_id')
      .eq('clinic_id', clinicId)
      .eq('id', payoutId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException("To'lov topilmadi");
    const p = data as { id: string; status: string; expense_id: string | null };
    if (p.status !== 'paid') throw new BadRequestException("To'lov allaqachon bekor qilingan");

    if (p.expense_id) await this.cashier.voidExpense(clinicId, userId, p.expense_id);

    const { error: relErr } = await admin
      .from('referral_accruals')
      .update({ status: 'accrued', payout_id: null })
      .eq('clinic_id', clinicId)
      .eq('payout_id', payoutId)
      .eq('status', 'paid');
    if (relErr) throw new BadRequestException(relErr.message);

    await admin
      .from('referral_payouts')
      .update({
        status: 'canceled',
        canceled_by: userId,
        canceled_at: new Date().toISOString(),
      })
      .eq('clinic_id', clinicId)
      .eq('id', payoutId);
    return { ok: true };
  }
}

@ApiTags('referral-partners')
@Controller({ path: 'referral-partners', version: '1' })
export class ReferralAgentsController {
  constructor(private readonly svc: ReferralAgentsService) {}

  // Ma'lumotnoma — qabul formasida ham kerak (qabulxona, shifokor ko'radi).
  @Get()
  list(
    @CurrentUser() u: { clinicId: string | null },
    @Query('type') type?: string,
    @Query('include_archived') includeArchived?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listPartners(u.clinicId, { type, includeArchived: includeArchived === 'true' });
  }

  // Qabulxona ham qo'sha oladi (qabul paytida yangi shifokor) — foizi 0 bo'ladi.
  @Post()
  @Roles(...ADMIN_ROLES, 'receptionist', 'cashier')
  @Audit({ action: 'referral_partner.created', resourceType: 'referral_partners' })
  create(
    @CurrentUser() u: { clinicId: string | null; userId: string | null; role: string },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createPartner(u.clinicId, u.userId, u.role, PartnerCreateSchema.parse(body));
  }

  @Patch(':id')
  @Roles(...ADMIN_ROLES)
  @Audit({ action: 'referral_partner.updated', resourceType: 'referral_partners' })
  update(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.updatePartner(u.clinicId, u.userId, id, PartnerUpdateSchema.parse(body));
  }

  @Get('summary')
  @Roles(...ADMIN_ROLES)
  summary(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.summary(u.clinicId);
  }

  @Get(':id/detail')
  @Roles(...ADMIN_ROLES)
  detail(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.partnerDetail(u.clinicId, id);
  }

  @Post(':id/payouts')
  @Roles(...ADMIN_ROLES)
  @Audit({ action: 'referral_partner.paid', resourceType: 'referral_payouts' })
  pay(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.pay(u.clinicId, u.userId, id, PayoutSchema.parse(body));
  }

  @Post('payouts/:payoutId/cancel')
  @Roles(...ADMIN_ROLES)
  @Audit({ action: 'referral_partner.payout_canceled', resourceType: 'referral_payouts' })
  cancelPayout(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('payoutId', ParseUUIDPipe) payoutId: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.cancelPayout(u.clinicId, u.userId, payoutId);
  }
}

@Module({
  imports: [CashierModule],
  controllers: [ReferralAgentsController],
  providers: [ReferralAgentsService, SupabaseService],
  exports: [ReferralAgentsService],
})
export class ReferralAgentsModule {}
