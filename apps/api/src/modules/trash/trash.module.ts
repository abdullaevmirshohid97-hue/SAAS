import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// Savatcha (Trash) — bittalab o'chirilgan yozuvlar (jurnal/dorixona/statsionar).
// Backend to'liq snapshot (summary + payload) bilan DB RPC'ga uzatadi, RPC arxivlab
// o'chiradi. Qaytarish — trash_restore RPC.

export type TrashKind = 'transaction' | 'pharmacy_sale' | 'inpatient';

type TrashSummary = {
  title: string;
  occurred_at: string | null;
  patient_name: string | null;
  doctor_name: string | null;
  shift_label: string | null;
  services: Array<{ name: string; type: string | null; qty: number; amount: number }>;
  total_uzs: number;
  paid_uzs: number;
  debt_uzs: number;
};

const RestoreSchema = z.object({ id: z.string().uuid() });

@Injectable()
export class TrashService {
  constructor(private readonly supabase: SupabaseService) {}

  private fmtShift(openedAt: string | null): string | null {
    if (!openedAt) return null;
    const d = new Date(openedAt);
    return `Smena · ${d.toLocaleString('uz-UZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }

  // --- Jurnal tranzaksiyasi ---------------------------------------------------
  async archiveTransaction(clinicId: string, userId: string, txId: string, reason: string) {
    const admin = this.supabase.admin();
    const { data: txRow } = await admin
      .from('transactions')
      .select(
        'id, created_at, shift_id, ' +
          'patient:patients(full_name), ' +
          'cashier:profiles!transactions_cashier_id_fkey(full_name), ' +
          'appointment:appointments(doctor:profiles!appointments_doctor_id_fkey(full_name)), ' +
          'items:transaction_items(service_name_snapshot, service_category_snapshot, quantity, final_amount_uzs)',
      )
      .eq('clinic_id', clinicId)
      .eq('id', txId)
      .maybeSingle();
    if (!txRow) throw new BadRequestException('Tranzaksiya topilmadi');
    const tx = txRow as unknown as {
      id: string;
      created_at: string;
      shift_id: string | null;
      patient: { full_name: string } | null;
      cashier: { full_name: string } | null;
      appointment: { doctor: { full_name: string } | null } | null;
      items: Array<{
        service_name_snapshot: string | null;
        service_category_snapshot: string | null;
        quantity: number;
        final_amount_uzs: number;
      }> | null;
    };

    let doctorName = tx.appointment?.doctor?.full_name ?? null;
    if (!doctorName) {
      const { data: comm } = await admin
        .from('doctor_commissions')
        .select('doctor:profiles!doctor_commissions_doctor_id_fkey(full_name)')
        .eq('clinic_id', clinicId)
        .eq('transaction_id', txId)
        .limit(1)
        .maybeSingle();
      doctorName = (comm as { doctor: { full_name: string } | null } | null)?.doctor?.full_name ?? null;
    }

    const services = (tx.items ?? []).map((it) => ({
      name: it.service_name_snapshot ?? 'xizmat',
      type: it.service_category_snapshot ?? null,
      qty: Number(it.quantity ?? 1),
      amount: Number(it.final_amount_uzs ?? 0),
    }));
    const totalUzs = services.reduce((a, s) => a + s.amount, 0);

    const { data: ledger } = await admin
      .from('patient_ledger')
      .select('amount_uzs')
      .eq('clinic_id', clinicId)
      .eq('transaction_id', txId);
    const ledgerSum = ((ledger ?? []) as Array<{ amount_uzs: number }>).reduce(
      (a, r) => a + Number(r.amount_uzs ?? 0),
      0,
    );
    const debtUzs = Math.max(0, -ledgerSum);
    const paidUzs = Math.max(0, totalUzs - debtUzs);

    const shiftLabel = await this.shiftLabel(clinicId, tx.shift_id);
    const summary: TrashSummary = {
      title: 'Jurnal tranzaksiyasi',
      occurred_at: tx.created_at,
      patient_name: tx.patient?.full_name ?? null,
      doctor_name: doctorName,
      shift_label: shiftLabel,
      services,
      total_uzs: totalUzs,
      paid_uzs: paidUzs,
      debt_uzs: debtUzs,
    };

    const { error } = await admin.rpc('trash_delete_transaction' as never, {
      p_clinic_id: clinicId,
      p_tx: txId,
      p_deleted_by: userId,
      p_reason: reason,
      p_summary: summary,
    } as never);
    if (error) throw new BadRequestException(`O'chirib bo'lmadi: ${error.message}`);
    return { ok: true, kind: 'transaction', source_id: txId };
  }

  // --- Dorixona savdosi -------------------------------------------------------
  async archivePharmacySale(clinicId: string, userId: string, saleId: string, reason: string) {
    const admin = this.supabase.admin();
    const { data: saleRow } = await admin
      .from('pharmacy_sales')
      .select(
        'id, created_at, shift_id, total_uzs, paid_uzs, debt_uzs, pharmacy_doctor_id, ' +
          'patient:patients(full_name), ' +
          'items:pharmacy_sale_items(name_snapshot, quantity, subtotal_uzs)',
      )
      .eq('clinic_id', clinicId)
      .eq('id', saleId)
      .maybeSingle();
    if (!saleRow) throw new BadRequestException('Savdo topilmadi');
    const sale = saleRow as unknown as {
      id: string;
      created_at: string;
      shift_id: string | null;
      total_uzs: number;
      paid_uzs: number;
      debt_uzs: number | null;
      pharmacy_doctor_id: string | null;
      patient: { full_name: string } | null;
      items: Array<{ name_snapshot: string; quantity: number; subtotal_uzs: number }> | null;
    };

    // pharmacy_doctor_id da FK yo'q — alohida qidiramiz (best-effort).
    let doctorName: string | null = null;
    if (sale.pharmacy_doctor_id) {
      const { data: doc } = await admin
        .from('profiles')
        .select('full_name')
        .eq('id', sale.pharmacy_doctor_id)
        .maybeSingle();
      doctorName = (doc as { full_name: string } | null)?.full_name ?? null;
    }

    const services = (sale.items ?? []).map((it) => ({
      name: it.name_snapshot,
      type: 'Dori',
      qty: Number(it.quantity ?? 1),
      amount: Number(it.subtotal_uzs ?? 0),
    }));
    const shiftLabel = await this.shiftLabel(clinicId, sale.shift_id);
    const summary: TrashSummary = {
      title: 'Dorixona savdosi',
      occurred_at: sale.created_at,
      patient_name: sale.patient?.full_name ?? null,
      doctor_name: doctorName,
      shift_label: shiftLabel,
      services,
      total_uzs: Number(sale.total_uzs ?? 0),
      paid_uzs: Number(sale.paid_uzs ?? 0),
      debt_uzs: Number(sale.debt_uzs ?? 0),
    };

    const { error } = await admin.rpc('trash_delete_pharmacy_sale' as never, {
      p_clinic_id: clinicId,
      p_sale: saleId,
      p_deleted_by: userId,
      p_reason: reason,
      p_summary: summary,
    } as never);
    if (error) throw new BadRequestException(`O'chirib bo'lmadi: ${error.message}`);
    return { ok: true, kind: 'pharmacy_sale', source_id: saleId };
  }

  // --- Statsionar yozuvi ------------------------------------------------------
  async archiveInpatientStay(clinicId: string, userId: string, stayId: string, reason: string) {
    const admin = this.supabase.admin();
    const { data: stayRow } = await admin
      .from('inpatient_stays')
      .select(
        'id, admitted_at, total_cost_uzs, ' +
          'patient:patients(full_name), ' +
          'doctor:profiles!inpatient_stays_attending_doctor_id_fkey(full_name), ' +
          'room:rooms(number)',
      )
      .eq('clinic_id', clinicId)
      .eq('id', stayId)
      .maybeSingle();
    if (!stayRow) throw new BadRequestException('Statsionar yozuvi topilmadi');
    const stay = stayRow as unknown as {
      id: string;
      admitted_at: string;
      total_cost_uzs: number;
      patient: { full_name: string } | null;
      doctor: { full_name: string } | null;
      room: { number: string } | null;
    };
    const roomLabel = stay.room?.number ? `Xona ${stay.room.number}` : null;

    // Xizmatlar — bog'liq tranzaksiya itemlaridan (nomi + turi + summa), bo'lmasa
    // statsionar care_items sarlavhalaridan (pulsiz).
    const { data: txRows } = await admin
      .from('transactions')
      .select('items:transaction_items(service_name_snapshot, service_category_snapshot, quantity, final_amount_uzs)')
      .eq('clinic_id', clinicId)
      .eq('stay_id', stayId);
    const services: TrashSummary['services'] = [];
    for (const t of (txRows ?? []) as Array<{
      items: Array<{
        service_name_snapshot: string | null;
        service_category_snapshot: string | null;
        quantity: number;
        final_amount_uzs: number;
      }> | null;
    }>) {
      for (const it of t.items ?? []) {
        services.push({
          name: it.service_name_snapshot ?? 'xizmat',
          type: it.service_category_snapshot ?? (roomLabel ? `Statsionar · ${roomLabel}` : 'Statsionar'),
          qty: Number(it.quantity ?? 1),
          amount: Number(it.final_amount_uzs ?? 0),
        });
      }
    }
    if (services.length === 0) {
      const { data: care } = await admin
        .from('care_items')
        .select('title, quantity')
        .eq('clinic_id', clinicId)
        .eq('stay_id', stayId);
      for (const c of (care ?? []) as Array<{ title: string; quantity: number | null }>) {
        services.push({
          name: c.title,
          type: roomLabel ? `Statsionar · ${roomLabel}` : 'Statsionar',
          qty: Number(c.quantity ?? 1),
          amount: 0,
        });
      }
    }

    const { data: ledger } = await admin
      .from('patient_ledger')
      .select('amount_uzs')
      .eq('clinic_id', clinicId)
      .eq('stay_id', stayId);
    const ledgerSum = ((ledger ?? []) as Array<{ amount_uzs: number }>).reduce(
      (a, r) => a + Number(r.amount_uzs ?? 0),
      0,
    );
    const totalUzs = Number(stay.total_cost_uzs ?? 0);
    const debtUzs = Math.max(0, -ledgerSum);
    const paidUzs = Math.max(0, totalUzs - debtUzs);

    const summary: TrashSummary = {
      title: 'Statsionar yozuvi',
      occurred_at: stay.admitted_at,
      patient_name: stay.patient?.full_name ?? null,
      doctor_name: stay.doctor?.full_name ?? null,
      shift_label: roomLabel,
      services,
      total_uzs: totalUzs,
      paid_uzs: paidUzs,
      debt_uzs: debtUzs,
    };

    const { error } = await admin.rpc('trash_delete_inpatient_stay' as never, {
      p_clinic_id: clinicId,
      p_stay: stayId,
      p_deleted_by: userId,
      p_reason: reason,
      p_summary: summary,
    } as never);
    if (error) throw new BadRequestException(`O'chirib bo'lmadi: ${error.message}`);
    return { ok: true, kind: 'inpatient', source_id: stayId };
  }

  private async shiftLabel(clinicId: string, shiftId: string | null): Promise<string | null> {
    if (!shiftId) return null;
    const { data } = await this.supabase
      .admin()
      .from('shifts')
      .select('opened_at')
      .eq('clinic_id', clinicId)
      .eq('id', shiftId)
      .maybeSingle();
    return this.fmtShift((data as { opened_at: string } | null)?.opened_at ?? null);
  }

  // --- Ro'yxat ----------------------------------------------------------------
  async list(clinicId: string, kind?: TrashKind, includeRestored = false) {
    let q = this.supabase
      .admin()
      .from('trash_bin')
      .select(
        'id, kind, source_id, reason, summary, deleted_at, restored_at, ' +
          'deleted_by:profiles!trash_bin_deleted_by_fkey(full_name)',
      )
      .eq('clinic_id', clinicId)
      .order('deleted_at', { ascending: false })
      .limit(300);
    if (kind) q = q.eq('kind', kind);
    if (!includeRestored) q = q.is('restored_at', null);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((r) => {
      const row = r as unknown as {
        id: string;
        kind: TrashKind;
        source_id: string;
        reason: string;
        summary: TrashSummary;
        deleted_at: string;
        restored_at: string | null;
        deleted_by: { full_name: string } | null;
      };
      return {
        id: row.id,
        kind: row.kind,
        source_id: row.source_id,
        reason: row.reason,
        summary: row.summary,
        deleted_at: row.deleted_at,
        restored_at: row.restored_at,
        deleted_by_name: row.deleted_by?.full_name ?? null,
      };
    });
  }

  async restore(clinicId: string, userId: string, id: string) {
    const { error } = await this.supabase.admin().rpc('trash_restore' as never, {
      p_clinic_id: clinicId,
      p_id: id,
      p_restored_by: userId,
    } as never);
    if (error) throw new BadRequestException(`Qaytarib bo'lmadi: ${error.message}`);
    return { ok: true, id };
  }
}

@ApiTags('trash')
@Controller({ path: 'trash', version: '1' })
class TrashController {
  constructor(private readonly svc: TrashService) {}

  @Get()
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  list(
    @CurrentUser() u: { clinicId: string | null },
    @Query('kind') kind?: string,
    @Query('include_restored') includeRestored?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const k = ['transaction', 'pharmacy_sale', 'inpatient'].includes(kind ?? '')
      ? (kind as TrashKind)
      : undefined;
    return this.svc.list(u.clinicId, k, includeRestored === 'true');
  }

  @Post('restore')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @Audit({ action: 'trash.restored', resourceType: 'trash_bin' })
  restore(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.restore(u.clinicId, u.userId, RestoreSchema.parse(body).id);
  }
}

@Module({
  controllers: [TrashController],
  providers: [TrashService, SupabaseService],
  exports: [TrashService],
})
export class TrashModule {}
