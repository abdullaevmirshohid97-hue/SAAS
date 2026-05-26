import {
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function rangeFor(
  preset: string | undefined,
  fromArg?: string,
  toArg?: string,
): { from: string; to: string } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  if (fromArg && toArg) return { from: fromArg, to: toArg };
  switch (preset) {
    case 'week':
      start.setDate(start.getDate() - 6);
      break;
    case 'month':
      start.setDate(1);
      break;
    case 'year':
      start.setMonth(0, 1);
      break;
    case 'today':
    default:
      break;
  }
  start.setHours(0, 0, 0, 0);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------
@Injectable()
export class AnalyticsService {
  constructor(private readonly supabase: SupabaseService) {}

  async overview(clinicId: string, from: string, to: string) {
    const admin = this.supabase.admin();
    const [revenueDaily, expenseDaily, pharmacyDaily, patients, appointments] = await Promise.all([
      admin
        .from('daily_revenue_view')
        .select('day, revenue_uzs, transactions')
        .eq('clinic_id', clinicId)
        .gte('day', from)
        .lte('day', to)
        .order('day'),
      admin
        .from('daily_expense_view')
        .select('day, expenses_uzs')
        .eq('clinic_id', clinicId)
        .gte('day', from)
        .lte('day', to)
        .order('day'),
      admin
        .from('pharmacy_daily_view')
        .select('day, sales, revenue_uzs, debt_uzs')
        .eq('clinic_id', clinicId)
        .gte('day', from)
        .lte('day', to)
        .order('day'),
      admin
        .from('patients')
        .select('id, created_at', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .gte('created_at', `${from}T00:00:00Z`)
        .lte('created_at', `${to}T23:59:59Z`),
      admin
        .from('appointments')
        .select('id, status, scheduled_at', { count: 'exact' })
        .eq('clinic_id', clinicId)
        .gte('scheduled_at', `${from}T00:00:00Z`)
        .lte('scheduled_at', `${to}T23:59:59Z`),
    ]);

    const rev = (revenueDaily.data ?? []) as Array<{
      day: string;
      revenue_uzs: number;
      transactions: number;
    }>;
    const exp = (expenseDaily.data ?? []) as Array<{ day: string; expenses_uzs: number }>;
    const pharm = (pharmacyDaily.data ?? []) as Array<{
      day: string;
      sales: number;
      revenue_uzs: number;
      debt_uzs: number;
    }>;

    const totalRevenue = rev.reduce((a, r) => a + Number(r.revenue_uzs ?? 0), 0);
    const totalExpenses = exp.reduce((a, r) => a + Number(r.expenses_uzs ?? 0), 0);
    const totalTransactions = rev.reduce((a, r) => a + Number(r.transactions ?? 0), 0);
    const avgCheck = totalTransactions > 0 ? Math.round(totalRevenue / totalTransactions) : 0;
    const totalPharmacy = pharm.reduce((a, r) => a + Number(r.revenue_uzs ?? 0), 0);

    // Merge daily series for chart
    const map = new Map<string, { day: string; revenue: number; expenses: number; pharmacy: number }>();
    for (const r of rev) map.set(r.day, { day: r.day, revenue: Number(r.revenue_uzs ?? 0), expenses: 0, pharmacy: 0 });
    for (const r of exp) {
      const e = map.get(r.day) ?? { day: r.day, revenue: 0, expenses: 0, pharmacy: 0 };
      e.expenses = Number(r.expenses_uzs ?? 0);
      map.set(r.day, e);
    }
    for (const r of pharm) {
      const e = map.get(r.day) ?? { day: r.day, revenue: 0, expenses: 0, pharmacy: 0 };
      e.pharmacy = Number(r.revenue_uzs ?? 0);
      map.set(r.day, e);
    }
    const daily = Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));

    const apptRows = (appointments.data ?? []) as Array<{ status: string }>;
    const apptStatus: Record<string, number> = {};
    for (const a of apptRows) apptStatus[a.status] = (apptStatus[a.status] ?? 0) + 1;

    return {
      totals: {
        revenue_uzs: totalRevenue,
        expenses_uzs: totalExpenses,
        profit_uzs: totalRevenue - totalExpenses,
        avg_check_uzs: avgCheck,
        transactions: totalTransactions,
        new_patients: patients.count ?? 0,
        appointments: appointments.count ?? 0,
        pharmacy_revenue_uzs: totalPharmacy,
      },
      daily,
      appointment_status: apptStatus,
    };
  }

  async doctors(clinicId: string, from: string, to: string) {
    const { data } = await this.supabase
      .admin()
      .from('doctor_productivity_view')
      .select('doctor_id, doctor_name, day, visits, unique_patients, revenue_uzs')
      .eq('clinic_id', clinicId)
      .gte('day', from)
      .lte('day', to);

    const rows = (data ?? []) as Array<{
      doctor_id: string | null;
      doctor_name: string | null;
      day: string;
      visits: number;
      unique_patients: number;
      revenue_uzs: number;
    }>;

    const aggMap = new Map<
      string,
      { doctor_id: string | null; doctor_name: string; visits: number; patients: number; revenue: number }
    >();
    for (const r of rows) {
      const key = r.doctor_id ?? '—';
      const cur = aggMap.get(key) ?? {
        doctor_id: r.doctor_id,
        doctor_name: r.doctor_name ?? 'Nomaʼlum',
        visits: 0,
        patients: 0,
        revenue: 0,
      };
      cur.visits += Number(r.visits ?? 0);
      cur.patients += Number(r.unique_patients ?? 0);
      cur.revenue += Number(r.revenue_uzs ?? 0);
      aggMap.set(key, cur);
    }
    return Array.from(aggMap.values()).sort((a, b) => b.revenue - a.revenue);
  }

  async heatmap(clinicId: string, from: string, to: string) {
    const { data } = await this.supabase
      .admin()
      .from('transactions')
      .select('created_at')
      .eq('clinic_id', clinicId)
      .eq('is_void', false)
      .gte('created_at', `${from}T00:00:00Z`)
      .lte('created_at', `${to}T23:59:59Z`);

    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of (data ?? []) as Array<{ created_at: string }>) {
      const d = new Date(r.created_at);
      // Tashkent offset approximation — UTC+5
      const dow = (d.getUTCDay() + 1) % 7; // approx
      const hour = (d.getUTCHours() + 5) % 24;
      const row = grid[dow];
      if (row) row[hour] = (row[hour] ?? 0) + 1;
    }
    return { grid };
  }

  async topServices(clinicId: string, from: string, to: string) {
    // service_hour_heatmap_view sana ustuniga ega emas (DOW/soat bo'yicha
    // oldindan jamlangan), shuning uchun transactions + transaction_items'dan
    // to'g'ridan-to'g'ri sana oralig'i bilan hisoblaymiz (heatmap patterni).
    const { data } = await this.supabase
      .admin()
      .from('transactions')
      .select('items:transaction_items(service_id, service_name_snapshot, final_amount_uzs)')
      .eq('clinic_id', clinicId)
      .eq('is_void', false)
      .gte('created_at', `${from}T00:00:00Z`)
      .lte('created_at', `${to}T23:59:59Z`);
    const rows = (data ?? []) as Array<{
      items: Array<{
        service_id: string | null;
        service_name_snapshot: string | null;
        final_amount_uzs: number | null;
      }> | null;
    }>;
    const agg = new Map<string, { service_name: string; count: number; revenue: number }>();
    for (const t of rows) {
      for (const it of t.items ?? []) {
        const name = it.service_name_snapshot ?? '—';
        const key = it.service_id ?? name;
        const cur = agg.get(key) ?? { service_name: name, count: 0, revenue: 0 };
        cur.count += 1;
        cur.revenue += Number(it.final_amount_uzs ?? 0);
        agg.set(key, cur);
      }
    }
    return Array.from(agg.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }

  // Dashboard widget — so'nggi 7 kunlik yangi bemorlar kunlik histogram.
  // Asia/Tashkent kun chegaralari.
  async newPatientsTrend(clinicId: string) {
    const admin = this.supabase.admin();
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 6);
    from.setHours(0, 0, 0, 0);
    const { data } = await admin
      .from('patients')
      .select('id, created_at')
      .eq('clinic_id', clinicId)
      .gte('created_at', from.toISOString())
      .order('created_at');

    // 7 kunlik bucketlar
    const buckets = new Map<string, number>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(from);
      d.setDate(from.getDate() + i);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const r of (data ?? []) as Array<{ created_at: string }>) {
      const key = r.created_at.slice(0, 10);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Array.from(buckets.entries()).map(([day, count]) => ({ day, count }));
  }

  // Dashboard widget — kelayotgan N kun ichida tug'ilgan kun.
  async upcomingBirthdays(clinicId: string, days = 7) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('patients')
      .select('id, full_name, phone, dob')
      .eq('clinic_id', clinicId)
      .not('dob', 'is', null);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const list: Array<{
      id: string;
      full_name: string | null;
      phone: string | null;
      dob: string;
      next_birthday: string;
      days_until: number;
    }> = [];
    for (const r of (data ?? []) as Array<{
      id: string;
      full_name: string | null;
      phone: string | null;
      dob: string | null;
    }>) {
      if (!r.dob) continue;
      const dob = new Date(r.dob);
      if (isNaN(dob.getTime())) continue;
      let next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
      if (next < today) {
        next = new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate());
      }
      const diffDays = Math.floor((next.getTime() - today.getTime()) / 86_400_000);
      if (diffDays <= days) {
        list.push({
          id: r.id,
          full_name: r.full_name,
          phone: r.phone,
          dob: r.dob,
          next_birthday: next.toISOString().slice(0, 10),
          days_until: diffDays,
        });
      }
    }
    return list.sort((a, b) => a.days_until - b.days_until);
  }

  // ===========================================================================
  // FAZA 1: Money Intelligence — cash anomaly + refund fraud + forecast
  // ===========================================================================

  // Cash anomaly — smena kassa farqi IQR asosida
  async cashAnomalies(clinicId: string, limit = 20) {
    const { data } = await this.supabase
      .admin()
      .from('shift_cash_anomaly_view')
      .select(
        '*, operator:shift_operators(full_name)',
      )
      .eq('clinic_id', clinicId)
      .order('closed_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as unknown[];
  }

  // Cashier refund fraud — vozvrat nisbati >10% kassirlar
  async refundFraudAlerts(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('cashier_refund_ratio_view')
      .select(
        '*, cashier:profiles!cashier_refund_ratio_view_cashier_id_fkey(full_name)',
      )
      .eq('clinic_id', clinicId)
      .in('risk_level', ['high_risk', 'medium_risk'])
      .order('week_start', { ascending: false })
      .limit(20);
    return (data ?? []) as unknown[];
  }

  // Cash forecast — kelasi 7 kun (DoW pattern asosida)
  async cashForecast(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('daily_revenue_history_view')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('day');
    const rows = (data ?? []) as Array<{
      day: string;
      dow: number;
      revenue_uzs: number;
      tx_count: number;
    }>;

    // Har dow uchun median revenue hisoblanadi (so'nggi 4 hafta)
    const byDow = new Map<number, number[]>();
    for (const r of rows) {
      const list = byDow.get(r.dow) ?? [];
      list.push(Number(r.revenue_uzs ?? 0));
      byDow.set(r.dow, list);
    }
    const medianByDow = new Map<number, number>();
    for (const [dow, values] of byDow.entries()) {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const med = sorted.length === 0
        ? 0
        : sorted.length % 2 === 0
          ? (sorted[mid - 1]! + sorted[mid]!) / 2
          : sorted[mid]!;
      medianByDow.set(dow, med);
    }

    // Trend faktor: so'nggi 7 kun avg / oldingi 7 kun avg
    const last7 = rows.slice(-7).reduce((s, r) => s + Number(r.revenue_uzs ?? 0), 0) / 7;
    const prev7 = rows.slice(-14, -7).reduce((s, r) => s + Number(r.revenue_uzs ?? 0), 0) / 7;
    const trend = prev7 > 0 ? last7 / prev7 : 1;

    // Kelasi 7 kun bashorat
    const today = new Date();
    const forecast: Array<{ day: string; dow: number; predicted_uzs: number }> = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dow = d.getDay();
      const median = medianByDow.get(dow) ?? 0;
      forecast.push({
        day: d.toISOString().slice(0, 10),
        dow,
        predicted_uzs: Math.round(median * trend),
      });
    }

    return {
      history: rows,
      forecast,
      trend_factor: Math.round(trend * 100) / 100,
      last_7d_avg: Math.round(last7),
      prev_7d_avg: Math.round(prev7),
    };
  }

  // ===========================================================================
  // FAZA 2: CRM — Patient segmentation
  // ===========================================================================

  // Bemor segmentatsiya — aggregat statistika va to'liq ro'yxat
  async patientSegments(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('patient_segments_view')
      .select('*')
      .eq('clinic_id', clinicId);

    const rows = (data ?? []) as Array<{
      id: string;
      full_name: string | null;
      phone: string | null;
      ltv_uzs: number;
      visit_count: number;
      last_visit: string | null;
      avg_check_uzs: number;
      churn_segment: 'active' | 'at_risk' | 'churned' | 'never_visited';
      ltv_segment: 'vip' | 'regular' | 'occasional' | 'new';
      days_since_last_activity: number;
    }>;

    // Aggregat
    const summary = {
      total: rows.length,
      by_ltv: { vip: 0, regular: 0, occasional: 0, new: 0 },
      by_churn: { active: 0, at_risk: 0, churned: 0, never_visited: 0 },
      total_ltv_uzs: 0,
    };
    for (const r of rows) {
      summary.by_ltv[r.ltv_segment] = (summary.by_ltv[r.ltv_segment] ?? 0) + 1;
      summary.by_churn[r.churn_segment] = (summary.by_churn[r.churn_segment] ?? 0) + 1;
      summary.total_ltv_uzs += Number(r.ltv_uzs ?? 0);
    }

    // Yo'qolish xavfi top 10 (eng ko'p sarflagan, lekin uzoq vaqt yo'q)
    const atRiskTop = rows
      .filter((r) => r.churn_segment === 'at_risk' || r.churn_segment === 'churned')
      .sort((a, b) => Number(b.ltv_uzs) - Number(a.ltv_uzs))
      .slice(0, 10);

    // VIP top 10
    const vipTop = rows
      .filter((r) => r.ltv_segment === 'vip')
      .sort((a, b) => Number(b.ltv_uzs) - Number(a.ltv_uzs))
      .slice(0, 10);

    return { summary, at_risk_top: atRiskTop, vip_top: vipTop };
  }

  // ===========================================================================
  // FAZA 3: Operatsion analitika — Shifokor anomaliya
  // ===========================================================================

  async doctorAnomalies(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('doctor_anomaly_view')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('total_revenue', { ascending: false });
    const rows = (data ?? []) as Array<{
      doctor_id: string;
      doctor_name: string;
      total_visits: number;
      total_patients: number;
      total_revenue: number;
      avg_check_uzs: number;
      working_days: number;
      q1_check: number;
      q3_check: number;
      performance_flag: 'below_expected' | 'normal' | 'above_expected' | 'insufficient_data';
    }>;

    const summary = {
      total_doctors: rows.length,
      below_expected: rows.filter((r) => r.performance_flag === 'below_expected').length,
      above_expected: rows.filter((r) => r.performance_flag === 'above_expected').length,
      normal: rows.filter((r) => r.performance_flag === 'normal').length,
    };

    return { summary, doctors: rows };
  }

  async inpatientShare(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('inpatient_occupancy_view')
      .select('room_id, room_number, room_type, current_stays, revenue_uzs')
      .eq('clinic_id', clinicId);
    return data ?? [];
  }
}

// -----------------------------------------------------------------------------
// Controller
// -----------------------------------------------------------------------------
@ApiTags('analytics')
@Controller({ path: 'analytics', version: '1' })
class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}

  @Get('overview')
  overview(
    @CurrentUser() u: { clinicId: string | null },
    @Query('preset') preset?: string,
    @Query('from') fromArg?: string,
    @Query('to') toArg?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const { from, to } = rangeFor(preset, fromArg, toArg);
    return this.svc.overview(u.clinicId, from, to);
  }

  @Get('doctors')
  doctors(
    @CurrentUser() u: { clinicId: string | null },
    @Query('preset') preset?: string,
    @Query('from') fromArg?: string,
    @Query('to') toArg?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const { from, to } = rangeFor(preset, fromArg, toArg);
    return this.svc.doctors(u.clinicId, from, to);
  }

  @Get('heatmap')
  heatmap(
    @CurrentUser() u: { clinicId: string | null },
    @Query('preset') preset?: string,
    @Query('from') fromArg?: string,
    @Query('to') toArg?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const { from, to } = rangeFor(preset, fromArg, toArg);
    return this.svc.heatmap(u.clinicId, from, to);
  }

  @Get('top-services')
  topServices(
    @CurrentUser() u: { clinicId: string | null },
    @Query('preset') preset?: string,
    @Query('from') fromArg?: string,
    @Query('to') toArg?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const { from, to } = rangeFor(preset, fromArg, toArg);
    return this.svc.topServices(u.clinicId, from, to);
  }

  @Get('inpatient-share')
  inpatientShare(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.inpatientShare(u.clinicId);
  }

  @Get('new-patients-trend')
  newPatientsTrend(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.newPatientsTrend(u.clinicId);
  }

  @Get('upcoming-birthdays')
  upcomingBirthdays(
    @CurrentUser() u: { clinicId: string | null },
    @Query('days') daysArg?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const days = Math.min(60, Math.max(1, Number(daysArg ?? 7) || 7));
    return this.svc.upcomingBirthdays(u.clinicId, days);
  }

  // ===== FAZA 1: Money Intelligence =====
  @Get('cash-anomalies')
  cashAnomalies(
    @CurrentUser() u: { clinicId: string | null },
    @Query('limit') limit?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const lim = Math.min(50, Math.max(1, Number(limit ?? 20) || 20));
    return this.svc.cashAnomalies(u.clinicId, lim);
  }

  @Get('refund-fraud-alerts')
  refundFraudAlerts(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.refundFraudAlerts(u.clinicId);
  }

  @Get('cash-forecast')
  cashForecast(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.cashForecast(u.clinicId);
  }

  // ===== FAZA 2: CRM =====
  @Get('patient-segments')
  patientSegments(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.patientSegments(u.clinicId);
  }

  // ===== FAZA 3: Operatsion =====
  @Get('doctor-anomalies')
  doctorAnomalies(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.doctorAnomalies(u.clinicId);
  }
}

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, SupabaseService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
