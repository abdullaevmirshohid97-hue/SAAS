import { Body, Controller, ForbiddenException, Get, Injectable, Module, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { SupabaseService } from '../../common/services/supabase.service';

const ImpersonateSchema = z.object({
  target_clinic_id: z.string().uuid(),
  target_user_id: z.string().uuid(),
  reason: z.string().min(20),
  support_ticket_id: z.string().uuid().optional(),
});

const FeatureFlagSchema = z.object({
  clinic_id: z.string().uuid(),
  feature: z.string().min(1),
  enabled: z.boolean(),
  reason: z.string().optional(),
});

@Injectable()
class AdminService {
  constructor(private readonly supabase: SupabaseService) {}

  async listTenants(q?: string) {
    let query = this.supabase.admin().from('clinics').select('*').is('deleted_at', null);
    if (q) query = query.ilike('name', `%${q}%`);
    const { data } = await query.order('created_at', { ascending: false }).limit(200);
    return data ?? [];
  }

  async getTenant(id: string) {
    const { data } = await this.supabase.admin().from('clinics').select('*, profiles(id, email, full_name, role), current_subscription:subscriptions(*)').eq('id', id).single();
    return data;
  }

  async suspend(id: string, reason: string) {
    const { data } = await this.supabase.admin().from('clinics').update({ is_suspended: true, suspension_reason: reason }).eq('id', id).select().single();
    return data;
  }

  async unsuspend(id: string) {
    const { data } = await this.supabase.admin().from('clinics').update({ is_suspended: false, suspension_reason: null }).eq('id', id).select().single();
    return data;
  }

  async impersonate(superAdminId: string, input: z.infer<typeof ImpersonateSchema>) {
    const { data: session } = await this.supabase.admin().from('admin_impersonation_sessions').insert({
      super_admin_id: superAdminId,
      target_clinic_id: input.target_clinic_id,
      target_user_id: input.target_user_id,
      reason: input.reason,
      support_ticket_id: input.support_ticket_id,
    }).select().single();
    // Real impl: mint a 30-min JWT with { sub: target_user, app_metadata: { clinic_id, role, impersonated_by } }
    return { session, note: 'JWT issuance pending Stripe-grade signing setup' };
  }

  async setFeatureFlag(input: z.infer<typeof FeatureFlagSchema>, enabledBy: string) {
    const { data } = await this.supabase.admin().from('clinic_features').upsert({
      clinic_id: input.clinic_id,
      feature: input.feature,
      enabled: input.enabled,
      reason: input.reason,
      enabled_at: input.enabled ? new Date().toISOString() : null,
      enabled_by: enabledBy,
    }, { onConflict: 'clinic_id,feature' }).select().single();
    return data;
  }

  async revenue() {
    const { data: invoices } = await this.supabase.admin().from('invoices').select('amount_usd_cents, status, issued_at');
    const totalRevenueCents = (invoices ?? []).filter((i) => i['status'] === 'paid').reduce((s, i) => s + (i['amount_usd_cents'] as number), 0);
    const { count: activeSubs } = await this.supabase.admin().from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active');
    return { totalRevenueUsd: totalRevenueCents / 100, activeSubscriptions: activeSubs ?? 0 };
  }

  async overview() {
    const admin = this.supabase.admin();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();

    const [
      tenantsHead,
      activeTenantsHead,
      doctorsHead,
      medicationsHead,
      activeSubsHead,
      trialHead,
      openTicketsHead,
      paidInvoices,
      recentClinics,
      txAgg,
      debts,
    ] = await Promise.all([
      admin.from('clinics').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      admin.from('clinics').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('is_suspended', false),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'doctor'),
      admin.from('medications').select('id', { count: 'exact', head: true }),
      admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'trialing'),
      admin.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'pending']),
      admin.from('invoices').select('amount_usd_cents, issued_at').eq('status', 'paid'),
      admin.from('clinics').select('id, name, created_at, is_suspended').is('deleted_at', null).order('created_at', { ascending: false }).limit(8),
      admin.from('transactions').select('amount_uzs, created_at').eq('kind', 'payment').eq('is_void', false).gte('created_at', thirtyDaysAgo),
      admin.from('transactions').select('amount_uzs').eq('kind', 'payment').eq('is_void', false).lt('amount_uzs', 0),
    ]);

    const totalRevenueCents = (paidInvoices.data ?? []).reduce(
      (s, i) => s + Number((i as { amount_usd_cents: number }).amount_usd_cents ?? 0),
      0,
    );
    const last30Days = (txAgg.data ?? []).reduce(
      (s, t) => s + Number((t as { amount_uzs: number }).amount_uzs ?? 0),
      0,
    );
    const debtTotal = (debts.data ?? []).reduce(
      (s, t) => s + Number((t as { amount_uzs: number }).amount_uzs ?? 0),
      0,
    );

    // Daily revenue series (last 30 days, UZS)
    const dailyMap = new Map<string, number>();
    for (const t of txAgg.data ?? []) {
      const day = String((t as { created_at: string }).created_at).slice(0, 10);
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + Number((t as { amount_uzs: number }).amount_uzs ?? 0));
    }
    const daily = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, amount]) => ({ day, amount_uzs: amount }));

    return {
      totals: {
        tenants: tenantsHead.count ?? 0,
        active_tenants: activeTenantsHead.count ?? 0,
        doctors: doctorsHead.count ?? 0,
        medications: medicationsHead.count ?? 0,
        active_subscriptions: activeSubsHead.count ?? 0,
        trial_subscriptions: trialHead.count ?? 0,
        open_tickets: openTicketsHead.count ?? 0,
        total_revenue_usd: totalRevenueCents / 100,
        last_30d_uzs: last30Days,
        debt_uzs: Math.abs(debtTotal),
      },
      recent_clinics: recentClinics.data ?? [],
      daily_revenue: daily,
    };
  }

  async listDoctors(q?: string, clinicId?: string) {
    const admin = this.supabase.admin();
    let query = admin
      .from('profiles')
      .select('id, full_name, email, phone, role, clinic_id, is_active, last_sign_in_at, created_at, clinic:clinics(id, name)')
      .eq('role', 'doctor')
      .order('full_name');
    if (clinicId) query = query.eq('clinic_id', clinicId);
    if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
    const { data } = await query.limit(500);
    return data ?? [];
  }

  async listPharmacies(clinicId?: string) {
    const admin = this.supabase.admin();
    let clinicsQ = admin.from('clinics').select('id, name').is('deleted_at', null);
    if (clinicId) clinicsQ = clinicsQ.eq('id', clinicId);
    const { data: clinics } = await clinicsQ;

    const out: Array<{
      clinic_id: string;
      clinic_name: string;
      medications_count: number;
      low_stock: number;
      sales_30d_uzs: number;
    }> = [];
    for (const c of (clinics as Array<{ id: string; name: string }> | null) ?? []) {
      const [med, low, sales] = await Promise.all([
        admin.from('medications').select('id', { count: 'exact', head: true }).eq('clinic_id', c.id),
        admin.from('medication_stock_summary').select('medication_id, stock_qty, reorder_level').eq('clinic_id', c.id),
        admin
          .from('pharmacy_sales')
          .select('total_uzs')
          .eq('clinic_id', c.id)
          .gte('created_at', new Date(Date.now() - 30 * 86400 * 1000).toISOString()),
      ]);
      const lowCount = (low.data ?? []).filter(
        (r) => Number((r as { stock_qty: number }).stock_qty) <= Number((r as { reorder_level: number }).reorder_level ?? 0),
      ).length;
      const salesTotal = (sales.data ?? []).reduce(
        (s, r) => s + Number((r as { total_uzs: number }).total_uzs ?? 0),
        0,
      );
      out.push({
        clinic_id: c.id,
        clinic_name: c.name,
        medications_count: med.count ?? 0,
        low_stock: lowCount,
        sales_30d_uzs: salesTotal,
      });
    }
    return out.sort((a, b) => b.sales_30d_uzs - a.sales_30d_uzs);
  }

  async platformAnalytics(days: number) {
    const admin = this.supabase.admin();
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
    const [tx, exp, clinics] = await Promise.all([
      admin
        .from('transactions')
        .select('amount_uzs, created_at, clinic_id')
        .eq('kind', 'payment')
        .eq('is_void', false)
        .gte('created_at', since),
      admin.from('expenses').select('amount_uzs, created_at, clinic_id').gte('created_at', since),
      admin.from('clinics').select('id, name').is('deleted_at', null),
    ]);

    const clinicsMap = new Map<string, string>();
    for (const c of (clinics.data ?? []) as Array<{ id: string; name: string }>) {
      clinicsMap.set(c.id, c.name);
    }

    const daily: Record<string, { day: string; revenue: number; expenses: number }> = {};
    for (const t of (tx.data ?? []) as Array<{ amount_uzs: number; created_at: string }>) {
      const d = String(t.created_at).slice(0, 10);
      daily[d] ??= { day: d, revenue: 0, expenses: 0 };
      daily[d]!.revenue += Number(t.amount_uzs ?? 0);
    }
    for (const e of (exp.data ?? []) as Array<{ amount_uzs: number; created_at: string }>) {
      const d = String(e.created_at).slice(0, 10);
      daily[d] ??= { day: d, revenue: 0, expenses: 0 };
      daily[d]!.expenses += Number(e.amount_uzs ?? 0);
    }
    const series = Object.values(daily).sort((a, b) => a.day.localeCompare(b.day));

    const byClinic = new Map<string, { revenue: number; expenses: number }>();
    for (const t of (tx.data ?? []) as Array<{ amount_uzs: number; clinic_id: string }>) {
      const row = byClinic.get(t.clinic_id) ?? { revenue: 0, expenses: 0 };
      row.revenue += Number(t.amount_uzs ?? 0);
      byClinic.set(t.clinic_id, row);
    }
    for (const e of (exp.data ?? []) as Array<{ amount_uzs: number; clinic_id: string }>) {
      const row = byClinic.get(e.clinic_id) ?? { revenue: 0, expenses: 0 };
      row.expenses += Number(e.amount_uzs ?? 0);
      byClinic.set(e.clinic_id, row);
    }
    const leaderboard = Array.from(byClinic.entries())
      .map(([id, v]) => ({
        clinic_id: id,
        clinic_name: clinicsMap.get(id) ?? id,
        revenue: v.revenue,
        expenses: v.expenses,
        profit: v.revenue - v.expenses,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return { series, leaderboard };
  }

  private async logAdmin(
    actor: string,
    action: string,
    opts: {
      clinic?: string | null;
      resourceType?: string;
      resourceId?: string | null;
      reason?: string;
      query?: Record<string, unknown>;
      count?: number;
    } = {},
  ) {
    try {
      await this.supabase.admin().rpc('log_super_admin_action', {
        p_actor: actor,
        p_action: action,
        p_target_clinic: opts.clinic ?? null,
        p_resource_type: opts.resourceType ?? null,
        p_resource_id: opts.resourceId ?? null,
        p_reason: opts.reason ?? null,
        p_query: opts.query ?? {},
        p_count: opts.count ?? null,
      });
    } catch {
      // audit must never block the main flow
    }
  }

  // ---------------------------------------------------------------------------
  // Cross-tenant patients
  // ---------------------------------------------------------------------------
  async listPatients(
    actor: string,
    q?: string,
    clinicId?: string,
    limit = 50,
    offset = 0,
  ) {
    const admin = this.supabase.admin();
    let query = admin
      .from('patients')
      .select(
        'id, clinic_id, full_name, phone, birth_date, gender, created_at, clinic:clinics(id, name)',
        { count: 'exact' },
      )
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (clinicId) query = query.eq('clinic_id', clinicId);
    if (q && q.trim()) {
      const esc = q.replace(/[%,]/g, ' ').trim();
      query = query.or(`full_name.ilike.%${esc}%,phone.ilike.%${esc}%`);
    }
    const { data, count } = await query.range(offset, offset + Math.min(limit, 200) - 1);
    await this.logAdmin(actor, 'patients.list', {
      clinic: clinicId ?? null,
      resourceType: 'patient',
      query: { q, clinic_id: clinicId, limit, offset },
      count: data?.length ?? 0,
    });
    return { data: data ?? [], total: count ?? 0 };
  }

  async patientTimeline(actor: string, patientId: string) {
    const admin = this.supabase.admin();
    const { data: patient } = await admin
      .from('patients')
      .select('id, clinic_id, full_name, phone, birth_date, gender, created_at, clinic:clinics(id, name)')
      .eq('id', patientId)
      .single();
    if (!patient) throw new Error('patient not found');

    const [appts, labs, rx, diag, pay, visits] = await Promise.all([
      admin
        .from('appointments')
        .select('id, scheduled_at, status, doctor_id, service_id, created_at')
        .eq('patient_id', patientId)
        .order('scheduled_at', { ascending: false })
        .limit(100),
      admin
        .from('lab_orders')
        .select('id, status, created_at, test_ids:lab_order_tests(test_id)')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('prescriptions')
        .select('id, status, issued_at, doctor_id')
        .eq('patient_id', patientId)
        .order('issued_at', { ascending: false })
        .limit(100),
      admin
        .from('diagnostic_orders')
        .select('id, status, created_at, equipment_id')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('transactions')
        .select('id, kind, amount_uzs, method, created_at, is_void')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('home_nurse_visits')
        .select('id, status, scheduled_at, clinic_id')
        .eq('patient_id', patientId)
        .order('scheduled_at', { ascending: false })
        .limit(50),
    ]);

    await this.logAdmin(actor, 'patient.timeline', {
      clinic: (patient as { clinic_id: string }).clinic_id,
      resourceType: 'patient',
      resourceId: patientId,
      count: (appts.data?.length ?? 0) + (labs.data?.length ?? 0) + (rx.data?.length ?? 0),
    });

    return {
      patient,
      appointments: appts.data ?? [],
      lab_orders: labs.data ?? [],
      prescriptions: rx.data ?? [],
      diagnostic_orders: diag.data ?? [],
      transactions: pay.data ?? [],
      home_nurse_visits: visits.data ?? [],
    };
  }

  // ---------------------------------------------------------------------------
  // Finance deep-dive
  // ---------------------------------------------------------------------------
  async financeOverview(actor: string, days: number) {
    const admin = this.supabase.admin();
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
    const [tx, exp, invoices, clinics] = await Promise.all([
      admin.from('transactions').select('amount_uzs, kind, method, clinic_id, created_at, is_void').gte('created_at', since).eq('is_void', false),
      admin.from('expenses').select('amount_uzs, clinic_id, created_at').gte('created_at', since),
      admin.from('invoices').select('amount_usd_cents, status, issued_at').gte('issued_at', since),
      admin.from('clinics').select('id, name').is('deleted_at', null),
    ]);

    const clinicsMap = new Map<string, string>();
    for (const c of (clinics.data ?? []) as Array<{ id: string; name: string }>) clinicsMap.set(c.id, c.name);

    const byMethod = new Map<string, number>();
    const byClinic = new Map<string, { revenue: number; expenses: number; debts: number }>();
    let revenue = 0;
    let debts = 0;
    for (const t of (tx.data ?? []) as Array<{ amount_uzs: number; method: string; clinic_id: string; kind: string }>) {
      if (t.kind !== 'payment') continue;
      const amt = Number(t.amount_uzs ?? 0);
      revenue += amt;
      if (amt < 0) debts += Math.abs(amt);
      byMethod.set(t.method, (byMethod.get(t.method) ?? 0) + amt);
      const row = byClinic.get(t.clinic_id) ?? { revenue: 0, expenses: 0, debts: 0 };
      row.revenue += amt;
      if (amt < 0) row.debts += Math.abs(amt);
      byClinic.set(t.clinic_id, row);
    }
    let expensesTotal = 0;
    for (const e of (exp.data ?? []) as Array<{ amount_uzs: number; clinic_id: string }>) {
      const amt = Number(e.amount_uzs ?? 0);
      expensesTotal += amt;
      const row = byClinic.get(e.clinic_id) ?? { revenue: 0, expenses: 0, debts: 0 };
      row.expenses += amt;
      byClinic.set(e.clinic_id, row);
    }

    const leaderboard = Array.from(byClinic.entries())
      .map(([id, v]) => ({
        clinic_id: id,
        clinic_name: clinicsMap.get(id) ?? id,
        revenue: v.revenue,
        expenses: v.expenses,
        debts: v.debts,
        profit: v.revenue - v.expenses,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const subscriptions = (invoices.data ?? [])
      .filter((i) => (i as { status: string }).status === 'paid')
      .reduce((s, i) => s + Number((i as { amount_usd_cents: number }).amount_usd_cents ?? 0), 0) / 100;

    await this.logAdmin(actor, 'finance.overview', { query: { days }, count: leaderboard.length });

    return {
      totals: {
        revenue_uzs: revenue,
        expenses_uzs: expensesTotal,
        debts_uzs: debts,
        profit_uzs: revenue - expensesTotal,
        subscriptions_usd: subscriptions,
      },
      by_method: Array.from(byMethod.entries()).map(([method, amount_uzs]) => ({ method, amount_uzs })),
      leaderboard,
    };
  }

  async medicationsUsage(actor: string, limit = 100) {
    const admin = this.supabase.admin();
    const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const [sales, meds, clinics] = await Promise.all([
      admin
        .from('pharmacy_sale_items')
        .select('medication_id, quantity, subtotal_uzs, clinic_id')
        .gte('created_at', since),
      admin.from('medications').select('id, name, manufacturer, clinic_id'),
      admin.from('clinics').select('id, name'),
    ]);
    const clinicsMap = new Map<string, string>();
    for (const c of (clinics.data ?? []) as Array<{ id: string; name: string }>) clinicsMap.set(c.id, c.name);
    const medsMap = new Map<string, { name: string; manufacturer: string | null; clinic_id: string }>();
    for (const m of (meds.data ?? []) as Array<{ id: string; name: string; manufacturer: string | null; clinic_id: string }>)
      medsMap.set(m.id, { name: m.name, manufacturer: m.manufacturer, clinic_id: m.clinic_id });

    type Row = { name: string; manufacturer: string | null; qty: number; revenue: number; clinic_id: string; clinic_name: string };
    const byMed = new Map<string, Row>();
    for (const s of (sales.data ?? []) as Array<{ medication_id: string; quantity: number; subtotal_uzs: number }>) {
      const info = medsMap.get(s.medication_id);
      if (!info) continue;
      const key = `${info.clinic_id}::${s.medication_id}`;
      const row = byMed.get(key) ?? {
        name: info.name,
        manufacturer: info.manufacturer,
        qty: 0,
        revenue: 0,
        clinic_id: info.clinic_id,
        clinic_name: clinicsMap.get(info.clinic_id) ?? info.clinic_id,
      };
      row.qty += Number(s.quantity ?? 0);
      row.revenue += Number(s.subtotal_uzs ?? 0);
      byMed.set(key, row);
    }
    const ranked = Array.from(byMed.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, limit);
    await this.logAdmin(actor, 'medications.ranking', { count: ranked.length });
    return ranked;
  }

  async diagnosticsPopularity(actor: string) {
    const admin = this.supabase.admin();
    const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const [orders, equip, clinics] = await Promise.all([
      admin
        .from('diagnostic_orders')
        .select('equipment_id, clinic_id, created_at, status')
        .gte('created_at', since),
      admin.from('diagnostic_equipment').select('id, name_i18n, category, clinic_id'),
      admin.from('clinics').select('id, name'),
    ]);
    const clinicsMap = new Map<string, string>();
    for (const c of (clinics.data ?? []) as Array<{ id: string; name: string }>) clinicsMap.set(c.id, c.name);
    const equipMap = new Map<string, { name: string; modality: string; clinic_id: string }>();
    const pickName = (i18n: Record<string, string> | null | undefined) => {
      if (!i18n) return 'Noma‘lum uskuna';
      return i18n['uz-Latn'] ?? i18n['uz'] ?? i18n['ru'] ?? i18n['en'] ?? Object.values(i18n)[0] ?? 'Noma‘lum uskuna';
    };
    for (const e of (equip.data ?? []) as Array<{ id: string; name_i18n: Record<string, string>; category: string; clinic_id: string }>)
      equipMap.set(e.id, { name: pickName(e.name_i18n), modality: e.category, clinic_id: e.clinic_id });

    type Row = { equipment_id: string; name: string; modality: string; orders: number; clinic_id: string; clinic_name: string };
    const byEq = new Map<string, Row>();
    for (const o of (orders.data ?? []) as Array<{ equipment_id: string; clinic_id: string }>) {
      if (!o.equipment_id) continue;
      const info = equipMap.get(o.equipment_id);
      if (!info) continue;
      const row = byEq.get(o.equipment_id) ?? {
        equipment_id: o.equipment_id,
        name: info.name,
        modality: info.modality,
        orders: 0,
        clinic_id: info.clinic_id,
        clinic_name: clinicsMap.get(info.clinic_id) ?? info.clinic_id,
      };
      row.orders += 1;
      byEq.set(o.equipment_id, row);
    }
    const ranked = Array.from(byEq.values()).sort((a, b) => b.orders - a.orders);
    await this.logAdmin(actor, 'diagnostics.popularity', { count: ranked.length });
    return ranked;
  }

  // ---------------------------------------------------------------------------
  // Cross-clinic support threads
  // ---------------------------------------------------------------------------
  async listSupportThreads(
    actor: string,
    filters: { status?: string; category?: string; clinic_id?: string; q?: string; limit?: number; offset?: number },
  ) {
    const admin = this.supabase.admin();
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = filters.offset ?? 0;
    let query = admin
      .from('support_tickets')
      .select(
        'id, clinic_id, status, subject, priority, category, created_at, updated_at, clinic:clinics(id, name)',
        { count: 'exact' },
      )
      .order('updated_at', { ascending: false });
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.clinic_id) query = query.eq('clinic_id', filters.clinic_id);
    if (filters.q && filters.q.trim()) query = query.ilike('subject', `%${filters.q.trim()}%`);
    const { data, count } = await query.range(offset, offset + limit - 1);
    await this.logAdmin(actor, 'support.list', { query: filters as unknown as Record<string, unknown>, count: data?.length ?? 0 });
    return { data: data ?? [], total: count ?? 0 };
  }

  async patchSupportThread(actor: string, id: string, patch: { status?: string; priority?: string; category?: string }) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('support_tickets')
      .update(patch)
      .eq('id', id)
      .select('id, clinic_id, status, priority, category')
      .single();
    if (error) throw new Error(error.message);
    await this.logAdmin(actor, 'support.patch', {
      clinic: (data as { clinic_id: string } | null)?.clinic_id ?? null,
      resourceType: 'support_ticket',
      resourceId: id,
      query: patch as unknown as Record<string, unknown>,
    });
    return data;
  }

  async issueImpersonationToken(superAdminId: string, targetUserId: string, reason: string) {
    const admin = this.supabase.admin();
    const { data: target, error: tErr } = await admin
      .from('profiles')
      .select('id, email, full_name, clinic_id, role')
      .eq('id', targetUserId)
      .single();
    if (tErr || !target) throw new Error(tErr?.message ?? 'user not found');
    const t = target as { id: string; email: string; full_name: string; clinic_id: string; role: string };

    const { data: session } = await admin
      .from('admin_impersonation_sessions')
      .insert({
        super_admin_id: superAdminId,
        target_clinic_id: t.clinic_id,
        target_user_id: t.id,
        reason,
      })
      .select()
      .single();

    // Supabase Admin API: generate a magiclink for the target user
    const generated = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: t.email,
    });
    const actionLink =
      (generated.data as { properties?: { action_link?: string } } | null)?.properties?.action_link ?? null;

    return {
      session,
      target: { id: t.id, email: t.email, clinic_id: t.clinic_id, role: t.role },
      action_link: actionLink,
      note: 'Redirect super admin to action_link to consume magic link and impersonate',
    };
  }
}

@ApiTags('admin')
@Controller('admin')
@UseGuards(SuperAdminGuard)
class AdminController {
  constructor(private readonly svc: AdminService) {}

  @Get('tenants')
  tenants(@Query('q') q?: string) { return this.svc.listTenants(q); }

  @Get('tenants/:id')
  tenant(@Param('id', ParseUUIDPipe) id: string) { return this.svc.getTenant(id); }

  @Post('tenants/:id/suspend')
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body() body: { reason: string }) {
    return this.svc.suspend(id, body.reason);
  }

  @Post('tenants/:id/unsuspend')
  unsuspend(@Param('id', ParseUUIDPipe) id: string) { return this.svc.unsuspend(id); }

  @Post('impersonate')
  impersonate(@CurrentUser() u: { userId: string | null }, @Body() body: unknown) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.impersonate(u.userId, ImpersonateSchema.parse(body));
  }

  @Post('feature-flags')
  setFlag(@CurrentUser() u: { userId: string | null }, @Body() body: unknown) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.setFeatureFlag(FeatureFlagSchema.parse(body), u.userId);
  }

  @Get('revenue')
  revenue() { return this.svc.revenue(); }

  @Get('overview')
  overview() { return this.svc.overview(); }

  @Get('doctors')
  doctors(@Query('q') q?: string, @Query('clinic_id') clinicId?: string) {
    return this.svc.listDoctors(q, clinicId);
  }

  @Get('pharmacies')
  pharmacies(@Query('clinic_id') clinicId?: string) {
    return this.svc.listPharmacies(clinicId);
  }

  @Get('analytics')
  platformAnalytics(@Query('days') days?: string) {
    const n = Number(days ?? '30');
    return this.svc.platformAnalytics(Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 30);
  }

  @Post('impersonate/token')
  impersonationToken(
    @CurrentUser() u: { userId: string | null },
    @Body() body: { target_user_id: string; reason: string },
  ) {
    if (!u.userId) throw new ForbiddenException();
    if (!body?.target_user_id || !body?.reason || body.reason.length < 10) {
      throw new ForbiddenException('target_user_id and reason (>=10 chars) required');
    }
    return this.svc.issueImpersonationToken(u.userId, body.target_user_id, body.reason);
  }

  @Get('patients')
  listPatients(
    @CurrentUser() u: { userId: string | null },
    @Query('q') q?: string,
    @Query('clinic_id') clinicId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.listPatients(u.userId, q, clinicId, Number(limit) || 50, Number(offset) || 0);
  }

  @Get('patients/:id/timeline')
  patientTimeline(@CurrentUser() u: { userId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.patientTimeline(u.userId, id);
  }

  @Get('finance/overview')
  financeOverview(@CurrentUser() u: { userId: string | null }, @Query('days') days?: string) {
    if (!u.userId) throw new ForbiddenException();
    const n = Number(days ?? '30');
    return this.svc.financeOverview(u.userId, Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 30);
  }

  @Get('medications/ranking')
  medicationsRanking(@CurrentUser() u: { userId: string | null }, @Query('limit') limit?: string) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.medicationsUsage(u.userId, Number(limit) || 100);
  }

  @Get('diagnostics/popularity')
  diagnosticsPopularity(@CurrentUser() u: { userId: string | null }) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.diagnosticsPopularity(u.userId);
  }

  @Get('support/threads')
  listSupport(
    @CurrentUser() u: { userId: string | null },
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('clinic_id') clinicId?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.listSupportThreads(u.userId, {
      status,
      category,
      clinic_id: clinicId,
      q,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
    });
  }

  @Post('support/threads/:id')
  patchSupport(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status?: string; priority?: string; category?: string },
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.patchSupportThread(u.userId, id, body ?? {});
  }
}

@Module({
  controllers: [AdminController],
  providers: [AdminService, SupabaseService],
})
export class AdminModule {}
