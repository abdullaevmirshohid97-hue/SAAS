import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// PATCH /transactions/:id/items
// Tranzaksiya tarkibini admin tomonidan o'zgartirish: xizmat qo'shish/o'chirish,
// soni va narxini o'zgartirish. Komissiyalar va patient_ledger qarz farqi
// avtomatik qayta hisoblanadi.
const TxItemSchema = z.object({
  service_id: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
  unit_price_uzs: z.number().int().nonnegative(),
  discount_uzs: z.number().int().nonnegative().default(0),
});

const EditItemsSchema = z.object({
  items: z.array(TxItemSchema).min(1),
  notes: z.string().max(2000).optional(),
});

@Injectable()
class TransactionsService {
  constructor(private readonly supabase: SupabaseService) {}

  // Bitta xizmat uchun shifokor komissiyasini qayta yozish.
  // doctor_id va service_id berilgan rate'dan foiz/fix oladi.
  private async accrueCommission(
    clinicId: string,
    transactionId: string,
    doctorId: string,
    serviceId: string,
    grossUzs: number,
  ): Promise<void> {
    const admin = this.supabase.admin();
    const today = new Date().toISOString().slice(0, 10);

    let rate: { percent: number; fixed_uzs: number } | null = null;
    {
      const { data } = await admin
        .from('doctor_commission_rates')
        .select('percent, fixed_uzs')
        .eq('clinic_id', clinicId)
        .eq('doctor_id', doctorId)
        .eq('service_id', serviceId)
        .eq('is_archived', false)
        .lte('valid_from', today)
        .order('valid_from', { ascending: false })
        .limit(1)
        .maybeSingle();
      rate = data as { percent: number; fixed_uzs: number } | null;
    }
    if (!rate) {
      const { data } = await admin
        .from('doctor_commission_rates')
        .select('percent, fixed_uzs')
        .eq('clinic_id', clinicId)
        .eq('doctor_id', doctorId)
        .is('service_id', null)
        .eq('is_archived', false)
        .lte('valid_from', today)
        .order('valid_from', { ascending: false })
        .limit(1)
        .maybeSingle();
      rate = data as { percent: number; fixed_uzs: number } | null;
    }
    const percent = rate?.percent ?? 0;
    const fixed = rate?.fixed_uzs ?? 0;
    if (percent === 0 && fixed === 0) return;
    const amount = Math.round((Number(grossUzs) * Number(percent)) / 100) + Number(fixed);
    await admin.from('doctor_commissions').upsert(
      {
        clinic_id: clinicId,
        doctor_id: doctorId,
        transaction_id: transactionId,
        service_id: serviceId,
        gross_uzs: grossUzs,
        percent,
        fixed_uzs: fixed,
        amount_uzs: amount,
        status: 'accrued',
      },
      { onConflict: 'clinic_id,transaction_id,doctor_id' },
    );
  }

  async editItems(
    clinicId: string,
    userId: string,
    transactionId: string,
    body: z.infer<typeof EditItemsSchema>,
  ) {
    const admin = this.supabase.admin();

    // 1) Tranzaksiyani topish (tenant izolyatsiyasi + holatni tekshirish)
    const { data: txRow } = await admin
      .from('transactions')
      .select(
        'id, clinic_id, patient_id, appointment_id, amount_uzs, is_void, notes, ' +
          'appointment:appointments(doctor_id)',
      )
      .eq('clinic_id', clinicId)
      .eq('id', transactionId)
      .maybeSingle();
    if (!txRow) throw new NotFoundException('Tranzaksiya topilmadi');
    const tx = txRow as unknown as {
      id: string;
      patient_id: string;
      appointment_id: string | null;
      amount_uzs: number;
      is_void: boolean;
      notes: string | null;
      appointment: { doctor_id: string | null } | null;
    };
    if (tx.is_void) {
      throw new BadRequestException('Bekor qilingan tranzaksiyani o\'zgartirib bo\'lmaydi');
    }
    const oldAmount = Number(tx.amount_uzs ?? 0);
    const doctorId = tx.appointment?.doctor_id ?? null;

    // 2) Xizmatlarning hozirgi narxlari (snapshot uchun)
    const serviceIds = [...new Set(body.items.map((i) => i.service_id))];
    const { data: services } = await admin
      .from('services')
      .select('id, name_i18n, price_uzs, category_id')
      .eq('clinic_id', clinicId)
      .in('id', serviceIds);
    const svcMap = new Map((services ?? []).map((s) => [s.id as string, s]));
    for (const it of body.items) {
      if (!svcMap.has(it.service_id)) {
        throw new BadRequestException(`Xizmat topilmadi: ${it.service_id}`);
      }
    }

    // 3) Jami summani qayta hisoblash
    let newAmount = 0;
    const itemRows: Array<Record<string, unknown>> = [];
    for (const it of body.items) {
      const svc = svcMap.get(it.service_id)!;
      const unit = it.unit_price_uzs;
      const itemTotal = unit * it.quantity - (it.discount_uzs ?? 0);
      newAmount += itemTotal;
      const nameI18n = (svc as { name_i18n: Record<string, string> }).name_i18n;
      itemRows.push({
        clinic_id: clinicId,
        transaction_id: transactionId,
        service_id: it.service_id,
        service_name_snapshot:
          nameI18n['uz-Latn'] ?? nameI18n.ru ?? Object.values(nameI18n)[0] ?? 'xizmat',
        service_price_snapshot: unit,
        service_category_snapshot: (svc as { category_id: string | null }).category_id ?? null,
        quantity: it.quantity,
        discount_snapshot: it.discount_uzs ?? 0,
        final_amount_uzs: itemTotal,
      });
    }

    // 4) transaction_items: eskilarini o'chirib yangilarini yozish
    {
      const { error } = await admin
        .from('transaction_items')
        .delete()
        .eq('clinic_id', clinicId)
        .eq('transaction_id', transactionId);
      if (error) throw new BadRequestException(error.message);
    }
    {
      const { error } = await admin.from('transaction_items').insert(itemRows);
      if (error) throw new BadRequestException(error.message);
    }

    // 5) transactions.amount_uzs va notes (audit izi) yangilash
    const auditNote = `EDIT ${oldAmount} → ${newAmount} by ${userId} @ ${new Date().toISOString()}`;
    const mergedNote = [tx.notes, body.notes, auditNote].filter(Boolean).join('\n');
    {
      const { error } = await admin
        .from('transactions')
        .update({ amount_uzs: newAmount, notes: mergedNote })
        .eq('clinic_id', clinicId)
        .eq('id', transactionId);
      if (error) throw new BadRequestException(error.message);
    }

    // 6) doctor_commissions: eski accrued status'dagilarini o'chirib qayta yozish.
    // Status 'paid' bo'lganlar (allaqachon to'langan) — tegmaymiz, payroll buzilmasin.
    if (doctorId) {
      await admin
        .from('doctor_commissions')
        .delete()
        .eq('clinic_id', clinicId)
        .eq('transaction_id', transactionId)
        .eq('status', 'accrued');

      // Primary xizmat uchun komissiya: birinchi xizmat (yoki barcha xizmatlar
      // bir shifokorga taalluqli deb qabul qilamiz — reception checkout
      // pattern'i ham shu).
      const primary = body.items[0];
      if (primary) {
        await this.accrueCommission(clinicId, transactionId, doctorId, primary.service_id, newAmount);
      }
    }

    // 7) patient_ledger: agar summa o'zgargan bo'lsa, farq qarz/oldindan to'lov
    // sifatida yoziladi. Bu eski qarzga qo'shimcha entry — eski yozuv tegmaydi
    // (audit izi). Farq musbat → bemor ko'proq qarzdor; manfiy → kamroq qarzdor.
    const diff = newAmount - oldAmount;
    if (diff !== 0) {
      await admin.from('patient_ledger').insert({
        clinic_id: clinicId,
        patient_id: tx.patient_id,
        transaction_id: transactionId,
        entry_kind: 'adjustment',
        amount_uzs: -diff,
        description: `Tranzaksiya tahriri: ${oldAmount} → ${newAmount}`,
        recorded_by: userId,
      });
    }

    return {
      ok: true,
      transaction_id: transactionId,
      old_amount_uzs: oldAmount,
      new_amount_uzs: newAmount,
      diff_uzs: diff,
      items_count: itemRows.length,
    };
  }

  // Tranzaksiyani BEKOR QILISH (void) — delete emas, soft-delete.
  // Audit izi saqlanadi (is_void=true, voided_at, voided_by, void_reason).
  // Cascade:
  //  1) doctor_commissions accrued → 'reversed' (payroll buzilmasin)
  //  2) patient_ledger kontr-amal yoziladi
  //  3) transactions.is_void=true
  async voidTransaction(
    clinicId: string,
    userId: string,
    transactionId: string,
    reason: string,
  ) {
    const admin = this.supabase.admin();

    const { data: txRow } = await admin
      .from('transactions')
      .select('id, patient_id, amount_uzs, is_void, notes')
      .eq('clinic_id', clinicId)
      .eq('id', transactionId)
      .maybeSingle();
    if (!txRow) throw new NotFoundException('Tranzaksiya topilmadi');
    const tx = txRow as {
      id: string;
      patient_id: string;
      amount_uzs: number;
      is_void: boolean;
      notes: string | null;
    };
    if (tx.is_void) {
      throw new BadRequestException('Tranzaksiya allaqachon bekor qilingan');
    }
    const oldAmount = Number(tx.amount_uzs ?? 0);

    // 1) doctor_commissions: accrued -> reversed (delete emas, payroll
    // tarix saqlanadi)
    await admin
      .from('doctor_commissions')
      .update({ status: 'reversed' })
      .eq('clinic_id', clinicId)
      .eq('transaction_id', transactionId);

    // 2) patient_ledger kontr-amal
    if (oldAmount !== 0) {
      await admin.from('patient_ledger').insert({
        clinic_id: clinicId,
        patient_id: tx.patient_id,
        transaction_id: null,
        entry_kind: 'adjustment',
        amount_uzs: oldAmount,
        description: `Tranzaksiya bekor qilindi: ${reason}`,
        recorded_by: userId,
      });
    }

    // 3) transactions.is_void + audit ma'lumotlari
    const auditNote = `VOID by ${userId} @ ${new Date().toISOString()}: ${reason}`;
    const mergedNotes = [tx.notes, auditNote].filter(Boolean).join('\n');
    const { error } = await admin
      .from('transactions')
      .update({
        is_void: true,
        voided_at: new Date().toISOString(),
        voided_by: userId,
        notes: mergedNotes,
      })
      .eq('clinic_id', clinicId)
      .eq('id', transactionId);
    if (error) throw new BadRequestException(error.message);

    return {
      ok: true,
      transaction_id: transactionId,
      voided_amount_uzs: oldAmount,
    };
  }

  // Tranzaksiyani butunlay o'chirish (admin/owner only).
  // Cascade:
  //  1) doctor_commissions: status='accrued' o'chiriladi (payroll'da hali
  //     to'lanmagan), 'paid' status='reversed' qilinadi (tarix saqlanadi).
  //  2) patient_ledger: kontr-amal yoziladi (qarz qaytariladi, eski yozuv
  //     audit izi sifatida qoladi).
  //  3) transaction_items DELETE (FK CASCADE bo'lmasa, qo'lda).
  //  4) transactions DELETE.
  async deleteTransaction(clinicId: string, userId: string, transactionId: string) {
    const admin = this.supabase.admin();

    const { data: txRow } = await admin
      .from('transactions')
      .select('id, patient_id, amount_uzs, is_void')
      .eq('clinic_id', clinicId)
      .eq('id', transactionId)
      .maybeSingle();
    if (!txRow) throw new NotFoundException('Tranzaksiya topilmadi');
    const tx = txRow as {
      id: string;
      patient_id: string;
      amount_uzs: number;
      is_void: boolean;
    };
    const oldAmount = Number(tx.amount_uzs ?? 0);

    // 1) doctor_commissions
    await admin
      .from('doctor_commissions')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('transaction_id', transactionId)
      .eq('status', 'accrued');
    await admin
      .from('doctor_commissions')
      .update({ status: 'reversed' })
      .eq('clinic_id', clinicId)
      .eq('transaction_id', transactionId)
      .eq('status', 'paid');

    // 2) patient_ledger kontr-amal — qarz mavjud bo'lsa qaytariladi.
    // entry_kind='adjustment', amount=+oldAmount (musbat = qarzni kamaytirish).
    if (oldAmount !== 0) {
      await admin.from('patient_ledger').insert({
        clinic_id: clinicId,
        patient_id: tx.patient_id,
        transaction_id: null,
        entry_kind: 'adjustment',
        amount_uzs: oldAmount,
        description: `Tranzaksiya o'chirildi (ID: ${transactionId.slice(0, 8)}, summa: ${oldAmount})`,
        recorded_by: userId,
      });
    }

    // 3) transaction_items
    await admin
      .from('transaction_items')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('transaction_id', transactionId);

    // 4) transactions
    const { error } = await admin
      .from('transactions')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', transactionId);
    if (error) {
      throw new BadRequestException(
        `Tranzaksiyani o'chirib bo'lmadi: ${error.message}. Boshqa jadvallarda FK aloqasi qolgan bo'lishi mumkin.`,
      );
    }

    return {
      ok: true,
      transaction_id: transactionId,
      deleted_amount_uzs: oldAmount,
    };
  }
}

@ApiTags('transactions')
@Controller({ path: 'transactions', version: '1' })
class TransactionsController {
  constructor(private readonly svc: TransactionsService) {}

  @Patch(':id/items')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'transaction.items_edited', resourceType: 'transactions' })
  async editItems(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.editItems(u.clinicId, u.userId, id, EditItemsSchema.parse(body));
  }

  @Delete(':id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'transaction.deleted', resourceType: 'transactions' })
  async delete(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.deleteTransaction(u.clinicId, u.userId, id);
  }

  // Tx void (soft delete) — is_void=true. Delete emas, audit izi saqlanadi.
  @Patch(':id/void')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'transaction.voided', resourceType: 'transactions' })
  async void(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    const schema = z.object({ reason: z.string().min(3).max(500) });
    const { reason } = schema.parse(body);
    return this.svc.voidTransaction(u.clinicId, u.userId, id, reason);
  }
}

@Module({
  controllers: [TransactionsController],
  providers: [TransactionsService, SupabaseService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
