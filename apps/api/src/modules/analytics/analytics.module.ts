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
    const { data } = await this.supabase
      .admin()
      .from('service_hour_heatmap_view')
      .select('service_id, service_name, count, revenue_uzs')
      .eq('clinic_id', clinicId);
    const rows = (data ?? []) as Array<{
      service_id: string | null;
      service_name: string;
      count: number;
      revenue_uzs: number;
    }>;
    const agg = new Map<string, { service_name: string; count: number; revenue: number }>();
    for (const r of rows) {
      const key = r.service_id ?? r.service_name;
      const cur = agg.get(key) ?? { service_name: r.service_name, count: 0, revenue: 0 };
      cur.count += Number(r.count ?? 0);
      cur.revenue += Number(r.revenue_uzs ?? 0);
      agg.set(key, cur);
    }
    return Array.from(agg.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
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
}

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, SupabaseService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
