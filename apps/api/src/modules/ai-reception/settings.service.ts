import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  addDays,
  localDateOf,
  localMidnightUtcMs,
  parseHm,
  phoneKey,
  scheduleSummary,
  weekdayOf,
  type ScheduleRule,
} from '@clary/utils';

import { SupabaseService } from '../../common/services/supabase.service';

import {
  DEFAULT_SETTINGS,
  type AiReceptionSettings,
  type ClinicContext,
} from './ai-reception.types';

// =============================================================================
// AI qabulxona sozlamalari, liniyalar, klinika konteksti
// =============================================================================

/** Klinika o'zi o'zgartira oladigan maydonlar (ai_allowed / limit — super admin). */
export const CLINIC_EDITABLE_KEYS = [
  'mode',
  'after_hours_mode',
  'assistant_name',
  'greeting',
  'voicemail_prompt',
  'russian_hint',
  'voice',
  'speech_speed',
  'booking_horizon_days',
  'min_lead_minutes',
  'allow_new_patients',
  'transfer_phone',
  'extra_instructions',
  'record_calls',
  'max_call_seconds',
  'notify_owner_telegram',
  'telegram_ai_chat',
  'confirm_telegram',
  'confirm_sms',
  'reminder_enabled',
  'reminder_hour',
  'reminder_sms',
  'mark_no_show',
] as const;

export interface PhoneLine {
  id: string;
  clinic_id: string;
  line_key: string;
  phone_number: string | null;
  forwarded_from: string | null;
  label: string | null;
  is_active: boolean;
  created_at: string;
}

const MIGRATION_HINT =
  "AI qabulxona bazasi tayyor emas (migratsiya 20261014000001_ai_reception qo'llanmagan). " +
  'Serverda: bash scripts/deploy-ai-reception.sh';

/** PostgREST "jadval/ustun yo'q" xatolari — migratsiya qo'llanmaganining belgisi. */
export function isMissingSchema(err: { code?: string; message?: string } | null | undefined) {
  if (!err) return false;
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    err.code === 'PGRST204' ||
    err.code === '42703' ||
    /schema cache|does not exist/i.test(err.message ?? '')
  );
}

export function schemaError(err: { code?: string; message?: string }): Error {
  return isMissingSchema(err)
    ? new ServiceUnavailableException(MIGRATION_HINT)
    : new BadRequestException(err.message ?? 'DB xato');
}

@Injectable()
export class AiReceptionSettingsService {
  private readonly log = new Logger('AiReceptionSettings');
  private readonly ctxCache = new Map<string, { at: number; ctx: ClinicContext }>();
  private readonly actorCache = new Map<string, { at: number; id: string }>();

  constructor(private readonly supabase: SupabaseService) {}

  // ---------------------------------------------------------------- settings
  async get(clinicId: string): Promise<AiReceptionSettings> {
    const { data, error } = await this.supabase
      .admin()
      .from('ai_reception_settings')
      .select('*')
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (error) throw schemaError(error);
    const row = (data ?? {}) as Partial<AiReceptionSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)),
      // null bo'lishi mumkin bo'lgan matnlar — aynan bazadagidek
      greeting: row.greeting ?? null,
      voicemail_prompt: row.voicemail_prompt ?? null,
      voice: row.voice ?? null,
      transfer_phone: row.transfer_phone ?? null,
      extra_instructions: row.extra_instructions ?? null,
      speech_speed: Number(row.speech_speed ?? DEFAULT_SETTINGS.speech_speed),
      clinic_id: clinicId,
    } as AiReceptionSettings;
  }

  /** Bir nechta klinikaning sozlamalari (cron, Telegram). */
  async getMany(clinicIds: string[]): Promise<Map<string, AiReceptionSettings>> {
    const out = new Map<string, AiReceptionSettings>();
    if (clinicIds.length === 0) return out;
    const { data, error } = await this.supabase
      .admin()
      .from('ai_reception_settings')
      .select('*')
      .in('clinic_id', clinicIds);
    if (error) {
      if (isMissingSchema(error)) return out;
      throw new BadRequestException(error.message);
    }
    for (const r of (data ?? []) as AiReceptionSettings[]) {
      out.set(r.clinic_id, {
        ...DEFAULT_SETTINGS,
        ...r,
        speech_speed: Number(r.speech_speed ?? 1),
      });
    }
    return out;
  }

  async save(clinicId: string, userId: string | null, patch: Partial<AiReceptionSettings>) {
    const clean: Record<string, unknown> = {};
    for (const k of CLINIC_EDITABLE_KEYS) {
      if (patch[k] !== undefined) clean[k] = patch[k];
    }
    if (clean.mode === 'ai') {
      const current = await this.get(clinicId);
      if (!this.aiEffective(current)) {
        throw new BadRequestException(
          "AI rejimi tarifingizda yoqilmagan. Hozircha 'Ovozli xabar' rejimidan foydalaning yoki " +
            "Clary bilan bog'laning.",
        );
      }
    }
    const { error } = await this.supabase
      .admin()
      .from('ai_reception_settings')
      .upsert(
        {
          clinic_id: clinicId,
          ...clean,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        },
        { onConflict: 'clinic_id' },
      );
    if (error) throw schemaError(error);
    return this.get(clinicId);
  }

  /** Super admin: premium ruxsat va oylik chegara. */
  async adminSet(
    clinicId: string,
    userId: string | null,
    patch: { ai_allowed?: boolean; monthly_call_limit?: number },
  ) {
    const row: Record<string, unknown> = {
      clinic_id: clinicId,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    };
    if (patch.ai_allowed !== undefined) row.ai_allowed = patch.ai_allowed;
    if (patch.monthly_call_limit !== undefined) row.monthly_call_limit = patch.monthly_call_limit;
    const { error } = await this.supabase
      .admin()
      .from('ai_reception_settings')
      .upsert(row, { onConflict: 'clinic_id' });
    if (error) throw schemaError(error);
    // Ruxsat olib tashlansa — AI rejimidagi klinika ovozli xabarga tushadi
    if (patch.ai_allowed === false) {
      await this.supabase
        .admin()
        .from('ai_reception_settings')
        .update({ mode: 'voicemail' })
        .eq('clinic_id', clinicId)
        .eq('mode', 'ai');
    }
    return this.get(clinicId);
  }

  /** AI ishlatish mumkinmi (premium ruxsat yoki serverda hammaga ochiq). */
  aiEffective(s: Pick<AiReceptionSettings, 'ai_allowed'>): boolean {
    return s.ai_allowed || process.env.AI_RECEPTION_OPEN_ALL === 'true';
  }

  /** Shu oydagi AI telefon qo'ng'iroqlari soni (chegara uchun). */
  async monthlyAiCalls(clinicId: string, now = new Date()): Promise<number> {
    const today = localDateOf(now);
    const monthStart = `${today.slice(0, 8)}01`;
    const { count, error } = await this.supabase
      .admin()
      .from('ai_calls')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('channel', 'phone')
      .eq('mode', 'ai')
      .gte('started_at', new Date(localMidnightUtcMs(monthStart)).toISOString());
    if (error) return 0;
    return count ?? 0;
  }

  /** Oylik foydalanish (sozlamalar va super admin sahifasi uchun). */
  async monthlyUsage(clinicId: string, now = new Date()) {
    const today = localDateOf(now);
    const monthStart = new Date(localMidnightUtcMs(`${today.slice(0, 8)}01`)).toISOString();
    const { data, error } = await this.supabase
      .admin()
      .from('ai_calls')
      .select('channel, mode, outcome, duration_sec, est_cost_uzs')
      .eq('clinic_id', clinicId)
      .gte('started_at', monthStart)
      .limit(10000);
    if (error) return { calls: 0, ai_calls: 0, minutes: 0, booked: 0, cost_uzs: 0 };
    const rows = (data ?? []) as Array<{
      channel: string;
      mode: string;
      outcome: string | null;
      duration_sec: number | null;
      est_cost_uzs: number | null;
    }>;
    const phone = rows.filter((r) => r.channel === 'phone');
    return {
      calls: phone.length,
      ai_calls: phone.filter((r) => r.mode === 'ai').length,
      minutes: Math.round(phone.reduce((s, r) => s + (r.duration_sec ?? 0), 0) / 60),
      booked: rows.filter((r) => r.outcome === 'booked').length,
      cost_uzs: rows.reduce((s, r) => s + (r.est_cost_uzs ?? 0), 0),
    };
  }

  // ---------------------------------------------------------------- lines
  async listLines(clinicId: string): Promise<PhoneLine[]> {
    const { data, error } = await this.supabase
      .admin()
      .from('ai_phone_lines')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('created_at');
    if (error) throw schemaError(error);
    return (data ?? []) as PhoneLine[];
  }

  normalizeLineKey(raw: string): string {
    const v = raw.trim();
    // Raqam bo'lsa — oxirgi 9 raqam (DID formati operatorga qarab har xil keladi)
    const digits = v.replace(/\D/g, '');
    if (/^[+\d\s()-]+$/.test(v) && digits.length >= 7) return phoneKey(v);
    return v.toLowerCase();
  }

  async createLine(
    clinicId: string,
    input: {
      line_key: string;
      phone_number?: string | null;
      forwarded_from?: string | null;
      label?: string | null;
    },
  ) {
    const lineKey = this.normalizeLineKey(input.line_key);
    if (!lineKey) throw new BadRequestException('Liniya kaliti bo‘sh');
    // trunk-<kod> — bulutli ATS liniyalari (ensureLine yaratadi); boshqa klinika band qilib qo'ymasin
    if (lineKey.startsWith('trunk-')) {
      throw new BadRequestException(
        '“trunk-” bilan boshlanadigan kalit bulutli ATS uchun band (Sozlamalar → IP-telefoniya)',
      );
    }
    const { data, error } = await this.supabase
      .admin()
      .from('ai_phone_lines')
      .insert({
        clinic_id: clinicId,
        line_key: lineKey,
        phone_number: input.phone_number ?? null,
        forwarded_from: input.forwarded_from ?? null,
        label: input.label ?? null,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new BadRequestException(
          `"${lineKey}" liniyasi allaqachon boshqa joyda ro'yxatda (bitta liniya — bitta klinika).`,
        );
      }
      throw schemaError(error);
    }
    return data as PhoneLine;
  }

  async updateLine(
    clinicId: string,
    id: string,
    patch: Partial<Pick<PhoneLine, 'phone_number' | 'forwarded_from' | 'label' | 'is_active'>>,
  ) {
    const { data, error } = await this.supabase
      .admin()
      .from('ai_phone_lines')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw schemaError(error);
    if (!data) throw new NotFoundException('Liniya topilmadi');
    return data as PhoneLine;
  }

  async deleteLine(clinicId: string, id: string) {
    const { error } = await this.supabase
      .admin()
      .from('ai_phone_lines')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw schemaError(error);
    return { ok: true };
  }

  /**
   * Bulutli ATS trunk'i uchun AI liniyasi (`trunk-<kod>`) — klinika IP-telefoniyani
   * saqlaganda avtomatik yaratiladi/yangilanadi (qo'lda qo'shish shart emas).
   */
  async ensureLine(
    clinicId: string,
    lineKey: string,
    input: { phone_number: string | null; label: string; is_active: boolean },
  ) {
    const admin = this.supabase.admin();
    const { data: existing, error } = await admin
      .from('ai_phone_lines')
      .select('id, clinic_id')
      .eq('line_key', lineKey)
      .maybeSingle();
    if (error) throw schemaError(error);
    const row = existing as { id: string; clinic_id: string } | null;
    if (row && row.clinic_id !== clinicId) {
      throw new BadRequestException(`"${lineKey}" liniyasi boshqa klinikaga tegishli`);
    }
    const values = {
      phone_number: input.phone_number,
      forwarded_from: null,
      label: input.label,
      is_active: input.is_active,
    };
    const res = row
      ? await admin.from('ai_phone_lines').update(values).eq('id', row.id)
      : await admin
          .from('ai_phone_lines')
          .insert({ clinic_id: clinicId, line_key: lineKey, ...values });
    if (res.error) throw schemaError(res.error);
  }

  /**
   * Kiruvchi qo'ng'iroq qaysi klinikaniki: avval Asterisk endpoint nomi
   * (goip1), keyin chaqirilgan raqam (DID) oxirgi 9 raqami bo'yicha.
   */
  async resolveLine(lineKey: string | null, did: string | null): Promise<PhoneLine | null> {
    const keys = [lineKey ? this.normalizeLineKey(lineKey) : '', did ? phoneKey(did) : '']
      .filter((k) => k && k.length > 0)
      .filter((k, i, a) => a.indexOf(k) === i);
    if (keys.length === 0) return null;
    const { data, error } = await this.supabase
      .admin()
      .from('ai_phone_lines')
      .select('*')
      .in('line_key', keys)
      .eq('is_active', true);
    if (error) throw schemaError(error);
    const rows = (data ?? []) as PhoneLine[];
    // Endpoint mosligi DID mosligidan ustun
    return rows.find((r) => r.line_key === keys[0]) ?? rows[0] ?? null;
  }

  // ---------------------------------------------------------------- clinic
  async clinicContext(clinicId: string): Promise<ClinicContext> {
    const hit = this.ctxCache.get(clinicId);
    if (hit && Date.now() - hit.at < 60_000) return hit.ctx;
    const admin = this.supabase.admin();
    const [{ data: clinic }, { data: wh }, { data: hol }] = await Promise.all([
      admin
        .from('clinics')
        .select('id, name, address, phone, slug')
        .eq('id', clinicId)
        .maybeSingle(),
      admin
        .from('working_hours')
        .select('day_of_week, open_from, close_to, is_closed')
        .eq('clinic_id', clinicId),
      admin
        .from('holidays')
        .select('date, is_closed, recurring_yearly, is_archived')
        .eq('clinic_id', clinicId)
        .eq('is_archived', false)
        .eq('is_closed', true),
    ]);
    if (!clinic) throw new NotFoundException('Klinika topilmadi');
    const c = clinic as {
      id: string;
      name: string;
      address: string | null;
      phone: string | null;
      slug: string | null;
    };

    const rules: ScheduleRule[] = (
      (wh ?? []) as Array<{
        day_of_week: number;
        open_from: string | null;
        close_to: string | null;
        is_closed: boolean;
      }>
    )
      .filter(
        (r) =>
          !r.is_closed &&
          Number.isFinite(parseHm(r.open_from)) &&
          Number.isFinite(parseHm(r.close_to)),
      )
      .map((r) => ({
        weekday: r.day_of_week,
        start_time: r.open_from as string,
        end_time: r.close_to as string,
      }));

    // Bayramlar: keyingi 120 kun ichidagi yopiq sanalar (har yili takrorlanuvchilar ham)
    const today = localDateOf(new Date());
    const horizon = addDays(today, 120);
    const closed = new Set<string>();
    for (const h of (hol ?? []) as Array<{ date: string; recurring_yearly: boolean }>) {
      const d = String(h.date).slice(0, 10);
      if (!h.recurring_yearly) {
        if (d >= today && d <= horizon) closed.add(d);
        continue;
      }
      const md = d.slice(5);
      for (const y of [Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1]) {
        const cand = `${y}-${md}`;
        if (cand >= today && cand <= horizon) closed.add(cand);
      }
    }

    const ctx: ClinicContext = {
      id: c.id,
      name: c.name,
      address: c.address,
      phone: c.phone,
      slug: c.slug,
      working_hours_text: rules.length ? scheduleSummary(rules) : null,
      working_hours: rules,
      closed_dates: [...closed].sort(),
    };
    this.ctxCache.set(clinicId, { at: Date.now(), ctx });
    return ctx;
  }

  /** Hozir klinika ish vaqtidami (ish vaqti kiritilmagan bo'lsa — doim "ha"). */
  isOpenNow(ctx: ClinicContext, now = new Date()): boolean {
    if (ctx.working_hours.length === 0) return true;
    const date = localDateOf(now);
    if (ctx.closed_dates.includes(date)) return false;
    const minute = Math.floor((now.getTime() - localMidnightUtcMs(date)) / 60_000);
    const wd = weekdayOf(date);
    return ctx.working_hours.some(
      (r) => r.weekday === wd && minute >= parseHm(r.start_time) && minute < parseHm(r.end_time),
    );
  }

  /**
   * AI/bot yaratgan yozuvlar uchun "kim yaratdi" — klinika egasi (yoki admin).
   * patients.created_by va appointments.created_by NOT NULL; asl manba
   * appointments.source da saqlanadi.
   */
  async systemActorId(clinicId: string): Promise<string> {
    const hit = this.actorCache.get(clinicId);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.id;
    const { data } = await this.supabase
      .admin()
      .from('profiles')
      .select('id, role, created_at')
      .eq('clinic_id', clinicId)
      .in('role', ['clinic_owner', 'clinic_admin'])
      .order('created_at', { ascending: true })
      .limit(10);
    const rows = (data ?? []) as Array<{ id: string; role: string }>;
    const actor = rows.find((r) => r.role === 'clinic_owner') ?? rows[0];
    if (!actor) {
      this.log.error(`systemActorId: klinika ${clinicId} da owner/admin profil yo'q`);
      throw new BadRequestException("Klinika egasi profili topilmadi — yozuv yaratib bo'lmaydi");
    }
    this.actorCache.set(clinicId, { at: Date.now(), id: actor.id });
    return actor.id;
  }
}
