import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
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
import { TrashModule, TrashService } from '../trash/trash.module';

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
  // Tranzaksiya shifokori — key kelmasa tegmaymiz; null — shifokorni o'chirish.
  doctor_id: z.string().uuid().nullable().optional(),
  // Aralash (split) to'lov — to'langan qismni usul bo'yicha bo'lish (naqd + karta).
  // Berilsa: paid = Σ payments, payment_method='mixed' (yoki 1 ta usul).
  payments: z
    .array(
      z.object({
        method: z.enum([
          'cash', 'card', 'transfer', 'insurance', 'click', 'payme', 'uzum', 'kaspi', 'humo', 'uzcard', 'stripe',
        ]),
        amount_uzs: z.number().int().positive(),
      }),
    )
    .optional(),
});

// PATCH /transactions/:id/transfer — hisobotni to'g'irlash: yozuvni boshqa
// kassa (registr) ga ko'chirish va/yoki to'lov usulini tuzatish. Komissiya/xizmat
// tegmaydi; kassa/jurnal/seyf registr+usul bo'yicha avtomatik qayta hisoblanadi.
const TransferSchema = z
  .object({
    register: z.enum(['reception', 'inpatient']).optional(),
    payment_method: z
      .enum(['cash', 'card', 'transfer', 'insurance', 'click', 'payme', 'uzum', 'kaspi', 'humo', 'uzcard', 'stripe'])
      .optional(),
  })
  .refine((b) => b.register !== undefined || b.payment_method !== undefined, {
    message: 'register yoki payment_method dan biri kerak',
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
    occurredAt?: string,
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
        // Komissiya tranzaksiya sanasiga bog'lansin — payroll davri bo'yicha
        // to'g'ri hisoblanishi uchun (tahrir vaqti "now" emas). occurredAt
        // berilmasa default now() ishlaydi.
        ...(occurredAt ? { created_at: occurredAt } : {}),
      },
      { onConflict: 'clinic_id,transaction_id,doctor_id' },
    );
  }

  // GET detail — repchek, tahrir preload va to'lov breakdown uchun yagona manba.
  // items service_id bilan; total = Σ items, debt = −Σ patient_ledger (shu tx), paid = total − debt.
  async getDetail(clinicId: string, transactionId: string) {
    const admin = this.supabase.admin();
    const { data: txRow } = await admin
      .from('transactions')
      .select(
        'id, created_at, amount_uzs, kind, payment_method, is_void, notes, doctor_id, ' +
          'patient:patients(full_name, phone), ' +
          'cashier:profiles!transactions_cashier_id_fkey(full_name), ' +
          'doctor:profiles!transactions_doctor_id_fkey(full_name), ' +
          'appointment:appointments(doctor_id, doctor:profiles!appointments_doctor_id_fkey(full_name)), ' +
          'items:transaction_items(service_id, service_name_snapshot, service_price_snapshot, quantity, discount_snapshot, final_amount_uzs)',
      )
      .eq('clinic_id', clinicId)
      .eq('id', transactionId)
      .maybeSingle();
    if (!txRow) throw new NotFoundException('Tranzaksiya topilmadi');
    const tx = txRow as unknown as {
      id: string;
      created_at: string;
      amount_uzs: number;
      payment_method: string | null;
      is_void: boolean;
      notes: string | null;
      doctor_id: string | null;
      patient: { full_name: string; phone: string | null } | null;
      cashier: { full_name: string } | null;
      doctor: { full_name: string } | null;
      appointment: { doctor_id: string | null; doctor: { full_name: string } | null } | null;
      items: Array<{
        service_id: string | null;
        service_name_snapshot: string | null;
        service_price_snapshot: number | null;
        quantity: number;
        discount_snapshot: unknown;
        final_amount_uzs: number;
      }> | null;
    };

    // Shifokor manbasi ustuvorligi: transactions.doctor_id → appointment → komissiya.
    let doctorId = tx.doctor_id ?? tx.appointment?.doctor_id ?? null;
    let doctorName = tx.doctor?.full_name ?? tx.appointment?.doctor?.full_name ?? null;
    if (!doctorName) {
      const { data: comm } = await admin
        .from('doctor_commissions')
        .select('doctor_id, doctor:profiles!doctor_commissions_doctor_id_fkey(full_name)')
        .eq('clinic_id', clinicId)
        .eq('transaction_id', transactionId)
        .limit(1)
        .maybeSingle();
      const c = comm as { doctor_id: string | null; doctor: { full_name: string } | null } | null;
      doctorId = doctorId ?? c?.doctor_id ?? null;
      doctorName = c?.doctor?.full_name ?? null;
    }

    const items = (tx.items ?? []).map((it) => {
      const disc = it.discount_snapshot;
      const discountUzs =
        typeof disc === 'number'
          ? disc
          : Number((disc as { amount?: number } | null)?.amount ?? 0);
      return {
        service_id: it.service_id,
        name: it.service_name_snapshot ?? 'xizmat',
        quantity: Number(it.quantity ?? 1),
        unit_price_uzs: Number(it.service_price_snapshot ?? 0),
        discount_uzs: discountUzs,
        final_amount_uzs: Number(it.final_amount_uzs ?? 0),
      };
    });
    const totalUzs = items.reduce((a, it) => a + it.final_amount_uzs, 0);

    // Qarz = shu tranzaksiya bo'yicha patient_ledger yozuvlari yig'indisi (charge manfiy).
    const { data: ledger } = await admin
      .from('patient_ledger')
      .select('amount_uzs')
      .eq('clinic_id', clinicId)
      .eq('transaction_id', transactionId);
    const ledgerSum = ((ledger ?? []) as Array<{ amount_uzs: number }>).reduce(
      (a, r) => a + Number(r.amount_uzs ?? 0),
      0,
    );
    const debtUzs = Math.max(0, -ledgerSum);
    const paidUzs = Math.max(0, totalUzs - debtUzs);
    const status = debtUzs <= 0 ? 'paid' : paidUzs > 0 ? 'partial' : 'debt';

    return {
      id: tx.id,
      occurred_at: tx.created_at,
      patient_name: tx.patient?.full_name ?? null,
      patient_phone: tx.patient?.phone ?? null,
      doctor_id: doctorId,
      doctor_name: doctorName,
      cashier_name: tx.cashier?.full_name ?? null,
      payment_method: tx.payment_method,
      notes: tx.notes,
      is_void: !!tx.is_void,
      items,
      total_uzs: totalUzs,
      paid_uzs: paidUzs,
      debt_uzs: debtUzs,
      status,
    };
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
        'id, clinic_id, patient_id, appointment_id, amount_uzs, is_void, notes, doctor_id, created_at, ' +
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
      doctor_id: string | null;
      created_at: string;
      appointment: { doctor_id: string | null } | null;
    };
    if (tx.is_void) {
      throw new BadRequestException('Bekor qilingan tranzaksiyani o\'zgartirib bo\'lmaydi');
    }
    // Tahrirda shifokor o'zgartirilishi mumkin. body.doctor_id key kelgan bo'lsa
    // (null bo'lsa ham — o'chirish), uni manba qilamiz; aks holda mavjud shifokor.
    const doctorChanged = 'doctor_id' in body;
    const doctorId = doctorChanged
      ? (body.doctor_id ?? null)
      : (tx.doctor_id ?? tx.appointment?.doctor_id ?? null);

    // 1b) Eski jami va qarzni hisoblash — paid (yig'ilgan pul) ni saqlash uchun.
    // MUHIM: transactions.amount_uzs = to'langan (checkout konvensiyasi), jami EMAS.
    // Jami = Σ transaction_items; qarz = −Σ patient_ledger (shu tx).
    const { data: oldItems } = await admin
      .from('transaction_items')
      .select('final_amount_uzs')
      .eq('clinic_id', clinicId)
      .eq('transaction_id', transactionId);
    const oldTotal = ((oldItems ?? []) as Array<{ final_amount_uzs: number }>).reduce(
      (a, r) => a + Number(r.final_amount_uzs ?? 0),
      0,
    );
    const { data: oldLedger } = await admin
      .from('patient_ledger')
      .select('amount_uzs')
      .eq('clinic_id', clinicId)
      .eq('transaction_id', transactionId);
    const oldLedgerSum = ((oldLedger ?? []) as Array<{ amount_uzs: number }>).reduce(
      (a, r) => a + Number(r.amount_uzs ?? 0),
      0,
    );
    const oldDebt = Math.max(0, -oldLedgerSum);
    const paid = Math.max(0, oldTotal - oldDebt); // haqiqatda yig'ilgan pul

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

    // 5) transactions.amount_uzs (= paid, saqlanadi) va notes (audit izi).
    // Aralash to'lov berilsa paid = Σ legs; aks holda eski to'langan summa saqlanadi.
    const payLegs = (body.payments ?? []).filter((p) => p.amount_uzs > 0);
    const hasSplit = payLegs.length > 0;
    const isMixed = payLegs.length > 1;
    const newPaid = hasSplit
      ? payLegs.reduce((s, p) => s + p.amount_uzs, 0)
      : Math.min(paid, newAmount);
    const newDebt = Math.max(0, newAmount - newPaid);
    const auditNote = `EDIT total ${oldTotal} → ${newAmount} (paid ${newPaid}, debt ${newDebt}) by ${userId} @ ${new Date().toISOString()}`;
    const mergedNote = [tx.notes, body.notes, auditNote].filter(Boolean).join('\n');
    {
      // Shifokor o'zgargan bo'lsa transactions.doctor_id ni ham yozamiz (manba shu).
      const patch: Record<string, unknown> = { amount_uzs: newPaid, notes: mergedNote };
      if (doctorChanged) patch.doctor_id = doctorId;
      if (hasSplit) patch.payment_method = isMixed ? 'mixed' : payLegs[0]!.method;
      const { error } = await admin
        .from('transactions')
        .update(patch)
        .eq('clinic_id', clinicId)
        .eq('id', transactionId);
      if (error) throw new BadRequestException(error.message);
    }

    // 5b) Aralash to'lov oyoqlari (legs): split berilganда eski legs o'chiriladi,
    // mixed bo'lsa yangilari yoziladi (yagona usul bo'lsa leg shart emas).
    if (hasSplit) {
      await admin
        .from('transaction_payments')
        .delete()
        .eq('clinic_id', clinicId)
        .eq('transaction_id', transactionId);
      if (isMixed) {
        const { error: legErr } = await admin.from('transaction_payments').insert(
          payLegs.map((p) => ({
            clinic_id: clinicId,
            transaction_id: transactionId,
            method: p.method,
            amount_uzs: p.amount_uzs,
            source: p.method === 'cash' ? 'cash_drawer' : 'bank',
          })),
        );
        if (legErr) throw new BadRequestException(legErr.message);
      }
    }

    // 6) doctor_commissions: eski accrued'larni HAR DOIM o'chiramiz (shifokor
    // almashgan/o'chirilgan bo'lsa eski shifokorniki ham ketishi uchun).
    // Status 'paid' (allaqachon to'langan) — tegmaymiz, payroll buzilmasin.
    await admin
      .from('doctor_commissions')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('transaction_id', transactionId)
      .eq('status', 'accrued');

    if (doctorId) {
      // Primary xizmat uchun komissiya: birinchi xizmat (barcha xizmatlar bitta
      // shifokorga taalluqli deb qabul qilinadi — reception checkout pattern'i ham shu).
      const primary = body.items[0];
      if (primary) {
        await this.accrueCommission(
          clinicId,
          transactionId,
          doctorId,
          primary.service_id,
          newAmount,
          tx.created_at,
        );
      }
    }

    // 7) patient_ledger reconcile: shu tx bo'yicha sof balans = −newDebt bo'lsin.
    // Joriy sof = oldLedgerSum. Qo'shiladigan tuzatish = (−newDebt) − oldLedgerSum.
    // Eski yozuvlar tegmaydi (audit izi) — faqat farq qo'shiladi.
    const ledgerDelta = -newDebt - oldLedgerSum;
    if (ledgerDelta !== 0) {
      await admin.from('patient_ledger').insert({
        clinic_id: clinicId,
        patient_id: tx.patient_id,
        transaction_id: transactionId,
        entry_kind: 'adjustment',
        amount_uzs: ledgerDelta,
        description: `Tranzaksiya tahriri: jami ${oldTotal} → ${newAmount}, qarz ${oldDebt} → ${newDebt}`,
        recorded_by: userId,
      });
    }

    return {
      ok: true,
      transaction_id: transactionId,
      old_amount_uzs: oldTotal,
      new_amount_uzs: newAmount,
      paid_uzs: newPaid,
      debt_uzs: newDebt,
      diff_uzs: newAmount - oldTotal,
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

    // 2) patient_ledger: bu tx'ning SOF balansini teskari yozuv bilan nolga
    // keltiramiz (eski yozuvlar audit uchun qoladi). Avval +oldAmount (=to'langan)
    // ishlatilardi — bu noto'g'ri edi; qarz to'liq bekor bo'lmasdi.
    const { data: plRows } = await admin
      .from('patient_ledger')
      .select('amount_uzs')
      .eq('clinic_id', clinicId)
      .eq('transaction_id', transactionId);
    const net = ((plRows ?? []) as Array<{ amount_uzs: number }>).reduce(
      (a, r) => a + Number(r.amount_uzs ?? 0),
      0,
    );
    if (net !== 0) {
      await admin.from('patient_ledger').insert({
        clinic_id: clinicId,
        patient_id: tx.patient_id,
        transaction_id: null,
        entry_kind: 'adjustment',
        amount_uzs: -net,
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
  // MUHIM: patient_ledger APPEND-ONLY (no_delete/no_update RULE) — to'g'ridan
  // DELETE/UPDATE jimgina e'tiborsiz qoldiriladi va FK (NO ACTION) tx o'chirishni
  // bloklaydi. Shuning uchun butun kaskad SECURITY DEFINER RPC ichida bajariladi:
  // rule vaqtincha o'chiriladi → patient_ledger o'chadi → boshqa FK'lar uziladi →
  // transactions o'chadi (transaction_items + doctor_commissions FK CASCADE).
  async deleteTransaction(clinicId: string, userId: string, transactionId: string) {
    const admin = this.supabase.admin();

    const { data: txRow } = await admin
      .from('transactions')
      .select('id, amount_uzs, is_void')
      .eq('clinic_id', clinicId)
      .eq('id', transactionId)
      .maybeSingle();
    if (!txRow) throw new NotFoundException('Tranzaksiya topilmadi');
    const oldAmount = Number((txRow as { amount_uzs: number }).amount_uzs ?? 0);

    const { error } = await admin.rpc('hard_delete_transaction' as never, {
      p_clinic_id: clinicId,
      p_tx: transactionId,
    } as never);
    if (error) {
      throw new BadRequestException(`Tranzaksiyani o'chirib bo'lmadi: ${error.message}`);
    }

    void userId;
    return {
      ok: true,
      transaction_id: transactionId,
      deleted_amount_uzs: oldAmount,
    };
  }

  // Hisobotni to'g'irlash — registr (kassa oynasi) va/yoki to'lov usulini o'zgartirish.
  async transfer(clinicId: string, userId: string, id: string, body: z.infer<typeof TransferSchema>) {
    const admin = this.supabase.admin();
    const { data: txRow } = await admin
      .from('transactions')
      .select('id, is_void, register, payment_method, kind')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (!txRow) throw new NotFoundException('Tranzaksiya topilmadi');
    const tx = txRow as { is_void: boolean; register: string; payment_method: string; kind: string };
    if (tx.is_void) throw new BadRequestException('Bekor qilingan tranzaksiyani ko‘chirib bo‘lmaydi');

    const patch: Record<string, unknown> = {};
    if (body.register !== undefined) patch.register = body.register;
    if (body.payment_method !== undefined) patch.payment_method = body.payment_method;

    // To'lov usuli yagona usulga o'zgarsa — mavjud aralash (mixed) leg'larni tozalaymiz
    // (aks holda by-method/seyf hisobi noto'g'ri bo'ladi).
    if (body.payment_method !== undefined) {
      await admin.from('transaction_payments').delete().eq('clinic_id', clinicId).eq('transaction_id', id);
    }

    const { data, error } = await admin
      .from('transactions')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select('id, register, payment_method')
      .single();
    if (error) throw new BadRequestException(error.message);
    void userId;
    return { ok: true, ...(data as Record<string, unknown>) };
  }
}

@ApiTags('transactions')
@Controller({ path: 'transactions', version: '1' })
class TransactionsController {
  constructor(
    private readonly svc: TransactionsService,
    private readonly trash: TrashService,
  ) {}

  @Get(':id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'receptionist')
  async getDetail(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getDetail(u.clinicId, id);
  }

  @Patch(':id/items')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'receptionist')
  @Audit({ action: 'transaction.items_edited', resourceType: 'transactions' })
  async editItems(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.editItems(u.clinicId, u.userId, id, EditItemsSchema.parse(body));
  }

  @Patch(':id/transfer')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'receptionist')
  @Audit({ action: 'transaction.transferred', resourceType: 'transactions' })
  async transfer(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.transfer(u.clinicId, u.userId, id, TransferSchema.parse(body));
  }

  // O'chirish — endi to'liq hard-delete emas, balki SAVATCHAga arxivlab o'chiriladi
  // (sabab MAJBURIY). Qaytarish — Sozlamalar > Savatcha.
  @Delete(':id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'receptionist')
  @Audit({ action: 'transaction.deleted', resourceType: 'transactions' })
  async delete(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    const { reason } = z.object({ reason: z.string().min(3).max(500) }).parse(body);
    return this.trash.archiveTransaction(u.clinicId, u.userId, id, reason);
  }

  // Tx void (soft delete) — is_void=true. Delete emas, audit izi saqlanadi.
  @Patch(':id/void')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'receptionist')
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
  imports: [TrashModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, SupabaseService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
