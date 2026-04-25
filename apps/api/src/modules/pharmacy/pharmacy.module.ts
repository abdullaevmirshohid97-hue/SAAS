import {
  Body,
  Controller,
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
  'stripe',
  'debt',
]);

const SaleSchema = z.object({
  patient_id: z.string().uuid().optional(),
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
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        medication_id: z.string().uuid(),
        quantity: z.number().int().positive(),
        unit_cost_uzs: z.number().int().nonnegative(),
        batch_no: z.string().optional(),
        expiry_date: z.string().optional(),
        unit_price_uzs: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1),
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

    const { data: meds, error: medsErr } = await admin
      .from('medications')
      .select('id, name, price_uzs')
      .in(
        'id',
        input.items.map((i) => i.medication_id),
      );
    if (medsErr) throw new BadRequestException(medsErr.message);
    if (!meds || meds.length !== input.items.length) throw new BadRequestException('Unknown medication');

    let subtotal = 0;
    const plannedItems: Array<{
      medication_id: string;
      name: string;
      quantity: number;
      unit_price: number;
      subtotal: number;
    }> = [];
    for (const it of input.items) {
      const m = meds.find((x) => (x as { id: string }).id === it.medication_id) as { id: string; name: string; price_uzs: number } | undefined;
      if (!m) throw new NotFoundException('Medication missing');
      const price = it.unit_price_override_uzs ?? Number(m.price_uzs);
      const line = price * it.quantity;
      subtotal += line;
      plannedItems.push({
        medication_id: m.id,
        name: m.name,
        quantity: it.quantity,
        unit_price: price,
        subtotal: line,
      });
    }
    const total = Math.max(0, subtotal - input.discount_uzs);
    const paid = input.paid_uzs ?? (input.payment_method === 'debt' ? 0 : total - input.debt_uzs);

    // Create sale
    const { data: sale, error: saleErr } = await admin
      .from('pharmacy_sales')
      .insert({
        clinic_id: clinicId,
        cashier_id: userId,
        patient_id: input.patient_id ?? null,
        prescription_id: input.prescription_id ?? null,
        shift_id: input.shift_id ?? null,
        payment_method: input.payment_method,
        discount_uzs: input.discount_uzs,
        total_uzs: total,
        paid_uzs: paid,
        debt_uzs: input.debt_uzs,
        notes: input.notes ?? null,
      })
      .select()
      .single();
    if (saleErr) throw new BadRequestException(saleErr.message);
    const saleId = (sale as { id: string }).id;

    // Allocate FIFO for each item, create sale_items + stock movements
    for (const p of plannedItems) {
      const { data: alloc, error: allocErr } = await admin.rpc(
        'pharmacy_allocate_fifo' as never,
        { p_clinic: clinicId, p_medication: p.medication_id, p_quantity: p.quantity } as never,
      );
      if (allocErr) throw new BadRequestException(`FIFO error for ${p.name}: ${allocErr.message}`);

      const batches = (alloc as Array<{ batch_id: string; quantity: number; unit_cost: number }>) ?? [];
      for (const b of batches) {
        await admin.from('pharmacy_sale_items').insert({
          clinic_id: clinicId,
          sale_id: saleId,
          medication_id: p.medication_id,
          batch_id: b.batch_id,
          name_snapshot: p.name,
          price_snapshot: p.unit_price,
          unit_cost_snapshot: b.unit_cost,
          quantity: b.quantity,
          subtotal_uzs: b.quantity * p.unit_price,
        });
        await admin.from('pharmacy_stock_movements').insert({
          clinic_id: clinicId,
          medication_id: p.medication_id,
          kind: 'out',
          quantity: -b.quantity,
          batch_no: null,
          sale_id: saleId,
          performed_by: userId,
        });
      }
    }

    // If paid with debt → add to patient ledger
    if (input.patient_id && input.debt_uzs > 0) {
      await admin.from('patient_ledger').insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        entry_kind: 'charge',
        amount_uzs: -input.debt_uzs,
        description: `Dorixona qarz — chek ${saleId.slice(0, 8)}`,
        recorded_by: userId,
      });
    }

    // Update prescription dispensed quantities
    if (input.prescription_id) {
      for (const p of plannedItems) {
        const { data: matchedItems } = await admin
          .from('prescription_items')
          .select('id, dispensed_qty, quantity')
          .eq('clinic_id', clinicId)
          .eq('prescription_id', input.prescription_id)
          .eq('medication_id', p.medication_id);
        const matched = (matchedItems as Array<{ id: string; dispensed_qty: number; quantity: number }> | null) ?? [];
        if (matched.length > 0 && matched[0]) {
          const it = matched[0];
          const newQty = Math.min(it.quantity, it.dispensed_qty + p.quantity);
          await admin
            .from('prescription_items')
            .update({ dispensed_qty: newQty })
            .eq('id', it.id);
        }
      }

      // Rollup prescription status
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

  async prescriptionsReadyToDispense(clinicId: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('prescriptions')
      .select(
        '*, patient:patients(id, full_name, phone), doctor:profiles!doctor_id(id, full_name), items:prescription_items(id, medication_id, medication_name_snapshot, dosage, quantity, dispensed_qty, unit_price_snapshot)',
      )
      .eq('clinic_id', clinicId)
      .in('status', ['issued', 'partially_dispensed'])
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async receipt(clinicId: string, userId: string, input: z.infer<typeof ReceiptSchema>) {
    const admin = this.supabase.admin();
    const total = input.items.reduce((a, i) => a + i.unit_cost_uzs * i.quantity, 0);

    const { data: receipt, error } = await admin
      .from('pharmacy_receipts')
      .insert({
        clinic_id: clinicId,
        supplier_id: input.supplier_id ?? null,
        receipt_no: input.receipt_no ?? null,
        received_at: input.received_at ?? new Date().toISOString(),
        total_cost_uzs: total,
        notes: input.notes ?? null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    const receiptId = (receipt as { id: string }).id;

    for (const it of input.items) {
      const { data: batch } = await admin
        .from('medication_batches')
        .insert({
          clinic_id: clinicId,
          medication_id: it.medication_id,
          supplier_id: input.supplier_id ?? null,
          batch_no: it.batch_no ?? null,
          expiry_date: it.expiry_date ?? null,
          unit_cost_uzs: it.unit_cost_uzs,
          unit_price_uzs: it.unit_price_uzs ?? null,
          qty_received: it.quantity,
          qty_remaining: it.quantity,
          receipt_id: receiptId,
          created_by: userId,
        })
        .select('id')
        .single();

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
    return receipt;
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
}

@Module({
  controllers: [PharmacyController],
  providers: [PharmacyService, SupabaseService],
  exports: [PharmacyService],
})
export class PharmacyModule {}
