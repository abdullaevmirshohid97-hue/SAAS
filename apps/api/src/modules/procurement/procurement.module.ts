import {
  Body, Controller, ForbiddenException, Get, Injectable, Logger, Module,
  NotFoundException, Param, Post,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';
import { PharmacyModule, PharmacyService } from '../pharmacy/pharmacy.module';

// =============================================================================
// Procurement (Pillar 2) — Purchase Order workflow + v2: requisition→approval,
// supplier invoices (3-way matching), auto-reorder cron. Qabul mavjud pharmacy
// receipt() ni qayta ishlatadi (batch + supplier_ledger -> GL avtomatik).
// =============================================================================

const TZ = 'Asia/Tashkent';

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

const RequisitionSchema = z.object({
  note: z.string().optional(),
  items: z.array(z.object({
    medication_id: z.string().uuid().optional(),
    name_snapshot: z.string().min(1),
    qty: z.number().int().positive(),
    note: z.string().optional(),
  })).min(1),
});

const InvoiceSchema = z.object({
  supplier_id: z.string().uuid().optional(),
  po_id: z.string().uuid().optional(),
  invoice_no: z.string().min(1),
  invoice_date: z.string().optional(),
  amount_uzs: z.number().int().nonnegative(),
  notes: z.string().optional(),
});

const SettingsSchema = z.object({
  auto_reorder_enabled: z.boolean().optional(),
  reorder_hour: z.number().int().min(0).max(23).optional(),
});

type ReorderSuggestion = {
  medication_id: string; name: string;
  qty_in_stock: number; reorder_level: number; suggested_qty: number;
};

@Injectable()
export class ProcurementService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly pharmacy: PharmacyService,
  ) {}

  // ===== Purchase Orders =====================================================
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
      // PO PDF (supplierga yuborish) uchun supplier to'liq ma'lumoti
      .select('*, supplier:suppliers(name, phone, email, address, tax_id), items:purchase_order_items(*)')
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

  // ===== Requisitions (talab → tasdiq → draft PO) ============================
  async listRequisitions(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('purchase_requisitions')
      .select('*, items:purchase_requisition_items(*)')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(100);
    return data ?? [];
  }

  async createRequisition(clinicId: string, userId: string | null, body: z.infer<typeof RequisitionSchema>) {
    const admin = this.supabase.admin();
    const req_no = 'REQ-' + Date.now().toString(36).toUpperCase();
    const { data: req, error } = await admin
      .from('purchase_requisitions')
      .insert({ clinic_id: clinicId, req_no, status: 'requested', note: body.note ?? null, requested_by: userId })
      .select('id').single();
    if (error) throw new Error(error.message);
    const reqId = (req as { id: string }).id;
    await admin.from('purchase_requisition_items').insert(
      body.items.map((i) => ({
        req_id: reqId, medication_id: i.medication_id ?? null,
        name_snapshot: i.name_snapshot, qty: i.qty, note: i.note ?? null,
      })),
    );
    return { id: reqId, req_no };
  }

  async approveRequisition(clinicId: string, userId: string | null, id: string) {
    const admin = this.supabase.admin();
    const { data: req } = await admin
      .from('purchase_requisitions')
      .select('*, items:purchase_requisition_items(*)')
      .eq('clinic_id', clinicId).eq('id', id).maybeSingle();
    if (!req) throw new NotFoundException();
    const r = req as { status: string; req_no: string; items: Array<{ medication_id: string | null; name_snapshot: string; qty: number }> };
    if (r.status !== 'requested') throw new Error('Faqat "so\'ralgan" talab tasdiqlanadi');

    // Tasdiq → draft PO (tannarx 0 — qabulda kiritiladi)
    const po = await this.create(clinicId, userId, {
      notes: 'Talabdan: ' + r.req_no,
      items: r.items.map((it) => ({
        medication_id: it.medication_id ?? undefined,
        name_snapshot: it.name_snapshot, qty_ordered: it.qty, unit_cost_uzs: 0,
      })),
    });
    await admin.from('purchase_orders').update({ requisition_id: id }).eq('id', po.id);
    await admin.from('purchase_requisitions')
      .update({ status: 'converted', reviewed_by: userId, reviewed_at: new Date().toISOString(), po_id: po.id })
      .eq('id', id);
    return { ok: true, po_id: po.id, po_no: po.po_no };
  }

  async rejectRequisition(clinicId: string, userId: string | null, id: string) {
    await this.supabase.admin().from('purchase_requisitions')
      .update({ status: 'rejected', reviewed_by: userId, reviewed_at: new Date().toISOString() })
      .eq('clinic_id', clinicId).eq('id', id).eq('status', 'requested');
    return { ok: true };
  }

  // ===== Supplier invoices + 3-way matching =================================
  async listInvoices(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('supplier_invoices')
      .select('*, supplier:suppliers(name), po:purchase_orders(po_no)')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(100);
    return data ?? [];
  }

  async createInvoice(clinicId: string, userId: string | null, body: z.infer<typeof InvoiceSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('supplier_invoices')
      .insert({
        clinic_id: clinicId, supplier_id: body.supplier_id ?? null, po_id: body.po_id ?? null,
        invoice_no: body.invoice_no, invoice_date: body.invoice_date ?? undefined,
        amount_uzs: body.amount_uzs, notes: body.notes ?? null, created_by: userId,
      })
      .select('id').single();
    if (error) throw new Error(error.message);
    return { id: (data as { id: string }).id };
  }

  /** 3-way match: PO buyurtma ↔ GRN qabul ↔ invoice. Farqlarni qaytaradi. */
  async matchOrder(clinicId: string, poId: string) {
    const admin = this.supabase.admin();
    const po = await this.getOrder(clinicId, poId);
    const items = (po as { po_no: string; status: string; items: Array<{ name_snapshot: string; qty_ordered: number; qty_received: number; unit_cost_uzs: number }> }).items ?? [];
    const { data: invoices } = await admin
      .from('supplier_invoices')
      .select('amount_uzs')
      .eq('clinic_id', clinicId).eq('po_id', poId);

    const orderedUzs = items.reduce((s, it) => s + it.qty_ordered * it.unit_cost_uzs, 0);
    const receivedUzs = items.reduce((s, it) => s + it.qty_received * it.unit_cost_uzs, 0);
    const invoicedUzs = (invoices ?? []).reduce((s, i) => s + Number((i as { amount_uzs: number }).amount_uzs ?? 0), 0);

    return {
      po_no: (po as { po_no: string }).po_no,
      status: (po as { status: string }).status,
      lines: items.map((it) => ({
        name: it.name_snapshot,
        qty_ordered: it.qty_ordered,
        qty_received: it.qty_received,
        unit_cost_uzs: it.unit_cost_uzs,
        qty_variance: it.qty_received - it.qty_ordered,
      })),
      totals: { ordered_uzs: orderedUzs, received_uzs: receivedUzs, invoiced_uzs: invoicedUzs },
      fully_received: items.length > 0 && items.every((it) => it.qty_received >= it.qty_ordered),
      // >0 = invoice qabuldan oshib ketgan (disputed); <0 = invoice kam
      invoice_vs_received_uzs: invoicedUzs - receivedUzs,
    };
  }

  // ===== Reorder + auto-reorder =============================================
  async reorderSuggestions(clinicId: string): Promise<ReorderSuggestion[]> {
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

  /** Ochiq PO'larda (draft|approved|partial) allaqachon buyurtma qilingan medication id'lar. */
  async openOrderedMedicationIds(clinicId: string): Promise<Set<string>> {
    const { data } = await this.supabase
      .admin()
      .from('purchase_orders')
      .select('status, items:purchase_order_items(medication_id)')
      .eq('clinic_id', clinicId)
      .in('status', ['draft', 'approved', 'partial']);
    const set = new Set<string>();
    for (const po of (data ?? []) as Array<{ items: Array<{ medication_id: string | null }> }>) {
      for (const it of po.items ?? []) if (it.medication_id) set.add(it.medication_id);
    }
    return set;
  }

  /** Har dori uchun oxirgi partiyaning supplier + tannarxi (avto-reorder uchun). */
  private async lastBatchInfo(clinicId: string, medIds: string[]): Promise<Map<string, { supplier_id: string | null; unit_cost_uzs: number }>> {
    const map = new Map<string, { supplier_id: string | null; unit_cost_uzs: number }>();
    if (medIds.length === 0) return map;
    const { data } = await this.supabase
      .admin()
      .from('medication_batches')
      .select('medication_id, supplier_id, unit_cost_uzs, received_at')
      .eq('clinic_id', clinicId)
      .in('medication_id', medIds)
      .order('received_at', { ascending: false });
    for (const b of (data ?? []) as Array<{ medication_id: string; supplier_id: string | null; unit_cost_uzs: number }>) {
      if (!map.has(b.medication_id)) {
        map.set(b.medication_id, { supplier_id: b.supplier_id ?? null, unit_cost_uzs: Number(b.unit_cost_uzs ?? 0) });
      }
    }
    return map;
  }

  /** Kam zaxira dorilarni oxirgi supplier bo'yicha guruhlab draft PO yaratadi. Dedup bilan. */
  async autoReorderForClinic(clinicId: string): Promise<{ created: number; items: number }> {
    const suggestions = await this.reorderSuggestions(clinicId);
    if (suggestions.length === 0) return { created: 0, items: 0 };
    const open = await this.openOrderedMedicationIds(clinicId);
    const fresh = suggestions.filter((s) => !open.has(s.medication_id));
    if (fresh.length === 0) return { created: 0, items: 0 };

    const info = await this.lastBatchInfo(clinicId, fresh.map((s) => s.medication_id));
    const groups = new Map<string, Array<{ medication_id: string; name_snapshot: string; qty_ordered: number; unit_cost_uzs: number }>>();
    for (const s of fresh) {
      const bi = info.get(s.medication_id);
      const key = bi?.supplier_id ?? 'none';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({
        medication_id: s.medication_id, name_snapshot: s.name,
        qty_ordered: s.suggested_qty, unit_cost_uzs: bi?.unit_cost_uzs ?? 0,
      });
    }
    let created = 0;
    for (const [key, items] of groups) {
      await this.create(clinicId, null, {
        supplier_id: key === 'none' ? undefined : key,
        notes: 'Avto-reorder (kam zaxira)', items,
      });
      created += 1;
    }
    return { created, items: fresh.length };
  }

  // ===== Settings ===========================================================
  async getSettings(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('procurement_settings')
      .select('*')
      .eq('clinic_id', clinicId).maybeSingle();
    return data ?? { clinic_id: clinicId, auto_reorder_enabled: false, reorder_hour: 6 };
  }

  async updateSettings(clinicId: string, body: z.infer<typeof SettingsSchema>) {
    await this.supabase.admin().from('procurement_settings').upsert(
      { clinic_id: clinicId, ...body, updated_at: new Date().toISOString() },
      { onConflict: 'clinic_id' },
    );
    return this.getSettings(clinicId);
  }
}

// =============================================================================
// Auto-reorder cron — har kuni ertalab (Asia/Tashkent). Faqat opt-in klinikalar.
// =============================================================================
@Injectable()
export class ProcurementCronService {
  private readonly logger = new Logger('ProcurementCron');
  constructor(
    private readonly supabase: SupabaseService,
    private readonly svc: ProcurementService,
  ) {}

  @Cron('0 * * * *', { timeZone: TZ })
  async autoReorderCron(): Promise<void> {
    // Har soat boshida ishlaydi; har klinika faqat o'z `reorder_hour`ida (Tashkent).
    const hour = new Date(Date.now() + 5 * 3_600_000).getUTCHours();
    const { data } = await this.supabase
      .admin()
      .from('procurement_settings')
      .select('clinic_id, reorder_hour')
      .eq('auto_reorder_enabled', true);
    const clinics = ((data ?? []) as Array<{ clinic_id: string; reorder_hour: number | null }>)
      .filter((r) => Number(r.reorder_hour ?? 6) === hour)
      .map((r) => r.clinic_id);
    for (const clinicId of clinics) {
      try {
        const r = await this.svc.autoReorderForClinic(clinicId);
        if (r.created > 0) this.logger.log(`Avto-reorder ${clinicId}: ${r.created} PO, ${r.items} dori`);
      } catch (e) {
        this.logger.warn(`Avto-reorder ${clinicId} xato: ${(e as Error).message}`);
      }
    }
  }
}

@ApiTags('procurement')
@Controller({ path: 'procurement', version: '1' })
class ProcurementController {
  constructor(private readonly svc: ProcurementService) {}

  // ---- Orders ----
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

  @Get('orders/:id/match')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'pharmacist')
  match(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.matchOrder(u.clinicId, id);
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

  // ---- Requisitions ----
  @Get('requisitions')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'pharmacist')
  reqList(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listRequisitions(u.clinicId);
  }

  @Post('requisitions')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'pharmacist', 'nurse')
  reqCreate(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.createRequisition(u.clinicId, u.userId ?? null, RequisitionSchema.parse(body));
  }

  @Post('requisitions/:id/approve')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  reqApprove(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Param('id') id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.approveRequisition(u.clinicId, u.userId ?? null, id);
  }

  @Post('requisitions/:id/reject')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  reqReject(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Param('id') id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.rejectRequisition(u.clinicId, u.userId ?? null, id);
  }

  // ---- Invoices + 3-way match ----
  @Get('invoices')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'pharmacist')
  invList(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listInvoices(u.clinicId);
  }

  @Post('invoices')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'pharmacist')
  invCreate(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.createInvoice(u.clinicId, u.userId ?? null, InvoiceSchema.parse(body));
  }

  // ---- Settings ----
  @Get('settings')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  getSettings(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getSettings(u.clinicId);
  }

  @Post('settings')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  updateSettings(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateSettings(u.clinicId, SettingsSchema.parse(body));
  }
}

@Module({
  imports: [PharmacyModule],
  controllers: [ProcurementController],
  providers: [ProcurementService, ProcurementCronService, SupabaseService],
})
export class ProcurementModule {}
