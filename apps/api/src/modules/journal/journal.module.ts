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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

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

const FeedQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  source: z
    .enum(['all', 'transactions', 'pharmacy', 'inpatient', 'appointments', 'expenses'])
    .default('all'),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
type FeedEntry = {
  id: string;
  source: 'transaction' | 'pharmacy_sale' | 'inpatient_stay' | 'appointment' | 'expense';
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
      queries.push(this.fetchTransactions(clinicId, fromIso, toIso));
    }
    if (wantAll || params.source === 'pharmacy') {
      queries.push(this.fetchPharmacy(clinicId, fromIso, toIso));
    }
    if (wantAll || params.source === 'inpatient') {
      queries.push(this.fetchInpatient(clinicId, fromIso, toIso));
    }
    if (wantAll || params.source === 'appointments') {
      queries.push(this.fetchAppointments(clinicId, fromIso, toIso));
    }
    if (wantAll || params.source === 'expenses') {
      queries.push(this.fetchExpenses(clinicId, fromIso, toIso));
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

    // Search filter
    if (params.search?.trim()) {
      const q = params.search.toLowerCase();
      merged = merged.filter(
        (r) =>
          (r.patient_name ?? '').toLowerCase().includes(q) ||
          (r.patient_phone ?? '').includes(q) ||
          (r.diagnosis ?? '').toLowerCase().includes(q) ||
          (r.doctor_name ?? '').toLowerCase().includes(q),
      );
    }

    merged.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
    return merged.slice(0, params.limit);
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
  private async fetchTransactions(clinicId: string, from: string, to: string): Promise<FeedEntry[]> {
    const { data } = await this.supabase
      .admin()
      .from('transactions')
      .select(
        'id, created_at, amount_uzs, kind, payment_method, is_void, notes, patient:patients(id, full_name, phone), appointment:appointments(id, doctor:profiles!appointments_doctor_id_fkey(full_name))',
      )
      .eq('clinic_id', clinicId)
      .eq('is_void', false)
      .gte('created_at', from)
      .lte('created_at', to)
      .order('created_at', { ascending: false })
      .limit(500);
    return ((data ?? []) as unknown as Array<{
      id: string;
      created_at: string;
      amount_uzs: number;
      kind: string;
      payment_method: string;
      notes: string | null;
      patient: { id: string; full_name: string; phone: string | null } | null;
      appointment: { id: string; doctor: { full_name: string } | null } | null;
    }>).map((r) => ({
      id: `tx-${r.id}`,
      source: 'transaction',
      ref_id: r.id,
      occurred_at: r.created_at,
      patient_id: r.patient?.id ?? null,
      patient_name: r.patient?.full_name ?? null,
      patient_phone: r.patient?.phone ?? null,
      doctor_name: r.appointment?.doctor?.full_name ?? null,
      diagnosis: null,
      amount_uzs: Number(r.amount_uzs ?? 0),
      status: r.kind === 'refund' ? 'refund' : 'paid',
      payment_method: r.payment_method,
      description: r.notes,
      note: null,
    }));
  }

  private async fetchPharmacy(clinicId: string, from: string, to: string): Promise<FeedEntry[]> {
    const { data } = await this.supabase
      .admin()
      .from('pharmacy_sales')
      .select(
        'id, created_at, total_uzs, paid_uzs, debt_uzs, is_void, payment_method, patient:patients(id, full_name, phone)',
      )
      .eq('clinic_id', clinicId)
      .eq('is_void', false)
      .gte('created_at', from)
      .lte('created_at', to)
      .order('created_at', { ascending: false })
      .limit(500);
    return ((data ?? []) as unknown as Array<{
      id: string;
      created_at: string;
      total_uzs: number;
      paid_uzs: number;
      debt_uzs: number;
      payment_method: string | null;
      patient: { id: string; full_name: string; phone: string | null } | null;
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
    }));
  }

  private async fetchExpenses(clinicId: string, from: string, to: string): Promise<FeedEntry[]> {
    const { data } = await this.supabase
      .admin()
      .from('expenses')
      .select('id, expense_date, created_at, amount_uzs, payment_method, description, category:expense_categories(name_i18n)')
      .eq('clinic_id', clinicId)
      .gte('expense_date', from.slice(0, 10))
      .lte('expense_date', to.slice(0, 10))
      .order('created_at', { ascending: false })
      .limit(300);
    return ((data ?? []) as unknown as Array<{
      id: string;
      expense_date: string;
      created_at: string;
      amount_uzs: number;
      payment_method: string | null;
      description: string | null;
      category: { name_i18n: Record<string, string> } | null;
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
    }));
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

@Module({
  controllers: [JournalController],
  providers: [JournalService, SupabaseService],
  exports: [JournalService],
})
export class JournalModule {}
