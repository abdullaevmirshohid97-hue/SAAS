import {
  Body, Controller, ForbiddenException, Get, Injectable, Module,
  NotFoundException, Param, Post, Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// =============================================================================
// Sug'urta (Faza A) — klinika tomoni: markaziy direktoriyani o'qish +
// per-clinic shartnoma (insurance_companies) sozlash. Layer 2.
// =============================================================================

const ContractSchema = z.object({
  name: z.string().min(1),
  provider_id: z.string().uuid().optional(),
  contract_no: z.string().optional(),
  copay_percent: z.number().min(0).max(100).optional(),
  commission_percent: z.number().min(0).max(100).optional(),
  covered_category_ids: z.array(z.string().uuid()).optional(),
  contract_start: z.string().optional(),
  contract_end: z.string().optional(),
  max_benefit_uzs: z.number().int().nonnegative().optional(),
  contact_person: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});
const ContractUpdateSchema = ContractSchema.partial().extend({ is_archived: z.boolean().optional() });

const PreviewSchema = z.object({
  patient_id: z.string().uuid(),
  items: z.array(z.object({
    service_id: z.string().uuid(),
    quantity: z.number().int().positive(),
    unit_price_uzs: z.number().int().nonnegative().optional(),
    discount_uzs: z.number().int().nonnegative().optional(),
  })).min(1),
});

const SettlementSchema = z.object({
  insurer_id: z.string().uuid().optional(),
  method: z.enum(['cash', 'card', 'transfer', 'bank', 'writeoff']).default('transfer'),
  settled_at: z.string().optional(),
  notes: z.string().optional(),
  allocations: z.array(z.object({ claim_id: z.string().uuid(), amount_uzs: z.number().int().positive() })).min(1),
});

const PayClaimSchema = z.object({ amount_uzs: z.number().int().positive().optional(), method: z.string().optional() });
const DenySchema = z.object({ reason: z.string().min(1) });

@Injectable()
export class InsuranceService {
  constructor(private readonly supabase: SupabaseService) {}

  /** Faol markaziy direktoriya — klinika shartnoma bog'lash uchun tanlaydi. */
  async listProviders() {
    const { data } = await this.supabase
      .admin()
      .from('insurance_providers')
      .select('id, code, name, type, logo_url, integration_mode')
      .eq('is_active', true)
      .order('sort_order');
    return data ?? [];
  }

  async listContracts(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('insurance_companies')
      .select('*, provider:insurance_providers(id, name, code, integration_mode)')
      .eq('clinic_id', clinicId)
      .eq('is_archived', false)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    return data ?? [];
  }

  private serialize(body: z.infer<typeof ContractUpdateSchema>) {
    const patch: Record<string, unknown> = { ...body };
    // covered_category_ids massiv -> jsonb
    if (body.covered_category_ids) patch.covered_category_ids = body.covered_category_ids;
    return patch;
  }

  async createContract(clinicId: string, userId: string | null, body: z.infer<typeof ContractSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('insurance_companies')
      .insert({ ...this.serialize(body), clinic_id: clinicId, created_by: userId, updated_by: userId })
      .select('id').single();
    if (error) throw new Error(error.message);
    return { id: (data as { id: string }).id };
  }

  async updateContract(clinicId: string, id: string, userId: string | null, body: z.infer<typeof ContractUpdateSchema>) {
    const { error } = await this.supabase
      .admin()
      .from('insurance_companies')
      .update({ ...this.serialize(body), updated_by: userId })
      .eq('clinic_id', clinicId).eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  // ===== Coverage (shartnoma darajasida: copay% + qoplanadigan kategoriyalar) =
  async getActiveContract(clinicId: string, insurerId: string) {
    const { data } = await this.supabase
      .admin()
      .from('insurance_companies')
      .select('id, provider_id, copay_percent, covered_category_ids, max_benefit_uzs, is_archived')
      .eq('clinic_id', clinicId).eq('id', insurerId).maybeSingle();
    if (!data || (data as { is_archived: boolean }).is_archived) return null;
    return data as {
      id: string; provider_id: string | null; copay_percent: number;
      covered_category_ids: string[]; max_benefit_uzs: number | null;
    };
  }

  /** Pure: shartnoma + xizmat qatorlaridan covered/copay split. */
  computeCoverage(
    contract: { copay_percent: number; covered_category_ids: string[] },
    items: Array<{ service_id: string; category_id: string | null; amount: number; name?: string }>,
  ) {
    const copayPct = Math.min(100, Math.max(0, Number(contract.copay_percent ?? 0)));
    const covered = Array.isArray(contract.covered_category_ids) ? contract.covered_category_ids : [];
    const lines = items.map((it) => {
      const isCovered = covered.length === 0 || (it.category_id != null && covered.includes(it.category_id));
      const coveredAmt = isCovered ? Math.round(it.amount * (1 - copayPct / 100)) : 0;
      return { service_id: it.service_id, name: it.name, amount: it.amount, covered: coveredAmt, copay: it.amount - coveredAmt };
    });
    return {
      lines,
      insurer_total: lines.reduce((s, l) => s + l.covered, 0),
      copay_total: lines.reduce((s, l) => s + l.copay, 0),
    };
  }

  /** Reception preview: bemorning faol sug'urtasi bo'yicha qoplanish hisobi. */
  async previewCoverage(
    clinicId: string, patientId: string,
    items: Array<{ service_id: string; quantity: number; unit_price_uzs?: number; discount_uzs?: number }>,
  ) {
    const admin = this.supabase.admin();
    const { data: p } = await admin.from('patients').select('insurance_company_id').eq('id', patientId).maybeSingle();
    const insurerId = (p as { insurance_company_id: string | null } | null)?.insurance_company_id;
    if (!insurerId) return { applicable: false as const, insurer_total: 0, copay_total: 0, lines: [] };
    const contract = await this.getActiveContract(clinicId, insurerId);
    if (!contract) return { applicable: false as const, insurer_total: 0, copay_total: 0, lines: [] };

    const ids = [...new Set(items.map((i) => i.service_id))];
    const { data: svcs } = await admin.from('services').select('id, name_i18n, price_uzs, category_id').eq('clinic_id', clinicId).in('id', ids);
    const map = new Map((svcs ?? []).map((s) => [s.id as string, s]));
    const covItems = items.map((it) => {
      const svc = map.get(it.service_id) as { name_i18n?: Record<string, string>; price_uzs?: number; category_id?: string | null } | undefined;
      const unit = it.unit_price_uzs && it.unit_price_uzs > 0 ? it.unit_price_uzs : Number(svc?.price_uzs ?? 0);
      const amount = unit * it.quantity - (it.discount_uzs ?? 0);
      const nm = svc?.name_i18n;
      return { service_id: it.service_id, category_id: svc?.category_id ?? null, amount, name: nm ? (nm['uz-Latn'] ?? Object.values(nm)[0]) : undefined };
    });
    const cov = this.computeCoverage(contract, covItems);
    return { applicable: true as const, insurer_id: insurerId, provider_id: contract.provider_id, ...cov };
  }

  // ===== Claims ============================================================
  async createClaim(clinicId: string, userId: string | null, input: {
    insurer_id?: string; provider_id?: string | null; patient_id?: string; transaction_id?: string;
    claim_amount_uzs: number; copay_amount_uzs: number; status?: string;
    lines: Array<{ service_id?: string; name?: string; covered: number; copay: number }>;
  }) {
    const admin = this.supabase.admin();
    const claim_no = 'CLM-' + Date.now().toString(36).toUpperCase();
    const { data: claim, error } = await admin.from('insurance_claims').insert({
      clinic_id: clinicId, insurer_id: input.insurer_id ?? null, provider_id: input.provider_id ?? null,
      patient_id: input.patient_id ?? null, transaction_id: input.transaction_id ?? null, claim_no,
      claim_amount_uzs: input.claim_amount_uzs, copay_amount_uzs: input.copay_amount_uzs,
      status: input.status ?? 'draft', created_by: userId,
    }).select('id').single();
    if (error) throw new Error(error.message);
    const claimId = (claim as { id: string }).id;
    const itemRows = input.lines.filter((l) => l.covered > 0).map((l) => ({
      clinic_id: clinicId, claim_id: claimId, service_id: l.service_id ?? null,
      name_snapshot: l.name ?? null, covered_amount_uzs: l.covered, copay_amount_uzs: l.copay,
    }));
    if (itemRows.length) await admin.from('insurance_claim_items').insert(itemRows);
    return { id: claimId, claim_no };
  }

  async listClaims(clinicId: string, status?: string) {
    let q = this.supabase
      .admin()
      .from('insurance_claims')
      .select('*, insurer:insurance_companies(name), provider:insurance_providers(name), patient:patients(full_name)')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (status) q = q.eq('status', status);
    const { data } = await q;
    return data ?? [];
  }

  async getClaim(clinicId: string, id: string) {
    const { data } = await this.supabase
      .admin()
      .from('insurance_claims')
      .select('*, insurer:insurance_companies(name, contract_no), provider:insurance_providers(name), patient:patients(full_name, insurance_policy_no), items:insurance_claim_items(*)')
      .eq('clinic_id', clinicId).eq('id', id).maybeSingle();
    if (!data) throw new NotFoundException();
    return data;
  }

  async submitClaim(clinicId: string, id: string) {
    await this.supabase.admin().from('insurance_claims')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('clinic_id', clinicId).eq('id', id).eq('status', 'draft');
    return { ok: true };
  }

  private async recomputeClaim(clinicId: string, claimId: string) {
    const admin = this.supabase.admin();
    const { data: claim } = await admin.from('insurance_claims').select('claim_amount_uzs, status').eq('id', claimId).single();
    const claimAmt = Number((claim as { claim_amount_uzs: number }).claim_amount_uzs ?? 0);
    const { data: allocs } = await admin
      .from('insurance_settlement_allocations')
      .select('amount_uzs, settlement:insurance_settlements(method)')
      .eq('claim_id', claimId);
    let paid = 0, total = 0;
    const rows = (allocs ?? []) as unknown as Array<{ amount_uzs: number; settlement: { method: string } | { method: string }[] | null }>;
    for (const a of rows) {
      total += Number(a.amount_uzs ?? 0);
      const m = Array.isArray(a.settlement) ? a.settlement[0]?.method : a.settlement?.method;
      if (m !== 'writeoff') paid += Number(a.amount_uzs ?? 0);
    }
    const status = (claim as { status: string }).status === 'denied'
      ? 'denied'
      : total >= claimAmt ? 'paid' : total > 0 ? 'partial' : 'submitted';
    await admin.from('insurance_claims')
      .update({ paid_amount_uzs: paid, status, paid_at: status === 'paid' ? new Date().toISOString() : null })
      .eq('id', claimId);
  }

  async createSettlement(clinicId: string, userId: string | null, body: {
    insurer_id?: string; method: string; settled_at?: string; notes?: string;
    allocations: Array<{ claim_id: string; amount_uzs: number }>;
  }) {
    const admin = this.supabase.admin();
    const total = body.allocations.reduce((s, a) => s + a.amount_uzs, 0);
    const { data: settle, error } = await admin.from('insurance_settlements').insert({
      clinic_id: clinicId, insurer_id: body.insurer_id ?? null, amount_uzs: total,
      method: body.method, settled_at: body.settled_at ?? undefined, notes: body.notes ?? null, created_by: userId,
    }).select('id').single();
    if (error) throw new Error(error.message);
    const settleId = (settle as { id: string }).id;
    for (const a of body.allocations) {
      await admin.from('insurance_settlement_allocations').insert({
        clinic_id: clinicId, settlement_id: settleId, claim_id: a.claim_id, amount_uzs: a.amount_uzs,
      });
      await this.recomputeClaim(clinicId, a.claim_id);
    }
    return { id: settleId };
  }

  /** Tezkor: bitta claim to'liq/qisman to'landi (insurer to'lovi). */
  async payClaim(clinicId: string, userId: string | null, id: string, body: { amount_uzs?: number; method?: string }) {
    const { data: claim } = await this.supabase.admin().from('insurance_claims').select('claim_amount_uzs, paid_amount_uzs, insurer_id').eq('clinic_id', clinicId).eq('id', id).single();
    const c = claim as { claim_amount_uzs: number; paid_amount_uzs: number; insurer_id: string | null };
    const remaining = Number(c.claim_amount_uzs) - Number(c.paid_amount_uzs);
    const amt = body.amount_uzs && body.amount_uzs > 0 ? body.amount_uzs : remaining;
    if (amt <= 0) throw new Error('To\'lash uchun qoldiq yo\'q');
    return this.createSettlement(clinicId, userId, {
      insurer_id: c.insurer_id ?? undefined, method: body.method ?? 'transfer',
      allocations: [{ claim_id: id, amount_uzs: amt }],
    });
  }

  /** Rad etish: qolgan summani 5200 ga write-off + status denied. */
  async denyClaim(clinicId: string, userId: string | null, id: string, reason: string) {
    const admin = this.supabase.admin();
    const { data: claim } = await admin.from('insurance_claims').select('claim_amount_uzs, paid_amount_uzs, insurer_id').eq('clinic_id', clinicId).eq('id', id).single();
    const c = claim as { claim_amount_uzs: number; paid_amount_uzs: number; insurer_id: string | null };
    const remaining = Number(c.claim_amount_uzs) - Number(c.paid_amount_uzs);
    await admin.from('insurance_claims').update({ status: 'denied', denial_reason: reason }).eq('clinic_id', clinicId).eq('id', id);
    if (remaining > 0) {
      await this.createSettlement(clinicId, userId, {
        insurer_id: c.insurer_id ?? undefined, method: 'writeoff', notes: `Rad: ${reason}`,
        allocations: [{ claim_id: id, amount_uzs: remaining }],
      });
    }
    // recompute denied holatini saqlaydi (status='denied' bo'ladi)
    await admin.from('insurance_claims').update({ status: 'denied' }).eq('clinic_id', clinicId).eq('id', id);
    return { ok: true };
  }

  async listSettlements(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('insurance_settlements')
      .select('*, insurer:insurance_companies(name)')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(100);
    return data ?? [];
  }

  // ===== Insurer aging (qarzdorlik hisoboti) ================================
  async insurerAging(clinicId: string, asOf: string) {
    const { data, error } = await this.supabase.admin().rpc('insurer_aging', { p_clinic: clinicId, p_as_of: asOf });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ insurer_name: string; total_owed: number; b0_30: number; b31_60: number; b61_90: number; b90_plus: number }>;
    const totals = rows.reduce(
      (a, r) => ({
        total_owed: a.total_owed + Number(r.total_owed ?? 0),
        b0_30: a.b0_30 + Number(r.b0_30 ?? 0), b31_60: a.b31_60 + Number(r.b31_60 ?? 0),
        b61_90: a.b61_90 + Number(r.b61_90 ?? 0), b90_plus: a.b90_plus + Number(r.b90_plus ?? 0),
      }),
      { total_owed: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0 },
    );
    return { rows, totals };
  }
}

@ApiTags('insurance')
@Controller({ path: 'insurance', version: '1' })
class InsuranceController {
  constructor(private readonly svc: InsuranceService) {}

  @Get('providers')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'cashier', 'receptionist')
  providers() {
    return this.svc.listProviders();
  }

  @Get('contracts')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  contracts(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listContracts(u.clinicId);
  }

  @Post('contracts')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  createContract(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.createContract(u.clinicId, u.userId ?? null, ContractSchema.parse(body));
  }

  @Post('contracts/:id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  updateContract(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Param('id') id: string, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateContract(u.clinicId, id, u.userId ?? null, ContractUpdateSchema.parse(body));
  }

  // --- Coverage preview (reception) ---
  @Post('coverage-preview')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'cashier', 'receptionist')
  preview(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    const p = PreviewSchema.parse(body);
    return this.svc.previewCoverage(u.clinicId, p.patient_id, p.items);
  }

  // --- Claims ---
  @Get('claims')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'cashier')
  claims(@CurrentUser() u: { clinicId: string | null }, @Query('status') status?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listClaims(u.clinicId, status);
  }

  @Get('claims/:id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'cashier')
  claim(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getClaim(u.clinicId, id);
  }

  @Post('claims/:id/submit')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'cashier')
  submit(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.submitClaim(u.clinicId, id);
  }

  @Post('claims/:id/pay')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'cashier')
  pay(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Param('id') id: string, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.payClaim(u.clinicId, u.userId ?? null, id, PayClaimSchema.parse(body));
  }

  @Post('claims/:id/deny')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  deny(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Param('id') id: string, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.denyClaim(u.clinicId, u.userId ?? null, id, DenySchema.parse(body).reason);
  }

  // --- Settlements ---
  @Get('settlements')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'cashier')
  settlements(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listSettlements(u.clinicId);
  }

  @Post('settlements')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'cashier')
  createSettlement(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.createSettlement(u.clinicId, u.userId ?? null, SettlementSchema.parse(body));
  }

  @Get('aging')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'cashier')
  aging(@CurrentUser() u: { clinicId: string | null }, @Query('as_of') asOf?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.insurerAging(u.clinicId, asOf || new Date().toISOString().slice(0, 10));
  }
}

@Module({
  controllers: [InsuranceController],
  providers: [InsuranceService, SupabaseService],
  exports: [InsuranceService],
})
export class InsuranceModule {}
