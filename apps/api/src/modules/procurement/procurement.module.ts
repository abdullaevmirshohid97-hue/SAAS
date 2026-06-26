import {
  Body, Controller, ForbiddenException, Get, Injectable, Module,
  NotFoundException, Param, Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';
import { PharmacyModule, PharmacyService } from '../pharmacy/pharmacy.module';

// =============================================================================
// Procurement (Pillar 2) — Purchase Order workflow. Qabul mavjud pharmacy
// receipt() ni qayta ishlatadi (batch + supplier_ledger -> GL avtomatik).
// =============================================================================

const CreateSchema = z.object({
  supplier_id: z.string().uuid().optional(),
  expected_at: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    medication_id: z.string().uuid().optional(),
    name_snapshot: z.string().min(1),
    qty_ordered: z.number().int().positive(),
    unit_cost_uzs: z.number().int().nonnegative(),
  })).min(1),
});

const ReceiveSchema = z.object({
  paid_uzs: z.number().int().nonnegative().optional(),
  payment_method: z.string().optional(),
  items: z.array(z.object({
    medication_id: z.string().uuid(),
    quantity: z.number().int().positive(),
    unit_cost_uzs: z.number().int().nonnegative(),
    batch_no: z.string().optional(),
    expiry_date: z.string().optional(),
    profit_percent: z.number().optional(),
  })).min(1),
});

@Injectable()
export class ProcurementService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly pharmacy: PharmacyService,
  ) {}

  async listOrders(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('purchase_orders')
      .select('*, supplier:suppliers(name), items:purchase_order_items(*)')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(100);
    return data ?? [];
  }

  async getOrder(clinicId: string, id: string) {
    const { data } = await this.supabase
      .admin()
      .from('purchase_orders')
      .select('*, supplier:suppliers(name, phone), items:purchase_order_items(*)')
      .eq('clinic_id', clinicId).eq('id', id).maybeSingle();
    if (!data) throw new NotFoundException();
    return data;
  }

  async create(clinicId: string, userId: string | null, body: z.infer<typeof CreateSchema>) {
    const admin = this.supabase.admin();
    const subtotal = body.items.reduce((s, i) => s + i.qty_ordered * i.unit_cost_uzs, 0);
    const po_no = 'PO-' + Date.now().toString(36).toUpperCase();
    const { data: po, error } = await admin
      .from('purchase_orders')
      .insert({
        clinic_id: clinicId, supplier_id: body.supplier_id ?? null, po_no, status: 'draft',
        expected_at: body.expected_at ?? null, notes: body.notes ?? null,
        subtotal_uzs: subtotal, created_by: userId,
      })
      .select('id').single();
    if (error) throw new Error(error.message);
    const poId = (po as { id: string }).id;
    await admin.from('purchase_order_items').insert(
      body.items.map((i) => ({
        po_id: poId, medication_id: i.medication_id ?? null, name_snapshot: i.name_snapshot,
        qty_ordered: i.qty_ordered, unit_cost_uzs: i.unit_cost_uzs,
      })),
    );
    return { id: poId, po_no };
  }

  async approve(clinicId: string, id: string, userId: string | null) {
    await this.supabase.admin().from('purchase_orders')
      .update({ status: 'approved', approved_by: userId, approved_at: new Date().toISOString() })
      .eq('clinic_id', clinicId).eq('id', id).eq('status', 'draft');
    return { ok: true };
  }

  async cancel(clinicId: string, id: string) {
    await this.supabase.admin().from('purchase_orders')
      .update({ status: 'cancelled' })
      .eq('clinic_id', clinicId).eq('id', id).in('status', ['draft', 'approved']);
    return { ok: true };
  }

  async receive(clinicId: string, userId: string, id: string, body: z.infer<typeof ReceiveSchema>) {
    const admin = this.supabase.admin();
    const po = await this.getOrder(clinicId, id);
    const supplierId = (po as { supplier_id?: string }).supplier_id;
    const poNo = (po as { po_no?: string }).po_no;

    // Mavjud pharmacy receipt oqimini qayta ishlatamiz (batch + stock + supplier_ledger -> GL)
    const receipt = await this.pharmacy.receipt(clinicId, userId, {
      supplier_id: supplierId ?? undefined,
      receipt_no: poNo,
      paid_uzs: body.paid_uzs,
      payment_method: body.payment_method,
      items: body.items.map((i) => ({
        medication_id: i.medication_id, quantity: i.quantity, unit_cost_uzs: i.unit_cost_uzs,
        batch_no: i.batch_no, expiry_date: i.expiry_date, profit_percent: i.profit_percent ?? 0,
        doctor_share_percent: 0, doctor_share_bonus_uzs: 0,
      })),
    });
    await admin.from('pharmacy_receipts').update({ po_id: id }).eq('id', (receipt as { id: string }).id);

    // PO qatorlarida qty_received yangilash
    const items = (po as { items: Array<{ id: string; medication_id: string | null; qty_ordered: number; qty_received: number }> }).items;
    for (const ri of body.items) {
      const line = items.find((it) => it.medication_id === ri.medication_id);
      if (!line) continue;
      const newRecv = Math.min(line.qty_ordered, line.qty_received + ri.quantity);
      await admin.from('purchase_order_items').update({ qty_received: newRecv }).eq('id', line.id);
      line.qty_received = newRecv;
    }
    const allReceived = items.every((it) => it.qty_received >= it.qty_ordered);
    await admin.from('purchase_orders')
      .update({ status: allReceived ? 'received' : 'partial' })
      .eq('clinic_id', clinicId).eq('id', id);
    return { ok: true, status: allReceived ? 'received' : 'partial' };
  }

  async reorderSuggestions(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('medication_stock_summary')
      .select('medication_id, name, qty_in_stock, reorder_level')
      .eq('clinic_id', clinicId);
    return ((data ?? []) as Array<{ medication_id: string; name: string; qty_in_stock: number; reorder_level: number | null }>)
      .filter((r) => Number(r.qty_in_stock ?? 0) < Number(r.reorder_level ?? 0))
      .map((r) => ({
        medication_id: r.medication_id, name: r.name,
        qty_in_stock: Number(r.qty_in_stock ?? 0), reorder_level: Number(r.reorder_level ?? 0),
        suggested_qty: Math.max(1, Number(r.reorder_level ?? 0) - Number(r.qty_in_stock ?? 0)),
      }))
      .sort((a, b) => a.qty_in_stock - b.qty_in_stock);
  }
}

@ApiTags('procurement')
@Controller({ path: 'procurement', version: '1' })
class ProcurementController {
  constructor(private readonly svc: ProcurementService) {}

  @Get('orders')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'pharmacist')
  list(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listOrders(u.clinicId);
  }

  @Get('reorder-suggestions')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'pharmacist')
  reorder(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.reorderSuggestions(u.clinicId);
  }

  @Get('orders/:id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'pharmacist')
  get(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getOrder(u.clinicId, id);
  }

  @Post('orders')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'pharmacist')
  create(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.create(u.clinicId, u.userId ?? null, CreateSchema.parse(body));
  }

  @Post('orders/:id/approve')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  approve(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Param('id') id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.approve(u.clinicId, id, u.userId ?? null);
  }

  @Post('orders/:id/cancel')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  cancel(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.cancel(u.clinicId, id);
  }

  @Post('orders/:id/receive')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'pharmacist')
  receive(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Param('id') id: string, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.receive(u.clinicId, u.userId, id, ReceiveSchema.parse(body));
  }
}

@Module({
  imports: [PharmacyModule],
  controllers: [ProcurementController],
  providers: [ProcurementService, SupabaseService],
})
export class ProcurementModule {}
