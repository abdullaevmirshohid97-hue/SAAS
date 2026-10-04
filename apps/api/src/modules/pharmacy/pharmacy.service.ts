import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import {
  barcodeLookupKeys,
  internalEan13,
  normalizeBarcode,
  parseScan,
  searchNorm,
} from '@clary/utils';

import { SupabaseService } from '../../common/services/supabase.service';
import { pharmacyWs } from './pharmacy-ctx';
import { PharmacyFiscalService } from './pharmacy-fiscal.service';
import { PharmacyShiftService } from './pharmacy-shift.service';
import {
  BulkMedicationSchema,
  ClinicPaymentSchema,
  DuplicateCheckSchema,
  ImportMatchSchema,
  ImportProfileSchema,
  MedCategorySchema,
  MedicationSchema,
  MedicationUpdateSchema,
  PharmClinicSchema,
  PharmDoctorSchema,
  ReceiptDraftSchema,
  SupplierEntrySchema,
  SupplierPaymentSchema,
  SupplierSchema,
  SupplierUpdateSchema,
  VoidSaleSchema,
  type ReceiptInput,
  type SaleInput,
} from './pharmacy.schemas';

const SUMMARY_COLS =
  'medication_id, name, form, strength, manufacturer, price_uzs, qty_in_stock, qty_sellable, ' +
  'reorder_level, barcode, pack_qty, blister_qty, unit_name, pack_price_uzs, blister_price_uzs, ' +
  'sell_by_unit, requires_prescription, earliest_sellable_expiry, mxik_code, vat_percent, generic_name';

@Injectable()
export class PharmacyService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly shifts: PharmacyShiftService,
    private readonly fiscal: PharmacyFiscalService,
  ) {}

  async dashboard(clinicId: string) {
    const admin = this.supabase.admin();
    const todayStr = new Date().toISOString().slice(0, 10);
    const soonStr = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    const [
      { data: stock },
      { data: lowStock },
      { data: expiring },
      { data: expired },
      { data: todayTotals },
    ] = await Promise.all([
      admin
        .from('medication_stock_summary')
        .select('qty_in_stock, stock_value_uzs')
        .eq('clinic_id', clinicId),
      admin
        .from('medication_stock_summary')
        .select('medication_id, name, qty_in_stock, reorder_level, pack_qty, unit_name')
        .eq('clinic_id', clinicId)
        .order('qty_in_stock', { ascending: true })
        .limit(20),
      admin
        .from('medication_batches')
        .select('id, medication:medications(name), batch_no, expiry_date, qty_remaining')
        .eq('clinic_id', clinicId)
        .gt('qty_remaining', 0)
        .gte('expiry_date', todayStr)
        .lte('expiry_date', soonStr)
        .order('expiry_date', { ascending: true })
        .limit(20),
      admin
        .from('medication_batches')
        .select('id, medication:medications(name), batch_no, expiry_date, qty_remaining')
        .eq('clinic_id', clinicId)
        .gt('qty_remaining', 0)
        .lt('expiry_date', todayStr)
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
    const lowCount = (
      (lowStock as Array<{ qty_in_stock: number; reorder_level: number | null }> | null) ?? []
    ).filter((r) => r.qty_in_stock <= (r.reorder_level ?? 10)).length;
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
        expired_count: (expired ?? []).length,
      },
      low_stock: lowStock ?? [],
      expiring: expiring ?? [],
      expired: expired ?? [],
    };
  }

  // Zaxirani yarashtirish — medications.stock ni partiyalar yig'indisiga tenglaydi.
  async reconcileStock(clinicId: string) {
    const { data, error } = await this.supabase
      .admin()
      .rpc('pharmacy_reconcile_stock' as never, { p_clinic: clinicId } as never);
    if (error) throw new BadRequestException(error.message);
    return { ok: true, updated: (data as unknown as number) ?? 0 };
  }

  /** Joriy dorixona kassasi smenasi (alohida dorixonada yoki kassa yoqilgan klinikada). */
  private async shiftContext(clinicId: string, registerNo?: number | null) {
    const required = await this.shifts.isKassaRequired(clinicId);
    if (!required) return { required: false, shiftId: null as string | null, registerNo: null };
    const reg = this.shifts.registerFor(registerNo ?? null);
    return {
      required: true,
      shiftId: await this.shifts.currentShiftId(clinicId, reg),
      registerNo: reg,
    };
  }

  // Sotuvdan qisman qaytarish — zaxira qaytadi, qarz/jami kamayadi, kassadan
  // naqd qaytgani dorixona kassasi harakati bo'lib yoziladi.
  async returnItems(
    clinicId: string,
    userId: string,
    saleId: string,
    items: Array<{ sale_item_id: string; qty: number }>,
    reason: string,
  ) {
    const sc = await this.shiftContext(clinicId);
    if (sc.required && !sc.shiftId) {
      throw new BadRequestException(
        'Kassa smenasi ochilmagan — qaytarish uchun avval smenani oching',
      );
    }
    const { data, error } = await this.supabase.admin().rpc(
      'pharmacy_return_items_v2' as never,
      {
        p_clinic: clinicId,
        p_user: userId,
        p_sale: saleId,
        p_items: items,
        p_reason: reason,
        p_shift: sc.shiftId,
        p_operator: pharmacyWs()?.operatorId ?? null,
      } as never,
    );
    if (error) throw new BadRequestException(error.message);
    const fiscal = await this.fiscal
      .enqueueRefund(clinicId, saleId, `refund:${Date.now()}`, items)
      .catch(() => null);
    return { ok: true, ...((data as Record<string, unknown>) ?? {}), fiscal };
  }

  async searchMedications(clinicId: string, q?: string) {
    const { data, error } = await this.supabase
      .admin()
      .rpc(
        'pharmacy_search_medications' as never,
        { p_clinic: clinicId, p_q: q ?? '', p_limit: 40 } as never,
      );
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const { cost_uzs: _c, search_text: _s, ...rest } = r;
      return rest;
    });
  }

  /**
   * POS uchun to'liq katalog (brauzerda qidiruv va skaner bir zumda ishlashi
   * uchun). Tannarx QAYTMAYDI. Shtrix-kodlar normallashgan holda.
   */
  async posCatalog(clinicId: string) {
    const admin = this.supabase.admin();
    const [{ data: meds, error }, { data: codes }] = await Promise.all([
      admin
        .from('medication_stock_summary')
        .select(SUMMARY_COLS + ', search_text, earliest_expiry')
        .eq('clinic_id', clinicId)
        .order('name')
        .limit(20_000),
      admin.from('medication_barcodes').select('medication_id, code').eq('clinic_id', clinicId),
    ]);
    if (error) throw new BadRequestException(error.message);
    const byMed = new Map<string, string[]>();
    for (const c of (codes ?? []) as Array<{ medication_id: string; code: string }>) {
      const arr = byMed.get(c.medication_id) ?? [];
      arr.push(c.code);
      byMed.set(c.medication_id, arr);
    }
    const items = (
      (meds ?? []) as unknown as Array<
        Record<string, unknown> & { medication_id: string; barcode: string | null }
      >
    ).map((m) => {
      const list = byMed.get(m.medication_id) ?? [];
      if (m.barcode) {
        const n = normalizeBarcode(m.barcode);
        if (n && !list.includes(n)) list.push(n);
      }
      return { ...m, barcodes: list };
    });
    return { items, generated_at: new Date().toISOString() };
  }

  /** Skanerdan kelgan kod: tahlil (GS1) + dori (bo'lsa). */
  async lookup(clinicId: string, code: string) {
    const parsed = parseScan(code);
    if (parsed.kind === 'clary-sale' || parsed.kind === 'url') return { parsed, medication: null };
    const keys = barcodeLookupKeys(code);
    const admin = this.supabase.admin();
    let medId: string | null = null;
    if (keys.length) {
      const { data } = await admin
        .from('medication_barcodes')
        .select('medication_id')
        .eq('clinic_id', clinicId)
        .in('code', keys)
        .limit(1);
      medId = ((data ?? []) as Array<{ medication_id: string }>)[0]?.medication_id ?? null;
      if (!medId) {
        const { data: legacy } = await admin
          .from('medications')
          .select('id')
          .eq('clinic_id', clinicId)
          .eq('is_archived', false)
          .in('barcode', [...keys, parsed.raw])
          .limit(1);
        medId = ((legacy ?? []) as Array<{ id: string }>)[0]?.id ?? null;
      }
    }
    if (!medId) return { parsed, medication: null };
    const { data: med } = await admin
      .from('medication_stock_summary')
      .select(SUMMARY_COLS)
      .eq('clinic_id', clinicId)
      .eq('medication_id', medId)
      .maybeSingle();
    return { parsed, medication: med ?? null };
  }

  /** Eski endpoint — skaner kodini (EAN/GS1) ham tushunadi. */
  async findByBarcode(clinicId: string, barcode: string) {
    const r = await this.lookup(clinicId, barcode);
    if (!r.medication) throw new NotFoundException("Barcode bo'yicha dori topilmadi");
    const m = r.medication as unknown as Record<string, unknown> & { medication_id: string };
    return {
      id: m.medication_id,
      name: m['name'],
      form: m['form'],
      price_uzs: m['price_uzs'],
      stock: m['qty_sellable'] ?? m['qty_in_stock'],
      barcode: m['barcode'],
      ...m,
    };
  }

  async sell(clinicId: string, userId: string, input: SaleInput) {
    const admin = this.supabase.admin();
    const ws = pharmacyWs();

    if (ws && (input.discount_uzs ?? 0) > 0 && !ws.canDiscount) {
      throw new ForbiddenException('Chegirma berishga ruxsat yo‘q (admin sozlamalarida)');
    }
    await this.fiscal.assertMxik(clinicId, [...new Set(input.items.map((i) => i.medication_id))]);

    // Dorixona kassasi: alohida dorixonada majburiy; klinikada sozlama bo'yicha.
    // Qabulxona "Dori bilan" savdosi qabulxona smenasida — dorixona smenasi kerak emas.
    let pharmacyShiftId: string | null = null;
    let requireShift = false;
    let registerNo: number | null = null;
    if (!input.reception_transaction_id) {
      const sc = await this.shiftContext(clinicId, input.register_no);
      requireShift = sc.required;
      pharmacyShiftId = sc.shiftId;
      registerNo = sc.registerNo;
    }

    const payload = {
      idempotency_key: input.idempotency_key ?? null,
      items: input.items.map((i) => ({
        medication_id: i.medication_id,
        quantity: i.quantity,
        unit_kind: i.unit_kind ?? 'unit',
        unit_price_override: i.unit_price_override_uzs ?? null,
        preferred_batch_no: i.preferred_batch_no ?? null,
      })),
      payments: input.payments ?? [],
      payment_method: input.payment_method,
      paid_uzs: input.paid_uzs ?? null,
      debt_uzs: input.debt_uzs ?? 0,
      discount_uzs: input.discount_uzs ?? 0,
      pharmacy_clinic_id: input.pharmacy_clinic_id ?? null,
      pharmacy_doctor_id: input.pharmacy_doctor_id ?? null,
      patient_id: input.patient_id ?? null,
      prescription_id: input.prescription_id ?? null,
      reception_transaction_id: input.reception_transaction_id ?? null,
      shift_id: input.shift_id ?? null,
      pharmacy_shift_id: pharmacyShiftId,
      register_no: registerNo,
      require_shift: requireShift,
      operator_id: ws?.operatorId ?? null,
      received_cash_uzs: input.received_cash_uzs ?? null,
      change_uzs: input.change_uzs ?? null,
      notes: input.notes ?? null,
    };

    // Atomar sotuv: FEFO (tanlangan partiya birinchi) + qadoq/blister/dona +
    // to'lov qismlari + smena — bitta tranzaksiyada (pharmacy_sell_v2).
    const { data, error: sellErr } = await admin.rpc(
      'pharmacy_sell_v2' as never,
      { p_clinic: clinicId, p_user: userId, p_payload: payload } as never,
    );
    if (sellErr) throw new BadRequestException(sellErr.message);
    const res = data as unknown as { sale_id: string; duplicate: boolean };
    const saleId = res.sale_id;

    // Retsept bo'yicha berilgan miqdorni yangilash (agar retseptdan sotilsa) —
    // takroriy so'rovda (duplicate) qayta qo'shilmaydi.
    if (input.prescription_id && !res.duplicate) {
      for (const it of input.items) {
        const { data: matchedItems } = await admin
          .from('prescription_items')
          .select('id, dispensed_qty, quantity')
          .eq('clinic_id', clinicId)
          .eq('prescription_id', input.prescription_id)
          .eq('medication_id', it.medication_id);
        const matched =
          (matchedItems as Array<{ id: string; dispensed_qty: number; quantity: number }> | null) ??
          [];
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

    const fiscal = res.duplicate
      ? await this.fiscal.summaryForSale(saleId)
      : await this.fiscal.enqueueSale(clinicId, saleId).catch(() => null);

    return { ...(await this.getSale(clinicId, saleId)), duplicate: res.duplicate, fiscal };
  }

  async getSale(clinicId: string, id: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('pharmacy_sales')
      .select(
        '*, items:pharmacy_sale_items(*), patient:patients(id, full_name, phone), ' +
          'cashier:profiles!pharmacy_sales_cashier_id_fkey(full_name)',
      )
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .single();
    if (error) throw new BadRequestException(error.message);

    const sale = data as unknown as Record<string, unknown> & {
      pharmacy_clinic_id: string | null;
      pharmacy_doctor_id: string | null;
      operator_id: string | null;
      cashier?: { full_name?: string | null } | null;
    };
    // B2B klinika/shifokor ismlari pharmacy_sales bilan FK orqali bog'lanmagan —
    // salesReport kabi alohida so'rov bilan hal qilamiz (savdo tarixi batafsil sahifasi uchun).
    const [clinicRes, doctorRes, operatorRes, paymentsRes, fiscalRes] = await Promise.all([
      sale.pharmacy_clinic_id
        ? admin
            .from('pharmacy_clinics')
            .select('name')
            .eq('id', sale.pharmacy_clinic_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      sale.pharmacy_doctor_id
        ? admin
            .from('pharmacy_clinic_doctors')
            .select('full_name')
            .eq('id', sale.pharmacy_doctor_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      sale.operator_id
        ? admin
            .from('pharmacy_operators')
            .select('full_name')
            .eq('id', sale.operator_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from('pharmacy_sale_payments').select('method, amount_uzs').eq('sale_id', id),
      admin
        .from('fiscal_receipts')
        .select(
          'id, kind, ref_key, status, is_test, fiscal_sign, fiscal_number, terminal_id, qr_url, last_error, created_at',
        )
        .eq('sale_id', id)
        .order('created_at', { ascending: true }),
    ]);

    return {
      ...sale,
      clinic_name: (clinicRes.data as { name?: string } | null)?.name ?? null,
      doctor_name: (doctorRes.data as { full_name?: string } | null)?.full_name ?? null,
      cashier_name:
        (operatorRes.data as { full_name?: string } | null)?.full_name ??
        sale.cashier?.full_name ??
        null,
      payments: paymentsRes.data ?? [],
      fiscal_receipts: fiscalRes.data ?? [],
    };
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
    params: {
      from?: string;
      to?: string;
      pharmacy_clinic_id?: string;
      pharmacy_doctor_id?: string;
    } = {},
  ) {
    const admin = this.supabase.admin();
    const ws = pharmacyWs();
    let q = admin
      .from('pharmacy_sales')
      .select(
        'id, created_at, total_uzs, paid_uzs, debt_uzs, payment_method, pharmacy_clinic_id, pharmacy_doctor_id, register_no, operator_id, fiscal_status, is_void, items:pharmacy_sale_items(quantity, profit_uzs, doctor_share_uzs)',
      )
      .eq('clinic_id', clinicId)
      .eq('is_void', false)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (params.from) q = q.gte('created_at', params.from);
    if (params.to) q = q.lte('created_at', params.to);
    if (params.pharmacy_clinic_id) q = q.eq('pharmacy_clinic_id', params.pharmacy_clinic_id);
    if (params.pharmacy_doctor_id) q = q.eq('pharmacy_doctor_id', params.pharmacy_doctor_id);
    // Kassir faqat o'z kassasining sotuvlarini ko'radi
    if (ws && ws.operatorRole !== 'admin' && ws.registerNo) q = q.eq('register_no', ws.registerNo);

    const [salesRes, { data: clinics }, { data: doctors }, { data: operators }] = await Promise.all(
      [
        q,
        admin.from('pharmacy_clinics').select('id, name').eq('clinic_id', clinicId),
        admin.from('pharmacy_clinic_doctors').select('id, full_name').eq('clinic_id', clinicId),
        admin.from('pharmacy_operators').select('id, full_name').eq('clinic_id', clinicId),
      ],
    );
    if (salesRes.error) throw new BadRequestException(salesRes.error.message);
    const clinicName = new Map(
      (clinics ?? []).map((c) => [(c as { id: string }).id, (c as { name: string }).name]),
    );
    const doctorName = new Map(
      (doctors ?? []).map((d) => [
        (d as { id: string }).id,
        (d as { full_name: string }).full_name,
      ]),
    );
    const operatorName = new Map(
      (operators ?? []).map((o) => [
        (o as { id: string }).id,
        (o as { full_name: string }).full_name,
      ]),
    );

    const rows = (salesRes.data ?? []) as Array<{
      id: string;
      created_at: string;
      total_uzs: number;
      paid_uzs: number;
      debt_uzs: number;
      payment_method: string;
      pharmacy_clinic_id: string | null;
      pharmacy_doctor_id: string | null;
      register_no: number | null;
      operator_id: string | null;
      fiscal_status: string | null;
      items: Array<{ quantity: number; profit_uzs: number; doctor_share_uzs: number }> | null;
    }>;

    let revenue = 0,
      qty = 0,
      profit = 0,
      doctorShare = 0;
    const byDoctor = new Map<
      string,
      {
        doctor_id: string | null;
        doctor_name: string;
        revenue: number;
        qty: number;
        profit: number;
        doctor_share: number;
        sales_count: number;
      }
    >();

    const sales = rows.map((s) => {
      const its = s.items ?? [];
      const sQty = its.reduce((a, i) => a + Number(i.quantity), 0);
      const sProfit = its.reduce((a, i) => a + Number(i.profit_uzs), 0);
      const sShare = its.reduce((a, i) => a + Number(i.doctor_share_uzs), 0);
      const sRevenue = Number(s.total_uzs);
      revenue += sRevenue;
      qty += sQty;
      profit += sProfit;
      doctorShare += sShare;

      const dkey = s.pharmacy_doctor_id ?? 'none';
      const cur = byDoctor.get(dkey) ?? {
        doctor_id: s.pharmacy_doctor_id,
        doctor_name: s.pharmacy_doctor_id
          ? (doctorName.get(s.pharmacy_doctor_id) ?? '—')
          : 'Shifokorsiz',
        revenue: 0,
        qty: 0,
        profit: 0,
        doctor_share: 0,
        sales_count: 0,
      };
      cur.revenue += sRevenue;
      cur.qty += sQty;
      cur.profit += sProfit;
      cur.doctor_share += sShare;
      cur.sales_count += 1;
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
        operator_name: s.operator_id ? (operatorName.get(s.operator_id) ?? null) : null,
        register_no: s.register_no,
        fiscal_status: s.fiscal_status,
        items_count: its.length,
        qty: sQty,
      };
    });

    // Tannarx/foyda kassirga ko'rsatilmaydi
    const hideProfit = !!ws && ws.operatorRole !== 'admin';
    return {
      totals: {
        revenue,
        qty,
        profit: hideProfit ? null : profit,
        doctor_share: doctorShare,
        sales_count: rows.length,
      },
      by_doctor: Array.from(byDoctor.values())
        .map((d) => (hideProfit ? { ...d, profit: null } : d))
        .sort((a, b) => b.revenue - a.revenue),
      sales,
    };
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
          const code = normalizeBarcode(r.barcode);
          const { data: existingBc } = await admin
            .from('medication_barcodes')
            .select('medication_id')
            .eq('clinic_id', clinicId)
            .eq('code', code)
            .maybeSingle();
          const existingId = (existingBc as { medication_id: string } | null)?.medication_id;
          if (existingId) {
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
              .eq('id', existingId);
            updated++;
            continue;
          }
        }
        const { error } = await admin.from('medications').insert({
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
        if (error) throw new Error(error.message);
        inserted++;
      } catch (err) {
        errors.push({ row: i + 1, message: (err as Error).message });
      }
    }
    return { inserted, updated, errors };
  }

  async prescriptionById(clinicId: string, idOrRx: string) {
    const admin = this.supabase.admin();
    const sel =
      '*, patient:patients(id, full_name, phone, pinfl), doctor:profiles!doctor_id(id, full_name), items:prescription_items(id, medication_id, medication_name_snapshot, dosage, route, quantity, dispensed_qty, unit_price_snapshot)';
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrRx);
    let q = admin.from('prescriptions').select(sel).eq('clinic_id', clinicId);
    q = isUuid ? q.eq('id', idOrRx) : q.eq('rx_number', idOrRx);
    const { data, error } = await q.maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Retsept topilmadi');
    return data;
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

  /**
   * Prixod (kirim) — ATOMAR (pharmacy_receive RPC): partiya, qator, harakat,
   * qoldiq, narx tarixi, shtrix-kod/alias o'rganish, firma daftari va (kassadan
   * naqd to'langan bo'lsa) kassa harakati bitta tranzaksiyada. Ilgari har
   * qatorga 5 ta alohida so'rov ketardi va o'rtada uzilsa yarim prixod qolardi.
   * Xaridlar (PO) qabul qilish ham shu metod orqali ishlaydi.
   */
  async receipt(clinicId: string, userId: string, input: ReceiptInput) {
    const ws = pharmacyWs();
    let shiftId: string | null = null;
    if ((input.paid_uzs ?? 0) > 0 && (input.payment_method ?? 'cash') === 'cash') {
      const sc = await this.shiftContext(clinicId);
      shiftId = sc.shiftId;
    }
    const payload = {
      idempotency_key: input.idempotency_key ?? null,
      supplier_id: input.supplier_id ?? null,
      receipt_no: input.receipt_no ?? null,
      invoice_date: input.invoice_date ?? null,
      received_at: input.received_at ?? null,
      paid_uzs: input.paid_uzs ?? 0,
      payment_method: input.payment_method ?? null,
      notes: input.notes ?? null,
      source: input.source ?? 'manual',
      file_name: input.file_name ?? null,
      file_hash: input.file_hash ?? null,
      expected_total_uzs: input.expected_total_uzs ?? null,
      operator_id: ws?.operatorId ?? null,
      pharmacy_shift_id: shiftId,
      items: input.items.map((it) => ({
        medication_id: it.medication_id,
        unit_kind: it.unit_kind ?? 'unit',
        entered_qty: it.quantity,
        entered_cost_uzs: it.unit_cost_uzs,
        sale_price_uzs: it.sale_price_uzs ?? it.unit_price_uzs ?? null,
        pack_price_uzs: it.pack_price_uzs ?? null,
        profit_percent: it.profit_percent ?? 0,
        keep_higher_price: it.keep_higher_price ?? false,
        doctor_share_percent: it.doctor_share_percent ?? 0,
        doctor_share_bonus_uzs: it.doctor_share_bonus_uzs ?? 0,
        manufacturer: it.manufacturer ?? null,
        manufacture_date: it.manufacture_date || null,
        batch_no: it.batch_no ?? null,
        expiry_date: it.expiry_date || null,
        gtin: it.gtin ?? null,
        mxik_code: it.mxik_code ?? null,
        source_name: it.source_name ?? null,
      })),
    };
    const { data, error } = await this.supabase
      .admin()
      .rpc(
        'pharmacy_receive' as never,
        { p_clinic: clinicId, p_user: userId, p_payload: payload } as never,
      );
    if (error) throw new BadRequestException(error.message);
    const r = data as unknown as {
      receipt_id: string;
      duplicate: boolean;
      total_cost_uzs?: number;
    };
    return { id: r.receipt_id, ...r };
  }

  /** Prixod tafsiloti (qatorlar bilan) — tarix va yorliq chop etish uchun. */
  async getReceipt(clinicId: string, id: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_receipts')
      .select(
        '*, supplier:suppliers(id, name), items:pharmacy_receipt_items(*, medication:medications(id, name, strength, form, barcode, price_uzs, pack_qty, pack_price_uzs, unit_name))',
      )
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  // ---- Excel import: moslash, profil, takror tekshiruvi, qoralama -----------
  async importMatch(clinicId: string, input: z.infer<typeof ImportMatchSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .rpc(
        'pharmacy_match_import' as never,
        { p_clinic: clinicId, p_supplier: input.supplier_id ?? null, p_rows: input.rows } as never,
      );
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getImportProfile(clinicId: string, supplierId?: string) {
    let q = this.supabase
      .admin()
      .from('pharmacy_import_profiles')
      .select('mapping, updated_at, supplier_id')
      .eq('clinic_id', clinicId);
    q = supplierId ? q.eq('supplier_id', supplierId) : q.is('supplier_id', null);
    const { data } = await q.maybeSingle();
    return data ?? null;
  }

  async saveImportProfile(
    clinicId: string,
    userId: string,
    input: z.infer<typeof ImportProfileSchema>,
  ) {
    const admin = this.supabase.admin();
    let q = admin.from('pharmacy_import_profiles').select('id').eq('clinic_id', clinicId);
    q = input.supplier_id ? q.eq('supplier_id', input.supplier_id) : q.is('supplier_id', null);
    const { data: existing } = await q.maybeSingle();
    if (existing) {
      const { error } = await admin
        .from('pharmacy_import_profiles')
        .update({
          mapping: input.mapping,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', (existing as { id: string }).id);
      if (error) throw new BadRequestException(error.message);
    } else {
      const { error } = await admin.from('pharmacy_import_profiles').insert({
        clinic_id: clinicId,
        supplier_id: input.supplier_id ?? null,
        mapping: input.mapping,
        updated_by: userId,
      });
      if (error) throw new BadRequestException(error.message);
    }
    return { ok: true };
  }

  /** Shu faktura (firma + raqam) yoki shu fayl avval kiritilganmi. */
  async duplicateCheck(clinicId: string, input: z.infer<typeof DuplicateCheckSchema>) {
    const admin = this.supabase.admin();
    const found: Array<Record<string, unknown>> = [];
    if (input.file_hash) {
      const { data } = await admin
        .from('pharmacy_receipts')
        .select('id, receipt_no, received_at, total_cost_uzs, file_name')
        .eq('clinic_id', clinicId)
        .eq('file_hash', input.file_hash)
        .eq('is_void', false)
        .limit(5);
      for (const r of (data ?? []) as Array<Record<string, unknown>>)
        found.push({ ...r, reason: 'file' });
    }
    if (input.supplier_id && input.receipt_no && input.receipt_no.trim()) {
      const { data } = await admin
        .from('pharmacy_receipts')
        .select('id, receipt_no, received_at, total_cost_uzs, file_name')
        .eq('clinic_id', clinicId)
        .eq('supplier_id', input.supplier_id)
        .eq('receipt_no', input.receipt_no.trim())
        .eq('is_void', false)
        .limit(5);
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        if (!found.some((f) => f['id'] === r['id'])) found.push({ ...r, reason: 'invoice' });
      }
    }
    return { duplicates: found };
  }

  async listDrafts(clinicId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_receipt_drafts')
      .select('id, title, lines_count, updated_at, created_at')
      .eq('clinic_id', clinicId)
      .order('updated_at', { ascending: false })
      .limit(20);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getDraft(clinicId: string, id: string) {
    const { data } = await this.supabase
      .admin()
      .from('pharmacy_receipt_drafts')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (!data) throw new NotFoundException('Qoralama topilmadi');
    return data;
  }

  async saveDraft(
    clinicId: string,
    userId: string,
    id: string | null,
    input: z.infer<typeof ReceiptDraftSchema>,
  ) {
    const admin = this.supabase.admin();
    const row = {
      title: input.title ?? null,
      payload: input.payload,
      lines_count: input.lines_count ?? 0,
      operator_id: pharmacyWs()?.operatorId ?? null,
      updated_at: new Date().toISOString(),
    };
    if (id) {
      const { data, error } = await admin
        .from('pharmacy_receipt_drafts')
        .update(row)
        .eq('clinic_id', clinicId)
        .eq('id', id)
        .select('id, updated_at')
        .maybeSingle();
      if (error) throw new BadRequestException(error.message);
      if (data) return data;
    }
    const { data, error } = await admin
      .from('pharmacy_receipt_drafts')
      .insert({ ...row, clinic_id: clinicId, created_by: userId })
      .select('id, updated_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteDraft(clinicId: string, id: string) {
    await this.supabase
      .admin()
      .from('pharmacy_receipt_drafts')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', id);
    return { ok: true };
  }

  /** Import'dagi topilmagan dorilarni bir yo'la yaratish. Kiritish tartibida id qaytadi. */
  async bulkCreateMedications(
    clinicId: string,
    userId: string,
    input: z.infer<typeof BulkMedicationSchema>,
  ) {
    const admin = this.supabase.admin();
    const created: Array<{ index: number; id: string | null; error?: string }> = [];
    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i]!;
      const barcode = it.barcode ? normalizeBarcode(it.barcode) : null;
      if (barcode) {
        const { data: taken } = await admin
          .from('medication_barcodes')
          .select('medication_id')
          .eq('clinic_id', clinicId)
          .eq('code', barcode)
          .maybeSingle();
        const takenId = (taken as { medication_id: string } | null)?.medication_id;
        if (takenId) {
          created.push({ index: i, id: takenId });
          continue;
        }
      }
      const { data, error } = await admin
        .from('medications')
        .insert({
          clinic_id: clinicId,
          name: it.name.trim(),
          strength: it.strength ?? null,
          form: it.form ?? null,
          manufacturer: it.manufacturer ?? null,
          barcode: it.barcode ?? null,
          mxik_code: it.mxik_code ?? null,
          pack_qty: it.pack_qty ?? 1,
          unit_name: it.unit_name ?? null,
          price_uzs: it.price_uzs ?? 0,
          requires_prescription: it.requires_prescription ?? false,
          stock: 0,
          created_by: userId,
        })
        .select('id')
        .single();
      created.push({
        index: i,
        id: (data as { id: string } | null)?.id ?? null,
        error: error?.message,
      });
    }
    return { created };
  }

  // ---- Shtrix-kodlar ---------------------------------------------------------
  async listBarcodes(clinicId: string, medId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('medication_barcodes')
      .select('id, code, raw_code, kind, created_at')
      .eq('clinic_id', clinicId)
      .eq('medication_id', medId)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async addBarcode(
    clinicId: string,
    userId: string,
    medId: string,
    raw: string,
    kind: 'manufacturer' | 'internal' | 'supplier' = 'manufacturer',
  ) {
    const parsed = parseScan(raw);
    const code = parsed.gtin ?? normalizeBarcode(parsed.raw);
    if (!code) throw new BadRequestException("Shtrix-kod bo'sh");
    const admin = this.supabase.admin();
    const { data: med } = await admin
      .from('medications')
      .select('id, barcode')
      .eq('clinic_id', clinicId)
      .eq('id', medId)
      .maybeSingle();
    if (!med) throw new NotFoundException('Dori topilmadi');
    const { data: taken } = await admin
      .from('medication_barcodes')
      .select('medication_id, medication:medications(name)')
      .eq('clinic_id', clinicId)
      .eq('code', code)
      .maybeSingle();
    if (taken) {
      const t = taken as unknown as {
        medication_id: string;
        medication: { name: string } | { name: string }[] | null;
      };
      if (t.medication_id === medId) return { ok: true, code, existed: true };
      const name = Array.isArray(t.medication) ? t.medication[0]?.name : t.medication?.name;
      throw new ConflictException(`Bu shtrix-kod boshqa doriga biriktirilgan: ${name ?? '—'}`);
    }
    const { error } = await admin.from('medication_barcodes').insert({
      clinic_id: clinicId,
      medication_id: medId,
      code,
      raw_code: raw,
      kind,
      created_by: userId,
    });
    if (error) throw new BadRequestException(error.message);
    // Asosiy maydon bo'sh bo'lsa — ko'rinish uchun to'ldiramiz
    if (!(med as { barcode: string | null }).barcode) {
      await admin
        .from('medications')
        .update({ barcode: code.replace(/^0(?=\d{13}$)/, ''), updated_by: userId })
        .eq('id', medId);
    }
    return { ok: true, code, existed: false };
  }

  async removeBarcode(clinicId: string, medId: string, barcodeId: string) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('medication_barcodes')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('medication_id', medId)
      .eq('id', barcodeId)
      .select('code')
      .maybeSingle();
    const code = (data as { code: string } | null)?.code;
    if (code) {
      // medications.barcode shu kod bo'lsa tozalaymiz
      const { data: med } = await admin
        .from('medications')
        .select('barcode')
        .eq('id', medId)
        .maybeSingle();
      const b = (med as { barcode: string | null } | null)?.barcode;
      if (b && normalizeBarcode(b) === code) {
        await admin.from('medications').update({ barcode: null }).eq('id', medId);
      }
    }
    return { ok: true };
  }

  /** Shtrix-kodi yo'q dori uchun ichki EAN-13 ("2..." — do'kon ichi) yaratadi. */
  async internalBarcode(clinicId: string, userId: string, medId: string) {
    const admin = this.supabase.admin();
    const { data: last } = await admin
      .from('medication_barcodes')
      .select('code')
      .eq('clinic_id', clinicId)
      .eq('kind', 'internal')
      .order('code', { ascending: false })
      .limit(1);
    const lastCode = ((last ?? []) as Array<{ code: string }>)[0]?.code ?? null;
    let seq = lastCode ? Number(lastCode.slice(2, 13)) + 1 : 1;
    for (let attempt = 0; attempt < 6; attempt++) {
      const ean = internalEan13(seq);
      try {
        const res = await this.addBarcode(clinicId, userId, medId, ean, 'internal');
        return { ...res, ean13: ean };
      } catch (e) {
        if (e instanceof ConflictException) {
          seq += 1;
          continue;
        }
        throw e;
      }
    }
    throw new ConflictException("Ichki shtrix-kod yaratib bo'lmadi — qayta urinib ko'ring");
  }

  async setPackSize(
    clinicId: string,
    userId: string,
    medId: string,
    packQty: number,
    convert: boolean,
  ) {
    const { data, error } = await this.supabase.admin().rpc(
      'pharmacy_set_pack_size' as never,
      {
        p_clinic: clinicId,
        p_user: userId,
        p_medication: medId,
        p_pack_qty: packQty,
        p_convert_stock: convert,
      } as never,
    );
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async priceHistory(clinicId: string, medId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('medication_price_history')
      .select(
        'id, old_price_uzs, new_price_uzs, old_pack_price_uzs, new_pack_price_uzs, source, receipt_id, created_at, changer:profiles!medication_price_history_changed_by_fkey(full_name)',
      )
      .eq('clinic_id', clinicId)
      .eq('medication_id', medId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ----- Mijoz-klinikalar (B2B) ----------------------------------------------
  async listClinics(clinicId: string) {
    const admin = this.supabase.admin();
    const [{ data: clinics }, { data: doctors }, { data: ledger }] = await Promise.all([
      admin
        .from('pharmacy_clinics')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('is_archived', false)
        .order('name'),
      admin
        .from('pharmacy_clinic_doctors')
        .select('id, pharmacy_clinic_id, full_name, phone')
        .eq('clinic_id', clinicId)
        .eq('is_archived', false)
        .order('full_name'),
      admin
        .from('pharmacy_clinic_ledger')
        .select('pharmacy_clinic_id, amount_uzs')
        .eq('clinic_id', clinicId),
    ]);
    const docMap = new Map<
      string,
      Array<{ id: string; full_name: string; phone: string | null }>
    >();
    for (const d of (doctors ?? []) as Array<{
      id: string;
      pharmacy_clinic_id: string;
      full_name: string;
      phone: string | null;
    }>) {
      const arr = docMap.get(d.pharmacy_clinic_id) ?? [];
      arr.push({ id: d.id, full_name: d.full_name, phone: d.phone });
      docMap.set(d.pharmacy_clinic_id, arr);
    }
    const balMap = new Map<string, number>();
    for (const l of (ledger ?? []) as Array<{ pharmacy_clinic_id: string; amount_uzs: number }>) {
      balMap.set(
        l.pharmacy_clinic_id,
        (balMap.get(l.pharmacy_clinic_id) ?? 0) + Number(l.amount_uzs),
      );
    }
    // debt_uzs > 0 => mijoz bizga qarzdor (ledger balansi manfiy)
    return ((clinics ?? []) as Array<{ id: string }>).map((c) => ({
      ...c,
      doctors: docMap.get(c.id) ?? [],
      debt_uzs: -(balMap.get(c.id) ?? 0),
    }));
  }

  async createClinic(clinicId: string, userId: string, input: z.infer<typeof PharmClinicSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_clinics')
      .insert({ clinic_id: clinicId, ...input, created_by: userId })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateClinic(
    clinicId: string,
    id: string,
    userId: string,
    input: Partial<z.infer<typeof PharmClinicSchema>>,
  ) {
    const patch: Record<string, unknown> = {
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    for (const [k, v] of Object.entries(input)) if (v !== undefined) patch[k] = v;
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_clinics')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async archiveClinic(clinicId: string, id: string) {
    await this.supabase
      .admin()
      .from('pharmacy_clinics')
      .update({ is_archived: true })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    return { ok: true };
  }

  async addClinicDoctor(
    clinicId: string,
    pharmacyClinicId: string,
    userId: string,
    input: z.infer<typeof PharmDoctorSchema>,
  ) {
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_clinic_doctors')
      .insert({
        clinic_id: clinicId,
        pharmacy_clinic_id: pharmacyClinicId,
        full_name: input.full_name,
        phone: input.phone ?? null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async archiveClinicDoctor(clinicId: string, id: string) {
    await this.supabase
      .admin()
      .from('pharmacy_clinic_doctors')
      .update({ is_archived: true })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    return { ok: true };
  }

  async clinicLedger(clinicId: string, pharmacyClinicId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_clinic_ledger')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('pharmacy_clinic_id', pharmacyClinicId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Array<{ amount_uzs: number }>;
    const balance = rows.reduce((a, r) => a + Number(r.amount_uzs), 0);
    return { entries: rows, debt_uzs: -balance };
  }

  async payClinicDebt(
    clinicId: string,
    userId: string,
    pharmacyClinicId: string,
    input: z.infer<typeof ClinicPaymentSchema>,
  ) {
    const method = input.payment_method ?? 'cash';
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_clinic_ledger')
      .insert({
        clinic_id: clinicId,
        pharmacy_clinic_id: pharmacyClinicId,
        entry_kind: 'payment',
        amount_uzs: Math.abs(input.amount_uzs),
        payment_method: method,
        description: input.notes ?? "Qarz to'lovi",
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    // Naqd qarz undirish — kassaga kirim
    if (method === 'cash') {
      await this.shifts
        .recordIfOpen(clinicId, userId, {
          kind: 'debt_collection',
          amount_uzs: Math.abs(input.amount_uzs),
          method: 'cash',
          notes: input.notes ?? "Mijoz klinika qarz to'lovi",
          ref_table: 'pharmacy_clinic_ledger',
          ref_id: (data as { id: string }).id,
        })
        .catch(() => null);
    }
    return data;
  }

  // ----- Sotuvni bekor qilish (otkaz/vozvrat) --------------------------------
  async voidSale(
    clinicId: string,
    userId: string,
    saleId: string,
    input: z.infer<typeof VoidSaleSchema>,
  ) {
    const sc = await this.shiftContext(clinicId);
    const { error } = await this.supabase.admin().rpc(
      'pharmacy_void_sale_v2' as never,
      {
        p_clinic: clinicId,
        p_user: userId,
        p_sale: saleId,
        p_reason: input.reason ?? null,
        p_shift: sc.shiftId,
        p_operator: pharmacyWs()?.operatorId ?? null,
      } as never,
    );
    if (error) throw new BadRequestException(error.message);
    const fiscal = await this.fiscal
      .enqueueRefund(clinicId, saleId, 'void', null)
      .catch(() => null);
    return { ok: true, fiscal };
  }

  /**
   * Prixod tarixi. Ilgari ro'yxat endpointi umuman yo'q edi — dorixonachi
   * kirim tarixini ko'ra olmasdi va shu sababli bekor qilish tugmasini
   * qo'yadigan joy ham yo'q edi.
   */
  async listReceipts(clinicId: string, limit = 100) {
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_receipts')
      .select(
        'id, receipt_no, total_cost_uzs, paid_uzs, payment_status, received_at, created_at, is_void, voided_at, voided_reason, source, file_name, invoice_date, operator_id, supplier:suppliers(id, name), items:pharmacy_receipt_items(id)',
      )
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 300));
    if (error) throw new BadRequestException(error.message);

    type Row = Record<string, unknown> & { items?: unknown[] | null };
    return ((data ?? []) as unknown as Row[]).map((r) => ({
      ...r,
      items_count: Array.isArray(r.items) ? r.items.length : 0,
      items: undefined,
    }));
  }

  /**
   * Prixodni bekor qilish — ombor, teskari harakatlar, yetkazib beruvchi
   * daftari va (endi) NARX bitta tranzaksiyada qaytariladi (DB funksiyasi ichida).
   * Undan biror dona sotilgan bo'lsa funksiya RAD ETADI.
   */
  async voidReceipt(
    clinicId: string,
    userId: string,
    receiptId: string,
    input: z.infer<typeof VoidSaleSchema>,
  ) {
    const { error } = await this.supabase.admin().rpc(
      'pharmacy_void_receipt' as never,
      {
        p_clinic_id: clinicId,
        p_user_id: userId,
        p_receipt_id: receiptId,
        p_reason: input.reason ?? null,
      } as never,
    );
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

    const [salesRes, receiptsRes, supLedgerRes, ledgerRes, clinicsRes, suppliersRes] =
      await Promise.all([
        admin
          .from('pharmacy_sales')
          .select('total_uzs, items:pharmacy_sale_items(profit_uzs)')
          .eq('clinic_id', clinicId)
          .eq('is_void', false)
          .gte('created_at', monthIso),
        admin
          .from('pharmacy_receipts')
          .select('total_cost_uzs, created_at, source, is_void')
          .eq('clinic_id', clinicId)
          .gte('created_at', monthIso),
        admin
          .from('pharmacy_supplier_ledger')
          .select('supplier_id, amount_uzs')
          .eq('clinic_id', clinicId),
        admin
          .from('pharmacy_clinic_ledger')
          .select('pharmacy_clinic_id, amount_uzs')
          .eq('clinic_id', clinicId),
        admin
          .from('pharmacy_clinics')
          .select('id, name')
          .eq('clinic_id', clinicId)
          .eq('is_archived', false),
        admin.from('suppliers').select('id, name').eq('clinic_id', clinicId),
      ]);

    let monthRevenue = 0,
      monthProfit = 0;
    for (const s of (salesRes.data ?? []) as Array<{
      total_uzs: number;
      items: Array<{ profit_uzs: number }> | null;
    }>) {
      monthRevenue += Number(s.total_uzs);
      for (const i of s.items ?? []) monthProfit += Number(i.profit_uzs);
    }

    // Boshlang'ich qoldiq va bekor qilingan prixodlar "oylik kirim"ga kirmaydi
    let monthPurchases = 0;
    for (const r of (receiptsRes.data ?? []) as Array<{
      total_cost_uzs: number;
      source: string | null;
      is_void: boolean;
    }>) {
      if (!r.is_void && r.source !== 'opening') monthPurchases += Number(r.total_cost_uzs);
    }

    // Yetkazib beruvchi qarzi = oldi-berdi daftaridagi balans (Σ amount_uzs > 0 = biz qarzdormiz)
    const supplierName = new Map(
      (suppliersRes.data ?? []).map((s) => [
        (s as { id: string }).id,
        (s as { name: string }).name,
      ]),
    );
    const supBal = new Map<string, number>();
    for (const l of (supLedgerRes.data ?? []) as Array<{
      supplier_id: string;
      amount_uzs: number;
    }>) {
      supBal.set(l.supplier_id, (supBal.get(l.supplier_id) ?? 0) + Number(l.amount_uzs));
    }
    const supplierDebts = Array.from(supBal.entries())
      .map(([id, bal]) => ({ supplier_id: id, name: supplierName.get(id) ?? '—', debt_uzs: bal }))
      .filter((x) => x.debt_uzs > 0)
      .sort((a, b) => b.debt_uzs - a.debt_uzs);
    const supplierDebtTotal = supplierDebts.reduce((a, c) => a + c.debt_uzs, 0);

    const clinicName = new Map(
      (clinicsRes.data ?? []).map((c) => [(c as { id: string }).id, (c as { name: string }).name]),
    );
    const cliBal = new Map<string, number>();
    for (const l of (ledgerRes.data ?? []) as Array<{
      pharmacy_clinic_id: string;
      amount_uzs: number;
    }>) {
      cliBal.set(
        l.pharmacy_clinic_id,
        (cliBal.get(l.pharmacy_clinic_id) ?? 0) + Number(l.amount_uzs),
      );
    }
    const customerDebts = Array.from(cliBal.entries())
      .map(([id, bal]) => ({
        pharmacy_clinic_id: id,
        name: clinicName.get(id) ?? '—',
        debt_uzs: -bal,
      }))
      .filter((x) => x.debt_uzs > 0)
      .sort((a, b) => b.debt_uzs - a.debt_uzs);
    const customerDebtTotal = customerDebts.reduce((a, c) => a + c.debt_uzs, 0);

    const ws = pharmacyWs();
    const hideProfit = !!ws && ws.operatorRole !== 'admin';
    return {
      month_revenue: monthRevenue,
      month_profit: hideProfit ? null : monthProfit,
      month_purchases: monthPurchases,
      supplier_debt_total: supplierDebtTotal,
      customer_debt_total: customerDebtTotal,
      supplier_debts: supplierDebts,
      customer_debts: customerDebts,
    };
  }

  async paySupplier(
    clinicId: string,
    userId: string,
    input: z.infer<typeof SupplierPaymentSchema>,
  ) {
    // Tezkor to'lov (dashboard) — oldi-berdi daftariga 'payment' yozuvi qo'shadi.
    const amt = Math.abs(input.amount_uzs);
    const method = input.payment_method ?? 'cash';
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_supplier_ledger')
      .insert({
        clinic_id: clinicId,
        supplier_id: input.supplier_id,
        entry_kind: 'payment',
        amount_uzs: -amt,
        payment_method: method,
        occurred_at: new Date().toISOString().slice(0, 10),
        notes: input.notes ?? "Yetkazib beruvchiga to'lov",
        created_by: userId,
      } as never)
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    if (method === 'cash') {
      await this.shifts
        .recordIfOpen(clinicId, userId, {
          kind: 'supplier_payment',
          amount_uzs: -amt,
          method: 'cash',
          notes: input.notes ?? "Firmaga to'lov",
          ref_table: 'pharmacy_supplier_ledger',
          ref_id: (data as { id: string }).id,
        })
        .catch(() => null);
    }
    return { ok: true, applied: amt };
  }

  // ----- Yetkazib beruvchi firmalar + oldi-berdi (ledger) --------------------
  async listSuppliers(clinicId: string) {
    const admin = this.supabase.admin();
    const [{ data: sups, error }, { data: ledger }] = await Promise.all([
      admin
        .from('suppliers')
        .select('id, name, contact_person, phone, address, tax_id')
        .eq('clinic_id', clinicId)
        .eq('is_archived', false)
        .order('name'),
      admin
        .from('pharmacy_supplier_ledger')
        .select('supplier_id, amount_uzs')
        .eq('clinic_id', clinicId),
    ]);
    if (error) throw new BadRequestException(error.message);
    const bal = new Map<string, number>();
    for (const l of (ledger ?? []) as Array<{ supplier_id: string; amount_uzs: number }>) {
      bal.set(l.supplier_id, (bal.get(l.supplier_id) ?? 0) + Number(l.amount_uzs));
    }
    return ((sups ?? []) as Array<{ id: string }>).map((s) => ({
      ...s,
      debt_uzs: bal.get(s.id) ?? 0,
    }));
  }

  async createSupplier(clinicId: string, userId: string, input: z.infer<typeof SupplierSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('suppliers')
      .insert({ clinic_id: clinicId, ...input, created_by: userId, updated_by: userId })
      .select('id, name, contact_person, phone, address, tax_id')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateSupplier(
    clinicId: string,
    id: string,
    userId: string,
    input: z.infer<typeof SupplierUpdateSchema>,
  ) {
    const patch: Record<string, unknown> = { updated_by: userId };
    for (const [k, v] of Object.entries(input)) if (v !== undefined) patch[k] = v;
    const { data, error } = await this.supabase
      .admin()
      .from('suppliers')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select('id, name, contact_person, phone, address, tax_id')
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async archiveSupplier(clinicId: string, id: string, userId: string) {
    const { error } = await this.supabase
      .admin()
      .from('suppliers')
      .update({ is_archived: true, updated_by: userId })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new NotFoundException(error.message);
    return { ok: true };
  }

  async supplierLedger(
    clinicId: string,
    supplierId: string,
    opts: { from?: string; to?: string; q?: string },
  ) {
    const admin = this.supabase.admin();
    // Balans — butun tarix bo'yicha (filtrdan qat'i nazar)
    const { data: allRows } = await admin
      .from('pharmacy_supplier_ledger')
      .select('amount_uzs')
      .eq('clinic_id', clinicId)
      .eq('supplier_id', supplierId);
    const balance = ((allRows ?? []) as Array<{ amount_uzs: number }>).reduce(
      (a, r) => a + Number(r.amount_uzs),
      0,
    );

    let q = admin
      .from('pharmacy_supplier_ledger')
      .select(
        'id, entry_kind, amount_uzs, payment_method, invoice_no, receipt_id, occurred_at, notes, created_at',
      )
      .eq('clinic_id', clinicId)
      .eq('supplier_id', supplierId)
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false });
    if (opts.from) q = q.gte('occurred_at', opts.from);
    if (opts.to) q = q.lte('occurred_at', opts.to);
    if (opts.q && opts.q.trim()) q = q.ilike('invoice_no', `%${opts.q.trim()}%`);
    const { data: entries, error } = await q.limit(500);
    if (error) throw new BadRequestException(error.message);
    return { balance, entries: entries ?? [] };
  }

  async addSupplierEntry(
    clinicId: string,
    userId: string,
    supplierId: string,
    input: z.infer<typeof SupplierEntrySchema>,
  ) {
    // Ishora: payment = − (pul berdim), debt = + (qarz), adjustment = berilgan ishora
    const mag = Math.abs(input.amount_uzs);
    const signed =
      input.entry_kind === 'payment' ? -mag : input.entry_kind === 'debt' ? mag : input.amount_uzs;
    const { data, error } = await this.supabase
      .admin()
      .from('pharmacy_supplier_ledger')
      .insert({
        clinic_id: clinicId,
        supplier_id: supplierId,
        entry_kind: input.entry_kind,
        amount_uzs: signed,
        payment_method: input.payment_method ?? null,
        invoice_no: input.invoice_no ?? null,
        occurred_at: input.occurred_at ?? new Date().toISOString().slice(0, 10),
        notes: input.notes ?? null,
        created_by: userId,
      } as never)
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    if (input.entry_kind === 'payment' && (input.payment_method ?? 'cash') === 'cash') {
      await this.shifts
        .recordIfOpen(clinicId, userId, {
          kind: 'supplier_payment',
          amount_uzs: -mag,
          method: 'cash',
          notes: input.notes ?? "Firmaga to'lov",
          ref_table: 'pharmacy_supplier_ledger',
          ref_id: (data as { id: string }).id,
        })
        .catch(() => null);
    }
    return data;
  }

  // ----- Dorilar (to'liq boshqaruv — dorixona oynasida) ----------------------
  async listMedicationsFull(clinicId: string, q?: string) {
    const admin = this.supabase.admin();
    let mq = admin
      .from('medications')
      .select(
        'id, name, category_id, manufacturer, strength, form, barcode, price_uzs, cost_uzs, reorder_level, requires_prescription, image_url, ' +
          'pack_qty, blister_qty, unit_name, pack_price_uzs, blister_price_uzs, sell_by_unit, mxik_code, package_code, vat_percent, generic_name',
      )
      .eq('clinic_id', clinicId)
      .eq('is_archived', false)
      .order('name')
      .limit(5000);
    if (q && q.trim()) {
      const n = searchNorm(q).replace(/[%,]/g, ' ');
      mq = mq.or(`search_text.ilike.%${n}%,barcode.ilike.%${q.trim().replace(/[%,]/g, ' ')}%`);
    }
    const [{ data: meds, error }, { data: stock }, { data: cats }, { data: codes }] =
      await Promise.all([
        mq,
        admin
          .from('medication_stock_summary')
          .select('medication_id, qty_in_stock, qty_sellable, earliest_expiry')
          .eq('clinic_id', clinicId),
        admin.from('medication_categories').select('id, name_i18n').eq('clinic_id', clinicId),
        admin.from('medication_barcodes').select('medication_id').eq('clinic_id', clinicId),
      ]);
    if (error) throw new BadRequestException(error.message);
    const stockMap = new Map(
      (stock ?? []).map((s) => [
        (s as { medication_id: string }).medication_id,
        s as { qty_in_stock: number; qty_sellable: number; earliest_expiry: string | null },
      ]),
    );
    const catName = (n: Record<string, string> | null) =>
      n ? (n['uz-Latn'] ?? Object.values(n)[0] ?? null) : null;
    const catMap = new Map(
      (cats ?? []).map((c) => [
        (c as { id: string }).id,
        catName((c as { name_i18n: Record<string, string> | null }).name_i18n),
      ]),
    );
    const codeCount = new Map<string, number>();
    for (const c of (codes ?? []) as Array<{ medication_id: string }>) {
      codeCount.set(c.medication_id, (codeCount.get(c.medication_id) ?? 0) + 1);
    }
    return ((meds ?? []) as unknown as Array<{ id: string; category_id: string | null }>).map(
      (m) => ({
        ...m,
        qty_in_stock: Number(stockMap.get(m.id)?.qty_in_stock ?? 0),
        qty_sellable: Number(stockMap.get(m.id)?.qty_sellable ?? 0),
        earliest_expiry: stockMap.get(m.id)?.earliest_expiry ?? null,
        category_name: m.category_id ? (catMap.get(m.category_id) ?? null) : null,
        barcodes_count: codeCount.get(m.id) ?? 0,
      }),
    );
  }

  async createMedication(
    clinicId: string,
    userId: string,
    input: z.infer<typeof MedicationSchema>,
  ) {
    const { data, error } = await this.supabase
      .admin()
      .from('medications')
      .insert({ clinic_id: clinicId, ...input, stock: 0, created_by: userId })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateMedication(
    clinicId: string,
    id: string,
    userId: string,
    input: z.infer<typeof MedicationUpdateSchema>,
  ) {
    const patch: Record<string, unknown> = { updated_by: userId };
    for (const [k, v] of Object.entries(input)) {
      // pack_qty bu yerda o'zgarmaydi — qoldiq ma'nosi buzilmasligi uchun
      // /medications/:id/pack-size (RPC qayta hisoblaydi) ishlatiladi.
      if (k === 'pack_qty') continue;
      if (v !== undefined) patch[k] = v;
    }
    const { data, error } = await this.supabase
      .admin()
      .from('medications')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async archiveMedication(clinicId: string, id: string) {
    await this.supabase
      .admin()
      .from('medications')
      .update({ is_archived: true })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    return { ok: true };
  }

  async listMedCategories(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('medication_categories')
      .select('id, name_i18n')
      .eq('clinic_id', clinicId)
      .order('created_at');
    return ((data ?? []) as Array<{ id: string; name_i18n: Record<string, string> | null }>).map(
      (c) => ({
        id: c.id,
        name: c.name_i18n ? (c.name_i18n['uz-Latn'] ?? Object.values(c.name_i18n)[0] ?? '') : '',
      }),
    );
  }

  async createMedCategory(
    clinicId: string,
    userId: string,
    input: z.infer<typeof MedCategorySchema>,
  ) {
    const { data, error } = await this.supabase
      .admin()
      .from('medication_categories')
      .insert({ clinic_id: clinicId, name_i18n: { 'uz-Latn': input.name }, created_by: userId })
      .select('id, name_i18n')
      .single();
    if (error) throw new BadRequestException(error.message);
    return { id: (data as { id: string }).id, name: input.name };
  }
}
