import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

@Injectable()
export class AppointmentsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(clinicId: string, opts: { from?: string; to?: string; doctor?: string }) {
    let q = this.supabase.admin().from('appointments').select('*').eq('clinic_id', clinicId);
    if (opts.from) q = q.gte('scheduled_at', opts.from);
    if (opts.to) q = q.lte('scheduled_at', opts.to);
    if (opts.doctor) q = q.eq('doctor_id', opts.doctor);
    const { data, error } = await q.order('scheduled_at', { ascending: true });
    if (error) throw new NotFoundException(error.message);
    return data ?? [];
  }

  async create(clinicId: string, userId: string, input: Record<string, unknown>) {
    const admin = this.supabase.admin();

    // Snapshot service
    let snapshot: { name: string | null; price: number | null } = { name: null, price: null };
    if (input['service_id']) {
      const { data: svc } = await admin.from('services').select('name_i18n, price_uzs').eq('id', input['service_id']).single();
      if (svc) {
        snapshot = { name: (svc['name_i18n'] as Record<string, string>)['uz-Latn'] ?? null, price: svc['price_uzs'] as number };
      }
    }

    const { data, error } = await admin
      .from('appointments')
      .insert({
        ...input,
        clinic_id: clinicId,
        created_by: userId,
        service_name_snapshot: snapshot.name,
        service_price_snapshot: snapshot.price,
      })
      .select()
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async update(clinicId: string, id: string, input: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .admin()
      .from('appointments')
      .update(input)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  // Pending appointment'ni butunlay o'chirish (jurnaldan).
  // Faqat to'lov qilinmagan (tranzaksiyasiz) va tugallanmagan holatlar uchun.
  // Bog'liq queue qatori ham o'chiriladi.
  async remove(clinicId: string, id: string) {
    const admin = this.supabase.admin();
    const { data: appt } = await admin
      .from('appointments')
      .select('id, status')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (!appt) throw new NotFoundException('Qabul topilmadi');
    const status = (appt as { status: string }).status;
    if (!['scheduled', 'checked_in', 'in_progress'].includes(status)) {
      throw new BadRequestException(
        'Faqat kutilayotgan (to\'lov qilinmagan) qabulni o\'chirish mumkin',
      );
    }
    // To'lov tranzaksiyasi bog'langan bo'lsa — o'chirmaymiz (jurnalda tx ko'rinadi).
    const { data: linkedTx } = await admin
      .from('transactions')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('appointment_id', id)
      .limit(1)
      .maybeSingle();
    if (linkedTx) {
      throw new BadRequestException(
        'Bu qabulga to\'lov bog\'langan — avval tranzaksiyani o\'chiring',
      );
    }
    await admin.from('queues').delete().eq('clinic_id', clinicId).eq('appointment_id', id);
    const { error } = await admin
      .from('appointments')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true, appointment_id: id };
  }
}
