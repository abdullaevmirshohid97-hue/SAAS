import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------
const PinVerifySchema = z.object({ pin: z.string().min(4).max(8) });
const PinChangeSchema = z.object({
  current_pin: z.string().min(4).max(8),
  new_pin: z.string().regex(/^\d{4,8}$/),
});

const NoteCreateSchema = z.object({
  ref_type: z.enum(['transaction', 'pharmacy_sale', 'inpatient_stay', 'appointment', 'expense']),
  ref_id: z.string().uuid(),
  note: z.string().min(1).max(2000),
});

const NoteUpdateSchema = z.object({ note: z.string().min(1).max(2000) });

// Journal layout schemas
const DefaultUpsertSchema = z.object({
  source_key: z.string().min(1).max(64),
  display_label_i18n: z.record(z.string(), z.string()).optional(),
  color_tone: z.string().max(32).optional(),
  icon_key: z.string().max(64).optional(),
  sort_order: z.number().int().optional(),
  is_visible: z.boolean().optional(),
  lock_label: z.boolean().optional(),
  lock_color: z.boolean().optional(),
  lock_icon: z.boolean().optional(),
  lock_order: z.boolean().optional(),
  lock_visible: z.boolean().optional(),
});

const OverrideUpsertSchema = z.object({
  source_key: z.string().min(1).max(64),
  display_label_i18n: z.record(z.string(), z.string()).nullable().optional(),
  color_tone: z.string().max(32).nullable().optional(),
  icon_key: z.string().max(64).nullable().optional(),
  sort_order: z.number().int().nullable().optional(),
  is_visible: z.boolean().nullable().optional(),
});

type EffectiveLayoutRow = {
  source_key: string;
  display_label_i18n: Record<string, string>;
  color_tone: string;
  icon_key: string;
  sort_order: number;
  is_visible: boolean;
  is_locked_label: boolean;
  is_locked_color: boolean;
  is_locked_icon: boolean;
  is_locked_order: boolean;
  is_locked_visible: boolean;
};

const FeedQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  source: z
    .enum([
      'all',
      'transactions',
      'pharmacy',
      'inpatient',
      'ledger',
      'appointments',
      'expenses',
      'shifts',
    ])
    .default('all'),
  search: z.string().optional(),
  // Pul bo'yicha filtr — amount_uzs +/- tolerance ichida (default 0 = aniq mos)
  amount: z.coerce.number().int().nonnegative().optional(),
  amount_tolerance: z.coerce.number().int().nonnegative().default(0),
  // true bo'lsa bekor qilingan (void) yozuvlar ham qaytariladi.
  // Eslatma: z.coerce.boolean() 'false' string'ni TRUE qiladi (bu Zod xatosi).
  // Shu sabab string'larni qo'lda parse qilamiz.
  include_void: z
    .preprocess(
      (v) => v === 'true' || v === '1' || v === true,
      z.boolean(),
    )
    .default(false),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
type FeedEntry = {
  id: string;
  source:
    | 'transaction'
    | 'pharmacy_sale'
    | 'inpatient_stay'
    | 'inpatient_ledger'
    | 'inpatient_discharge'
    | 'inpatient_transfer'
    | 'appointment'
    | 'expense'
    | 'shift_opened'
    | 'shift_closed';
  ref_id: string;
  occurred_at: string;
  patient_id: string | null;
  patient_name: string | null;
  patient_phone: string | null;
  doctor_name: string | null;
  diagnosis: string | null;
  amount_uzs: number;
  status: 'paid' | 'debt' | 'refund' | 'expense' | 'pending' | 'partial';
  payment_method: string | null;
  description: string | null;
  note: string | null;
  /** Yozuvni qayd qilgan kassir/xodim ismi. */
  cashier_name: string | null;
  /** Bekor qilingan (void) yozuvmi — chizilgan holda ko'rsatiladi. */
  is_void: boolean;
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------
@Injectable()
export class JournalService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Unified journal feed — merges transactions, pharmacy_sales,
   * inpatient_stays, appointments and expenses into one chronological list.
   */
  async feed(clinicId: string, params: z.infer<typeof FeedQuerySchema>) {
    const admin = this.supabase.admin();
    const fromIso = params.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
    const toIso = params.to ?? new Date().toISOString();
    const wantAll = params.source === 'all';

    const queries: Promise<FeedEntry[]>[] = [];

    if (wantAll || params.source === 'transactions') {
      queries.push(this.fetchTransactions(clinicId, fromIso, toIso, params.include_void));
    }
    if (wantAll || params.source === 'pharmacy') {
      queries.push(this.fetchPharmacy(clinicId, fromIso, toIso, params.include_void));
    }
    if (wantAll || params.source === 'inpatient') {
      queries.push(this.fetchInpatient(clinicId, fromIso, toIso));
      queries.push(this.fetchInpatientDischarges(clinicId, fromIso, toIso));
      queries.push(this.fetchInpatientTransfers(clinicId, fromIso, toIso));
    }
    if (wantAll || params.source === 'ledger' || params.source === 'inpatient') {
      queries.push(this.fetchLedger(clinicId, fromIso, toIso));
    }
    if (wantAll || params.source === 'appointments') {
      queries.push(this.fetchAppointments(clinicId, fromIso, toIso));
    }
    if (wantAll || params.source === 'expenses') {
      queries.push(this.fetchExpenses(clinicId, fromIso, toIso, params.include_void));
    }
    if (wantAll || params.source === 'shifts') {
      queries.push(this.fetchShiftOpenings(clinicId, fromIso, toIso));
      queries.push(this.fetchShiftClosings(clinicId, fromIso, toIso));
    }

    const buckets = await Promise.all(queries);
    let merged = buckets.flat();

    // Notes lookup — single roundtrip
    const refKeys = merged.map((r) => `${r.source}::${r.ref_id}`);
    if (refKeys.length) {
      const { data: notes } = await admin
        .from('journal_notes')
        .select('ref_type, ref_id, note')
        .eq('clinic_id', clinicId)
        .in('ref_id', merged.map((r) => r.ref_id));
      const map = new Map<string, string>();
      for (const n of (notes ?? []) as Array<{ ref_type: string; ref_id: string; note: string }>) {
        map.set(`${n.ref_type}::${n.ref_id}`, n.note);
      }
      merged = merged.map((r) => ({ ...r, note: map.get(`${r.source}::${r.ref_id}`) ?? null }));
    }

    // Search filter — matn yoki RAQAM (raqam berilsa amount_uzs ham mos)
    if (params.search?.trim()) {
      const q = params.search.toLowerCase();
      const qDigits = params.search.replace(/[^\d]/g, '');
      const qAmount = qDigits.length >= 3 ? Number(qDigits) : NaN;
      merged = merged.filter((r) => {
        const textMatch =
          (r.patient_name ?? '').toLowerCase().includes(q) ||
          (r.patient_phone ?? '').includes(q) ||
          (r.diagnosis ?? '').toLowerCase().includes(q) ||
          (r.doctor_name ?? '').toLowerCase().includes(q) ||
          (r.description ?? '').toLowerCase().includes(q) ||
          (r.note ?? '').toLowerCase().includes(q);
        // Agar qidiruv raqam bo'lsa, amount_uzs ham mos kelishini tekshiramiz
        const amountMatch = !Number.isNaN(qAmount) && Math.abs(r.amount_uzs) === qAmount;
        return textMatch || amountMatch;
      });
    }

    // Aniq summa filtri (slider/input) — qiymat berilgan bo'lsa filterlaymiz.
    if (params.amount && params.amount > 0) {
      const tol = params.amount_tolerance ?? 0;
      const min = params.amount - tol;
      const max = params.amount + tol;
      merged = merged.filter((r) => {
        const v = Math.abs(r.amount_uzs);
        return v >= min && v <= max;
      });
    }

    // Effektiv layout'dan is_visible=false bo'lganlarni filtrlash (super admin
    // yoki klinika o'chirib qo'ygan manbalar ko'rinmaydi).
    const layout = await this.getEffectiveLayout(clinicId);
    const visibleKeys = new Set(layout.filter((l) => l.is_visible).map((l) => l.source_key));
    if (visibleKeys.size > 0) {
      merged = merged.filter((r) => visibleKeys.has(r.source));
    }

    merged.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
    return merged.slice(0, params.limit);
  }

  // -----------------------------------------------------------------------------
  // Effektiv layout (defaults + overrides) — clinic frontend va feed ishlatadi.
  // -----------------------------------------------------------------------------
  async getEffectiveLayout(clinicId: string): Promise<EffectiveLayoutRow[]> {
    const admin = this.supabase.admin();
    const { data, error } = await admin.rpc('resolve_journal_layout', { p_clinic_id: clinicId });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as EffectiveLayoutRow[];
  }

  // -----------------------------------------------------------------------------
  // Defaults (super admin) — list/upsert/delete
  // -----------------------------------------------------------------------------
  async listDefaults() {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('journal_layout_defaults')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertDefault(input: z.infer<typeof DefaultUpsertSchema>) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('journal_layout_defaults')
      .upsert({ ...input }, { onConflict: 'source_key' })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteDefault(sourceKey: string) {
    const admin = this.supabase.admin();
    const { error } = await admin
      .from('journal_layout_defaults')
      .delete()
      .eq('source_key', sourceKey);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // -----------------------------------------------------------------------------
  // Overrides (clinic admin) — list/upsert/delete + lock check
  // -----------------------------------------------------------------------------
  async listOverrides(clinicId: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('journal_layout_overrides')
      .select('*')
      .eq('clinic_id', clinicId);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertOverride(clinicId: string, input: z.infer<typeof OverrideUpsertSchema>) {
    const admin = this.supabase.admin();
    // Lock tekshiruvi: defaults'dagi lock_* maydonlari true bo'lsa, mos
    // override maydonini yozishga ruxsat berilmaydi.
    const { data: defRow } = await admin
      .from('journal_layout_defaults')
      .select('lock_label, lock_color, lock_icon, lock_order, lock_visible')
      .eq('source_key', input.source_key)
      .maybeSingle();
    if (!defRow) throw new NotFoundException('Source kaliti topilmadi');
    const def = defRow as {
      lock_label: boolean;
      lock_color: boolean;
      lock_icon: boolean;
      lock_order: boolean;
      lock_visible: boolean;
    };
    if (def.lock_label && input.display_label_i18n != null) {
      throw new ForbiddenException('Nom qulflangan (super admin tomondan)');
    }
    if (def.lock_color && input.color_tone != null) {
      throw new ForbiddenException('Rang qulflangan');
    }
    if (def.lock_icon && input.icon_key != null) {
      throw new ForbiddenException('Belgi (icon) qulflangan');
    }
    if (def.lock_order && input.sort_order != null) {
      throw new ForbiddenException('Tartib qulflangan');
    }
    if (def.lock_visible && input.is_visible != null) {
      throw new ForbiddenException("Ko'rinish qulflangan");
    }

    const { data, error } = await admin
      .from('journal_layout_overrides')
      .upsert(
        { clinic_id: clinicId, ...input },
        { onConflict: 'clinic_id,source_key' },
      )
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteOverride(clinicId: string, sourceKey: string) {
    const admin = this.supabase.admin();
    const { error } = await admin
      .from('journal_layout_overrides')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('source_key', sourceKey);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  /**
   * Daily totals — bottom summary card on the journal page.
   * Always uses the same window (from/to) so numbers match the feed above.
   */
  async summary(clinicId: string, fromIso: string, toIso: string) {
    const admin = this.supabase.admin();
    const [{ data: trx }, { data: exp }, { data: sales }] = await Promise.all([
      admin
        .from('transactions')
        .select('amount_uzs, kind, is_void')
        .eq('clinic_id', clinicId)
        .eq('is_void', false)
        .gte('created_at', fromIso)
        .lte('created_at', toIso),
      admin
        .from('expenses')
        .select('amount_uzs')
        .eq('clinic_id', clinicId)
        .gte('expense_date', fromIso.slice(0, 10))
        .lte('expense_date', toIso.slice(0, 10)),
      admin
        .from('pharmacy_sales')
        .select('total_uzs, paid_uzs, debt_uzs, is_void')
        .eq('clinic_id', clinicId)
        .eq('is_void', false)
        .gte('created_at', fromIso)
        .lte('created_at', toIso),
    ]);

    let revenue = 0;
    let refunds = 0;
    for (const r of (trx ?? []) as Array<{ amount_uzs: number; kind: string }>) {
      const v = Number(r.amount_uzs ?? 0);
      if (r.kind === 'refund') refunds += v;
      else revenue += v;
    }
    const expensesTotal = (exp ?? []).reduce(
      (a: number, r: { amount_uzs: number }) => a + Number(r.amount_uzs ?? 0),
      0,
    );
    const pharmDebt = (sales ?? []).reduce(
      (a: number, r: { debt_uzs: number }) => a + Number(r.debt_uzs ?? 0),
      0,
    );

    return {
      revenue,
      refunds,
      expenses: expensesTotal,
      profit: revenue - refunds - expensesTotal,
      pharmacy_debt_window: pharmDebt,
      window: { from: fromIso, to: toIso },
    };
  }

  // ---------------------------------------------------------------------- PIN
  async verifyPin(clinicId: string, pin: string) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('clinics')
      .select('journal_pin_hash')
      .eq('id', clinicId)
      .single();
    if (!data?.journal_pin_hash) throw new ForbiddenException('PIN o\'rnatilmagan');
    const ok = (data.journal_pin_hash as string) === sha256(pin);
    if (!ok) throw new UnauthorizedException('Noto\'g\'ri PIN');
    return { ok: true };
  }

  async changePin(clinicId: string, currentPin: string, newPin: string) {
    await this.verifyPin(clinicId, currentPin);
    const { error } = await this.supabase
      .admin()
      .from('clinics')
      .update({ journal_pin_hash: sha256(newPin), journal_pin_set_at: new Date().toISOString() })
      .eq('id', clinicId);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // -------------------------------------------------------------------- notes
  async listNotes(clinicId: string, refType: string, refId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('journal_notes')
      .select('*, author:profiles!journal_notes_created_by_fkey(id, full_name)')
      .eq('clinic_id', clinicId)
      .eq('ref_type', refType)
      .eq('ref_id', refId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createNote(clinicId: string, userId: string, input: z.infer<typeof NoteCreateSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('journal_notes')
      .insert({
        clinic_id: clinicId,
        ref_type: input.ref_type,
        ref_id: input.ref_id,
        note: input.note,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateNote(clinicId: string, id: string, note: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('journal_notes')
      .update({ note })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteNote(clinicId: string, id: string) {
    const { error } = await this.supabase
      .admin()
      .from('journal_notes')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // PIN-protected void/delete on underlying records
  async voidEntry(clinicId: string, source: string, refId: string, pin: string) {
    await this.verifyPin(clinicId, pin);
    const admin = this.supabase.admin();
    if (source === 'transaction') {
      const { error } = await admin
        .from('transactions')
        .update({ is_void: true, voided_at: new Date().toISOString() })
        .eq('clinic_id', clinicId)
        .eq('id', refId);
      if (error) throw new BadRequestException(error.message);
    } else if (source === 'pharmacy_sale') {
      const { error } = await admin
        .from('pharmacy_sales')
        .update({ is_void: true })
        .eq('clinic_id', clinicId)
        .eq('id', refId);
      if (error) throw new BadRequestException(error.message);
    } else if (source === 'expense') {
      const { error } = await admin
        .from('expenses')
        .delete()
        .eq('clinic_id', clinicId)
        .eq('id', refId);
      if (error) throw new BadRequestException(error.message);
    } else {
      throw new BadRequestException('Bu yozuvni o\'chirib bo\'lmaydi');
    }
    return { ok: true };
  }

  // ----------------------------------------------------------- private feeders
  private async fetchTransactions(
    clinicId: string,
    from: string,
    to: string,
    includeVoid: boolean,
  ): Promise<FeedEntry[]> {
    const admin = this.supabase.admin();
    let q = admin
      .from('transactions')
      .select(
        'id, created_at, amount_uzs, kind, payment_method, is_void, notes, ' +
          'patient:patients(id, full_name, phone), ' +
          'cashier:profiles!transactions_cashier_id_fkey(full_name), ' +
          'appointment:appointments(id, doctor:profiles!appointments_doctor_id_fkey(full_name))',
      )
      .eq('clinic_id', clinicId)
      .gte('created_at', from)
      .lte('created_at', to);
    if (!includeVoid) q = q.eq('is_void', false);
    const { data } = await q.order('created_at', { ascending: false }).limit(500);
    const rows = (data ?? []) as unknown as Array<{
      id: string;
      created_at: string;
      amount_uzs: number;
      kind: string;
      payment_method: string;
      is_void: boolean;
      notes: string | null;
      patient: { id: string; full_name: string; phone: string | null } | null;
      cashier: { full_name: string } | null;
      appointment: { id: string; doctor: { full_name: string } | null } | null;
    }>;

    // Fallback: agar appointment.doctor yo'q bo'lsa, doctor_commissions orqali
    // xizmat ko'rsatgan shifokorni topamiz (transaction_id -> doctor_id).
    // Bir transaction'da bir nechta xizmat bo'lishi mumkin — birinchi shifokor.
    const txIds = rows.map((r) => r.id);
    const txToDoctor = new Map<string, string>();
    if (txIds.length > 0) {
      const { data: comms } = await admin
        .from('doctor_commissions')
        .select('transaction_id, doctor:profiles!doctor_commissions_doctor_id_fkey(full_name)')
        .eq('clinic_id', clinicId)
        .in('transaction_id', txIds);
      for (const c of (comms ?? []) as unknown as Array<{
        transaction_id: string;
        doctor: { full_name: string } | null;
      }>) {
        if (c.doctor?.full_name && !txToDoctor.has(c.transaction_id)) {
          txToDoctor.set(c.transaction_id, c.doctor.full_name);
        }
      }
    }

    return rows.map((r) => {
      let status: FeedEntry['status'] = 'paid';
      if (r.kind === 'refund') status = 'refund';
      else if (r.payment_method === 'debt' || Number(r.amount_uzs ?? 0) <= 0) status = 'debt';
      const doctorName =
        r.appointment?.doctor?.full_name ?? txToDoctor.get(r.id) ?? null;
      return {
        id: `tx-${r.id}`,
        source: 'transaction' as const,
        ref_id: r.id,
        occurred_at: r.created_at,
        patient_id: r.patient?.id ?? null,
        patient_name: r.patient?.full_name ?? null,
        patient_phone: r.patient?.phone ?? null,
        doctor_name: doctorName,
        diagnosis: null,
        amount_uzs: Number(r.amount_uzs ?? 0),
        status,
        payment_method: r.payment_method,
        description: r.notes,
        note: null,
        cashier_name: r.cashier?.full_name ?? null,
        is_void: !!r.is_void,
      };
    });
  }

  private async fetchPharmacy(
    clinicId: string,
    from: string,
    to: string,
    includeVoid: boolean,
  ): Promise<FeedEntry[]> {
    let q = this.supabase
      .admin()
      .from('pharmacy_sales')
      .select(
        'id, created_at, total_uzs, paid_uzs, debt_uzs, is_void, payment_method, ' +
          'patient:patients(id, full_name, phone), ' +
          'cashier:profiles!pharmacy_sales_cashier_id_fkey(full_name)',
      )
      .eq('clinic_id', clinicId)
      .gte('created_at', from)
      .lte('created_at', to);
    if (!includeVoid) q = q.eq('is_void', false);
    const { data } = await q.order('created_at', { ascending: false }).limit(500);
    return ((data ?? []) as unknown as Array<{
      id: string;
      created_at: string;
      total_uzs: number;
      paid_uzs: number;
      debt_uzs: number;
      is_void: boolean;
      payment_method: string | null;
      patient: { id: string; full_name: string; phone: string | null } | null;
      cashier: { full_name: string } | null;
    }>).map((r) => ({
      id: `ph-${r.id}`,
      source: 'pharmacy_sale',
      ref_id: r.id,
      occurred_at: r.created_at,
      patient_id: r.patient?.id ?? null,
      patient_name: r.patient?.full_name ?? 'Anonim mijoz',
      patient_phone: r.patient?.phone ?? null,
      doctor_name: null,
      diagnosis: 'Dorixona savdosi',
      amount_uzs: Number(r.total_uzs ?? 0),
      status:
        Number(r.debt_uzs ?? 0) > 0
          ? Number(r.paid_uzs ?? 0) > 0
            ? 'partial'
            : 'debt'
          : 'paid',
      payment_method: r.payment_method,
      description: null,
      note: null,
      cashier_name: r.cashier?.full_name ?? null,
      is_void: !!r.is_void,
    }));
  }

  private async fetchInpatient(clinicId: string, from: string, to: string): Promise<FeedEntry[]> {
    const { data } = await this.supabase
      .admin()
      .from('inpatient_stays')
      .select(
        'id, admitted_at, admission_reason, status, patient:patients(id, full_name, phone), doctor:profiles!inpatient_stays_attending_doctor_id_fkey(id, full_name)',
      )
      .eq('clinic_id', clinicId)
      .gte('admitted_at', from)
      .lte('admitted_at', to)
      .order('admitted_at', { ascending: false })
      .limit(200);
    return ((data ?? []) as unknown as Array<{
      id: string;
      admitted_at: string;
      admission_reason: string | null;
      status: string;
      patient: { id: string; full_name: string; phone: string | null } | null;
      doctor: { full_name: string } | null;
    }>).map((r) => ({
      id: `st-${r.id}`,
      source: 'inpatient_stay',
      ref_id: r.id,
      occurred_at: r.admitted_at,
      patient_id: r.patient?.id ?? null,
      patient_name: r.patient?.full_name ?? null,
      patient_phone: r.patient?.phone ?? null,
      doctor_name: r.doctor?.full_name ?? null,
      diagnosis: r.admission_reason,
      amount_uzs: 0,
      status: r.status === 'discharged' ? 'paid' : 'pending',
      payment_method: null,
      description: 'Statsionar qabul',
      note: null,
      cashier_name: null,
      is_void: false,
    }));
  }

  /**
   * Statsionar chiqarish (discharge) — alohida event jurnalda.
   * Qarz bilan chiqarish ham aniq ko'rinadi (status='debt').
   */
  private async fetchInpatientDischarges(
    clinicId: string,
    from: string,
    to: string,
  ): Promise<FeedEntry[]> {
    const { data } = await this.supabase
      .admin()
      .from('inpatient_stays')
      .select(
        `id, discharged_at, discharge_summary, discharge_reason,
         discharge_payment_method, outstanding_settled_uzs,
         discharged_with_debt, deceased_writeoff,
         patient:patients(id, full_name, phone),
         doctor:profiles!inpatient_stays_attending_doctor_id_fkey(id, full_name)`,
      )
      .eq('clinic_id', clinicId)
      .eq('status', 'discharged')
      .not('discharged_at', 'is', null)
      .gte('discharged_at', from)
      .lte('discharged_at', to)
      .order('discharged_at', { ascending: false })
      .limit(200);

    const REASON_LABEL: Record<string, string> = {
      recovery: 'Tuzaldi',
      treatment_refused: 'Davolanishdan voz kechdi',
      negative_review: 'Salbiy sharh',
      admin: "Ma'muriy",
      transferred: "Ko'chirildi",
      deceased: 'Vafot etgan',
      other: 'Boshqa',
    };

    return ((data ?? []) as unknown as Array<{
      id: string;
      discharged_at: string;
      discharge_summary: string | null;
      discharge_reason: string | null;
      discharge_payment_method: string | null;
      outstanding_settled_uzs: number | null;
      discharged_with_debt: boolean | null;
      deceased_writeoff: boolean | null;
      patient: { id: string; full_name: string; phone: string | null } | null;
      doctor: { full_name: string } | null;
    }>).map((r) => {
      const reason = r.discharge_reason
        ? REASON_LABEL[r.discharge_reason] ?? r.discharge_reason
        : null;
      const debtSuffix = r.discharged_with_debt ? ' (QARZ BILAN)' : '';
      const writeoffSuffix = r.deceased_writeoff ? ' (qarz hisobdan chiqarilgan)' : '';
      const desc = [
        'Statsionardan chiqarildi',
        reason ? `— ${reason}` : '',
        debtSuffix,
        writeoffSuffix,
      ]
        .filter(Boolean)
        .join(' ');
      return {
        id: `di-${r.id}`,
        source: 'inpatient_discharge' as const,
        ref_id: r.id,
        occurred_at: r.discharged_at,
        patient_id: r.patient?.id ?? null,
        patient_name: r.patient?.full_name ?? null,
        patient_phone: r.patient?.phone ?? null,
        doctor_name: r.doctor?.full_name ?? null,
        diagnosis: r.discharge_summary,
        amount_uzs: Number(r.outstanding_settled_uzs ?? 0),
        status: r.discharged_with_debt ? 'debt' : 'paid',
        payment_method: r.discharge_payment_method,
        description: desc,
        note: null,
        cashier_name: null,
        is_void: false,
      };
    });
  }

  /**
   * Statsionar bemorni xonadan xonaga ko'chirish (transfer) — alohida event.
   */
  private async fetchInpatientTransfers(
    clinicId: string,
    from: string,
    to: string,
  ): Promise<FeedEntry[]> {
    const { data } = await this.supabase
      .admin()
      .from('inpatient_transfers')
      .select(
        `id, stay_id, transferred_at, reason, from_bed_no, to_bed_no,
         from_room:rooms!from_room_id(id, number, section),
         to_room:rooms!to_room_id(id, number, section),
         stay:inpatient_stays(id, patient:patients(id, full_name, phone),
                              doctor:profiles!inpatient_stays_attending_doctor_id_fkey(id, full_name))`,
      )
      .eq('clinic_id', clinicId)
      .gte('transferred_at', from)
      .lte('transferred_at', to)
      .order('transferred_at', { ascending: false })
      .limit(200);

    return ((data ?? []) as unknown as Array<{
      id: string;
      stay_id: string;
      transferred_at: string;
      reason: string | null;
      from_bed_no: string | null;
      to_bed_no: string | null;
      from_room: { number: string; section: string | null } | null;
      to_room: { number: string; section: string | null } | null;
      stay: {
        patient: { id: string; full_name: string; phone: string | null } | null;
        doctor: { full_name: string } | null;
      } | null;
    }>).map((r) => {
      const fromLabel = r.from_room
        ? `№${r.from_room.number}${r.from_bed_no ? `/${r.from_bed_no}` : ''}`
        : '—';
      const toLabel = r.to_room
        ? `№${r.to_room.number}${r.to_bed_no ? `/${r.to_bed_no}` : ''}`
        : '—';
      const desc = `${fromLabel} → ${toLabel}` + (r.reason ? ` · ${r.reason}` : '');
      return {
        id: `tr-${r.id}`,
        source: 'inpatient_transfer' as const,
        ref_id: r.id,
        occurred_at: r.transferred_at,
        patient_id: r.stay?.patient?.id ?? null,
        patient_name: r.stay?.patient?.full_name ?? null,
        patient_phone: r.stay?.patient?.phone ?? null,
        doctor_name: r.stay?.doctor?.full_name ?? null,
        diagnosis: r.reason,
        amount_uzs: 0,
        status: 'pending' as const,
        payment_method: null,
        description: desc,
        note: null,
        cashier_name: null,
        is_void: false,
      };
    });
  }

  /**
   * Statsionar hisob harakati — patient_ledger'dan kunlik to'lov (charge) va
   * tuzatish (adjustment) yozuvlari. deposit/refund bu yerga KIRMAYDI — ular
   * transactions'ga yoziladi va fetchTransactions ko'rsatadi (takror oldini olish).
   */
  private async fetchLedger(clinicId: string, from: string, to: string): Promise<FeedEntry[]> {
    const { data } = await this.supabase
      .admin()
      .from('patient_ledger')
      .select(
        'id, entry_kind, amount_uzs, description, created_at, ' +
          'patient:patients(id, full_name, phone)',
      )
      .eq('clinic_id', clinicId)
      .in('entry_kind', ['charge', 'adjustment'])
      .gte('created_at', from)
      .lte('created_at', to)
      .order('created_at', { ascending: false })
      .limit(300);
    return ((data ?? []) as unknown as Array<{
      id: string;
      entry_kind: string;
      amount_uzs: number;
      description: string | null;
      created_at: string;
      patient: { id: string; full_name: string; phone: string | null } | null;
    }>).map((r) => ({
      id: `lg-${r.id}`,
      source: 'inpatient_ledger',
      ref_id: r.id,
      occurred_at: r.created_at,
      patient_id: r.patient?.id ?? null,
      patient_name: r.patient?.full_name ?? null,
      patient_phone: r.patient?.phone ?? null,
      doctor_name: null,
      diagnosis: null,
      // charge — manfiy (hisobdan yechiladi); jurnal absolyut summani ko'rsatadi
      amount_uzs: Math.abs(Number(r.amount_uzs ?? 0)),
      status: r.entry_kind === 'charge' ? 'debt' : 'partial',
      payment_method: null,
      description:
        r.description ?? (r.entry_kind === 'charge' ? 'Statsionar kunlik to‘lov' : 'Tuzatish'),
      note: null,
      cashier_name: null,
      is_void: false,
    }));
  }

  private async fetchAppointments(clinicId: string, from: string, to: string): Promise<FeedEntry[]> {
    const { data } = await this.supabase
      .admin()
      .from('appointments')
      .select(
        'id, scheduled_at, status, service_name_snapshot, total_amount_uzs, patient:patients(id, full_name, phone), doctor:profiles!appointments_doctor_id_fkey(full_name)',
      )
      .eq('clinic_id', clinicId)
      .gte('scheduled_at', from)
      .lte('scheduled_at', to)
      .order('scheduled_at', { ascending: false })
      .limit(300);
    return ((data ?? []) as unknown as Array<{
      id: string;
      scheduled_at: string;
      status: string;
      service_name_snapshot: string | null;
      total_amount_uzs: number | null;
      patient: { id: string; full_name: string; phone: string | null } | null;
      doctor: { full_name: string } | null;
    }>).map((r) => ({
      id: `ap-${r.id}`,
      source: 'appointment',
      ref_id: r.id,
      occurred_at: r.scheduled_at,
      patient_id: r.patient?.id ?? null,
      patient_name: r.patient?.full_name ?? null,
      patient_phone: r.patient?.phone ?? null,
      doctor_name: r.doctor?.full_name ?? null,
      diagnosis: r.service_name_snapshot,
      amount_uzs: Number(r.total_amount_uzs ?? 0),
      status:
        r.status === 'completed' ? 'paid' : r.status === 'cancelled' ? 'refund' : 'pending',
      payment_method: null,
      description: r.service_name_snapshot,
      note: null,
      cashier_name: null,
      is_void: false,
    }));
  }

  private async fetchExpenses(
    clinicId: string,
    from: string,
    to: string,
    includeVoid: boolean,
  ): Promise<FeedEntry[]> {
    let q = this.supabase
      .admin()
      .from('expenses')
      .select(
        'id, expense_date, created_at, amount_uzs, payment_method, description, is_void, ' +
          'category:expense_categories(name_i18n), ' +
          'recorder:profiles!expenses_recorded_by_fkey(full_name)',
      )
      .eq('clinic_id', clinicId)
      .gte('expense_date', from.slice(0, 10))
      .lte('expense_date', to.slice(0, 10));
    if (!includeVoid) q = q.eq('is_void', false);
    const { data } = await q.order('created_at', { ascending: false }).limit(300);
    return ((data ?? []) as unknown as Array<{
      id: string;
      expense_date: string;
      created_at: string;
      amount_uzs: number;
      payment_method: string | null;
      description: string | null;
      is_void: boolean;
      category: { name_i18n: Record<string, string> } | null;
      recorder: { full_name: string } | null;
    }>).map((r) => ({
      id: `ex-${r.id}`,
      source: 'expense',
      ref_id: r.id,
      occurred_at: r.created_at ?? r.expense_date,
      patient_id: null,
      patient_name: null,
      patient_phone: null,
      doctor_name: null,
      diagnosis:
        r.category?.name_i18n?.['uz-Latn'] ?? r.category?.name_i18n?.['en'] ?? 'Rasxot',
      amount_uzs: -Number(r.amount_uzs ?? 0),
      status: 'expense',
      payment_method: r.payment_method,
      description: r.description,
      note: null,
      cashier_name: r.recorder?.full_name ?? null,
      is_void: !!r.is_void,
    }));
  }

  // Sintetik qatorlar — smena ochilishi.
  private async fetchShiftOpenings(clinicId: string, from: string, to: string): Promise<FeedEntry[]> {
    const { data } = await this.supabase
      .admin()
      .from('shifts')
      .select('id, opened_at, opening_cash_uzs, operator:shift_operators(full_name)')
      .eq('clinic_id', clinicId)
      .gte('opened_at', from)
      .lte('opened_at', to)
      .order('opened_at', { ascending: false })
      .limit(200);
    return ((data ?? []) as unknown as Array<{
      id: string;
      opened_at: string;
      opening_cash_uzs: number | null;
      operator: { full_name: string } | null;
    }>).map((r) => ({
      id: `shift-open-${r.id}`,
      source: 'shift_opened' as const,
      ref_id: r.id,
      occurred_at: r.opened_at,
      patient_id: null,
      patient_name: null,
      patient_phone: null,
      doctor_name: null,
      diagnosis: null,
      amount_uzs: Number(r.opening_cash_uzs ?? 0),
      status: 'pending' as const,
      payment_method: 'cash',
      description: `Boshlang‘ich naqd: ${Number(r.opening_cash_uzs ?? 0).toLocaleString('uz-UZ')} so‘m`,
      note: null,
      cashier_name: r.operator?.full_name ?? null,
      is_void: false,
    }));
  }

  // Sintetik qatorlar — smena yopilishi.
  private async fetchShiftClosings(clinicId: string, from: string, to: string): Promise<FeedEntry[]> {
    const { data } = await this.supabase
      .admin()
      .from('shifts')
      .select('id, closed_at, opening_cash_uzs, actual_cash_uzs, cash_total_uzs, operator:shift_operators(full_name)')
      .eq('clinic_id', clinicId)
      .not('closed_at', 'is', null)
      .gte('closed_at', from)
      .lte('closed_at', to)
      .order('closed_at', { ascending: false })
      .limit(200);
    return ((data ?? []) as unknown as Array<{
      id: string;
      closed_at: string;
      opening_cash_uzs: number | null;
      actual_cash_uzs: number | null;
      cash_total_uzs: number | null;
      operator: { full_name: string } | null;
    }>).map((r) => {
      const actual = Number(r.actual_cash_uzs ?? 0);
      const expected = Number(r.opening_cash_uzs ?? 0) + Number(r.cash_total_uzs ?? 0);
      const diff = actual - expected;
      const diffStr =
        diff === 0
          ? ''
          : diff > 0
            ? `, ortiq: ${Math.abs(diff).toLocaleString('uz-UZ')} so‘m`
            : `, kam: ${Math.abs(diff).toLocaleString('uz-UZ')} so‘m`;
      return {
        id: `shift-close-${r.id}`,
        source: 'shift_closed' as const,
        ref_id: r.id,
        occurred_at: r.closed_at,
        patient_id: null,
        patient_name: null,
        patient_phone: null,
        doctor_name: null,
        diagnosis: null,
        amount_uzs: actual,
        status: 'paid' as const,
        payment_method: 'cash',
        description: `Kassada: ${actual.toLocaleString('uz-UZ')} so‘m${diffStr}`,
        note: null,
        cashier_name: r.operator?.full_name ?? null,
        is_void: false,
      };
    });
  }
}

// -----------------------------------------------------------------------------
// Controller
// -----------------------------------------------------------------------------
@ApiTags('journal')
@Controller({ path: 'journal', version: '1' })
class JournalController {
  constructor(private readonly svc: JournalService) {}

  @Get('feed')
  feed(
    @CurrentUser() u: { clinicId: string | null },
    @Query() q: Record<string, string>,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.feed(u.clinicId, FeedQuerySchema.parse(q));
  }

  // -------- Layout (clinic side) --------
  @Get('layout')
  effectiveLayout(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getEffectiveLayout(u.clinicId);
  }

  @Get('layout/overrides')
  listOverrides(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listOverrides(u.clinicId);
  }

  @Post('layout/overrides')
  @Audit({ action: 'journal.layout_override_upserted', resourceType: 'journal_layout_overrides' })
  upsertOverride(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.upsertOverride(u.clinicId, OverrideUpsertSchema.parse(body));
  }

  @Delete('layout/overrides/:sourceKey')
  @Audit({ action: 'journal.layout_override_deleted', resourceType: 'journal_layout_overrides' })
  deleteOverride(@CurrentUser() u: { clinicId: string | null }, @Param('sourceKey') sourceKey: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.deleteOverride(u.clinicId, sourceKey);
  }

  @Get('summary')
  summary(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const fromIso = from ?? new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const toIso = to ?? new Date().toISOString();
    return this.svc.summary(u.clinicId, fromIso, toIso);
  }

  @Post('pin/verify')
  verify(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    const { pin } = PinVerifySchema.parse(body);
    return this.svc.verifyPin(u.clinicId, pin);
  }

  @Post('pin/change')
  @Audit({ action: 'journal.pin_changed', resourceType: 'clinics' })
  changePin(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    const v = PinChangeSchema.parse(body);
    return this.svc.changePin(u.clinicId, v.current_pin, v.new_pin);
  }

  // Notes
  @Get('notes/:refType/:refId')
  listNotes(
    @CurrentUser() u: { clinicId: string | null },
    @Param('refType') refType: string,
    @Param('refId', ParseUUIDPipe) refId: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listNotes(u.clinicId, refType, refId);
  }

  @Post('notes')
  @Audit({ action: 'journal.note_created', resourceType: 'journal_notes' })
  createNote(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createNote(u.clinicId, u.userId, NoteCreateSchema.parse(body));
  }

  @Patch('notes/:id')
  @Audit({ action: 'journal.note_updated', resourceType: 'journal_notes' })
  updateNote(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const v = NoteUpdateSchema.parse(body);
    return this.svc.updateNote(u.clinicId, id, v.note);
  }

  @Delete('notes/:id')
  @Audit({ action: 'journal.note_deleted', resourceType: 'journal_notes' })
  deleteNote(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.deleteNote(u.clinicId, id);
  }

  @Post('void')
  @Audit({ action: 'journal.entry_voided', resourceType: 'journal' })
  void(
    @CurrentUser() u: { clinicId: string | null },
    @Body() body: { source: string; ref_id: string; pin: string },
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.voidEntry(u.clinicId, body.source, body.ref_id, body.pin);
  }
}

// -----------------------------------------------------------------------------
// Super admin controller — journal layout defaults
// -----------------------------------------------------------------------------
@ApiTags('admin')
@Controller('admin/journal-layout')
@UseGuards(SuperAdminGuard)
class JournalLayoutAdminController {
  constructor(private readonly svc: JournalService) {}

  @Get('defaults')
  list() {
    return this.svc.listDefaults();
  }

  @Post('defaults')
  upsert(@Body() body: unknown) {
    return this.svc.upsertDefault(DefaultUpsertSchema.parse(body));
  }

  @Delete('defaults/:sourceKey')
  remove(@Param('sourceKey') sourceKey: string) {
    return this.svc.deleteDefault(sourceKey);
  }
}

@Module({
  controllers: [JournalController, JournalLayoutAdminController],
  providers: [JournalService, SupabaseService],
  exports: [JournalService],
})
export class JournalModule {}
