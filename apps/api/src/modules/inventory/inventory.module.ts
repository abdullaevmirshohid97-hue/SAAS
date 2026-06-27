import {
  Body, Controller, ForbiddenException, Get, Injectable, Module,
  Param, Post, Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// =============================================================================
// Pillar 3 — Umumiy inventar (lab reagent / consumable / xo'jalik). Dorixonadan
// mustaqil. Kirim -> batch + 'in' movement + supplier_ledger 'purchase' (GL:
// Dr 1400 / Cr 2100). Sarf -> inventory_consume RPC (FEFO 'out' -> GL Dr 5100 / Cr 1400).
// =============================================================================

const ItemSchema = z.object({
  name: z.string().min(1),
  category: z.enum(['reagent', 'consumable', 'household', 'other']).optional(),
  unit: z.string().optional(),
  reorder_level: z.number().int().nonnegative().optional(),
  cost_uzs: z.number().int().nonnegative().optional(),
});
const ItemUpdateSchema = ItemSchema.partial().extend({ is_archived: z.boolean().optional() });

const ReceiptSchema = z.object({
  supplier_id: z.string().uuid().optional(),
  receipt_no: z.string().optional(),
  paid_uzs: z.number().int().nonnegative().optional(),
  payment_method: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    item_id: z.string().uuid(),
    quantity: z.number().int().positive(),
    unit_cost_uzs: z.number().int().nonnegative(),
    batch_no: z.string().optional(),
    expiry_date: z.string().optional(),
  })).min(1),
});

const ConsumeSchema = z.object({
  item_id: z.string().uuid(),
  quantity: z.number().int().positive(),
  reason: z.string().optional(),
});

const PaySupplierSchema = z.object({
  supplier_id: z.string().uuid().optional(),
  amount_uzs: z.number().int().positive(),
  payment_method: z.string().optional(),
  notes: z.string().optional(),
});

@Injectable()
export class InventoryService {
  constructor(private readonly supabase: SupabaseService) {}

  async listItems(clinicId: string, includeArchived = false) {
    let q = this.supabase
      .admin()
      .from('inventory_items')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (!includeArchived) q = q.eq('is_archived', false);
    const { data } = await q;
    return data ?? [];
  }

  async createItem(clinicId: string, userId: string | null, body: z.infer<typeof ItemSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('inventory_items')
      .insert({
        clinic_id: clinicId, name: body.name,
        category: body.category ?? 'consumable', unit: body.unit ?? 'dona',
        reorder_level: body.reorder_level ?? 0, cost_uzs: body.cost_uzs ?? 0,
        created_by: userId,
      })
      .select('id').single();
    if (error) throw new Error(error.message);
    return { id: (data as { id: string }).id };
  }

  async updateItem(clinicId: string, id: string, body: z.infer<typeof ItemUpdateSchema>) {
    await this.supabase.admin().from('inventory_items')
      .update(body).eq('clinic_id', clinicId).eq('id', id);
    return { ok: true };
  }

  async stockSummary(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('inventory_stock_summary')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('name', { ascending: true });
    return data ?? [];
  }

  async lowStock(clinicId: string) {
    const rows = (await this.stockSummary(clinicId)) as Array<{ item_id: string; name: string; qty_in_stock: number; reorder_level: number }>;
    return rows
      .filter((r) => Number(r.qty_in_stock ?? 0) < Number(r.reorder_level ?? 0))
      .map((r) => ({ ...r, suggested_qty: Math.max(1, Number(r.reorder_level ?? 0) - Number(r.qty_in_stock ?? 0)) }));
  }

  async expiring(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('inventory_batches')
      .select('id, batch_no, expiry_date, qty_remaining, unit_cost_uzs, item:inventory_items(name, unit)')
      .eq('clinic_id', clinicId)
      .gt('qty_remaining', 0)
      .not('expiry_date', 'is', null)
      .order('expiry_date', { ascending: true })
      .limit(200);
    return data ?? [];
  }

  async batches(clinicId: string, itemId?: string) {
    let q = this.supabase
      .admin()
      .from('inventory_batches')
      .select('id, item_id, batch_no, expiry_date, qty_received, qty_remaining, unit_cost_uzs, received_at')
      .eq('clinic_id', clinicId)
      .gt('qty_remaining', 0)
      .order('expiry_date', { ascending: true });
    if (itemId) q = q.eq('item_id', itemId);
    const { data } = await q;
    return data ?? [];
  }

  async listReceipts(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('inventory_receipts')
      .select('*, supplier:suppliers(name)')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(100);
    return data ?? [];
  }

  async receipt(clinicId: string, userId: string | null, body: z.infer<typeof ReceiptSchema>) {
    const admin = this.supabase.admin();
    const total = body.items.reduce((s, i) => s + i.quantity * i.unit_cost_uzs, 0);
    const paid = body.paid_uzs ?? 0;
    const payment_status = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    const receipt_no = body.receipt_no || 'INV-' + Date.now().toString(36).toUpperCase();

    const { data: rec, error } = await admin
      .from('inventory_receipts')
      .insert({
        clinic_id: clinicId, supplier_id: body.supplier_id ?? null, receipt_no,
        total_cost_uzs: total, paid_uzs: paid, payment_status, notes: body.notes ?? null, created_by: userId,
      })
      .select('id').single();
    if (error) throw new Error(error.message);
    const receiptId = (rec as { id: string }).id;

    for (const it of body.items) {
      const { data: batch } = await admin
        .from('inventory_batches')
        .insert({
          clinic_id: clinicId, item_id: it.item_id, supplier_id: body.supplier_id ?? null,
          batch_no: it.batch_no ?? null, expiry_date: it.expiry_date ?? null,
          unit_cost_uzs: it.unit_cost_uzs, qty_received: it.quantity, qty_remaining: it.quantity,
          receipt_id: receiptId, created_by: userId,
        })
        .select('id').single();
      const batchId = (batch as { id: string } | null)?.id ?? null;
      await admin.from('inventory_receipt_items').insert({
        clinic_id: clinicId, receipt_id: receiptId, item_id: it.item_id, batch_id: batchId,
        quantity: it.quantity, unit_cost_uzs: it.unit_cost_uzs, total_cost_uzs: it.quantity * it.unit_cost_uzs,
      });
      // 'in' harakati GL post QILMAYDI — aktiv supplier_ledger 'purchase' orqali oshadi
      await admin.from('inventory_stock_movements').insert({
        clinic_id: clinicId, item_id: it.item_id, kind: 'in', quantity: it.quantity,
        unit_cost_uzs: it.unit_cost_uzs, reason: 'Kirim', batch_id: batchId, performed_by: userId,
      });
    }

    // GL: kirim (Dr 1400 / Cr 2100) + (paid bo'lsa) to'lov (Dr 2100 / Cr kassa)
    await admin.from('inventory_supplier_ledger').insert({
      clinic_id: clinicId, supplier_id: body.supplier_id ?? null, entry_kind: 'purchase',
      amount_uzs: total, receipt_id: receiptId, notes: 'Kirim', created_by: userId,
    });
    if (paid > 0) {
      await admin.from('inventory_supplier_ledger').insert({
        clinic_id: clinicId, supplier_id: body.supplier_id ?? null, entry_kind: 'payment',
        amount_uzs: -paid, payment_method: body.payment_method ?? 'cash', receipt_id: receiptId,
        notes: 'Kirimda to\'langan', created_by: userId,
      });
    }
    return { id: receiptId, receipt_no };
  }

  async consume(clinicId: string, userId: string | null, body: z.infer<typeof ConsumeSchema>) {
    const { error } = await this.supabase.admin().rpc('inventory_consume', {
      p_clinic: clinicId, p_user: userId, p_item: body.item_id, p_qty: body.quantity, p_reason: body.reason ?? 'Sarf',
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  async paySupplier(clinicId: string, userId: string | null, body: z.infer<typeof PaySupplierSchema>) {
    const { error } = await this.supabase.admin().from('inventory_supplier_ledger').insert({
      clinic_id: clinicId, supplier_id: body.supplier_id ?? null, entry_kind: 'payment',
      amount_uzs: -Math.abs(body.amount_uzs), payment_method: body.payment_method ?? 'cash',
      notes: body.notes ?? 'Supplierga to\'lov', created_by: userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  }
}

@ApiTags('inventory')
@Controller({ path: 'inventory', version: '1' })
class InventoryController {
  constructor(private readonly svc: InventoryService) {}

  @Get('items')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'lab_technician', 'pharmacist')
  items(@CurrentUser() u: { clinicId: string | null }, @Query('archived') archived?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listItems(u.clinicId, archived === 'true');
  }

  @Post('items')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  createItem(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.createItem(u.clinicId, u.userId ?? null, ItemSchema.parse(body));
  }

  @Post('items/:id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  updateItem(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateItem(u.clinicId, id, ItemUpdateSchema.parse(body));
  }

  @Get('stock')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'lab_technician', 'pharmacist')
  stock(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.stockSummary(u.clinicId);
  }

  @Get('low-stock')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'lab_technician', 'pharmacist')
  low(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.lowStock(u.clinicId);
  }

  @Get('expiring')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'lab_technician', 'pharmacist')
  expiring(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.expiring(u.clinicId);
  }

  @Get('batches')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'lab_technician', 'pharmacist')
  batches(@CurrentUser() u: { clinicId: string | null }, @Query('item_id') itemId?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.batches(u.clinicId, itemId);
  }

  @Get('receipts')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'lab_technician', 'pharmacist')
  receipts(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listReceipts(u.clinicId);
  }

  @Post('receipt')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'lab_technician', 'pharmacist')
  receipt(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.receipt(u.clinicId, u.userId ?? null, ReceiptSchema.parse(body));
  }

  @Post('consume')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'lab_technician', 'pharmacist', 'nurse')
  consume(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.consume(u.clinicId, u.userId ?? null, ConsumeSchema.parse(body));
  }

  @Post('supplier-payment')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  paySupplier(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.paySupplier(u.clinicId, u.userId ?? null, PaySupplierSchema.parse(body));
  }
}

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, SupabaseService],
})
export class InventoryModule {}
