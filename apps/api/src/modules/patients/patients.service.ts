import { Injectable, NotFoundException } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

@Injectable()
export class PatientsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(clinicId: string, page: number, pageSize: number, q?: string) {
    const from = (page - 1) * pageSize;
    let query = this.supabase
      .admin()
      .from('patients')
      .select('*', { count: 'exact' })
      .eq('clinic_id', clinicId)
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
    const { data, error } = await this.supabase
      .admin()
      .from('patients')
      .select('*')
      .eq('clinic_id', clinicId)
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
    const [patient, appts, tx, prescriptions, referrals, labOrders, stays, pharmacy, notes] = await Promise.all([
      admin.from('patients').select('*').eq('clinic_id', clinicId).eq('id', patientId).maybeSingle(),
      admin
        .from('appointments')
        .select('id, scheduled_at, status, service_name_snapshot, doctor:profiles!doctor_id(full_name)')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .order('scheduled_at', { ascending: false })
        .limit(200),
      admin
        .from('transactions')
        .select('id, kind, amount_uzs, payment_method, is_void, created_at, notes')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(200),
      admin
        .from('prescriptions')
        .select('id, rx_number, status, created_at, items:prescription_items(medication_name_snapshot, quantity)')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('service_referrals')
        .select('id, kind, status, service_name_snapshot, notes, created_at')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('lab_orders')
        .select(
          'id, status, created_at, completed_at, items:lab_order_items(name_snapshot, status)',
        )
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('inpatient_stays')
        .select(
          'id, admitted_at, discharged_at, status, total_cost_uzs, attending_notes, room:rooms(number, type)',
        )
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .order('admitted_at', { ascending: false })
        .limit(50),
      admin
        .from('pharmacy_sales')
        .select('id, total_uzs, payment_method, created_at, items:pharmacy_sale_items(name_snapshot, quantity, subtotal_uzs)')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('treatment_notes')
        .select(
          'id, soap_subjective, soap_objective, soap_assessment, soap_plan, diagnosis_text, is_final, signed_at, created_at, author:profiles!author_id(full_name)',
        )
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    const totalSpent = (tx.data ?? []).reduce((acc, t) => {
      const r = t as { kind: string; amount_uzs: number; is_void: boolean };
      if (r.is_void) return acc;
      return acc + (r.kind === 'refund' ? -r.amount_uzs : r.amount_uzs);
    }, 0);

    return {
      patient: patient.data,
      summary: {
        total_spent_uzs: totalSpent,
        visits: (appts.data ?? []).length,
        prescriptions: (prescriptions.data ?? []).length,
        lab_orders: (labOrders.data ?? []).length,
        stays: (stays.data ?? []).length,
      },
      appointments: appts.data ?? [],
      transactions: tx.data ?? [],
      prescriptions: prescriptions.data ?? [],
      referrals: referrals.data ?? [],
      lab_orders: labOrders.data ?? [],
      inpatient_stays: stays.data ?? [],
      pharmacy_sales: pharmacy.data ?? [],
      clinical_notes: notes.data ?? [],
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
