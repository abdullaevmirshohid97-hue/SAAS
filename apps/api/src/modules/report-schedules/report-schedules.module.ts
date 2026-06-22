import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  Module,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Cron } from '@nestjs/schedule';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';
import { AnalyticsModule, AnalyticsService } from '../analytics/analytics.module';
import { QUERY_DIMENSIONS, QUERY_GRAINS } from '../analytics/semantic';
import { TelegramReportsModule, TelegramReportsService } from '../telegram-reports/telegram-reports.module';

const TZ = 'Asia/Tashkent';
const CADENCES = ['daily', 'weekly', 'monthly'] as const;
type Cadence = (typeof CADENCES)[number];

interface ScheduleRow {
  id: string;
  clinic_id: string;
  name: string;
  dimension: string;
  grain: string;
  cadence: Cadence;
  send_hour: number;
  channel: string;
  format: string;
  is_active: boolean;
  last_run_on: string | null;
}

// --- Asia/Tashkent (UTC+5, DST yo'q) vaqt yordamchilari ---
function tashkentNow(): Date {
  return new Date(Date.now() + 5 * 3600 * 1000);
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

const DIMENSION_LABEL: Record<string, string> = {
  time: 'Vaqt',
  payment_method: "To'lov usuli",
  register: 'Registr',
  source: 'Manba',
  cashier: 'Kassir',
};
const CADENCE_LABEL: Record<Cadence, string> = {
  daily: 'Kunlik',
  weekly: 'Haftalik',
  monthly: 'Oylik',
};

/** Cadence -> tugallangan davr (Tashkent sanalari). */
function computePeriod(cadence: Cadence): { from: string; to: string } {
  const now = tashkentNow();
  const yesterday = new Date(now);
  yesterday.setUTCDate(now.getUTCDate() - 1);
  if (cadence === 'daily') return { from: ymd(yesterday), to: ymd(yesterday) };
  if (cadence === 'weekly') {
    const from = new Date(yesterday);
    from.setUTCDate(yesterday.getUTCDate() - 6);
    return { from: ymd(from), to: ymd(yesterday) };
  }
  // monthly — o'tgan kalendar oy
  const firstThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastPrev = new Date(firstThis);
  lastPrev.setUTCDate(0);
  const firstPrev = new Date(Date.UTC(lastPrev.getUTCFullYear(), lastPrev.getUTCMonth(), 1));
  return { from: ymd(firstPrev), to: ymd(lastPrev) };
}

/** Schedule bugun yuborilishi kerakmi (cadence bo'yicha)? */
function isCadenceDue(cadence: Cadence, now: Date): boolean {
  if (cadence === 'daily') return true;
  if (cadence === 'weekly') return now.getUTCDay() === 1; // dushanba
  return now.getUTCDate() === 1; // monthly — oyning 1-kuni
}

@Injectable()
export class ReportSchedulesService {
  private readonly log = new Logger('ReportSchedules');

  constructor(
    private readonly supabase: SupabaseService,
    private readonly analytics: AnalyticsService,
    private readonly telegram: TelegramReportsService,
  ) {}

  async list(clinicId: string) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('report_schedules')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false });
    const telegram_connected = await this.telegram.hasActiveReportBot(clinicId);
    return { schedules: (data ?? []) as ScheduleRow[], telegram_connected };
  }

  async create(
    clinicId: string,
    userId: string | null,
    body: {
      name: string;
      dimension: string;
      grain: string;
      cadence: Cadence;
      send_hour: number;
    },
  ) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('report_schedules')
      .insert({
        clinic_id: clinicId,
        created_by: userId,
        name: body.name,
        dimension: body.dimension,
        grain: body.grain,
        cadence: body.cadence,
        send_hour: body.send_hour,
        channel: 'telegram',
        format: 'csv',
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as ScheduleRow;
  }

  async toggle(clinicId: string, id: string, isActive: boolean) {
    const admin = this.supabase.admin();
    await admin
      .from('report_schedules')
      .update({ is_active: isActive })
      .eq('id', id)
      .eq('clinic_id', clinicId);
    return { ok: true };
  }

  async remove(clinicId: string, id: string) {
    const admin = this.supabase.admin();
    await admin.from('report_schedules').delete().eq('id', id).eq('clinic_id', clinicId);
    return { ok: true };
  }

  async runNow(clinicId: string, id: string): Promise<{ ok: boolean; reason?: string }> {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('report_schedules')
      .select('*')
      .eq('id', id)
      .eq('clinic_id', clinicId)
      .maybeSingle();
    const row = data as ScheduleRow | null;
    if (!row) return { ok: false, reason: 'not_found' };
    return this.runSchedule(row, true);
  }

  /** Bitta schedule'ni bajaradi: hisobot -> CSV -> Telegram. */
  async runSchedule(row: ScheduleRow, manual = false): Promise<{ ok: boolean; reason?: string }> {
    const { from, to } = computePeriod(row.cadence);
    let rows: Array<{ bucket: string; revenue_uzs: number; tx_count: number; avg_check_uzs: number }>;
    try {
      const res = await this.analytics.query(row.clinic_id, row.dimension, row.grain, from, to);
      rows = res.rows;
    } catch (err) {
      this.log.warn(`query failed (${row.id}): ${(err as Error).message}`);
      return { ok: false, reason: 'query_failed' };
    }

    // CSV
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv =
      '﻿' +
      "Bo'lim,Tushum,Tranzaksiya,O'rtacha chek\n" +
      rows
        .map((r) => [r.bucket, r.revenue_uzs, r.tx_count, r.avg_check_uzs].map(esc).join(','))
        .join('\n');

    const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue_uzs ?? 0), 0);
    const totalTx = rows.reduce((s, r) => s + Number(r.tx_count ?? 0), 0);
    const dimLabel = DIMENSION_LABEL[row.dimension] ?? row.dimension;
    const caption =
      `📊 <b>${row.name}</b> (${CADENCE_LABEL[row.cadence]})\n` +
      `O'lcham: ${dimLabel} · Davr: ${from} – ${to}\n` +
      `Jami tushum: <b>${fmt(totalRevenue)}</b> so'm · ${totalTx} ta amal`;

    const sent = await this.telegram.deliverReportToOwners(row.clinic_id, caption, [
      { filename: `hisobot-${row.dimension}-${from}_${to}.csv`, content: csv },
    ]);
    if (!sent) return { ok: false, reason: 'no_bot' };

    if (!manual) {
      await this.supabase
        .admin()
        .from('report_schedules')
        .update({ last_run_on: ymd(tashkentNow()) })
        .eq('id', row.id);
    }
    return { ok: true };
  }

  // Soatlik cron — yuborish soati kelgan va muddati yetgan schedule'lar.
  @Cron('0 * * * *', { timeZone: TZ })
  async hourlyCron(): Promise<void> {
    const now = tashkentNow();
    const hour = now.getUTCHours();
    const today = ymd(now);
    const { data } = await this.supabase
      .admin()
      .from('report_schedules')
      .select('*')
      .eq('is_active', true)
      .eq('send_hour', hour);
    const rows = (data ?? []) as ScheduleRow[];
    const due = rows.filter(
      (r) => r.last_run_on !== today && isCadenceDue(r.cadence, now),
    );
    if (due.length === 0) return;
    this.log.log(`Jadvallashtirilgan hisobot: ${due.length} ta (soat ${hour})`);
    for (const row of due) {
      try {
        await this.runSchedule(row);
      } catch (err) {
        this.log.warn(`runSchedule xato (${row.id}): ${(err as Error).message}`);
      }
    }
  }
}

@ApiTags('report-schedules')
@Controller({ path: 'report-schedules', version: '1' })
class ReportSchedulesController {
  constructor(private readonly svc: ReportSchedulesService) {}

  @Get()
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  list(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.list(u.clinicId);
  }

  @Post()
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  create(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const schema = z.object({
      name: z.string().min(1).max(100),
      dimension: z.enum(QUERY_DIMENSIONS),
      grain: z.enum(QUERY_GRAINS).default('day'),
      cadence: z.enum(CADENCES),
      send_hour: z.number().int().min(0).max(23),
    });
    return this.svc.create(u.clinicId, u.userId ?? null, schema.parse(body));
  }

  @Patch(':id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  toggle(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const { is_active } = z.object({ is_active: z.boolean() }).parse(body);
    return this.svc.toggle(u.clinicId, id, is_active);
  }

  @Delete(':id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  remove(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.remove(u.clinicId, id);
  }

  @Post(':id/run-now')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  runNow(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.runNow(u.clinicId, id);
  }
}

@Module({
  imports: [AnalyticsModule, TelegramReportsModule],
  controllers: [ReportSchedulesController],
  providers: [ReportSchedulesService, SupabaseService],
})
export class ReportSchedulesModule {}
