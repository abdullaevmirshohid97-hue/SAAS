import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  identityNames,
  phoneIlikePattern,
  phoneKey,
  samePatientIdentity,
  searchNorm,
  type PatientIdentity,
} from '@clary/utils';

import { SupabaseService } from '../../common/services/supabase.service';

import { PatientsService } from './patients.service';

// =============================================================================
// Bemorlar daftari ("xotira daftari")
// =============================================================================
// - match:    familiya + ism + telefon mos kelsa — o'sha bemor ("qayta keldi")
// - registry: barcha bemorlar ro'yxati + har biriga tashrif/to'lov/qarz/statsionar
// - history:  bitta bemor — xizmatlar, shifokorlar, kasallik tarixi, dorilar,
//             statsionar (tashxis, necha kun), qarz, to'lov usullari
// =============================================================================

const TZ = 'Asia/Tashkent';
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
/** Qabul kuni = 1-kun; chiqmagan bo'lsa — bugungacha. */
export function stayDays(
  admittedAt: string,
  dischargedAt: string | null,
  now = new Date(),
): number {
  const a = Date.parse(dayOf(admittedAt));
  const b = Date.parse(dayOf(dischargedAt ?? now.toISOString()));
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/** Tashrif hisoblanmaydigan tranzaksiyalar (pul harakati, xizmat emas). */
const NON_VISIT_KINDS = new Set(['refund', 'deposit', 'adjustment', 'withdrawal']);
/** Statsionar kassasi to'lovlari tashrif emas — yotqizilgan kun alohida hisoblanadi. */
const isVisitTx = (t: { kind: string; register?: string | null }) =>
  !NON_VISIT_KINDS.has(t.kind) && t.register !== 'inpatient';

export interface PatientStats {
  visits: number;
  first_visit_at: string | null;
  last_visit_at: string | null;
  paid_uzs: number;
  debt_uzs: number;
  stays: number;
  in_stay: boolean;
}

type Tx = {
  id: string;
  patient_id: string;
  created_at: string;
  amount_uzs: number;
  kind: string;
  payment_method: string;
  register?: string | null;
};

export type RegistryFilter = 'all' | 'debtors' | 'inpatient';

@Injectable()
export class PatientRegistryService {
  private readonly log = new Logger('PatientRegistry');

  constructor(
    private readonly supabase: SupabaseService,
    private readonly patients: PatientsService,
  ) {}

  // ---------------------------------------------------------------- match
  /** Familiya + ism + telefon mos keladigan bemor(lar). Eng eskisi — asosiy. */
  async findIdentityMatches(
    clinicId: string,
    who: PatientIdentity,
  ): Promise<Array<Record<string, unknown>>> {
    const pattern = phoneIlikePattern(who.phone);
    const names = identityNames(who);
    if (!pattern || !names.last || !names.first) return [];
    const scope = await this.patients.branchScope(clinicId);
    const { data } = await this.supabase
      .admin()
      .from('patients')
      .select(
        'id, full_name, last_name, first_name, patronymic, phone, dob, gender, address, created_at',
      )
      .in('clinic_id', scope)
      .is('deleted_at', null)
      .ilike('phone', pattern)
      .order('created_at', { ascending: true })
      .limit(50);
    return ((data ?? []) as Array<Record<string, unknown>>).filter((p) =>
      samePatientIdentity(who, p as PatientIdentity),
    );
  }

  async match(clinicId: string, who: PatientIdentity) {
    const found = await this.findIdentityMatches(clinicId, who);
    const patient = found[0];
    if (!patient) return { patient: null, duplicates: 0, stats: null };
    const stats = (await this.stats(clinicId, [patient.id as string])).get(patient.id as string);
    return { patient, duplicates: found.length - 1, stats: stats ?? null };
  }

  /**
   * Yangi bemor: familiya + ism + telefon mos kelgan bemor bor bo'lsa — yangi
   * karta OCHILMAYDI, o'sha bemor qaytadi (`returning: true`). Mavjud kartadagi
   * bo'sh maydonlar (tug'ilgan sana, jins, manzil...) yangi ma'lumot bilan to'ladi.
   */
  async createOrReuse(clinicId: string, userId: string, input: Record<string, unknown>) {
    const [existing] = await this.findIdentityMatches(clinicId, input as PatientIdentity);
    if (!existing) return this.patients.create(clinicId, userId, input);
    const fill: Record<string, unknown> = {};
    for (const k of [
      'patronymic',
      'dob',
      'gender',
      'address',
      'secondary_phone',
      'city',
      'region',
    ]) {
      const v = input[k];
      if (v != null && v !== '' && (existing[k] == null || existing[k] === '')) fill[k] = v;
    }
    let row: Record<string, unknown> = existing;
    if (Object.keys(fill).length) {
      const { data } = await this.supabase
        .admin()
        .from('patients')
        .update(fill)
        .eq('id', existing.id as string)
        .select()
        .maybeSingle();
      if (data) row = data as Record<string, unknown>;
    }
    return { ...row, returning: true };
  }

  // ---------------------------------------------------------------- stats
  /** Ko'p sahifali o'qish (PostgREST bir so'rovda ≤1000 qator qaytaradi). */
  private async fetchAll<T>(
    build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>,
    maxPages = 30,
  ): Promise<T[]> {
    const out: T[] = [];
    for (let page = 0; page < maxPages; page++) {
      const { data } = await build(page * 1000, page * 1000 + 999);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }

  /** Bemorlar bo'yicha tashrif/to'lov/qarz/statsionar ko'rsatkichlari. */
  async stats(clinicId: string, ids: string[]): Promise<Map<string, PatientStats>> {
    const out = new Map<string, PatientStats>();
    if (ids.length === 0) return out;
    for (const id of ids) {
      out.set(id, {
        visits: 0,
        first_visit_at: null,
        last_visit_at: null,
        paid_uzs: 0,
        debt_uzs: 0,
        stays: 0,
        in_stay: false,
      });
    }
    const admin = this.supabase.admin();
    const scope = await this.patients.branchScope(clinicId);
    const [txs, balances, stays] = await Promise.all([
      this.fetchAll<Tx>((from, to) =>
        admin
          .from('transactions')
          .select('id, patient_id, created_at, amount_uzs, kind, payment_method, register')
          .in('clinic_id', scope)
          .in('patient_id', ids)
          .eq('is_void', false)
          .order('created_at', { ascending: true })
          .range(from, to),
      ),
      admin
        .from('patient_balance')
        .select('patient_id, balance_uzs')
        .in('clinic_id', scope)
        .in('patient_id', ids),
      admin
        .from('inpatient_stays')
        .select('patient_id, admitted_at, status')
        .in('clinic_id', scope)
        .in('patient_id', ids),
    ]);

    const days = new Map<string, Set<string>>();
    const touch = (pid: string, iso: string) => {
      const s = out.get(pid);
      if (!s) return;
      const d = dayOf(iso);
      if (!days.has(pid)) days.set(pid, new Set());
      days.get(pid)!.add(d);
      if (!s.first_visit_at || iso < s.first_visit_at) s.first_visit_at = iso;
      if (!s.last_visit_at || iso > s.last_visit_at) s.last_visit_at = iso;
    };
    for (const t of txs) {
      const s = out.get(t.patient_id);
      if (!s) continue;
      const amt = Number(t.amount_uzs ?? 0);
      s.paid_uzs += t.kind === 'refund' ? -amt : amt;
      if (isVisitTx(t)) touch(t.patient_id, t.created_at);
    }
    for (const st of (stays.data ?? []) as Array<{
      patient_id: string;
      admitted_at: string;
      status: string;
    }>) {
      const s = out.get(st.patient_id);
      if (!s) continue;
      s.stays += 1;
      if (st.status === 'admitted') s.in_stay = true;
      touch(st.patient_id, st.admitted_at);
    }
    const bal = new Map<string, number>();
    for (const b of (balances.data ?? []) as Array<{ patient_id: string; balance_uzs: number }>) {
      bal.set(b.patient_id, (bal.get(b.patient_id) ?? 0) + Number(b.balance_uzs ?? 0));
    }
    for (const [pid, s] of out) {
      s.visits = days.get(pid)?.size ?? 0;
      s.debt_uzs = Math.max(0, -(bal.get(pid) ?? 0));
    }
    return out;
  }

  // ---------------------------------------------------------------- registry
  async registry(
    clinicId: string,
    opts: { q?: string; filter?: RegistryFilter; page: number; pageSize: number },
  ) {
    const admin = this.supabase.admin();
    const scope = await this.patients.branchScope(clinicId);
    const page = Math.max(1, opts.page);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize));
    const q = (opts.q ?? '').trim();
    const cols = 'id, full_name, last_name, first_name, phone, dob, gender, created_at';

    let rows: Array<Record<string, unknown>> = [];
    let total = 0;

    if (opts.filter === 'debtors' || opts.filter === 'inpatient') {
      // 1) Tartiblangan bemor id'lari
      let orderedIds: string[] = [];
      if (opts.filter === 'debtors') {
        const { data } = await admin
          .from('patient_balance')
          .select('patient_id, balance_uzs')
          .in('clinic_id', scope)
          .lt('balance_uzs', 0)
          .order('balance_uzs', { ascending: true })
          .limit(1000);
        orderedIds = [
          ...new Set(((data ?? []) as Array<{ patient_id: string }>).map((r) => r.patient_id)),
        ];
      } else {
        const { data } = await admin
          .from('inpatient_stays')
          .select('patient_id, admitted_at')
          .in('clinic_id', scope)
          .eq('status', 'admitted')
          .order('admitted_at', { ascending: false })
          .limit(1000);
        orderedIds = [
          ...new Set(((data ?? []) as Array<{ patient_id: string }>).map((r) => r.patient_id)),
        ];
      }
      // 2) Bemorlar (bo'laklab — URL uzunligi), so'ng qidiruv JS'da
      const byId = new Map<string, Record<string, unknown>>();
      for (let i = 0; i < orderedIds.length; i += 150) {
        const { data } = await admin
          .from('patients')
          .select(cols)
          .in('clinic_id', scope)
          .is('deleted_at', null)
          .in('id', orderedIds.slice(i, i + 150));
        for (const p of (data ?? []) as Array<Record<string, unknown>>) byId.set(p.id as string, p);
      }
      let list = orderedIds.map((id) => byId.get(id)).filter(Boolean) as Array<
        Record<string, unknown>
      >;
      if (q) {
        const tokens = searchNorm(q).split(' ').filter(Boolean);
        const qPhone = phoneKey(q) || q.replace(/\D/g, '');
        list = list.filter((p) => {
          const name = searchNorm(p.full_name as string);
          if (tokens.length && tokens.every((t) => name.includes(t))) return true;
          const ph = String(p.phone ?? '').replace(/\D/g, '');
          return qPhone.length >= 4 && ph.includes(qPhone);
        });
      }
      total = list.length;
      rows = list.slice((page - 1) * pageSize, page * pageSize);
    } else {
      let query = admin
        .from('patients')
        .select(cols, { count: 'exact' })
        .in('clinic_id', scope)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);
      if (q) {
        const safe = q.replace(/[%_,()]/g, ' ').trim();
        const digits = q.replace(/\D/g, '');
        const ors = [
          `full_name.ilike.%${safe}%`,
          `first_name.ilike.%${safe}%`,
          `last_name.ilike.%${safe}%`,
        ];
        if (digits.length >= 4) ors.push(`phone.ilike.%${digits.split('').join('%')}%`);
        if (safe) query = query.or(ors.join(','));
      }
      const { data, count, error } = await query;
      if (error) throw new NotFoundException(error.message);
      rows = (data ?? []) as Array<Record<string, unknown>>;
      total = count ?? rows.length;
    }

    const stats = await this.stats(
      clinicId,
      rows.map((r) => r.id as string),
    );
    return {
      items: rows.map((r) => ({ ...r, stats: stats.get(r.id as string) ?? null })),
      total,
      page,
      pageSize,
    };
  }

  // ---------------------------------------------------------------- history
  async history(clinicId: string, patientId: string) {
    const admin = this.supabase.admin();
    const scope = await this.patients.branchScope(clinicId);
    const [patientRes, txRes, staysRes, notesRes, rxRes, pharmRes, balRes] = await Promise.all([
      admin
        .from('patients')
        .select('*')
        .in('clinic_id', scope)
        .eq('id', patientId)
        .is('deleted_at', null)
        .maybeSingle(),
      admin
        .from('transactions')
        .select(
          'id, created_at, amount_uzs, kind, payment_method, register, stay_id, ' +
            'doctor:profiles!transactions_doctor_id_fkey(full_name), ' +
            'appointment:appointments(doctor:profiles!appointments_doctor_id_fkey(full_name)), ' +
            'items:transaction_items(service_name_snapshot, quantity, final_amount_uzs), ' +
            'legs:transaction_payments(method, amount_uzs)',
        )
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .eq('is_void', false)
        .order('created_at', { ascending: false })
        .limit(1000),
      admin
        .from('inpatient_stays')
        .select(
          'id, admitted_at, discharged_at, status, admission_reason, discharge_summary, attending_notes, ' +
            'discharge_reason, total_cost_uzs, discharged_with_debt, bed_no, ' +
            'room:rooms(number, floor, building, section), ' +
            'doctor:profiles!inpatient_stays_attending_doctor_id_fkey(full_name)',
        )
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .order('admitted_at', { ascending: false })
        .limit(100),
      admin
        .from('treatment_notes')
        .select(
          'id, created_at, signed_at, diagnosis_code, diagnosis_text, soap_assessment, stay_id, ' +
            'author:profiles!author_id(full_name)',
        )
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(300),
      admin
        .from('prescriptions')
        .select(
          'id, rx_number, created_at, status, ' +
            'doctor:profiles!prescriptions_doctor_id_fkey(full_name), ' +
            'items:prescription_items(medication_name_snapshot, dosage, frequency, duration, quantity)',
        )
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(200),
      admin
        .from('pharmacy_sales')
        .select('id, created_at, total_uzs, items:pharmacy_sale_items(name_snapshot, quantity)')
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .eq('is_void', false)
        .order('created_at', { ascending: false })
        .limit(200),
      admin
        .from('patient_balance')
        .select('balance_uzs')
        .in('clinic_id', scope)
        .eq('patient_id', patientId),
    ]);

    const patient = patientRes.data as Record<string, unknown> | null;
    if (!patient) throw new NotFoundException('patient not found');
    // Bitta bo'lim o'qilmasa — qolgani baribir ko'rsatiladi, sababi esa aytiladi
    const warnings = [txRes, staysRes, notesRes, rxRes, pharmRes, balRes]
      .map((r) => r.error?.message)
      .filter((m): m is string => !!m);
    if (warnings.length) this.log.warn(`history ${patientId}: ${warnings.join(' | ')}`);

    type HTx = Tx & {
      stay_id: string | null;
      doctor: { full_name: string } | null;
      appointment: { doctor: { full_name: string } | null } | null;
      items: Array<{
        service_name_snapshot: string | null;
        quantity: number;
        final_amount_uzs: number;
      }> | null;
      legs: Array<{ method: string; amount_uzs: number }> | null;
    };
    const txs = (txRes.data ?? []) as unknown as HTx[];

    // Shifokor: tranzaksiya → qabul → komissiya (journal bilan bir xil tartib)
    const txIds = txs.filter((t) => !t.doctor && !t.appointment?.doctor).map((t) => t.id);
    const commDoctor = new Map<string, string>();
    for (let i = 0; i < txIds.length; i += 150) {
      const { data } = await admin
        .from('doctor_commissions')
        .select('transaction_id, doctor:profiles!doctor_commissions_doctor_id_fkey(full_name)')
        .in('clinic_id', scope)
        .in('transaction_id', txIds.slice(i, i + 150));
      for (const c of (data ?? []) as unknown as Array<{
        transaction_id: string;
        doctor: { full_name: string } | null;
      }>) {
        if (c.doctor?.full_name && !commDoctor.has(c.transaction_id)) {
          commDoctor.set(c.transaction_id, c.doctor.full_name);
        }
      }
    }
    const doctorOf = (t: HTx) =>
      t.doctor?.full_name ?? t.appointment?.doctor?.full_name ?? commDoctor.get(t.id) ?? null;

    // --- Tashriflar (kun bo'yicha), xizmatlar, shifokorlar, to'lov usullari
    const visitsByDay = new Map<
      string,
      {
        date: string;
        services: string[];
        doctors: Set<string>;
        amount_uzs: number;
        methods: Set<string>;
      }
    >();
    const services = new Map<
      string,
      { name: string; count: number; amount_uzs: number; last_at: string; doctors: Set<string> }
    >();
    const doctors = new Map<string, { name: string; days: Set<string>; last_at: string }>();
    const methods = new Map<string, { method: string; count: number; amount_uzs: number }>();
    let paid = 0;
    const addService = (
      it: { service_name_snapshot: string | null; quantity: number; final_amount_uzs: number },
      at: string,
      doc: string | null,
    ): string | null => {
      const name = (it.service_name_snapshot ?? '').trim();
      if (!name) return null;
      const s = services.get(name) ?? {
        name,
        count: 0,
        amount_uzs: 0,
        last_at: at,
        doctors: new Set<string>(),
      };
      s.count += Number(it.quantity ?? 1);
      s.amount_uzs += Number(it.final_amount_uzs ?? 0);
      if (at > s.last_at) s.last_at = at;
      if (doc) s.doctors.add(doc);
      services.set(name, s);
      return name;
    };

    for (const t of txs) {
      const amt = Number(t.amount_uzs ?? 0);
      paid += t.kind === 'refund' ? -amt : amt;
      if (t.kind === 'refund') continue;

      // To'lov usullari: aralash (mixed) bo'lsa — qismlari bo'yicha
      const legs =
        t.payment_method === 'mixed' && t.legs?.length
          ? t.legs.map((l) => ({ method: l.method, amount: Number(l.amount_uzs ?? 0) }))
          : [{ method: t.payment_method, amount: amt }];
      for (const l of legs) {
        const m = methods.get(l.method) ?? { method: l.method, count: 0, amount_uzs: 0 };
        m.count += 1;
        m.amount_uzs += l.amount;
        methods.set(l.method, m);
      }

      if (NON_VISIT_KINDS.has(t.kind)) continue;
      const doc = doctorOf(t);
      // Statsionar xizmatlari — xizmatlar ro'yxatiga, lekin alohida tashrif emas
      if (!isVisitTx(t)) {
        for (const it of t.items ?? []) addService(it, t.created_at, doc);
        continue;
      }
      const day = dayOf(t.created_at);
      const v = visitsByDay.get(day) ?? {
        date: t.created_at,
        services: [],
        doctors: new Set<string>(),
        amount_uzs: 0,
        methods: new Set<string>(),
      };
      v.amount_uzs += amt;
      legs.forEach((l) => v.methods.add(l.method));
      if (doc) v.doctors.add(doc);
      for (const it of t.items ?? []) {
        const name = addService(it, t.created_at, doc);
        if (name) v.services.push(it.quantity > 1 ? `${name} ×${it.quantity}` : name);
      }
      visitsByDay.set(day, v);
      if (doc) {
        const d = doctors.get(doc) ?? { name: doc, days: new Set<string>(), last_at: t.created_at };
        d.days.add(day);
        if (t.created_at > d.last_at) d.last_at = t.created_at;
        doctors.set(doc, d);
      }
    }

    // --- Statsionar
    type HStay = {
      id: string;
      admitted_at: string;
      discharged_at: string | null;
      status: string;
      admission_reason: string | null;
      discharge_summary: string | null;
      attending_notes: string | null;
      discharge_reason: string | null;
      total_cost_uzs: number;
      discharged_with_debt: boolean;
      bed_no: string | null;
      room: {
        number: string;
        floor: number | null;
        building: string | null;
        section: string | null;
      } | null;
      doctor: { full_name: string } | null;
    };
    type HNote = {
      id: string;
      created_at: string;
      signed_at: string | null;
      diagnosis_code: string | null;
      diagnosis_text: string | null;
      soap_assessment: string | null;
      stay_id: string | null;
      author: { full_name: string } | null;
    };
    const notes = (notesRes.data ?? []) as unknown as HNote[];
    const stays = ((staysRes.data ?? []) as unknown as HStay[]).map((s) => {
      const dx = notes
        .filter((n) => n.stay_id === s.id && (n.diagnosis_code || n.diagnosis_text))
        .map((n) => ({
          code: n.diagnosis_code,
          text: n.diagnosis_text,
          date: n.signed_at ?? n.created_at,
          doctor: n.author?.full_name ?? null,
        }));
      const day = dayOf(s.admitted_at);
      if (!visitsByDay.has(day)) {
        visitsByDay.set(day, {
          date: s.admitted_at,
          services: [],
          doctors: new Set<string>(),
          amount_uzs: 0,
          methods: new Set<string>(),
        });
      }
      const v = visitsByDay.get(day)!;
      v.services.push('Statsionarga yotqizildi');
      if (s.doctor?.full_name) v.doctors.add(s.doctor.full_name);
      return {
        id: s.id,
        admitted_at: s.admitted_at,
        discharged_at: s.discharged_at,
        days: stayDays(s.admitted_at, s.discharged_at),
        status: s.status,
        admission_reason: s.admission_reason,
        diagnoses: dx,
        discharge_summary: s.discharge_summary ?? s.attending_notes,
        discharge_reason: s.discharge_reason,
        total_cost_uzs: Number(s.total_cost_uzs ?? 0),
        discharged_with_debt: s.discharged_with_debt,
        bed_no: s.bed_no,
        room: s.room,
        doctor: s.doctor?.full_name ?? null,
      };
    });

    // --- Kasallik tarixi (ambulator tashxislar + statsionar sabablari)
    const diagnoses = [
      ...notes
        .filter((n) => n.diagnosis_code || n.diagnosis_text)
        .map((n) => ({
          date: n.signed_at ?? n.created_at,
          code: n.diagnosis_code,
          text: n.diagnosis_text,
          doctor: n.author?.full_name ?? null,
          source: n.stay_id ? ('inpatient' as const) : ('outpatient' as const),
        })),
      ...stays
        .filter((s) => s.admission_reason)
        .map((s) => ({
          date: s.admitted_at,
          code: null,
          text: s.admission_reason,
          doctor: s.doctor,
          source: 'admission' as const,
        })),
    ].sort((a, b) => (a.date < b.date ? 1 : -1));

    // --- Dorilar (retseptlar + dorixonadan olinganlar)
    type HRx = {
      id: string;
      rx_number: string | null;
      created_at: string;
      status: string;
      doctor: { full_name: string } | null;
      items: Array<{
        medication_name_snapshot: string;
        dosage: string | null;
        frequency: string | null;
        duration: string | null;
        quantity: number;
      }> | null;
    };
    type HSale = {
      id: string;
      created_at: string;
      items: Array<{ name_snapshot: string; quantity: number }> | null;
    };
    const medications = [
      ...((rxRes.data ?? []) as unknown as HRx[]).flatMap((r) =>
        (r.items ?? []).map((it) => ({
          date: r.created_at,
          name: it.medication_name_snapshot,
          dosage: [it.dosage, it.frequency, it.duration].filter(Boolean).join(' · ') || null,
          quantity: Number(it.quantity ?? 1),
          source: 'prescription' as const,
          doctor: r.doctor?.full_name ?? null,
        })),
      ),
      ...((pharmRes.data ?? []) as unknown as HSale[]).flatMap((s) =>
        (s.items ?? []).map((it) => ({
          date: s.created_at,
          name: it.name_snapshot,
          dosage: null,
          quantity: Number(it.quantity ?? 1),
          source: 'pharmacy' as const,
          doctor: null,
        })),
      ),
    ].sort((a, b) => (a.date < b.date ? 1 : -1));

    const balance = ((balRes.data ?? []) as Array<{ balance_uzs: number }>).reduce(
      (a, r) => a + Number(r.balance_uzs ?? 0),
      0,
    );
    const visits = [...visitsByDay.values()]
      .map((v) => ({
        date: v.date,
        services: v.services,
        doctors: [...v.doctors],
        amount_uzs: v.amount_uzs,
        methods: [...v.methods],
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    return {
      patient,
      summary: {
        visits: visits.length,
        first_visit_at: visits.at(-1)?.date ?? null,
        last_visit_at: visits[0]?.date ?? null,
        paid_uzs: paid,
        balance_uzs: balance,
        debt_uzs: Math.max(0, -balance),
        stays: stays.length,
        in_stay: stays.some((s) => s.status === 'admitted'),
      },
      visits,
      services: [...services.values()]
        .map((s) => ({ ...s, doctors: [...s.doctors] }))
        .sort((a, b) => b.count - a.count || (a.last_at < b.last_at ? 1 : -1)),
      doctors: [...doctors.values()]
        .map((d) => ({ name: d.name, visits: d.days.size, last_at: d.last_at }))
        .sort((a, b) => b.visits - a.visits),
      payment_methods: [...methods.values()].sort((a, b) => b.amount_uzs - a.amount_uzs),
      diagnoses,
      medications,
      stays,
      warnings,
    };
  }
}
