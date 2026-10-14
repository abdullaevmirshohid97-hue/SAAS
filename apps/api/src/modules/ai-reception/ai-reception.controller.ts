import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { addDays, localDateOf, localMidnightUtcMs } from '@clary/utils';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePerm } from '../../common/decorators/require-perm.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

import { BookingService, normalizeUzPhone } from './booking.service';
import { ReceptionBrainService } from './brain.service';
import { PatientNotifierService } from './patient-notifier.service';
import { AiReceptionSettingsService, schemaError } from './settings.service';

// =============================================================================
// AI qabulxona — klinika xodimlari uchun endpointlar
// =============================================================================

type U = { clinicId: string | null; userId: string | null };

const SettingsSchema = z
  .object({
    mode: z.enum(['off', 'voicemail', 'ai']),
    after_hours_mode: z.enum(['same', 'voicemail']),
    assistant_name: z.string().min(1).max(40),
    greeting: z.string().max(500).nullable(),
    voicemail_prompt: z.string().max(500).nullable(),
    russian_hint: z.boolean(),
    voice: z.string().max(60).nullable(),
    speech_speed: z.number().min(0.5).max(2),
    booking_horizon_days: z.number().int().min(1).max(90),
    min_lead_minutes: z.number().int().min(0).max(1440),
    allow_new_patients: z.boolean(),
    transfer_phone: z.string().max(30).nullable(),
    extra_instructions: z.string().max(2000).nullable(),
    record_calls: z.boolean(),
    max_call_seconds: z.number().int().min(60).max(1200),
    notify_owner_telegram: z.boolean(),
    telegram_ai_chat: z.boolean(),
    confirm_telegram: z.boolean(),
    confirm_sms: z.boolean(),
    reminder_enabled: z.boolean(),
    reminder_hour: z.number().int().min(6).max(21),
    reminder_sms: z.boolean(),
    mark_no_show: z.boolean(),
  })
  .partial();

const LineSchema = z.object({
  line_key: z.string().min(2).max(60),
  phone_number: z.string().max(30).nullish(),
  forwarded_from: z.string().max(30).nullish(),
  label: z.string().max(80).nullish(),
});
const LinePatchSchema = z.object({
  phone_number: z.string().max(30).nullish(),
  forwarded_from: z.string().max(30).nullish(),
  label: z.string().max(80).nullish(),
  is_active: z.boolean().optional(),
});

const HM = z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/);
const DoctorSchema = z.object({
  booking_enabled: z.boolean().optional(),
  medical_category: z.enum(['highest', 'first', 'second', 'none']).nullish(),
  academic_degree: z.enum(['phd', 'dsc']).nullish(),
  academic_title: z.enum(['docent', 'professor']).nullish(),
  experience_years: z.number().int().min(0).max(70).nullish(),
  slot_minutes: z.number().int().min(5).max(240).optional(),
  keywords: z.array(z.string().min(1).max(40)).max(20).optional(),
  public_note: z.string().max(300).nullish(),
  service_id: z.string().uuid().nullish(),
  sort_order: z.number().int().min(-1000).max(1000).optional(),
  rules: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        start_time: HM,
        end_time: HM,
        capacity: z.number().int().min(1).max(50).optional(),
      }),
    )
    .max(50)
    .optional(),
});
const TimeOffSchema = z.object({
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  reason: z.string().max(200).nullish(),
});
const BookSchema = z.object({
  staff_id: z.string().uuid(),
  starts_at: z.string().datetime({ offset: true }),
  patient_id: z.string().uuid().optional(),
  patient: z
    .object({
      full_name: z.string().min(3).max(120),
      phone: z.string().min(9).max(30),
    })
    .optional(),
  reason: z.string().max(300).optional(),
  call_id: z.string().uuid().optional(),
});
const SimStartSchema = z.object({ caller_phone: z.string().max(30).nullish() });
const SimTurnSchema = z.object({ call_id: z.string().uuid(), text: z.string().min(1).max(2000) });

function clinicOf(u: U): string {
  if (!u.clinicId) throw new ForbiddenException();
  return u.clinicId;
}

@ApiTags('ai-reception')
@Controller({ path: 'ai-reception', version: '1' })
export class AiReceptionController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly settings: AiReceptionSettingsService,
    private readonly booking: BookingService,
    private readonly brain: ReceptionBrainService,
    private readonly notifier: PatientNotifierService,
  ) {}

  // ---------------------------------------------------------------- sozlamalar
  @Get('settings')
  @RequirePerm('settings.view')
  async getSettings(@CurrentUser() u: U) {
    const clinicId = clinicOf(u);
    const [settings, lines, usage, clinic, bot] = await Promise.all([
      this.settings.get(clinicId),
      this.settings.listLines(clinicId),
      this.settings.monthlyUsage(clinicId),
      this.settings.clinicContext(clinicId),
      this.notifier.botUsername(),
    ]);
    return {
      settings,
      ai_effective: this.settings.aiEffective(settings),
      lines,
      usage,
      model: this.brain.model,
      clinic: { name: clinic.name, phone: clinic.phone, slug: clinic.slug },
      telegram_bot: bot,
      telegram_link: bot && clinic.slug ? `https://t.me/${bot}?start=c_${clinic.slug}` : null,
    };
  }

  @Put('settings')
  @RequirePerm('settings.manage_online_queue')
  @Audit({ action: 'ai_reception.settings_updated', resourceType: 'ai_reception_settings' })
  async saveSettings(@CurrentUser() u: U, @Body() body: unknown) {
    const clinicId = clinicOf(u);
    const input = SettingsSchema.parse(body);
    if (input.transfer_phone) {
      const t = normalizeUzPhone(input.transfer_phone);
      if (!t) throw new BadRequestException("Ulash raqami O'zbekiston raqami bo'lsin (9 raqam)");
      input.transfer_phone = t;
    }
    return this.settings.save(clinicId, u.userId, input);
  }

  // ---------------------------------------------------------------- liniyalar
  @Get('lines')
  @RequirePerm('settings.view')
  lines(@CurrentUser() u: U) {
    return this.settings.listLines(clinicOf(u));
  }

  @Post('lines')
  @RequirePerm('settings.manage_online_queue')
  @Audit({ action: 'ai_reception.line_created', resourceType: 'ai_phone_lines' })
  createLine(@CurrentUser() u: U, @Body() body: unknown) {
    return this.settings.createLine(clinicOf(u), LineSchema.parse(body));
  }

  @Patch('lines/:id')
  @RequirePerm('settings.manage_online_queue')
  updateLine(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.settings.updateLine(clinicOf(u), id, LinePatchSchema.parse(body));
  }

  @Delete('lines/:id')
  @RequirePerm('settings.manage_online_queue')
  @Audit({ action: 'ai_reception.line_deleted', resourceType: 'ai_phone_lines' })
  deleteLine(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.settings.deleteLine(clinicOf(u), id);
  }

  // ---------------------------------------------------------------- shifokorlar
  @Get('doctors')
  @RequirePerm('appointments.view')
  doctors(@CurrentUser() u: U) {
    return this.booking.directory(clinicOf(u), { fresh: true });
  }

  @Put('doctors/:staffId')
  @RequirePerm('settings.manage_online_queue')
  @Audit({
    action: 'ai_reception.doctor_schedule_updated',
    resourceType: 'doctor_booking_profiles',
  })
  saveDoctor(
    @CurrentUser() u: U,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() body: unknown,
  ) {
    return this.booking.saveDoctor(clinicOf(u), u.userId, staffId, DoctorSchema.parse(body));
  }

  @Post('doctors/:staffId/time-off')
  @RequirePerm('settings.manage_online_queue')
  @Audit({ action: 'ai_reception.time_off_added', resourceType: 'doctor_time_off' })
  addTimeOff(
    @CurrentUser() u: U,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() body: unknown,
  ) {
    return this.booking.addTimeOff(clinicOf(u), u.userId, staffId, TimeOffSchema.parse(body));
  }

  @Delete('time-off/:id')
  @RequirePerm('settings.manage_online_queue')
  removeTimeOff(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.booking.removeTimeOff(clinicOf(u), id);
  }

  // ---------------------------------------------------------------- navbat
  @Get('slots')
  @RequirePerm('appointments.view')
  async slots(
    @CurrentUser() u: U,
    @Query('staff_id') staffId?: string,
    @Query('from') from?: string,
    @Query('days') days?: string,
  ) {
    if (!staffId || !/^[0-9a-f-]{36}$/i.test(staffId))
      throw new BadRequestException('staff_id kerak');
    const { doctor, slots } = await this.booking.freeSlots(clinicOf(u), staffId, {
      fromDate: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : undefined,
      days: Math.min(Math.max(Number(days) || 7, 1), 60),
      forStaff: true,
    });
    return {
      doctor: {
        staff_id: doctor.staff_id,
        full_name: doctor.full_name,
        slot_minutes: doctor.slot_minutes,
      },
      slots,
    };
  }

  @Post('book')
  @RequirePerm('appointments.create')
  @Audit({ action: 'appointment.scheduled', resourceType: 'appointments' })
  async book(@CurrentUser() u: U, @Body() body: unknown) {
    const clinicId = clinicOf(u);
    const input = BookSchema.parse(body);
    if (!input.patient_id && !input.patient) throw new BadRequestException('Bemor kerak');
    const r = await this.booking.reserve(clinicId, {
      staffId: input.staff_id,
      startIso: input.starts_at,
      patient: input.patient_id
        ? { id: input.patient_id }
        : { full_name: input.patient!.full_name, phone: input.patient!.phone },
      reason: input.reason ?? null,
      source: 'staff',
      actorId: u.userId,
      callId: input.call_id ?? null,
    });
    // Qayta qo'ng'iroqdan yozilgan bo'lsa — qo'ng'iroq ham yopiladi
    if (input.call_id && r.appointment_id) {
      await this.supabase
        .admin()
        .from('ai_calls')
        .update({
          appointment_id: r.appointment_id,
          outcome: 'booked',
          callback_done_at: new Date().toISOString(),
          callback_done_by: u.userId,
        })
        .eq('clinic_id', clinicId)
        .eq('id', input.call_id);
    }
    return {
      appointment_id: r.appointment_id,
      patient_id: r.patient_id,
      patient_name: r.patient_name,
      starts_at: r.starts_at,
      doctor_name: r.doctor.full_name,
      new_patient: r.new_patient,
    };
  }

  @Get('upcoming')
  @RequirePerm('appointments.view')
  upcoming(
    @CurrentUser() u: U,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('source') source?: string,
  ) {
    const ok = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
    return this.booking.upcoming(clinicOf(u), { from: ok(from), to: ok(to), source });
  }

  @Post('appointments/:id/cancel')
  @RequirePerm('appointments.cancel')
  @Audit({ action: 'appointment.canceled', resourceType: 'appointments' })
  cancel(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(body ?? {});
    return this.booking.cancel(clinicOf(u), id, { by: 'clinic', reason: reason ?? null });
  }

  // ---------------------------------------------------------------- qo'ng'iroqlar
  @Get('calls')
  @RequirePerm('appointments.view')
  async calls(
    @CurrentUser() u: U,
    @Query('filter') filter?: string,
    @Query('channel') channel?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
  ) {
    const clinicId = clinicOf(u);
    const size = 50;
    const p = Math.max(1, Number(page) || 1);
    let q = this.supabase
      .admin()
      .from('ai_calls')
      .select(
        'id, channel, mode, status, caller_phone, outcome, needs_callback, callback_note, callback_done_at, started_at, ended_at, duration_sec, est_cost_uzs, recording_path, patient:patients(id, full_name), appointment:appointments(id, scheduled_at, status)',
        { count: 'exact' },
      )
      .eq('clinic_id', clinicId)
      .neq('channel', 'simulator')
      .order('started_at', { ascending: false })
      .range((p - 1) * size, p * size - 1);
    if (filter === 'callback') q = q.eq('needs_callback', true).is('callback_done_at', null);
    if (filter === 'booked') q = q.eq('outcome', 'booked');
    if (channel === 'phone' || channel === 'telegram') q = q.eq('channel', channel);
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
      q = q.gte('started_at', new Date(localMidnightUtcMs(from)).toISOString());
    }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      q = q.lt('started_at', new Date(localMidnightUtcMs(addDays(to, 1))).toISOString());
    }
    const { data, error, count } = await q;
    if (error) throw schemaError(error);
    return {
      items: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        ...r,
        has_recording: !!r.recording_path,
        recording_path: undefined,
      })),
      total: count ?? 0,
      page: p,
      pageSize: size,
    };
  }

  @Get('calls/:id')
  @RequirePerm('appointments.view')
  async call(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    const clinicId = clinicOf(u);
    const { data, error } = await this.supabase
      .admin()
      .from('ai_calls')
      .select(
        'id, channel, mode, status, caller_phone, outcome, needs_callback, callback_note, callback_done_at, started_at, ended_at, duration_sec, transcript, summary, recording_path, stt_seconds, tts_chars, llm_input_tokens, llm_output_tokens, est_cost_uzs, meta, error, patient:patients(id, full_name, phone), appointment:appointments(id, scheduled_at, status)',
      )
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw schemaError(error);
    if (!data) throw new NotFoundException('Qo‘ng‘iroq topilmadi');
    const row = data as Record<string, unknown> & { recording_path: string | null };
    let recording_url: string | null = null;
    if (row.recording_path) {
      const { data: signed } = await this.supabase
        .admin()
        .storage.from('call-recordings')
        .createSignedUrl(row.recording_path, 3600);
      recording_url = signed?.signedUrl ?? null;
    }
    return { ...row, recording_path: undefined, recording_url };
  }

  @Post('calls/:id/callback-done')
  @RequirePerm('appointments.view')
  @Audit({ action: 'ai_reception.callback_done', resourceType: 'ai_calls' })
  async callbackDone(
    @CurrentUser() u: U,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const clinicId = clinicOf(u);
    const { note } = z.object({ note: z.string().max(500).optional() }).parse(body ?? {});
    const { data, error } = await this.supabase
      .admin()
      .from('ai_calls')
      .update({
        callback_done_at: new Date().toISOString(),
        callback_done_by: u.userId,
        ...(note ? { summary: note } : {}),
      })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw schemaError(error);
    if (!data) throw new NotFoundException('Qo‘ng‘iroq topilmadi');
    return { ok: true };
  }

  @Get('stats')
  @RequirePerm('appointments.view')
  async stats(@CurrentUser() u: U, @Query('from') from?: string, @Query('to') to?: string) {
    const clinicId = clinicOf(u);
    const today = localDateOf(new Date());
    const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : `${today.slice(0, 8)}01`;
    const t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : today;
    const fromIso = new Date(localMidnightUtcMs(f)).toISOString();
    const toIso = new Date(localMidnightUtcMs(addDays(t, 1))).toISOString();
    const admin = this.supabase.admin();
    const [callsRes, pendingRes, bookedRes] = await Promise.all([
      admin
        .from('ai_calls')
        .select('channel, mode, outcome, duration_sec, est_cost_uzs')
        .eq('clinic_id', clinicId)
        .neq('channel', 'simulator')
        .gte('started_at', fromIso)
        .lt('started_at', toIso)
        .limit(10000),
      admin
        .from('ai_calls')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('needs_callback', true)
        .is('callback_done_at', null),
      admin
        .from('appointments')
        .select('source, status')
        .eq('clinic_id', clinicId)
        .neq('source', 'staff')
        .gte('created_at', fromIso)
        .lt('created_at', toIso)
        .limit(10000),
    ]);
    if (callsRes.error) throw schemaError(callsRes.error);
    const calls = (callsRes.data ?? []) as Array<{
      channel: string;
      mode: string;
      outcome: string | null;
      duration_sec: number | null;
      est_cost_uzs: number | null;
    }>;
    const phone = calls.filter((c) => c.channel === 'phone');
    const byOutcome: Record<string, number> = {};
    for (const c of calls)
      byOutcome[c.outcome ?? 'active'] = (byOutcome[c.outcome ?? 'active'] ?? 0) + 1;
    const bookings = (bookedRes.data ?? []) as Array<{ source: string; status: string }>;
    const bySource: Record<string, number> = {};
    for (const b of bookings) bySource[b.source] = (bySource[b.source] ?? 0) + 1;
    const durations = phone.map((c) => c.duration_sec ?? 0).filter((d) => d > 0);
    return {
      from: f,
      to: t,
      phone_calls: phone.length,
      phone_ai: phone.filter((c) => c.mode === 'ai').length,
      phone_voicemail: phone.filter((c) => c.mode === 'voicemail').length,
      telegram_chats: calls.filter((c) => c.channel === 'telegram').length,
      by_outcome: byOutcome,
      avg_duration_sec: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0,
      total_minutes: Math.round(durations.reduce((a, b) => a + b, 0) / 60),
      cost_uzs: calls.reduce((s, c) => s + (c.est_cost_uzs ?? 0), 0),
      pending_callbacks: pendingRes.count ?? 0,
      bookings_total: bookings.length,
      bookings_by_source: bySource,
      bookings_no_show: bookings.filter((b) => b.status === 'no_show').length,
      bookings_canceled: bookings.filter((b) => b.status === 'canceled').length,
    };
  }

  // ---------------------------------------------------------------- sinov
  @Post('simulate/start')
  @RequirePerm('settings.manage_online_queue')
  async simulateStart(@CurrentUser() u: U, @Body() body: unknown) {
    const clinicId = clinicOf(u);
    const input = SimStartSchema.parse(body ?? {});
    const s = await this.settings.get(clinicId);
    if (!this.settings.aiEffective(s)) {
      throw new ForbiddenException(
        "AI rejimi tarifingizda yoqilmagan — sinab ko'rish uchun Clary bilan bog'laning.",
      );
    }
    const clinic = await this.settings.clinicContext(clinicId);
    const greeting = this.brain.buildGreeting(s, clinic);
    const { callId } = await this.brain.startSession({
      clinicId,
      channel: 'simulator',
      callerPhone: normalizeUzPhone(input.caller_phone ?? null),
      greeting,
      meta: { started_by: u.userId },
    });
    return { call_id: callId, greeting };
  }

  @Post('simulate/turn')
  @RequirePerm('settings.manage_online_queue')
  async simulateTurn(@CurrentUser() u: U, @Body() body: unknown) {
    const clinicId = clinicOf(u);
    const input = SimTurnSchema.parse(body);
    const { data } = await this.supabase
      .admin()
      .from('ai_calls')
      .select('id, channel')
      .eq('clinic_id', clinicId)
      .eq('id', input.call_id)
      .maybeSingle();
    if (!data || (data as { channel: string }).channel !== 'simulator') {
      throw new NotFoundException('Sinov suhbati topilmadi');
    }
    this.brain.checkSimulatorQuota(clinicId);
    return this.brain.handleTurn(input.call_id, { text: input.text });
  }
}
