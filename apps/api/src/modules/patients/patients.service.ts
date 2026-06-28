import { Injectable, NotFoundException } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

// 360° Patient Timeline — barcha modullardan yagona xronologik event.
export type TimelineEventType =
  | 'visit' | 'note' | 'lab' | 'diagnostic' | 'prescription'
  | 'pharmacy' | 'payment' | 'inpatient' | 'vital' | 'referral' | 'file';

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  date: string;
  title: string;
  subtitle?: string | null;
  status?: string;
  ref_id: string;
  module: string;
  abnormal?: boolean;
  amount_uzs?: number;
  icd?: { code: string; name: string };
  attachments?: Array<{ name: string; url: string }>;
  details?: Record<string, unknown>;
}

@Injectable()
export class PatientsService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Cross-branch ko'rinish: bemor KLINIK ma'lumotlari kompaniyaning barcha
   * filiallari bo'yicha ko'rinadi. Bir-filial kompaniyada [clinicId] qaytadi —
   * ya'ni `.in('clinic_id', [clinicId])` ≡ `.eq('clinic_id', clinicId)` (regress yo'q).
   * Cross-branch faqat 2-filial qo'shilganda faollashadi.
   */
  private async branchScope(clinicId: string): Promise<string[]> {
    const admin = this.supabase.admin();
    const { data: self } = await admin.from('clinics').select('company_id').eq('id', clinicId).maybeSingle();
    const companyId = (self as { company_id: string | null } | null)?.company_id ?? null;
    if (!companyId) return [clinicId];
    const { data: branches } = await admin.from('clinics').select('id').eq('company_id', companyId).is('deleted_at', null);
    const ids = (branches ?? []).map((b) => (b as { id: string }).id);
    return ids.length ? ids : [clinicId];
  }

  async list(clinicId: string, page: number, pageSize: number, q?: string) {
    const from = (page - 1) * pageSize;
    const scope = await this.branchScope(clinicId);
    let query = this.supabase
      .admin()
      .from('patients')
      .select('*', { count: 'exact' })
      .in('clinic_id', scope)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (q) {
      const escaped = q.replace(/[%_]/g, '').trim();
      if (escaped.length) {
        query = query.or(
          [
            `full_name.ilike.%${escaped}%`,
            `first_name.ilike.%${escaped}%`,
            `last_name.ilike.%${escaped}%`,
            `phone.ilike.%${escaped}%`,
          ].join(','),
        );
      }
    }
    const { data, count, error } = await query;
    if (error) throw new NotFoundException(error.message);
    return { items: data ?? [], total: count ?? 0, page, pageSize };
  }

  async getOne(clinicId: string, id: string) {
    const scope = await this.branchScope(clinicId);
    const { data, error } = await this.supabase
      .admin()
      .from('patients')
      .select('*')
      .in('clinic_id', scope)
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    if (error || !data) throw new NotFoundException('patient not found');
    return data;
  }

  async create(clinicId: string, userId: string, input: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .admin()
      .from('patients')
      .insert({ ...input, clinic_id: clinicId, created_by: userId })
      .select()
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async update(clinicId: string, id: string, input: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .admin()
      .from('patients')
      .update(input)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async timeline(clinicId: string, patientId: string) {
    const admin = this.supabase.admin();
    const scope = await this.branchScope(clinicId); // cross-branch klinik tarix (bir-filialda = [clinicId])
    const [patient, appts, tx, prescriptions, referrals, labOrders, stays, pharmacy, notes, diagnostics, vitals, files] = await Promise.all([
      admin.from('patients').select('*').in('clinic_id', scope).eq('id', patientId).maybeSingle(),
      admin
        .from('appointments')
        .select('id, scheduled_at, status, service_name_snapshot, doctor:profiles!doctor_id(full_name)')
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .order('scheduled_at', { ascending: false })
        .limit(200),
      admin
        .from('transactions')
        .select('id, kind, amount_uzs, payment_method, is_void, created_at, notes')
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(200),
      admin
        .from('prescriptions')
        .select('id, rx_number, status, created_at, items:prescription_items(medication_name_snapshot, quantity)')
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('service_referrals')
        .select('id, kind, status, service_name_snapshot, notes, created_at')
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('lab_orders')
        .select(
          'id, status, created_at, completed_at, items:lab_order_items(name_snapshot, status, results:lab_results(is_abnormal, value))',
        )
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('inpatient_stays')
        .select(
          'id, admitted_at, discharged_at, status, total_cost_uzs, attending_notes, room:rooms(number, type)',
        )
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .order('admitted_at', { ascending: false })
        .limit(50),
      admin
        .from('pharmacy_sales')
        .select('id, total_uzs, payment_method, created_at, items:pharmacy_sale_items(name_snapshot, quantity, subtotal_uzs)')
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('treatment_notes')
        .select(
          'id, soap_subjective, soap_objective, soap_assessment, soap_plan, diagnosis_code, diagnosis_text, is_final, signed_at, created_at, author:profiles!author_id(full_name)',
        )
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(200),
      admin
        .from('diagnostic_orders')
        .select(
          'id, name_snapshot, status, scheduled_at, created_at, results:diagnostic_results(findings, impression, attachments, reported_at)',
        )
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('vital_signs')
        .select(
          'id, recorded_at, temperature_c, pulse_bpm, systolic_mmhg, diastolic_mmhg, respiration_rate, oxygen_saturation, weight_kg, height_cm, notes, recorder:profiles!recorded_by(full_name)',
        )
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .order('recorded_at', { ascending: false })
        .limit(100),
      admin
        .from('patient_files')
        .select('id, kind, title, url, mime_type, created_at')
        .in('clinic_id', scope)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    const totalSpent = (tx.data ?? []).reduce((acc, t) => {
      const r = t as { kind: string; amount_uzs: number; is_void: boolean };
      if (r.is_void) return acc;
      return acc + (r.kind === 'refund' ? -r.amount_uzs : r.amount_uzs);
    }, 0);

    // ── 360° Timeline — barcha manbalarni yagona xronologik event'ga birlashtirish ──
    const name = (v: unknown): string | null =>
      (v as { full_name?: string } | null)?.full_name ?? null;
    const events: TimelineEvent[] = [];
    const push = (e: TimelineEvent) => {
      if (e.date) events.push(e);
    };

    for (const a of (appts.data ?? []) as Array<Record<string, unknown>>) {
      push({
        id: `visit-${a.id}`, type: 'visit', date: a.scheduled_at as string,
        title: (a.service_name_snapshot as string) || 'Tashrif', subtitle: name(a.doctor),
        status: a.status as string, ref_id: a.id as string, module: 'reception',
      });
    }
    for (const n of (notes.data ?? []) as Array<Record<string, unknown>>) {
      push({
        id: `note-${n.id}`, type: 'note', date: (n.signed_at as string) || (n.created_at as string),
        title: (n.diagnosis_text as string) || 'Klinik qayd', subtitle: name(n.author),
        status: n.is_final ? 'final' : 'draft', ref_id: n.id as string, module: 'doctor',
        icd: n.diagnosis_code ? { code: n.diagnosis_code as string, name: (n.diagnosis_text as string) ?? '' } : undefined,
        details: { soap_subjective: n.soap_subjective, soap_objective: n.soap_objective, soap_assessment: n.soap_assessment, soap_plan: n.soap_plan },
      });
    }
    for (const l of (labOrders.data ?? []) as Array<Record<string, unknown>>) {
      const items = (l.items as Array<Record<string, unknown>>) ?? [];
      const abnormal = items.some((it) => ((it.results as Array<{ is_abnormal?: boolean }>) ?? []).some((r) => r.is_abnormal));
      push({
        id: `lab-${l.id}`, type: 'lab', date: (l.completed_at as string) || (l.created_at as string),
        title: 'Laboratoriya', status: l.status as string, ref_id: l.id as string, module: 'lab',
        abnormal, details: { items: items.map((it) => ({ name: it.name_snapshot, status: it.status, results: it.results })) },
      });
    }
    for (const d of (diagnostics.data ?? []) as Array<Record<string, unknown>>) {
      const res = (d.results as Array<Record<string, unknown>>) ?? [];
      const atts = res.flatMap((r) => ((r.attachments as Array<{ name?: string; url?: string }>) ?? []));
      push({
        id: `diag-${d.id}`, type: 'diagnostic', date: (d.created_at as string) || (d.scheduled_at as string),
        title: (d.name_snapshot as string) || 'Diagnostika', status: d.status as string, ref_id: d.id as string, module: 'diagnostics',
        attachments: atts.map((a) => ({ name: a.name ?? 'Fayl', url: a.url ?? '' })).filter((a) => a.url),
        details: { findings: res[0]?.findings, impression: res[0]?.impression },
      });
    }
    for (const p of (prescriptions.data ?? []) as Array<Record<string, unknown>>) {
      push({
        id: `rx-${p.id}`, type: 'prescription', date: p.created_at as string,
        title: `Retsept ${p.rx_number ?? ''}`.trim(), status: p.status as string, ref_id: p.id as string, module: 'doctor',
        details: { items: p.items },
      });
    }
    for (const s of (pharmacy.data ?? []) as Array<Record<string, unknown>>) {
      push({
        id: `pharm-${s.id}`, type: 'pharmacy', date: s.created_at as string, title: 'Dorixona',
        amount_uzs: Number(s.total_uzs ?? 0), ref_id: s.id as string, module: 'pharmacy',
        details: { items: s.items, payment_method: s.payment_method },
      });
    }
    for (const t of (tx.data ?? []) as Array<Record<string, unknown>>) {
      push({
        id: `pay-${t.id}`, type: 'payment', date: t.created_at as string, title: 'To\'lov',
        amount_uzs: Number(t.amount_uzs ?? 0), status: t.is_void ? 'void' : (t.kind as string),
        ref_id: t.id as string, module: 'cashier',
        details: { kind: t.kind, payment_method: t.payment_method, notes: t.notes },
      });
    }
    for (const s of (stays.data ?? []) as Array<Record<string, unknown>>) {
      const room = s.room as { number?: string; type?: string } | null;
      push({
        id: `stay-${s.id}`, type: 'inpatient', date: s.admitted_at as string, title: 'Statsionar',
        subtitle: room?.number ? `Palata ${room.number}` : null, status: s.status as string,
        amount_uzs: Number(s.total_cost_uzs ?? 0), ref_id: s.id as string, module: 'inpatient',
        details: { discharged_at: s.discharged_at, epicrisis: s.attending_notes },
      });
    }
    for (const v of (vitals.data ?? []) as Array<Record<string, unknown>>) {
      push({
        id: `vital-${v.id}`, type: 'vital', date: v.recorded_at as string, title: 'Vital belgilar',
        subtitle: name(v.recorder), ref_id: v.id as string, module: 'nurse',
        details: {
          bp: v.systolic_mmhg && v.diastolic_mmhg ? `${v.systolic_mmhg}/${v.diastolic_mmhg}` : null,
          pulse: v.pulse_bpm, temp: v.temperature_c, spo2: v.oxygen_saturation,
          weight: v.weight_kg, height: v.height_cm, notes: v.notes,
        },
      });
    }
    for (const r of (referrals.data ?? []) as Array<Record<string, unknown>>) {
      push({
        id: `ref-${r.id}`, type: 'referral', date: r.created_at as string,
        title: (r.service_name_snapshot as string) || 'Yo\'naltirish', status: r.status as string,
        ref_id: r.id as string, module: 'reception', details: { kind: r.kind, notes: r.notes },
      });
    }
    for (const f of (files.data ?? []) as Array<Record<string, unknown>>) {
      push({
        id: `file-${f.id}`, type: 'file', date: f.created_at as string, title: f.title as string,
        ref_id: f.id as string, module: 'files',
        attachments: [{ name: (f.title as string) ?? 'Fayl', url: (f.url as string) ?? '' }],
        details: { kind: f.kind, mime_type: f.mime_type },
      });
    }

    events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return {
      patient: patient.data,
      summary: {
        total_spent_uzs: totalSpent,
        visits: (appts.data ?? []).length,
        prescriptions: (prescriptions.data ?? []).length,
        lab_orders: (labOrders.data ?? []).length,
        stays: (stays.data ?? []).length,
      },
      events,
      appointments: appts.data ?? [],
      transactions: tx.data ?? [],
      prescriptions: prescriptions.data ?? [],
      referrals: referrals.data ?? [],
      lab_orders: labOrders.data ?? [],
      inpatient_stays: stays.data ?? [],
      pharmacy_sales: pharmacy.data ?? [],
      clinical_notes: notes.data ?? [],
      diagnostics: diagnostics.data ?? [],
      vital_signs: vitals.data ?? [],
      patient_files: files.data ?? [],
    };
  }

  async softDelete(clinicId: string, id: string) {
    const { error } = await this.supabase
      .admin()
      .from('patients')
      .update({ deleted_at: new Date().toISOString() })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new NotFoundException(error.message);
    return { ok: true };
  }
}
