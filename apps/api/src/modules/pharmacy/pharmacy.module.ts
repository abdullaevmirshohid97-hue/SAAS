import {
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
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

const PAYMENT_METHOD = z.enum([
  'cash',
  'card',
  'transfer',
  'insurance',
  'click',
  'payme',
  'uzum',
  'kaspi',
  'humo',
  'uzcard',
  'debt',
]);

const SaleSchema = z.object({
  patient_id: z.string().uuid().optional(),
  // Mijoz-klinika (B2B) + shu klinikaning shifokori
  pharmacy_clinic_id: z.string().uuid().optional(),
  pharmacy_doctor_id: z.string().uuid().optional(),
  prescription_id: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        medication_id: z.string().uuid(),
        quantity: z.number().int().positive(),
        unit_price_override_uzs: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1),
  payment_method: PAYMENT_METHOD,
  paid_uzs: z.number().int().nonnegative().optional(),
  debt_uzs: z.number().int().nonnegative().default(0),
  discount_uzs: z.number().int().nonnegative().default(0),
  notes: z.string().optional(),
  shift_id: z.string().uuid().optional(),
});

const ReceiptSchema = z.object({
  supplier_id: z.string().uuid().optional(),
  receipt_no: z.string().optional(),
  received_at: z.string().datetime().optional(),
  // Yetkazib beruvchiga to'langan summa (qarz = jami − to'langan)
  paid_uzs: z.number().int().nonnegative().optional(),
  payment_method: z.string().optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        medication_id: z.string().uuid(),
        quantity: z.number().int().positive(),
        unit_cost_uzs: z.number().int().nonnegative(),
        // Foyda foizi — sotuv narxi = tannarx * (1 + foyda%/100)
        profit_percent: z.number().nonnegative().default(0),
        // Doktor ulushi: foizda YOKI bonus summada (faqat dorixona hisobotida)
        doctor_share_percent: z.number().min(0).max(100).default(0),
        doctor_share_bonus_uzs: z.number().int().nonnegative().default(0),
        manufacturer: z.string().optional(),
        manufacture_date: z.string().optional(),
        batch_no: z.string().optional(),
        expiry_date: z.string().optional(),
        // Agar frontend narxni bevosita yuborsa — undan, aks holda foiz bilan hisoblanadi
        unit_price_uzs: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1),
});

// Mijoz-klinika (B2B) — dorixonaning o'z ro'yxati
const PharmClinicSchema = z.object({
  name: z.string().min(1),
  contact_person: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
});
const PharmDoctorSchema = z.object({
  full_name: z.string().min(1),
  phone: z.string().optional(),
});
const ClinicPaymentSchema = z.object({
  amount_uzs: z.number().int().positive(),
  payment_method: z.string().optional(),
  notes: z.string().optional(),
});
const VoidSaleSchema = z.object({ reason: z.string().optional() });
const SupplierPaymentSchema = z.object({
  supplier_id: z.string().uuid(),
  amount_uzs: z.number().int().positive(),
  payment_method: z.string().optional(),
  notes: z.string().optional(),
});

// Dori (medication) — to'liq ma'lumotlar, dorixona oynasida boshqariladi
const MedicationSchema = z.object({
  name: z.string().min(1),
  category_id: z.string().uuid().nullish(),
  manufacturer: z.string().optional(),
  strength: z.string().optional(),
  form: z.string().optional(),
  barcode: z.string().optional(),
  price_uzs: z.number().int().nonnegative().default(0),
  cost_uzs: z.number().int().nonnegative().nullish(),
  reorder_level: z.number().int().nonnegative().nullish(),
  requires_prescription: z.boolean().optional(),
  image_url: z.string().url().nullish(),
});
const MedicationUpdateSchema = MedicationSchema.partial();
const MedCategorySchema = z.object({ name: z.string().min(1) });

// Yetkazib beruvchi firma (suppliers jadvali) — anketa
const SupplierSchema = z.object({
  name: z.string().min(1),
  contact_person: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
});
const SupplierUpdateSchema = SupplierSchema.partial();
// Firma bilan oldi-berdi (manual): payment (pul berdim) / debt (qarz) / adjustment
const SupplierEntrySchema = z.object({
  entry_kind: z.enum(['payment', 'debt', 'adjustment']),
  amount_uzs: z.number().int(),
  payment_method: z.string().optional(),
  invoice_no: z.string().optional(),
  occurred_at: z.string().optional(),
  notes: z.string().optional(),
});

@Injectable()
export class PharmacyService {
  constructor(private readonly supabase: SupabaseService) {}

  async dashboard(clinicId: string) {
    const admin = this.supabase.admin();
    const [{ data: stock }, { data: lowStock }, { data: expiring }, { data: todayTotals }] = await Promise.all([
      admin
        .from('medication_stock_summary')
        .select('qty_in_stock, stock_value_uzs')
        .eq('clinic_id', clinicId),
      admin
        .from('medication_stock_summary')
        .select('medication_id, name, qty_in_stock, reorder_level')
        .eq('clinic_id', clinicId)
        .order('qty_in_stock', { ascending: true })
        .limit(20),
      admin
        .from('medication_batches')
        .select('id, medication:medications(name), batch_no, expiry_date, qty_remaining')
        .eq('clinic_id', clinicId)
        .gt('qty_remaining', 0)
        .not('expiry_date', 'is', null)
        .lte('expiry_date', new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10))
        .order('expiry_date', { ascending: true })
        .limit(20),
      admin
        .from('pharmacy_sales')
        .select('total_uzs, paid_uzs, debt_uzs')
        .eq('clinic_id', clinicId)
        .eq('is_void', false)
        .gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
    ]);

    const totalQty = (stock ?? []).reduce(
      (a, r: Record<string, number>) => a + Number(r.qty_in_stock ?? 0),
      0,
    );
    const totalValue = (stock ?? []).reduce(
      (a, r: Record<string, number>) => a + Number(r.stock_value_uzs ?? 0),
      0,
    );
    const lowCount = ((lowStock as Array<{ qty_in_stock: number; reorder_level: number | null }> | null) ?? []).filter(
      (r) => r.qty_in_stock <= (r.reorder_level ?? 10),
    ).length;
    const todayRevenue = (todayTotals ?? []).reduce(
      (a, r: Record<string, number>) => a + Number(r.paid_uzs ?? 0),
      0,
    );
    const todayDebt = (todayTotals ?? []).reduce(
      (a, r: Record<string, number>) => a + Number(r.debt_uzs ?? 0),
      0,
    );

    return {
      totals: {
        qty_in_stock: totalQty,
        stock_value_uzs: totalValue,
        today_revenue_uzs: todayRevenue,
        today_debt_uzs: todayDebt,
        low_stock_count: lowCount,
        expiring_count: (expiring ?? []).length,
      },
      low_stock: lowStock ?? [],
      expiring: expiring ?? [],
    };
  }

  async searchMedications(clinicId: string, q?: string) {
    const admin = this.supabase.admin();
    let qb = admin
      .from('medication_stock_summary')
      .select('medication_id, name, form, price_uzs, qty_in_stock, reorder_level')
      .eq('clinic_id', clinicId)
      .order('name')
      .limit(40);
    if (q && q.trim().length > 0) qb = qb.ilike('name', `%${q.trim()}%`);
    const { data, error } = await qb;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async sell(clinicId: string, userId: string, input: z.infer<typeof SaleSchema>) {
    const admin = this.supabase.admin();

    // Atomar sotuv: FIFO + sale + items + stock harakatlari + mijoz qarzi —
    // bitta tranzaksiyada (pharmacy_sell RPC). Qoldiq yetmasa RAISE → to'liq
    // rollback (eski sell() yarim-sotuv bug'i yo'q).
    const items = input.items.map((i) => ({
      medication_id: i.medication_id,
      quantity: i.quantity,
      unit_price_override: i.unit_price_override_uzs ?? null,
    }));
    const { data: saleIdData, error: sellErr } = await admin.rpc('pharmacy_sell' as never, {
      p_clinic_id: clinicId,
      p_user_id: userId,
      p_pharmacy_clinic_id: input.pharmacy_clinic_id ?? null,
      p_pharmacy_doctor_id: input.pharmacy_doctor_id ?? null,
      p_payment_method: input.payment_method,
      p_items: items,
      p_discount_uzs: input.discount_uzs ?? 0,
      p_paid_uzs: input.paid_uzs ?? 0,
      p_debt_uzs: input.debt_uzs ?? 0,
      p_notes: input.notes ?? null,
      p_shift_id: input.shift_id ?? null,
    } as never);
    if (sellErr) throw new BadRequestException(sellErr.message);
    const saleId = saleIdData as unknown as string;

    // Retsept bo'yicha berilgan miqdorni yangilash (agar retseptdan sotilsa)
    if (input.prescription_id) {
      for (const it of input.items) {
        const { data: matchedItems } = await admin
          .from('prescription_items')
          .select('id, dispensed_qty, quantity')
          .eq('clinic_id', clinicId)
          .eq('prescription_id', input.prescription_id)
          .eq('medication_id', it.medication_id);
        const matched = (matchedItems as Array<{ id: string; dispensed_qty: number; quantity: number }> | null) ?? [];
        if (matched.length > 0 && matched[0]) {
          const row = matched[0];
          const newQty = Math.min(row.quantity, row.dispensed_qty + it.quantity);
          await admin.from('prescription_items').update({ dispensed_qty: newQty }).eq('id', row.id);
        }
      }
      const { data: rxItems } = await admin
        .from('prescription_items')
        .select('quantity, dispensed_qty')
        .eq('prescription_id', input.prescription_id);
      const rx = (rxItems as Array<{ quantity: number; dispensed_qty: number }> | null) ?? [];
      const allDone = rx.length > 0 && rx.every((x) => x.dispensed_qty >= x.quantity);
      const someDone = rx.some((x) => x.dispensed_qty > 0);
      await admin
        .from('prescriptions')
        .update({ status: allDone ? 'dispensed' : someDone ? 'partially_dispensed' : 'issued' })
        .eq('clinic_id', clinicId)
        .eq('id', input.prescription_id);
    }

    return this.getSale(clinicId, saleId);
  }

  async getSale(clinicId: string, id: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_sales')
      .select('*, items:pharmacy_sale_items(*), patient:patients(id, full_name)')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async listSales(
    clinicId: string,
    params: { from?: string; to?: string; patientId?: string; limit?: number } = {},
  ) {
    const admin = this.supabase.admin();
    let q = admin
      .from('pharmacy_sales')
      .select('*, items:pharmacy_sale_items(*), patient:patients(id, full_name)')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(params.limit ?? 100);
    if (params.from) q = q.gte('created_at', params.from);
    if (params.to) q = q.lte('created_at', params.to);
    if (params.patientId) q = q.eq('patient_id', params.patientId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // Savdo tarixi + filtr (sana/klinika/shifokor) + agregat (daromad/foyda/dori soni)
  async salesReport(
    clinicId: string,
    params: { from?: string; to?: string; pharmacy_clinic_id?: string; pharmacy_doctor_id?: string } = {},
  ) {
    const admin = this.supabase.admin();
    let q = admin
      .from('pharmacy_sales')
      .select('id, created_at, total_uzs, paid_uzs, debt_uzs, payment_method, pharmacy_clinic_id, pharmacy_doctor_id, items:pharmacy_sale_items(quantity, profit_uzs, doctor_share_uzs)')
      .eq('clinic_id', clinicId)
      .eq('is_void', false)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (params.from) q = q.gte('created_at', params.from);
    if (params.to) q = q.lte('created_at', params.to);
    if (params.pharmacy_clinic_id) q = q.eq('pharmacy_clinic_id', params.pharmacy_clinic_id);
    if (params.pharmacy_doctor_id) q = q.eq('pharmacy_doctor_id', params.pharmacy_doctor_id);

    const [salesRes, { data: clinics }, { data: doctors }] = await Promise.all([
      q,
      admin.from('pharmacy_clinics').select('id, name').eq('clinic_id', clinicId),
      admin.from('pharmacy_clinic_doctors').select('id, full_name').eq('clinic_id', clinicId),
    ]);
    if (salesRes.error) throw new BadRequestException(salesRes.error.message);
    const clinicName = new Map((clinics ?? []).map((c) => [(c as { id: string }).id, (c as { name: string }).name]));
    const doctorName = new Map((doctors ?? []).map((d) => [(d as { id: string }).id, (d as { full_name: string }).full_name]));

    const rows = (salesRes.data ?? []) as Array<{
      id: string; created_at: string; total_uzs: number; paid_uzs: number; debt_uzs: number;
      payment_method: string; pharmacy_clinic_id: string | null; pharmacy_doctor_id: string | null;
      items: Array<{ quantity: number; profit_uzs: number; doctor_share_uzs: number }> | null;
    }>;

    let revenue = 0, qty = 0, profit = 0, doctorShare = 0;
    const byDoctor = new Map<string, { doctor_id: string | null; doctor_name: string; revenue: number; qty: number; profit: number; doctor_share: number; sales_count: number }>();

    const sales = rows.map((s) => {
      const its = s.items ?? [];
      const sQty = its.reduce((a, i) => a + Number(i.quantity), 0);
      const sProfit = its.reduce((a, i) => a + Number(i.profit_uzs), 0);
      const sShare = its.reduce((a, i) => a + Number(i.doctor_share_uzs), 0);
      const sRevenue = Number(s.total_uzs);
      revenue += sRevenue; qty += sQty; profit += sProfit; doctorShare += sShare;

      const dkey = s.pharmacy_doctor_id ?? 'none';
      const cur = byDoctor.get(dkey) ?? {
        doctor_id: s.pharmacy_doctor_id,
        doctor_name: s.pharmacy_doctor_id ? (doctorName.get(s.pharmacy_doctor_id) ?? '—') : 'Shifokorsiz',
        revenue: 0, qty: 0, profit: 0, doctor_share: 0, sales_count: 0,
      };
      cur.revenue += sRevenue; cur.qty += sQty; cur.profit += sProfit; cur.doctor_share += sShare; cur.sales_count += 1;
      byDoctor.set(dkey, cur);

      return {
        id: s.id,
        created_at: s.created_at,
        total_uzs: sRevenue,
        paid_uzs: Number(s.paid_uzs),
        debt_uzs: Number(s.debt_uzs),
        payment_method: s.payment_method,
        clinic_name: s.pharmacy_clinic_id ? (clinicName.get(s.pharmacy_clinic_id) ?? '—') : null,
        doctor_name: s.pharmacy_doctor_id ? (doctorName.get(s.pharmacy_doctor_id) ?? '—') : null,
        items_count: its.length,
        qty: sQty,
      };
    });

    return {
      totals: { revenue, qty, profit, doctor_share: doctorShare, sales_count: rows.length },
      by_doctor: Array.from(byDoctor.values()).sort((a, b) => b.revenue - a.revenue),
      sales,
    };
  }

  async findByBarcode(clinicId: string, barcode: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('medications')
      .select('id, name, form, price_uzs, stock, barcode, image_url')
      .eq('clinic_id', clinicId)
      .eq('barcode', barcode)
      .eq('is_archived', false)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Barcode bo\'yicha dori topilmadi');
    return data;
  }

  async importCsv(
    clinicId: string,
    userId: string,
    rows: Array<{
      name: string;
      barcode?: string;
      manufacturer?: string;
      strength?: string;
      form?: string;
      price_uzs: number;
      cost_uzs?: number;
      reorder_level?: number;
    }>,
  ) {
    const admin = this.supabase.admin();
    let inserted = 0;
    let updated = 0;
    const errors: Array<{ row: number; message: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      if (!r.name || !r.price_uzs) {
        errors.push({ row: i + 1, message: 'name va price_uzs majburiy' });
        continue;
      }
      try {
        if (r.barcode) {
          const { data: existing } = await admin
            .from('medications')
            .select('id')
            .eq('clinic_id', clinicId)
            .eq('barcode', r.barcode)
            .maybeSingle();
          if (existing) {
            await admin
              .from('medications')
              .update({
                name: r.name,
                manufacturer: r.manufacturer ?? null,
                strength: r.strength ?? null,
                form: r.form ?? null,
                price_uzs: r.price_uzs,
                cost_uzs: r.cost_uzs ?? null,
                reorder_level: r.reorder_level ?? null,
                updated_by: userId,
              })
              .eq('id', (existing as { id: string }).id);
            updated++;
            continue;
          }
        }
        await admin.from('medications').insert({
          clinic_id: clinicId,
          name: r.name,
          barcode: r.barcode ?? null,
          manufacturer: r.manufacturer ?? null,
          strength: r.strength ?? null,
          form: r.form ?? null,
          price_uzs: r.price_uzs,
          cost_uzs: r.cost_uzs ?? null,
          reorder_level: r.reorder_level ?? null,
          stock: 0,
          created_by: userId,
        });
        inserted++;
      } catch (err) {
        errors.push({ row: i + 1, message: (err as Error).message });
      }
    }
    return { inserted, updated, errors };
  }

  async prescriptionsReadyToDispense(clinicId: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('prescriptions')
      .select(
        '*, patient:patients(id, full_name, phone), doctor:profiles!doctor_id(id, full_name), items:prescription_items(id, medication_id, medication_name_snapshot, dosage, quantity, dispensed_qty, unit_price_snapshot)',
      )
      .eq('clinic_id', clinicId)
      .eq('dispense_at_pharmacy', true)
      .in('status', ['issued', 'partially_dispensed'])
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async receipt(clinicId: string, userId: string, input: z.infer<typeof ReceiptSchema>) {
    const admin = this.supabase.admin();
    const total = input.items.reduce((a, i) => a + i.unit_cost_uzs * i.quantity, 0);
    const paid = Math.min(Number(input.paid_uzs ?? 0), total);
    const paymentStatus = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

    const { data: receipt, error } = await admin
      .from('pharmacy_receipts')
      .insert({
        clinic_id: clinicId,
        supplier_id: input.supplier_id ?? null,
        receipt_no: input.receipt_no ?? null,
        received_at: input.received_at ?? new Date().toISOString(),
        total_cost_uzs: total,
        paid_uzs: paid,
        payment_status: paymentStatus,
        notes: input.notes ?? null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    const receiptId = (receipt as { id: string }).id;

    for (const it of input.items) {
      // Sotuv narxi: bevosita yuborilsa undan, aks holda tannarx * (1 + foyda%/100)
      const salePrice =
        it.unit_price_uzs ??
        Math.round(it.unit_cost_uzs * (1 + Number(it.profit_percent ?? 0) / 100));

      const { data: batch } = await admin
        .from('medication_batches')
        .insert({
          clinic_id: clinicId,
          medication_id: it.medication_id,
          supplier_id: input.supplier_id ?? null,
          batch_no: it.batch_no ?? null,
          expiry_date: it.expiry_date ?? null,
          manufacture_date: it.manufacture_date ?? null,
          manufacturer: it.manufacturer ?? null,
          unit_cost_uzs: it.unit_cost_uzs,
          unit_price_uzs: salePrice,
          profit_percent: Number(it.profit_percent ?? 0),
          doctor_share_percent: Number(it.doctor_share_percent ?? 0),
          doctor_share_bonus_uzs: Number(it.doctor_share_bonus_uzs ?? 0),
          received_at: input.received_at ?? new Date().toISOString(),
          qty_received: it.quantity,
          qty_remaining: it.quantity,
          receipt_id: receiptId,
          created_by: userId,
        })
        .select('id')
        .single();

      // Dorining joriy sotuv narxini (va ishlab chiqaruvchini) eng so'nggi partiyaga moslaymiz —
      // qidiruv/POS shu narxni ko'rsatadi.
      await admin
        .from('medications')
        .update({
          price_uzs: salePrice,
          ...(it.manufacturer ? { manufacturer: it.manufacturer } : {}),
          updated_by: userId,
        })
        .eq('clinic_id', clinicId)
        .eq('id', it.medication_id);

      await admin.from('pharmacy_receipt_items').insert({
        clinic_id: clinicId,
        receipt_id: receiptId,
        medication_id: it.medication_id,
        batch_id: (batch as { id: string } | null)?.id ?? null,
        quantity: it.quantity,
        unit_cost_uzs: it.unit_cost_uzs,
        total_cost_uzs: it.quantity * it.unit_cost_uzs,
        batch_no: it.batch_no ?? null,
        expiry_date: it.expiry_date ?? null,
      });

      // Update med aggregate stock
      await admin.rpc('increment_medication_stock' as never, {
        p_medication: it.medication_id,
        p_qty: it.quantity,
      } as never).then(
        () => undefined,
        async () => {
          const { data: cur } = await admin
            .from('medications')
            .select('stock')
            .eq('id', it.medication_id)
            .single();
          const current = Number((cur as { stock: number } | null)?.stock ?? 0);
          await admin
            .from('medications')
            .update({ stock: current + it.quantity })
            .eq('id', it.medication_id);
        },
      );

      await admin.from('pharmacy_stock_movements').insert({
        clinic_id: clinicId,
        medication_id: it.medication_id,
        kind: 'in',
        quantity: it.quantity,
        unit_cost_uzs: it.unit_cost_uzs,
        supplier_id: input.supplier_id ?? null,
        batch_no: it.batch_no ?? null,
        expiry_date: it.expiry_date ?? null,
        performed_by: userId,
      });
    }

    // Yetkazib beruvchi oldi-berdi daftari: prixot = 'purchase' (+total),
    // prixotda to'langan bo'lsa 'payment' (−paid). Balans shu daftardan o'qiladi.
    if (input.supplier_id) {
      const occurred = (input.received_at ?? new Date().toISOString()).slice(0, 10);
      const entries: Record<string, unknown>[] = [
        {
          clinic_id: clinicId,
          supplier_id: input.supplier_id,
          entry_kind: 'purchase',
          amount_uzs: total,
          invoice_no: input.receipt_no ?? null,
          receipt_id: receiptId,
          occurred_at: occurred,
          notes: 'Prixot (kirim)',
          created_by: userId,
        },
      ];
      if (paid > 0) {
        entries.push({
          clinic_id: clinicId,
          supplier_id: input.supplier_id,
          entry_kind: 'payment',
          amount_uzs: -paid,
          payment_method: input.payment_method ?? null,
          invoice_no: input.receipt_no ?? null,
          receipt_id: receiptId,
          occurred_at: occurred,
          notes: 'Prixotda to\'langan',
          created_by: userId,
        });
      }
      await admin.from('pharmacy_supplier_ledger').insert(entries as never);
    }
    return receipt;
  }

  // ----- Mijoz-klinikalar (B2B) ----------------------------------------------
  async listClinics(clinicId: string) {
    const admin = this.supabase.admin();
    const [{ data: clinics }, { data: doctors }, { data: ledger }] = await Promise.all([
      admin.from('pharmacy_clinics').select('*').eq('clinic_id', clinicId).eq('is_archived', false).order('name'),
      admin.from('pharmacy_clinic_doctors').select('id, pharmacy_clinic_id, full_name, phone').eq('clinic_id', clinicId).eq('is_archived', false).order('full_name'),
      admin.from('pharmacy_clinic_ledger').select('pharmacy_clinic_id, amount_uzs').eq('clinic_id', clinicId),
    ]);
    const docMap = new Map<string, Array<{ id: string; full_name: string; phone: string | null }>>();
    for (const d of (doctors ?? []) as Array<{ id: string; pharmacy_clinic_id: string; full_name: string; phone: string | null }>) {
      const arr = docMap.get(d.pharmacy_clinic_id) ?? [];
      arr.push({ id: d.id, full_name: d.full_name, phone: d.phone });
      docMap.set(d.pharmacy_clinic_id, arr);
    }
    const balMap = new Map<string, number>();
    for (const l of (ledger ?? []) as Array<{ pharmacy_clinic_id: string; amount_uzs: number }>) {
      balMap.set(l.pharmacy_clinic_id, (balMap.get(l.pharmacy_clinic_id) ?? 0) + Number(l.amount_uzs));
    }
    // debt_uzs > 0 => mijoz bizga qarzdor (ledger balansi manfiy)
    return ((clinics ?? []) as Array<{ id: string }>).map((c) => ({
      ...c,
      doctors: docMap.get(c.id) ?? [],
      debt_uzs: -(balMap.get(c.id) ?? 0),
    }));
  }

  async createClinic(clinicId: string, userId: string, input: z.infer<typeof PharmClinicSchema>) {
    const { data, error } = await this.supabase.admin().from('pharmacy_clinics')
      .insert({ clinic_id: clinicId, ...input, created_by: userId }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateClinic(clinicId: string, id: string, userId: string, input: Partial<z.infer<typeof PharmClinicSchema>>) {
    const patch: Record<string, unknown> = { updated_by: userId, updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(input)) if (v !== undefined) patch[k] = v;
    const { data, error } = await this.supabase.admin().from('pharmacy_clinics')
      .update(patch).eq('clinic_id', clinicId).eq('id', id).select().single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async archiveClinic(clinicId: string, id: string) {
    await this.supabase.admin().from('pharmacy_clinics').update({ is_archived: true }).eq('clinic_id', clinicId).eq('id', id);
    return { ok: true };
  }

  async addClinicDoctor(clinicId: string, pharmacyClinicId: string, userId: string, input: z.infer<typeof PharmDoctorSchema>) {
    const { data, error } = await this.supabase.admin().from('pharmacy_clinic_doctors')
      .insert({ clinic_id: clinicId, pharmacy_clinic_id: pharmacyClinicId, full_name: input.full_name, phone: input.phone ?? null, created_by: userId })
      .select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async archiveClinicDoctor(clinicId: string, id: string) {
    await this.supabase.admin().from('pharmacy_clinic_doctors').update({ is_archived: true }).eq('clinic_id', clinicId).eq('id', id);
    return { ok: true };
  }

  async clinicLedger(clinicId: string, pharmacyClinicId: string) {
    const { data, error } = await this.supabase.admin().from('pharmacy_clinic_ledger')
      .select('*').eq('clinic_id', clinicId).eq('pharmacy_clinic_id', pharmacyClinicId)
      .order('created_at', { ascending: false }).limit(500);
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Array<{ amount_uzs: number }>;
    const balance = rows.reduce((a, r) => a + Number(r.amount_uzs), 0);
    return { entries: rows, debt_uzs: -balance };
  }

  async payClinicDebt(clinicId: string, userId: string, pharmacyClinicId: string, input: z.infer<typeof ClinicPaymentSchema>) {
    const { data, error } = await this.supabase.admin().from('pharmacy_clinic_ledger')
      .insert({
        clinic_id: clinicId, pharmacy_clinic_id: pharmacyClinicId,
        entry_kind: 'payment', amount_uzs: Math.abs(input.amount_uzs),
        payment_method: input.payment_method ?? 'cash',
        description: input.notes ?? 'Qarz to\'lovi', created_by: userId,
      }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ----- Sotuvni bekor qilish (otkaz/vozvrat) --------------------------------
  async voidSale(clinicId: string, userId: string, saleId: string, input: z.infer<typeof VoidSaleSchema>) {
    const { error } = await this.supabase.admin().rpc('pharmacy_void_sale' as never, {
      p_clinic_id: clinicId,
      p_user_id: userId,
      p_sale_id: saleId,
      p_reason: input.reason ?? null,
    } as never);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ----- Dashboard moliya + qarzlar ------------------------------------------
  async financeSummary(clinicId: string) {
    const admin = this.supabase.admin();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthIso = monthStart.toISOString();

    const [salesRes, receiptsRes, supLedgerRes, ledgerRes, clinicsRes, suppliersRes] = await Promise.all([
      admin.from('pharmacy_sales').select('total_uzs, items:pharmacy_sale_items(profit_uzs)').eq('clinic_id', clinicId).eq('is_void', false).gte('created_at', monthIso),
      admin.from('pharmacy_receipts').select('total_cost_uzs, created_at').eq('clinic_id', clinicId),
      admin.from('pharmacy_supplier_ledger').select('supplier_id, amount_uzs').eq('clinic_id', clinicId),
      admin.from('pharmacy_clinic_ledger').select('pharmacy_clinic_id, amount_uzs').eq('clinic_id', clinicId),
      admin.from('pharmacy_clinics').select('id, name').eq('clinic_id', clinicId).eq('is_archived', false),
      admin.from('suppliers').select('id, name').eq('clinic_id', clinicId),
    ]);

    let monthRevenue = 0, monthProfit = 0;
    for (const s of (salesRes.data ?? []) as Array<{ total_uzs: number; items: Array<{ profit_uzs: number }> | null }>) {
      monthRevenue += Number(s.total_uzs);
      for (const i of s.items ?? []) monthProfit += Number(i.profit_uzs);
    }

    let monthPurchases = 0;
    for (const r of (receiptsRes.data ?? []) as Array<{ total_cost_uzs: number; created_at: string }>) {
      if (new Date(r.created_at) >= monthStart) monthPurchases += Number(r.total_cost_uzs);
    }

    // Yetkazib beruvchi qarzi = oldi-berdi daftaridagi balans (Σ amount_uzs > 0 = biz qarzdormiz)
    const supplierName = new Map((suppliersRes.data ?? []).map((s) => [(s as { id: string }).id, (s as { name: string }).name]));
    const supBal = new Map<string, number>();
    for (const l of (supLedgerRes.data ?? []) as Array<{ supplier_id: string; amount_uzs: number }>) {
      supBal.set(l.supplier_id, (supBal.get(l.supplier_id) ?? 0) + Number(l.amount_uzs));
    }
    const supplierDebts = Array.from(supBal.entries())
      .map(([id, bal]) => ({ supplier_id: id, name: supplierName.get(id) ?? '—', debt_uzs: bal }))
      .filter((x) => x.debt_uzs > 0)
      .sort((a, b) => b.debt_uzs - a.debt_uzs);
    const supplierDebtTotal = supplierDebts.reduce((a, c) => a + c.debt_uzs, 0);

    const clinicName = new Map((clinicsRes.data ?? []).map((c) => [(c as { id: string }).id, (c as { name: string }).name]));
    const cliBal = new Map<string, number>();
    for (const l of (ledgerRes.data ?? []) as Array<{ pharmacy_clinic_id: string; amount_uzs: number }>) {
      cliBal.set(l.pharmacy_clinic_id, (cliBal.get(l.pharmacy_clinic_id) ?? 0) + Number(l.amount_uzs));
    }
    const customerDebts = Array.from(cliBal.entries())
      .map(([id, bal]) => ({ pharmacy_clinic_id: id, name: clinicName.get(id) ?? '—', debt_uzs: -bal }))
      .filter((x) => x.debt_uzs > 0)
      .sort((a, b) => b.debt_uzs - a.debt_uzs);
    const customerDebtTotal = customerDebts.reduce((a, c) => a + c.debt_uzs, 0);

    return {
      month_revenue: monthRevenue,
      month_profit: monthProfit,
      month_purchases: monthPurchases,
      supplier_debt_total: supplierDebtTotal,
      customer_debt_total: customerDebtTotal,
      supplier_debts: supplierDebts,
      customer_debts: customerDebts,
    };
  }

  async paySupplier(clinicId: string, userId: string, input: z.infer<typeof SupplierPaymentSchema>) {
    // Tezkor to'lov (dashboard) — oldi-berdi daftariga 'payment' yozuvi qo'shadi.
    const amt = Math.abs(input.amount_uzs);
    const { error } = await this.supabase.admin().from('pharmacy_supplier_ledger').insert({
      clinic_id: clinicId,
      supplier_id: input.supplier_id,
      entry_kind: 'payment',
      amount_uzs: -amt,
      payment_method: input.payment_method ?? null,
      occurred_at: new Date().toISOString().slice(0, 10),
      notes: input.notes ?? 'Yetkazib beruvchiga to\'lov',
      created_by: userId,
    } as never);
    if (error) throw new BadRequestException(error.message);
    return { ok: true, applied: amt };
  }

  // ----- Yetkazib beruvchi firmalar + oldi-berdi (ledger) --------------------
  async listSuppliers(clinicId: string) {
    const admin = this.supabase.admin();
    const [{ data: sups, error }, { data: ledger }] = await Promise.all([
      admin.from('suppliers').select('id, name, contact_person, phone, address')
        .eq('clinic_id', clinicId).eq('is_archived', false).order('name'),
      admin.from('pharmacy_supplier_ledger').select('supplier_id, amount_uzs').eq('clinic_id', clinicId),
    ]);
    if (error) throw new BadRequestException(error.message);
    const bal = new Map<string, number>();
    for (const l of (ledger ?? []) as Array<{ supplier_id: string; amount_uzs: number }>) {
      bal.set(l.supplier_id, (bal.get(l.supplier_id) ?? 0) + Number(l.amount_uzs));
    }
    return ((sups ?? []) as Array<{ id: string }>).map((s) => ({ ...s, debt_uzs: bal.get(s.id) ?? 0 }));
  }

  async createSupplier(clinicId: string, userId: string, input: z.infer<typeof SupplierSchema>) {
    const { data, error } = await this.supabase.admin().from('suppliers')
      .insert({ clinic_id: clinicId, ...input, created_by: userId, updated_by: userId })
      .select('id, name, contact_person, phone, address').single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateSupplier(clinicId: string, id: string, userId: string, input: z.infer<typeof SupplierUpdateSchema>) {
    const patch: Record<string, unknown> = { updated_by: userId };
    for (const [k, v] of Object.entries(input)) if (v !== undefined) patch[k] = v;
    const { data, error } = await this.supabase.admin().from('suppliers')
      .update(patch).eq('clinic_id', clinicId).eq('id', id)
      .select('id, name, contact_person, phone, address').single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async archiveSupplier(clinicId: string, id: string, userId: string) {
    const { error } = await this.supabase.admin().from('suppliers')
      .update({ is_archived: true, updated_by: userId }).eq('clinic_id', clinicId).eq('id', id);
    if (error) throw new NotFoundException(error.message);
    return { ok: true };
  }

  async supplierLedger(clinicId: string, supplierId: string, opts: { from?: string; to?: string; q?: string }) {
    const admin = this.supabase.admin();
    // Balans — butun tarix bo'yicha (filtrdan qat'i nazar)
    const { data: allRows } = await admin.from('pharmacy_supplier_ledger')
      .select('amount_uzs').eq('clinic_id', clinicId).eq('supplier_id', supplierId);
    const balance = ((allRows ?? []) as Array<{ amount_uzs: number }>).reduce((a, r) => a + Number(r.amount_uzs), 0);

    let q = admin.from('pharmacy_supplier_ledger')
      .select('id, entry_kind, amount_uzs, payment_method, invoice_no, receipt_id, occurred_at, notes, created_at')
      .eq('clinic_id', clinicId).eq('supplier_id', supplierId)
      .order('occurred_at', { ascending: false }).order('created_at', { ascending: false });
    if (opts.from) q = q.gte('occurred_at', opts.from);
    if (opts.to) q = q.lte('occurred_at', opts.to);
    if (opts.q && opts.q.trim()) q = q.ilike('invoice_no', `%${opts.q.trim()}%`);
    const { data: entries, error } = await q.limit(500);
    if (error) throw new BadRequestException(error.message);
    return { balance, entries: entries ?? [] };
  }

  async addSupplierEntry(clinicId: string, userId: string, supplierId: string, input: z.infer<typeof SupplierEntrySchema>) {
    // Ishora: payment = − (pul berdim), debt = + (qarz), adjustment = berilgan ishora
    const mag = Math.abs(input.amount_uzs);
    const signed = input.entry_kind === 'payment' ? -mag
      : input.entry_kind === 'debt' ? mag
      : input.amount_uzs;
    const { data, error } = await this.supabase.admin().from('pharmacy_supplier_ledger').insert({
      clinic_id: clinicId,
      supplier_id: supplierId,
      entry_kind: input.entry_kind,
      amount_uzs: signed,
      payment_method: input.payment_method ?? null,
      invoice_no: input.invoice_no ?? null,
      occurred_at: input.occurred_at ?? new Date().toISOString().slice(0, 10),
      notes: input.notes ?? null,
      created_by: userId,
    } as never).select('id').single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ----- Dorilar (to'liq boshqaruv — dorixona oynasida) ----------------------
  async listMedicationsFull(clinicId: string, q?: string) {
    const admin = this.supabase.admin();
    let mq = admin
      .from('medications')
      .select('id, name, category_id, manufacturer, strength, form, barcode, price_uzs, cost_uzs, reorder_level, requires_prescription, image_url')
      .eq('clinic_id', clinicId)
      .eq('is_archived', false)
      .order('name')
      .limit(1000);
    if (q && q.trim()) mq = mq.ilike('name', `%${q.trim()}%`);
    const [{ data: meds, error }, { data: stock }, { data: cats }] = await Promise.all([
      mq,
      admin.from('medication_stock_summary').select('medication_id, qty_in_stock, earliest_expiry').eq('clinic_id', clinicId),
      admin.from('medication_categories').select('id, name_i18n').eq('clinic_id', clinicId),
    ]);
    if (error) throw new BadRequestException(error.message);
    const stockMap = new Map((stock ?? []).map((s) => [(s as { medication_id: string }).medication_id, s as { qty_in_stock: number; earliest_expiry: string | null }]));
    const catName = (n: Record<string, string> | null) => (n ? (n['uz-Latn'] ?? Object.values(n)[0] ?? null) : null);
    const catMap = new Map((cats ?? []).map((c) => [(c as { id: string }).id, catName((c as { name_i18n: Record<string, string> | null }).name_i18n)]));
    return ((meds ?? []) as Array<{ id: string; category_id: string | null }>).map((m) => ({
      ...m,
      qty_in_stock: Number(stockMap.get(m.id)?.qty_in_stock ?? 0),
      earliest_expiry: stockMap.get(m.id)?.earliest_expiry ?? null,
      category_name: m.category_id ? (catMap.get(m.category_id) ?? null) : null,
    }));
  }

  async createMedication(clinicId: string, userId: string, input: z.infer<typeof MedicationSchema>) {
    const { data, error } = await this.supabase.admin().from('medications')
      .insert({ clinic_id: clinicId, ...input, stock: 0, created_by: userId })
      .select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateMedication(clinicId: string, id: string, userId: string, input: z.infer<typeof MedicationUpdateSchema>) {
    const patch: Record<string, unknown> = { updated_by: userId };
    for (const [k, v] of Object.entries(input)) if (v !== undefined) patch[k] = v;
    const { data, error } = await this.supabase.admin().from('medications')
      .update(patch).eq('clinic_id', clinicId).eq('id', id).select().single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async archiveMedication(clinicId: string, id: string) {
    await this.supabase.admin().from('medications').update({ is_archived: true }).eq('clinic_id', clinicId).eq('id', id);
    return { ok: true };
  }

  async listMedCategories(clinicId: string) {
    const { data } = await this.supabase.admin()
      .from('medication_categories').select('id, name_i18n').eq('clinic_id', clinicId).order('created_at');
    return ((data ?? []) as Array<{ id: string; name_i18n: Record<string, string> | null }>).map((c) => ({
      id: c.id,
      name: c.name_i18n ? (c.name_i18n['uz-Latn'] ?? Object.values(c.name_i18n)[0] ?? '') : '',
    }));
  }

  async createMedCategory(clinicId: string, userId: string, input: z.infer<typeof MedCategorySchema>) {
    const { data, error } = await this.supabase.admin().from('medication_categories')
      .insert({ clinic_id: clinicId, name_i18n: { 'uz-Latn': input.name }, created_by: userId })
      .select('id, name_i18n').single();
    if (error) throw new BadRequestException(error.message);
    return { id: (data as { id: string }).id, name: input.name };
  }
}

@ApiTags('pharmacy')
@Controller({ path: 'pharmacy', version: '1' })
class PharmacyController {
  constructor(private readonly svc: PharmacyService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.dashboard(u.clinicId);
  }

  @Get('medications/search')
  search(@CurrentUser() u: { clinicId: string | null }, @Query('q') q?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.searchMedications(u.clinicId, q);
  }

  @Get('medications/barcode/:code')
  findByBarcode(
    @CurrentUser() u: { clinicId: string | null },
    @Param('code') code: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.findByBarcode(u.clinicId, code);
  }

  @Post('medications/import-csv')
  importCsv(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: { rows: unknown[] },
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    const ImportRowSchema = z.object({
      name: z.string().min(1),
      barcode: z.string().optional(),
      manufacturer: z.string().optional(),
      strength: z.string().optional(),
      form: z.string().optional(),
      price_uzs: z.number().int().nonnegative(),
      cost_uzs: z.number().int().nonnegative().optional(),
      reorder_level: z.number().int().nonnegative().optional(),
    });
    const rows = z.array(ImportRowSchema).parse(body.rows ?? []);
    return this.svc.importCsv(u.clinicId, u.userId, rows);
  }

  @Get('sales')
  listSales(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('patient_id') patientId?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listSales(u.clinicId, { from, to, patientId });
  }

  @Get('sales-report')
  salesReport(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('pharmacy_clinic_id') pharmacyClinicId?: string,
    @Query('pharmacy_doctor_id') pharmacyDoctorId?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    // Frontend ba'zan bo'sh filtrni "undefined" satr sifatida yuboradi —
    // uuid xatosi bermasligi uchun tozalaymiz.
    const clean = (v?: string) => (v && v !== 'undefined' && v !== 'null' ? v : undefined);
    return this.svc.salesReport(u.clinicId, {
      from,
      to,
      pharmacy_clinic_id: clean(pharmacyClinicId),
      pharmacy_doctor_id: clean(pharmacyDoctorId),
    });
  }

  @Get('sales/:id')
  getSale(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getSale(u.clinicId, id);
  }

  @Post('sales')
  @Audit({ action: 'pharmacy.sale_completed', resourceType: 'pharmacy_sales' })
  createSale(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.sell(u.clinicId, u.userId, SaleSchema.parse(body));
  }

  @Get('prescriptions/pending')
  prescriptionsPending(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.prescriptionsReadyToDispense(u.clinicId);
  }

  @Post('receipts')
  @Audit({ action: 'pharmacy.goods_received', resourceType: 'pharmacy_receipts' })
  createReceipt(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.receipt(u.clinicId, u.userId, ReceiptSchema.parse(body));
  }

  // ----- Mijoz-klinikalar (B2B) ----------------------------------------------
  @Get('clinics')
  listClinics(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listClinics(u.clinicId);
  }

  @Post('clinics')
  @Audit({ action: 'pharmacy.clinic_created', resourceType: 'pharmacy_clinics' })
  createClinic(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createClinic(u.clinicId, u.userId, PharmClinicSchema.parse(body));
  }

  @Patch('clinics/:id')
  updateClinic(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.updateClinic(u.clinicId, id, u.userId, PharmClinicSchema.partial().parse(body));
  }

  @Delete('clinics/:id')
  archiveClinic(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.archiveClinic(u.clinicId, id);
  }

  @Post('clinics/:id/doctors')
  addClinicDoctor(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.addClinicDoctor(u.clinicId, id, u.userId, PharmDoctorSchema.parse(body));
  }

  @Delete('doctors/:id')
  archiveClinicDoctor(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.archiveClinicDoctor(u.clinicId, id);
  }

  @Get('clinics/:id/ledger')
  clinicLedger(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.clinicLedger(u.clinicId, id);
  }

  @Post('clinics/:id/payment')
  @Audit({ action: 'pharmacy.clinic_payment', resourceType: 'pharmacy_clinic_ledger' })
  payClinicDebt(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.payClinicDebt(u.clinicId, u.userId, id, ClinicPaymentSchema.parse(body));
  }

  @Get('finance')
  finance(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.financeSummary(u.clinicId);
  }

  @Post('sales/:id/void')
  @Audit({ action: 'pharmacy.sale_voided', resourceType: 'pharmacy_sales' })
  voidSale(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.voidSale(u.clinicId, u.userId, id, VoidSaleSchema.parse(body));
  }

  @Post('supplier-payment')
  @Audit({ action: 'pharmacy.supplier_payment', resourceType: 'pharmacy_receipts' })
  paySupplier(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.paySupplier(u.clinicId, u.userId, SupplierPaymentSchema.parse(body));
  }

  // ----- Dorilar (to'liq boshqaruv) ------------------------------------------
  @Get('medications-full')
  listMedicationsFull(@CurrentUser() u: { clinicId: string | null }, @Query('q') q?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listMedicationsFull(u.clinicId, q);
  }

  @Post('medications')
  @Audit({ action: 'pharmacy.medication_created', resourceType: 'medications' })
  createMedication(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createMedication(u.clinicId, u.userId, MedicationSchema.parse(body));
  }

  @Patch('medications/:id')
  @Audit({ action: 'pharmacy.medication_updated', resourceType: 'medications' })
  updateMedication(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.updateMedication(u.clinicId, id, u.userId, MedicationUpdateSchema.parse(body));
  }

  @Delete('medications/:id')
  @Audit({ action: 'pharmacy.medication_archived', resourceType: 'medications' })
  archiveMedication(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.archiveMedication(u.clinicId, id);
  }

  @Get('medication-categories')
  listMedCategories(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listMedCategories(u.clinicId);
  }

  @Post('medication-categories')
  createMedCategory(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createMedCategory(u.clinicId, u.userId, MedCategorySchema.parse(body));
  }

  // ----- Yetkazib beruvchi firmalar + oldi-berdi -----------------------------
  @Get('suppliers')
  listSuppliers(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listSuppliers(u.clinicId);
  }

  @Post('suppliers')
  @Audit({ action: 'pharmacy.supplier_created', resourceType: 'suppliers' })
  createSupplier(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createSupplier(u.clinicId, u.userId, SupplierSchema.parse(body));
  }

  @Patch('suppliers/:id')
  @Audit({ action: 'pharmacy.supplier_updated', resourceType: 'suppliers' })
  updateSupplier(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.updateSupplier(u.clinicId, id, u.userId, SupplierUpdateSchema.parse(body));
  }

  @Delete('suppliers/:id')
  @Audit({ action: 'pharmacy.supplier_archived', resourceType: 'suppliers' })
  archiveSupplier(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.archiveSupplier(u.clinicId, id, u.userId);
  }

  @Get('suppliers/:id/ledger')
  supplierLedger(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.supplierLedger(u.clinicId, id, { from, to, q });
  }

  @Post('suppliers/:id/ledger')
  @Audit({ action: 'pharmacy.supplier_entry', resourceType: 'pharmacy_supplier_ledger' })
  addSupplierEntry(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.addSupplierEntry(u.clinicId, u.userId, id, SupplierEntrySchema.parse(body));
  }
}

@Module({
  controllers: [PharmacyController],
  providers: [PharmacyService, SupabaseService],
  exports: [PharmacyService],
})
export class PharmacyModule {}
