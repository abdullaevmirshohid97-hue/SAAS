import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { fetchAllRows } from '../../common/fetch-all';
import { SupabaseService } from '../../common/services/supabase.service';
import {
  addDays,
  presetRange,
  tashkentBounds,
  tashkentDate,
  tashkentDayOf,
} from '../../common/tashkent-range';
import { QUERY_DIMENSIONS, QUERY_GRAINS } from './semantic';

// =============================================================================
// Analitika. Ta'riflar (2026-10-17 auditidan keyin):
//   Tushum   = kassaga tushgan pul (naqd/karta/o'tkazma; qarzga berilgani EMAS,
//              qarz to'langanda tushum) − vozvrat. Oylik moliyaviy hisobot bilan bir xil.
//   Xizmat   = chek qatorlari qiymati (qarzga ko'rsatilgani ham — bu bajarilgan ish).
//   Shifokor = chekdagi shifokor, bo'lmasa qabul (appointment) shifokori.
//   Kun      = Toshkent kuni (UTC+5). Og'ir agregatlar SQL funksiyalarda —
//              PostgREST'ning 1000 qator chegarasi natijani kesmaydi.
// =============================================================================

type DailyRow = { day: string; revenue: number; expenses: number; pharmacy: number };

/** Kunlar ketma-ketligi (grafik uzilmasin): from..to, ko'pi bilan 400 kun */
function dayRange(from: string, to: string, max = 400): string[] {
  const days: string[] = [];
  for (let d = from; d <= to && days.length < max; d = addDays(d, 1)) days.push(d);
  return days;
}

/** YYYY-MM-DD → hafta kuni (0 = yakshanba), TZ'siz */
function dowOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly supabase: SupabaseService) {}

  private db(): SupabaseClient {
    return this.supabase.admin();
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db().rpc(fn as never, args as never);
    if (error) throw new BadRequestException(error.message);
    return data as T;
  }

  /** Davr bo'yicha qo'shimcha ko'rsatkichlar (SQL, 1000 qator chegarasisiz) */
  private extras(clinicId: string, from: string, to: string) {
    return this.rpc<{
      new_patients: number;
      appointments: number;
      appointment_status: Record<string, number>;
      payroll_uzs: number;
      debt_given_uzs: number;
      refunds_uzs: number;
      inpatient_charges_uzs: number;
      inpatient_charges_count: number;
    }>('analytics_period_extras', { p_clinic: clinicId, p_from: from, p_to: to });
  }

  async overview(clinicId: string, from: string, to: string) {
    const admin = this.db();
    const [revenueDaily, expenseDaily, pharmacyDaily, extra] = await Promise.all([
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
      this.extras(clinicId, from, to),
    ]);
    for (const r of [revenueDaily, expenseDaily, pharmacyDaily]) {
      if (r.error) throw new BadRequestException(r.error.message);
    }

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
    const totalPharmacy = pharm.reduce((a, r) => a + Number(r.revenue_uzs ?? 0), 0);
    const payroll = Number(extra.payroll_uzs ?? 0);
    // O'rtacha chek = tushum / pul to'langan cheklar (vozvrat va qarz to'lovi ham
    // tushumda, shuning uchun bu "kassaga o'rtacha tushum")
    const avgCheck = totalTransactions > 0 ? Math.round(totalRevenue / totalTransactions) : 0;

    // Kunlik qator — bo'sh kunlar 0 bilan (grafik uzilmasin)
    const map = new Map<string, DailyRow>();
    for (const day of dayRange(from, to))
      map.set(day, { day, revenue: 0, expenses: 0, pharmacy: 0 });
    const row = (day: string) => {
      const cur = map.get(day) ?? { day, revenue: 0, expenses: 0, pharmacy: 0 };
      map.set(day, cur);
      return cur;
    };
    for (const r of rev) row(r.day).revenue = Number(r.revenue_uzs ?? 0);
    for (const r of exp) row(r.day).expenses = Number(r.expenses_uzs ?? 0);
    for (const r of pharm) row(r.day).pharmacy = Number(r.revenue_uzs ?? 0);
    const daily = Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));

    return {
      range: { from, to },
      totals: {
        revenue_uzs: totalRevenue,
        expenses_uzs: totalExpenses,
        payroll_uzs: payroll,
        // Sof foyda = tushum − rasxot − to'langan maosh (dorixona alohida)
        profit_uzs: totalRevenue - totalExpenses - payroll,
        avg_check_uzs: avgCheck,
        transactions: totalTransactions,
        new_patients: Number(extra.new_patients ?? 0),
        appointments: Number(extra.appointments ?? 0),
        pharmacy_revenue_uzs: totalPharmacy,
        debt_given_uzs: Number(extra.debt_given_uzs ?? 0),
        refunds_uzs: Number(extra.refunds_uzs ?? 0),
      },
      daily,
      appointment_status: extra.appointment_status ?? {},
    };
  }

  private doctorRows(clinicId: string, from: string, to: string) {
    return this.rpc<
      Array<{
        doctor_id: string;
        doctor_name: string;
        visits: number;
        patients: number;
        revenue_uzs: number;
        commission_uzs: number;
        is_active: boolean;
      }>
    >('analytics_doctors', { p_clinic: clinicId, p_from: from, p_to: to });
  }

  /** Davrda faoliyati bor shifokorlar (tushum bo'yicha) */
  async doctors(clinicId: string, from: string, to: string) {
    const rows = await this.doctorRows(clinicId, from, to);
    return rows
      .filter((r) => Number(r.visits) > 0 || Number(r.revenue_uzs) > 0)
      .map((r) => ({
        doctor_id: r.doctor_id,
        doctor_name: r.doctor_name,
        visits: Number(r.visits),
        patients: Number(r.patients),
        revenue: Number(r.revenue_uzs),
      }));
  }

  /** Barcha faol shifokorlar (faoliyatsizlar 0 bilan) + davr komissiyasi */
  async allDoctors(clinicId: string, from: string, to: string) {
    const rows = await this.doctorRows(clinicId, from, to);
    return rows
      .filter(
        (r) =>
          r.is_active ||
          Number(r.visits) > 0 ||
          Number(r.revenue_uzs) > 0 ||
          Number(r.commission_uzs) > 0,
      )
      .map((r) => ({
        doctor_id: r.doctor_id,
        doctor_name: r.doctor_name,
        visits: Number(r.visits),
        patients: Number(r.patients),
        revenue_uzs: Number(r.revenue_uzs),
        commission_uzs: Number(r.commission_uzs),
      }));
  }

  /** Soat × hafta kuni (Toshkent; qator 0 = yakshanba) */
  async heatmap(clinicId: string, from: string, to: string) {
    const rows = await this.rpc<Array<{ dow: number; hour: number; n: number }>>(
      'analytics_heatmap',
      { p_clinic: clinicId, p_from: from, p_to: to },
    );
    const grid: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    for (const r of rows ?? []) {
      const line = grid[Number(r.dow)];
      if (line && Number(r.hour) >= 0 && Number(r.hour) < 24) line[Number(r.hour)] = Number(r.n);
    }
    return { grid };
  }

  private serviceRows(clinicId: string, from: string, to: string, limit: number) {
    return this.rpc<
      Array<{
        service_key: string;
        service_name: string;
        qty: number;
        revenue_uzs: number;
        cost_uzs: number;
        daily: Array<{ day: string; count: number; revenue: number }>;
        doctors: Array<{ name: string; times: number }>;
      }>
    >('analytics_services', { p_clinic: clinicId, p_from: from, p_to: to, p_limit: limit });
  }

  async topServices(clinicId: string, from: string, to: string) {
    const rows = await this.serviceRows(clinicId, from, to, 10);
    return rows.map((s) => {
      const revenue = Number(s.revenue_uzs);
      const cost = Number(s.cost_uzs);
      return {
        service_name: s.service_name,
        // soni = miqdor (2 dona UZI = 2), avval qator soni edi
        count: Number(s.qty),
        revenue,
        cost,
        profit: revenue - cost,
        margin_pct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0,
      };
    });
  }

  async serviceDetail(clinicId: string, from: string, to: string) {
    const rows = await this.serviceRows(clinicId, from, to, 20);
    return rows.map((s) => ({
      service_id: s.service_key,
      service_name: s.service_name,
      count: Number(s.qty),
      revenue: Number(s.revenue_uzs),
      doctors: (s.doctors ?? []).map((d) => ({ name: d.name, times: Number(d.times) })),
      daily: (s.daily ?? []).map((d) => ({
        day: d.day,
        count: Number(d.count),
        revenue: Number(d.revenue),
      })),
    }));
  }

  // Dashboard — so'nggi 7 kun (Toshkent kunlari) yangi bemorlar
  async newPatientsTrend(clinicId: string) {
    const to = tashkentDate();
    const from = addDays(to, -6);
    const { startIso, endIso } = tashkentBounds(from, to);
    const rows = await fetchAllRows<{ created_at: string }>((a, b) =>
      this.db()
        .from('patients')
        .select('created_at')
        .eq('clinic_id', clinicId)
        .is('deleted_at', null)
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('created_at')
        .range(a, b),
    );
    const buckets = new Map<string, number>(dayRange(from, to).map((d) => [d, 0]));
    for (const r of rows) {
      const key = tashkentDayOf(r.created_at);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Array.from(buckets.entries()).map(([day, count]) => ({ day, count }));
  }

  // Dashboard — kelayotgan N kun ichida tug'ilgan kun (Toshkent bugungi kuni)
  async upcomingBirthdays(clinicId: string, days = 7) {
    const rows = await fetchAllRows<{
      id: string;
      full_name: string | null;
      phone: string | null;
      dob: string | null;
    }>((a, b) =>
      this.db()
        .from('patients')
        .select('id, full_name, phone, dob')
        .eq('clinic_id', clinicId)
        .is('deleted_at', null)
        .not('dob', 'is', null)
        .order('id')
        .range(a, b),
    );
    const today = tashkentDate();
    const year = Number(today.slice(0, 4));
    const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const dayMs = 86_400_000;
    const list: Array<{
      id: string;
      full_name: string | null;
      phone: string | null;
      dob: string;
      next_birthday: string;
      days_until: number;
    }> = [];
    for (const r of rows) {
      if (!r.dob || !/^\d{4}-\d{2}-\d{2}/.test(r.dob)) continue;
      const mm = r.dob.slice(5, 7);
      const dd = r.dob.slice(8, 10);
      // 29-fevral — kabisa bo'lmagan yilda 28-fevral
      const onYear = (y: number) =>
        mm === '02' && dd === '29' && !isLeap(y) ? `${y}-02-28` : `${y}-${mm}-${dd}`;
      let next = onYear(year);
      if (next < today) next = onYear(year + 1);
      const diff = Math.round(
        (Date.parse(`${next}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs,
      );
      if (diff <= days) {
        list.push({
          id: r.id,
          full_name: r.full_name,
          phone: r.phone,
          dob: r.dob,
          next_birthday: next,
          days_until: diff,
        });
      }
    }
    return list.sort((a, b) => a.days_until - b.days_until);
  }

  // ===========================================================================
  // FAZA 1: Money Intelligence
  // ===========================================================================

  // Smena kassa farqi (IQR). View'da FK yo'q — nomlar alohida olinadi (embed
  // PostgREST'da xato berib vidjet jimgina bo'sh qolardi).
  async cashAnomalies(clinicId: string, limit = 20) {
    const admin = this.db();
    const { data, error } = await admin
      .from('shift_cash_anomaly_view')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('closed_at', { ascending: false })
      .limit(limit);
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Array<
      Record<string, unknown> & { operator_id: string | null; user_id?: string | null }
    >;
    const opIds = [...new Set(rows.map((r) => r.operator_id).filter(Boolean))] as string[];
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
    const [ops, users] = await Promise.all([
      opIds.length
        ? admin.from('shift_operators').select('id, full_name').in('id', opIds)
        : Promise.resolve({ data: [] as unknown[] }),
      userIds.length
        ? admin.from('profiles').select('id, full_name').in('id', userIds)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);
    const opName = new Map(
      ((ops.data ?? []) as Array<{ id: string; full_name: string }>).map((o) => [
        o.id,
        o.full_name,
      ]),
    );
    const userName = new Map(
      ((users.data ?? []) as Array<{ id: string; full_name: string }>).map((u) => [
        u.id,
        u.full_name,
      ]),
    );
    return rows.map((r) => {
      const name =
        (r.operator_id ? opName.get(r.operator_id) : undefined) ??
        (r.user_id ? userName.get(r.user_id) : undefined) ??
        null;
      return { ...r, operator: name ? { full_name: name } : null };
    });
  }

  // Cashier refund fraud — vozvrat nisbati >10% kassirlar
  async refundFraudAlerts(clinicId: string) {
    const admin = this.db();
    // MUHIM: view'da FK yo'q — profiles embed PostgREST'da 400 qaytarardi va
    // xato yutilib vidjet doim bo'sh ko'rinardi. Ismlarni alohida olib qo'shamiz.
    const { data, error } = await admin
      .from('cashier_refund_ratio_view')
      .select('*')
      .eq('clinic_id', clinicId)
      .in('risk_level', ['high_risk', 'medium_risk'])
      .order('week_start', { ascending: false })
      .limit(20);
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Array<Record<string, unknown> & { cashier_id: string | null }>;
    const ids = [...new Set(rows.map((r) => r.cashier_id).filter(Boolean))] as string[];
    if (ids.length === 0) return rows;
    const { data: profs } = await admin.from('profiles').select('id, full_name').in('id', ids);
    const nameById = new Map(
      ((profs as Array<{ id: string; full_name: string }> | null) ?? []).map((p) => [
        p.id,
        p.full_name,
      ]),
    );
    return rows.map((r) => ({
      ...r,
      cashier: r.cashier_id ? { full_name: nameById.get(r.cashier_id) ?? null } : null,
    }));
  }

  // Tushum prognozi — kelasi 7 kun. So'nggi 4 TO'LIQ hafta (bugun hisobga
  // olinmaydi — u hali tugamagan), bo'sh kunlar 0, hafta kuni medianasi × trend.
  async cashForecast(clinicId: string) {
    const { data, error } = await this.db()
      .from('daily_revenue_history_view')
      .select('day, dow, revenue_uzs, tx_count')
      .eq('clinic_id', clinicId)
      .order('day');
    if (error) throw new BadRequestException(error.message);
    const byDay = new Map(
      ((data ?? []) as Array<{ day: string; revenue_uzs: number; tx_count: number }>).map((r) => [
        r.day,
        r,
      ]),
    );
    const today = tashkentDate();
    const lastFull = addDays(today, -1);
    const history = dayRange(addDays(lastFull, -27), lastFull).map((day) => {
      const r = byDay.get(day);
      return {
        day,
        dow: dowOf(day),
        revenue_uzs: Number(r?.revenue_uzs ?? 0),
        tx_count: Number(r?.tx_count ?? 0),
      };
    });

    const byDow = new Map<number, number[]>();
    for (const r of history) byDow.set(r.dow, [...(byDow.get(r.dow) ?? []), r.revenue_uzs]);

    const sum = (rows: typeof history) => rows.reduce((s, r) => s + r.revenue_uzs, 0);
    const last7 = sum(history.slice(-7)) / 7;
    const prev7 = sum(history.slice(-14, -7)) / 7;
    const trend = prev7 > 0 ? last7 / prev7 : 1;

    const forecast: Array<{ day: string; dow: number; predicted_uzs: number }> = [];
    for (let i = 1; i <= 7; i++) {
      const day = addDays(today, i);
      const dow = dowOf(day);
      forecast.push({ day, dow, predicted_uzs: Math.round(median(byDow.get(dow) ?? []) * trend) });
    }

    return {
      history,
      forecast,
      trend_factor: Math.round(trend * 100) / 100,
      last_7d_avg: Math.round(last7),
      prev_7d_avg: Math.round(prev7),
    };
  }

  // ===========================================================================
  // FAZA 2: CRM — bemor segmentlari (butun klinika bo'yicha SQL'da jamlanadi)
  // ===========================================================================
  async patientSegments(clinicId: string) {
    const res = await this.rpc<{
      summary: {
        total: number;
        by_ltv: { vip: number; regular: number; occasional: number; new: number };
        by_churn: { active: number; at_risk: number; churned: number; never_visited: number };
        total_ltv_uzs: number;
      };
      at_risk_top: unknown[];
      vip_top: unknown[];
    }>('analytics_patient_segments', { p_clinic: clinicId });
    return {
      summary: { ...res.summary, total_ltv_uzs: Number(res.summary.total_ltv_uzs ?? 0) },
      at_risk_top: res.at_risk_top ?? [],
      vip_top: res.vip_top ?? [],
    };
  }

  // ===========================================================================
  // FAZA 3: Operatsion analitika — Shifokor anomaliya
  // ===========================================================================
  async doctorAnomalies(clinicId: string) {
    const { data, error } = await this.db()
      .from('doctor_anomaly_view')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('total_revenue', { ascending: false });
    if (error) throw new BadRequestException(error.message);
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

  async inpatientShare(clinicId: string, from: string, to: string) {
    const [occupancy, extra] = await Promise.all([
      // Joriy holat — xonalar (bo'sh xonalar ham), davrsiz
      this.db()
        .from('inpatient_occupancy_view')
        .select('room_id, room_number, room_type, current_stays, revenue_uzs')
        .eq('clinic_id', clinicId)
        .order('room_number'),
      this.extras(clinicId, from, to),
    ]);
    if (occupancy.error) throw new BadRequestException(occupancy.error.message);
    return {
      rooms: occupancy.data ?? [],
      period: {
        total_uzs: Number(extra.inpatient_charges_uzs ?? 0),
        count: Number(extra.inpatient_charges_count ?? 0),
      },
    };
  }

  // ===== FAZA 5B: Report Builder — oq-ro'yxatli agregatsiya (analytics_query RPC) =====
  async query(clinicId: string, dimension: string, grain: string, from: string, to: string) {
    const rows = await this.rpc<
      Array<{ bucket: string; revenue_uzs: number; tx_count: number; avg_check_uzs: number }>
    >('analytics_query', {
      p_clinic_id: clinicId,
      p_dimension: dimension,
      p_grain: grain,
      p_from: from,
      p_to: to,
    });
    return { dimension, grain, rows: rows ?? [] };
  }
}

// -----------------------------------------------------------------------------
// Controller
// -----------------------------------------------------------------------------
type RangeQuery = { preset?: string; from?: string; to?: string };

@ApiTags('analytics')
@Controller({ path: 'analytics', version: '1' })
class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}

  private range(q: RangeQuery) {
    return presetRange(q.preset, q.from, q.to, 'today');
  }

  private clinic(u: { clinicId: string | null }): string {
    if (!u.clinicId) throw new ForbiddenException();
    return u.clinicId;
  }

  @Get('overview')
  overview(@CurrentUser() u: { clinicId: string | null }, @Query() q: RangeQuery) {
    const { from, to } = this.range(q);
    return this.svc.overview(this.clinic(u), from, to);
  }

  @Get('doctors')
  doctors(@CurrentUser() u: { clinicId: string | null }, @Query() q: RangeQuery) {
    const { from, to } = this.range(q);
    return this.svc.doctors(this.clinic(u), from, to);
  }

  @Get('heatmap')
  heatmap(@CurrentUser() u: { clinicId: string | null }, @Query() q: RangeQuery) {
    const { from, to } = this.range(q);
    return this.svc.heatmap(this.clinic(u), from, to);
  }

  @Get('top-services')
  topServices(@CurrentUser() u: { clinicId: string | null }, @Query() q: RangeQuery) {
    const { from, to } = this.range(q);
    return this.svc.topServices(this.clinic(u), from, to);
  }

  @Get('all-doctors')
  allDoctors(@CurrentUser() u: { clinicId: string | null }, @Query() q: RangeQuery) {
    const { from, to } = this.range(q);
    return this.svc.allDoctors(this.clinic(u), from, to);
  }

  @Get('service-detail')
  serviceDetail(@CurrentUser() u: { clinicId: string | null }, @Query() q: RangeQuery) {
    const { from, to } = this.range(q);
    return this.svc.serviceDetail(this.clinic(u), from, to);
  }

  @Get('inpatient-share')
  inpatientShare(@CurrentUser() u: { clinicId: string | null }, @Query() q: RangeQuery) {
    const { from, to } = this.range(q);
    return this.svc.inpatientShare(this.clinic(u), from, to);
  }

  @Get('new-patients-trend')
  newPatientsTrend(@CurrentUser() u: { clinicId: string | null }) {
    return this.svc.newPatientsTrend(this.clinic(u));
  }

  @Get('upcoming-birthdays')
  upcomingBirthdays(
    @CurrentUser() u: { clinicId: string | null },
    @Query('days') daysArg?: string,
  ) {
    const days = Math.min(60, Math.max(1, Number(daysArg ?? 7) || 7));
    return this.svc.upcomingBirthdays(this.clinic(u), days);
  }

  // ===== FAZA 1: Money Intelligence =====
  @Get('cash-anomalies')
  cashAnomalies(@CurrentUser() u: { clinicId: string | null }, @Query('limit') limit?: string) {
    const lim = Math.min(50, Math.max(1, Number(limit ?? 20) || 20));
    return this.svc.cashAnomalies(this.clinic(u), lim);
  }

  @Get('refund-fraud-alerts')
  refundFraudAlerts(@CurrentUser() u: { clinicId: string | null }) {
    return this.svc.refundFraudAlerts(this.clinic(u));
  }

  @Get('cash-forecast')
  cashForecast(@CurrentUser() u: { clinicId: string | null }) {
    return this.svc.cashForecast(this.clinic(u));
  }

  // ===== FAZA 2: CRM =====
  @Get('patient-segments')
  patientSegments(@CurrentUser() u: { clinicId: string | null }) {
    return this.svc.patientSegments(this.clinic(u));
  }

  // ===== FAZA 3: Operatsion =====
  @Get('doctor-anomalies')
  doctorAnomalies(@CurrentUser() u: { clinicId: string | null }) {
    return this.svc.doctorAnomalies(this.clinic(u));
  }

  // ===== FAZA 5B: Self-serve BI — Report Builder =====
  // Faqat admin/owner (moliyaviy ma'lumot). Oq-ro'yxatli o'lcham/grain/sana.
  @Post('query')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  query(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    const clinicId = this.clinic(u);
    const schema = z.object({
      dimension: z.enum(QUERY_DIMENSIONS),
      grain: z.enum(QUERY_GRAINS).default('day'),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    });
    const parsed = schema.parse(body);
    const { from, to } = presetRange(undefined, parsed.from, parsed.to);
    return this.svc.query(clinicId, parsed.dimension, parsed.grain, from, to);
  }
}

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, SupabaseService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
