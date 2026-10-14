import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  addDays,
  localDateOf,
  localMidnightUtcMs,
  localTimeOf,
  parseHm,
  searchNorm,
  speakableUz,
  uzDateShort,
  uzRelativeDay,
  type FreeSlot,
} from '@clary/utils';

import { SupabaseService } from '../../common/services/supabase.service';
import { VaultService } from '../vault/vault.module';

import type {
  AiReceptionSettings,
  BrainTurnResult,
  CallChannel,
  CallOutcome,
  ClinicContext,
} from './ai-reception.types';
import {
  BRAIN_TOOLS,
  buildSystemPrompt,
  cleanForSpeech,
  detectLang,
  type PromptDoctor,
} from './brain-prompt';
import { BookingError, BookingService, normalizeUzPhone } from './booking.service';
import { PatientNotifierService } from './patient-notifier.service';
import { AiReceptionSettingsService, schemaError } from './settings.service';

// =============================================================================
// AI QABULXONA "MIYASI" — kanalga bog'liq bo'lmagan suhbat dvigateli
// =============================================================================
// Telefon (voice-agent), Telegram va sinov oynasi shu servisni chaqiradi:
//   startSession → handleTurn (har bemor gapi) → endSession
// Claude tool-use: bo'sh vaqt, yozish, bekor qilish, narx, odamga ulash.
// clinic_id va telefon raqami HECH QACHON modeldan olinmaydi — server qo'yadi.
// =============================================================================

/** Model — env bilan almashtiriladi (sifat yetmasa: claude-sonnet-5-5). */
const MODEL = process.env.AI_RECEPTION_MODEL?.trim() || 'claude-haiku-4-5';
const MAX_TOOL_ROUNDS = 5;
const MAX_TURNS = 30;
const MAX_MESSAGES = 40;
const SIMULATOR_TURNS_PER_DAY = 300;

/** $ / 1M token (kirish, chiqish) — taxminiy xarajat hisobi uchun. */
const MODEL_PRICES: Array<[RegExp, number, number]> = [
  [/haiku/, 1, 5],
  [/sonnet-5/, 2, 10],
  [/opus-5/, 4, 20],
  [/sonnet-4/, 3, 15],
  [/opus-4/, 5, 25],
];

const FALLBACK_FAIL =
  "Kechirasiz, hozir texnik nosozlik bor. Qabulxona sizga tez orada o'zi qo'ng'iroq qiladi.";
const FALLBACK_BYE = "Rahmat, sog' bo'ling!";

interface BrainState {
  v: 1;
  messages: Anthropic.MessageParam[];
  /** D1 → staff_id */
  doctors: Record<string, string>;
  /** A1 → appointment_id */
  appts: Record<string, string>;
  greeting: string | null;
  lang: 'uz' | 'ru';
  turns: number;
  known: number | null;
}

interface CallRow {
  id: string;
  clinic_id: string;
  channel: CallChannel;
  mode: string;
  status: string;
  caller_phone: string | null;
  patient_id: string | null;
  appointment_id: string | null;
  outcome: CallOutcome | null;
  needs_callback: boolean;
  callback_note: string | null;
  transcript: Array<{ role: string; text: string; at: string }>;
  llm_state: BrainState | null;
  llm_input_tokens: number;
  llm_output_tokens: number;
  stt_seconds: number;
  tts_chars: number;
  meta: Record<string, unknown>;
  started_at: string;
}

interface TurnFlags {
  transfer: boolean;
  end: boolean;
  callback: boolean;
  callbackNote: string | null;
  outcome: CallOutcome | null;
  appointmentId: string | null;
  patientId: string | null;
}

interface ToolCtx {
  call: CallRow;
  settings: AiReceptionSettings;
  clinic: ClinicContext;
  state: BrainState;
  flags: TurnFlags;
  dryRun: boolean;
  events: string[];
}

const OUTCOME_PRIORITY: CallOutcome[] = [
  'booked',
  'cancelled',
  'transferred',
  'callback',
  'voicemail',
  'info',
  'abandoned',
  'failed',
];

function strongerOutcome(a: CallOutcome | null, b: CallOutcome | null): CallOutcome | null {
  if (!a) return b;
  if (!b) return a;
  return OUTCOME_PRIORITY.indexOf(a) <= OUTCOME_PRIORITY.indexOf(b) ? a : b;
}

function modelParams(model: string): Record<string, unknown> {
  // Haiku 4.5 effort'ni qabul qilmaydi; yangi modellarda tezlik uchun 'low'.
  if (/haiku/.test(model)) return {};
  return { output_config: { effort: 'low' } };
}

export function estimateCostUzs(r: {
  llm_input_tokens: number;
  llm_output_tokens: number;
  stt_seconds: number;
  tts_chars: number;
}): number {
  const price = MODEL_PRICES.find(([re]) => re.test(MODEL)) ?? [/./, 3, 15];
  const usd = (r.llm_input_tokens * price[1] + r.llm_output_tokens * price[2]) / 1_000_000;
  const usdUzs = Number(process.env.USD_UZS_RATE ?? 12700);
  const sttPerMin = Number(process.env.AI_STT_UZS_PER_MIN ?? 425);
  const ttsPerChar = Number(process.env.AI_TTS_UZS_PER_CHAR ?? 1);
  return Math.round(
    usd * usdUzs + (Number(r.stt_seconds) / 60) * sttPerMin + Number(r.tts_chars) * ttsPerChar,
  );
}

/** Oxirgi N xabar — tool_use/tool_result juftligini buzmasdan kesiladi. */
function trimMessages(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length <= MAX_MESSAGES) return messages;
  for (let i = messages.length - MAX_MESSAGES; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === 'user' && typeof m.content === 'string') return messages.slice(i);
  }
  return messages.slice(-2);
}

function dayLabel(date: string, today: string): string {
  const rel = uzRelativeDay(date, today);
  return `${rel ? `${rel}, ` : ''}${uzDateShort(date)}`;
}

function groupByDate(slots: FreeSlot[]): Array<{ date: string; times: string[] }> {
  const map = new Map<string, string[]>();
  for (const s of slots) {
    const arr = map.get(s.date) ?? [];
    arr.push(s.time);
    map.set(s.date, arr);
  }
  return [...map.entries()].map(([date, times]) => ({ date, times }));
}

function partFilter(part: string | undefined) {
  return (t: string) => {
    const h = Number(t.slice(0, 2));
    if (part === 'morning') return h < 12;
    if (part === 'afternoon') return h >= 12 && h < 17;
    if (part === 'evening') return h >= 17;
    return true;
  };
}

/** Javobni ovozga tayyorlash: belgilar tozalanadi, o'zbekcha jumlalarda raqamlar so'z bilan. */
export function toSpeech(text: string): string {
  const clean = cleanForSpeech(text);
  return clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => (detectLang(sentence) === 'uz' ? speakableUz(sentence) : sentence))
    .join(' ');
}

const SlotsInput = z.object({
  doctor_id: z.string().min(1),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  part_of_day: z.enum(['morning', 'afternoon', 'evening', 'any']).optional(),
});
const BookInput = z.object({
  doctor_id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{1,2}:\d{2}$/),
  patient_full_name: z.string().min(3).max(120),
  patient_phone: z.string().max(40).optional(),
  reason: z.string().max(300).optional(),
});
const CancelInput = z.object({ appointment_ref: z.string().min(1) });
const ServicesInput = z.object({ query: z.string().min(1).max(100) });
const ReasonInput = z.object({ reason: z.string().max(300).optional() });
const NoteInput = z.object({ note: z.string().max(500).optional() });
const EndInput = z.object({
  outcome: z.enum(['booked', 'cancelled', 'info', 'callback']).optional(),
});

@Injectable()
export class ReceptionBrainService {
  private readonly log = new Logger('ReceptionBrain');
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly clients = new Map<string, { at: number; client: Anthropic }>();
  private readonly simCounters = new Map<string, { date: string; count: number }>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly settingsSvc: AiReceptionSettingsService,
    private readonly booking: BookingService,
    private readonly notifier: PatientNotifierService,
    private readonly vault: VaultService,
  ) {}

  get model(): string {
    return MODEL;
  }

  // ==========================================================================
  // Matnlar
  // ==========================================================================
  buildGreeting(s: AiReceptionSettings, clinic: ClinicContext): string {
    const ru = s.russian_hint ? ' Можете говорить по-русски.' : '';
    if (s.greeting?.trim()) return s.greeting.trim() + ru;
    const name = s.assistant_name?.trim() || 'Malika';
    return (
      `Assalomu alaykum! ${clinic.name} klinikasi, men ${name}, sun'iy intellekt yordamchisiman. ` +
      `Sizga qanday yordam bera olaman?${ru}`
    );
  }

  voicemailPrompt(s: AiReceptionSettings, clinic: ClinicContext): string {
    return (
      s.voicemail_prompt?.trim() ||
      `Assalomu alaykum! ${clinic.name} klinikasi. Hozir barcha xodimlarimiz band. ` +
        'Signaldan keyin ismingiz va qaysi shifokorga yozilmoqchi ekaningizni ayting — ' +
        "tez orada o'zimiz qo'ng'iroq qilamiz."
    );
  }

  readonly voicemailThanks =
    "Rahmat! Xabaringiz qabul qilindi, tez orada qo'ng'iroq qilamiz. Sog' bo'ling!";
  readonly rejectMessage =
    "Kechirasiz, hozir qo'ng'iroqqa javob bera olmaymiz. Iltimos, keyinroq qayta qo'ng'iroq qiling.";

  // ==========================================================================
  // Sessiya
  // ==========================================================================
  async startSession(input: {
    clinicId: string;
    channel: CallChannel;
    mode?: 'ai' | 'voicemail' | 'reject';
    externalId?: string | null;
    callerPhone?: string | null;
    lineId?: string | null;
    greeting?: string | null;
    meta?: Record<string, unknown>;
  }): Promise<{ callId: string }> {
    const state: BrainState = {
      v: 1,
      messages: [],
      doctors: {},
      appts: {},
      greeting: input.greeting ?? null,
      lang: 'uz',
      turns: 0,
      known: null,
    };
    const transcript = input.greeting
      ? [{ role: 'agent', text: input.greeting, at: new Date().toISOString() }]
      : [];
    const { data, error } = await this.supabase
      .admin()
      .from('ai_calls')
      .insert({
        clinic_id: input.clinicId,
        channel: input.channel,
        mode: input.mode ?? 'ai',
        external_id: input.externalId ?? null,
        caller_phone: input.callerPhone ?? null,
        line_id: input.lineId ?? null,
        llm_state: state,
        transcript,
        meta: input.meta ?? {},
      })
      .select('id')
      .single();
    if (error) throw schemaError(error);
    return { callId: (data as { id: string }).id };
  }

  /** Telegram: shu chat + klinika bo'yicha 30 daqiqa ichidagi faol suhbat. */
  async activeChatSession(clinicId: string, chatId: number): Promise<string | null> {
    const { data } = await this.supabase
      .admin()
      .from('ai_calls')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('channel', 'telegram')
      .eq('external_id', String(chatId))
      .eq('status', 'active')
      .gte('last_activity_at', new Date(Date.now() - 30 * 60_000).toISOString())
      .order('last_activity_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }

  private async loadCall(callId: string): Promise<CallRow> {
    const { data, error } = await this.supabase
      .admin()
      .from('ai_calls')
      .select(
        'id, clinic_id, channel, mode, status, caller_phone, patient_id, appointment_id, outcome, needs_callback, callback_note, transcript, llm_state, llm_input_tokens, llm_output_tokens, stt_seconds, tts_chars, meta, started_at',
      )
      .eq('id', callId)
      .maybeSingle();
    if (error) throw schemaError(error);
    if (!data) throw new NotFoundException('Suhbat topilmadi');
    return data as CallRow;
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const chained = prev.then(() => mine);
    this.locks.set(key, chained);
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }

  checkSimulatorQuota(clinicId: string) {
    const today = localDateOf(new Date());
    const cur = this.simCounters.get(clinicId);
    if (!cur || cur.date !== today) {
      this.simCounters.set(clinicId, { date: today, count: 1 });
      return;
    }
    if (cur.count >= SIMULATOR_TURNS_PER_DAY) {
      throw new ServiceUnavailableException(
        'Sinov suhbatlari kunlik chegarasi tugadi — ertaga davom eting.',
      );
    }
    cur.count += 1;
  }

  // ==========================================================================
  // Bitta navbat (bemor gapi → javob)
  // ==========================================================================
  handleTurn(
    callId: string,
    input: { text: string; altTextRu?: string | null; sttSeconds?: number },
  ): Promise<BrainTurnResult> {
    return this.withLock(callId, () => this.runTurn(callId, input));
  }

  private async runTurn(
    callId: string,
    input: { text: string; altTextRu?: string | null; sttSeconds?: number },
  ): Promise<BrainTurnResult> {
    const call = await this.loadCall(callId);
    if (call.status !== 'active') {
      throw new BadRequestException('SESSION_ENDED');
    }
    const settings = await this.settingsSvc.get(call.clinic_id);
    const clinic = await this.settingsSvc.clinicContext(call.clinic_id);
    const state: BrainState = call.llm_state ?? {
      v: 1,
      messages: [],
      doctors: {},
      appts: {},
      greeting: null,
      lang: 'uz',
      turns: 0,
      known: null,
    };
    const flags: TurnFlags = {
      transfer: false,
      end: false,
      callback: false,
      callbackNote: null,
      outcome: null,
      appointmentId: null,
      patientId: null,
    };
    const dryRun = call.channel === 'simulator';
    const ctx: ToolCtx = { call, settings, clinic, state, flags, dryRun, events: [] };

    // --- Shifokorlar ro'yxati + barqaror kodlar (D1, D2...) ---
    const all = await this.booking.directory(call.clinic_id);
    const enabled = all.filter((d) => d.booking_enabled && d.rules.length > 0);
    const others = all.filter(
      (d) => !(d.booking_enabled && d.rules.length > 0) && d.position === 'doctor',
    );
    const aliasOf = new Map(Object.entries(state.doctors).map(([a, id]) => [id, a]));
    let next =
      Object.keys(state.doctors).reduce((m, a) => Math.max(m, Number(a.slice(1)) || 0), 0) + 1;
    const promptDoctors: PromptDoctor[] = enabled.map((entry) => {
      let alias = aliasOf.get(entry.staff_id);
      if (!alias) {
        alias = `D${next++}`;
        state.doctors[alias] = entry.staff_id;
      }
      return { alias, entry };
    });

    if (state.known === null) {
      state.known = call.caller_phone
        ? (await this.booking.patientsByPhone(call.clinic_id, call.caller_phone)).length
        : 0;
    }

    const now = new Date();
    const { stable, dynamic } = buildSystemPrompt({
      channel: call.channel,
      clinic,
      settings,
      doctors: promptDoctors,
      otherDoctors: others,
      greeting: state.greeting,
      today: localDateOf(now),
      nowTime: localTimeOf(now),
      callerPhone: call.caller_phone,
      callerVerified: call.channel === 'telegram',
      knownPatients: state.known ?? 0,
      dryRun,
    });

    // --- Bemor gapi ---
    const heard = input.text.trim();
    const alt = input.altTextRu?.trim();
    const userText =
      alt && alt !== heard
        ? `[Ovoz matnga ikki xil o'girildi]\nO'zbekcha: "${heard}"\nRuscha: "${alt}"\n` +
          "Qaysi biri ma'noli bo'lsa, bemor o'sha tilda gapirgan — o'sha tilda javob ber."
        : heard;
    state.messages.push({ role: 'user', content: userText });
    const baseLen = state.messages.length;
    state.turns += 1;

    let reply = '';
    let inTok = 0;
    let outTok = 0;
    let errorText: string | null = null;

    if (state.turns > MAX_TURNS) {
      reply =
        "Suhbatimiz uzoq davom etdi. Qabulxona xodimi sizga qo'ng'iroq qilib, qolgan savollarga javob beradi.";
      flags.callback = true;
      flags.callbackNote = 'Suhbat juda uzun — AI to‘xtatdi';
      flags.end = true;
    } else {
      try {
        const client = await this.getClient(call.clinic_id);
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const lastRound = round === MAX_TOOL_ROUNDS;
          const response: Anthropic.Message = await client.messages.create({
            model: MODEL,
            max_tokens: 600,
            system: [
              { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: dynamic },
            ],
            tools: BRAIN_TOOLS,
            // Oxirgi aylanishda tool taqiqlanadi — matnli javob kafolatlanadi
            ...(lastRound ? { tool_choice: { type: 'none' } } : {}),
            messages: trimMessages(state.messages),
            ...(modelParams(MODEL) as object),
          } as Anthropic.MessageCreateParamsNonStreaming);

          const u = response.usage as Anthropic.Usage & {
            cache_creation_input_tokens?: number | null;
            cache_read_input_tokens?: number | null;
          };
          inTok += Math.round(
            (u.input_tokens ?? 0) +
              (u.cache_creation_input_tokens ?? 0) * 1.25 +
              (u.cache_read_input_tokens ?? 0) * 0.1,
          );
          outTok += u.output_tokens ?? 0;

          if ((response.stop_reason as string) === 'refusal') {
            reply = FALLBACK_FAIL;
            flags.callback = true;
            flags.callbackNote = 'AI javob bermadi (xavfsizlik filtri)';
            break;
          }

          state.messages.push({ role: 'assistant', content: response.content });

          if (response.stop_reason === 'tool_use' && !lastRound) {
            const results: Anthropic.ToolResultBlockParam[] = [];
            for (const block of response.content) {
              if (block.type !== 'tool_use') continue;
              const out = await this.executeTool(ctx, block.name, block.input);
              results.push({ type: 'tool_result', tool_use_id: block.id, content: out });
            }
            state.messages.push({ role: 'user', content: results });
            continue;
          }

          reply = response.content
            .filter((c): c is Anthropic.TextBlock => c.type === 'text')
            .map((c) => c.text)
            .join(' ')
            .trim();
          break;
        }
      } catch (e) {
        errorText = (e as Error).message;
        this.log.error(`turn xato (${callId}): ${errorText}`);
        // Yarim qolgan tool_use/tool_result juftliklarini olib tashlaymiz —
        // keyingi navbatda API "javobsiz tool_use" deb rad etmasin.
        state.messages.length = baseLen;
        reply = FALLBACK_FAIL;
        flags.callback = true;
        flags.callbackNote = 'Texnik xato — AI suhbatni davom ettira olmadi';
        if (call.channel === 'phone') flags.end = true;
      }
    }

    if (!reply) reply = flags.end ? FALLBACK_BYE : 'Tushunmadim, iltimos qaytaring.';
    // Suhbat tarixi user/assistant navbatma-navbat qolsin (xato/rad holatida ham)
    const last = state.messages[state.messages.length - 1];
    if (!last || last.role !== 'assistant')
      state.messages.push({ role: 'assistant', content: reply });
    state.lang = detectLang(reply);

    // --- Saqlash ---
    state.messages = trimMessages(state.messages);
    const end = flags.end || flags.transfer;
    const transferTo = flags.transfer ? normalizeUzPhone(settings.transfer_phone) : null;
    const at = new Date().toISOString();
    const transcript = [
      ...(call.transcript ?? []),
      { role: 'caller', text: heard, at },
      ...ctx.events.map((t) => ({ role: 'system', text: t, at })),
      { role: 'agent', text: reply, at },
    ].slice(-200);
    const newCallback = flags.callback && !call.needs_callback;
    const totals = {
      llm_input_tokens: (call.llm_input_tokens ?? 0) + inTok,
      llm_output_tokens: (call.llm_output_tokens ?? 0) + outTok,
      stt_seconds: Number(call.stt_seconds ?? 0) + (input.sttSeconds ?? 0),
      tts_chars: call.tts_chars ?? 0,
    };
    const finished = end && call.channel !== 'phone';
    const outcome = strongerOutcome(
      call.outcome,
      flags.outcome ?? (flags.callback ? 'callback' : null),
    );
    const { error: upErr } = await this.supabase
      .admin()
      .from('ai_calls')
      .update({
        llm_state: state,
        transcript,
        ...totals,
        est_cost_uzs: estimateCostUzs(totals),
        outcome,
        needs_callback: call.needs_callback || flags.callback,
        callback_note: flags.callbackNote ?? call.callback_note,
        appointment_id: flags.appointmentId ?? call.appointment_id,
        patient_id: flags.patientId ?? call.patient_id,
        last_activity_at: at,
        ...(finished ? { status: 'ended', ended_at: at } : {}),
        ...(errorText ? { error: errorText.slice(0, 500) } : {}),
      })
      .eq('id', callId);
    if (upErr) this.log.error(`ai_calls saqlanmadi (${callId}): ${upErr.message}`);

    // Telefon qo'ng'irog'ida egaga xabar qo'ng'iroq tugaganda (endSession) bir marta
    if (newCallback && call.channel === 'telegram' && settings.notify_owner_telegram) {
      void this.notifier
        .callbackNeeded(call.clinic_id, {
          caller_phone: call.caller_phone,
          note: flags.callbackNote,
          channel: call.channel,
          mode: call.mode,
        })
        .catch(() => undefined);
    }

    return {
      say: call.channel === 'phone' ? toSpeech(reply) : reply,
      lang: state.lang,
      end,
      action: flags.transfer ? 'transfer' : end ? 'hangup' : 'none',
      transfer_to: transferTo,
      outcome,
      appointment_id: flags.appointmentId ?? call.appointment_id,
    };
  }

  // ==========================================================================
  // Tool'lar
  // ==========================================================================
  private async executeTool(ctx: ToolCtx, name: string, raw: unknown): Promise<string> {
    try {
      const out = await this.runTool(ctx, name, raw);
      return JSON.stringify(out);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return JSON.stringify({ ok: false, error: 'BAD_INPUT', message: e.issues[0]?.message });
      }
      this.log.warn(`tool ${name} xato: ${(e as Error).message}`);
      return JSON.stringify({
        ok: false,
        error: 'INTERNAL',
        message:
          'Texnik xato. Bemorga qabulxona qayta qo‘ng‘iroq qilishini ayt va request_callback chaqir.',
      });
    }
  }

  private async runTool(ctx: ToolCtx, name: string, raw: unknown): Promise<unknown> {
    const { call, settings, state, flags } = ctx;
    const clinicId = call.clinic_id;
    const today = localDateOf(new Date());

    switch (name) {
      case 'get_free_slots': {
        const input = SlotsInput.parse(raw);
        const staffId = state.doctors[input.doctor_id.trim().toUpperCase()];
        if (!staffId) return { ok: false, error: 'UNKNOWN_DOCTOR', message: "Bunday kod yo'q" };
        const keep = partFilter(input.part_of_day);
        if (input.date) {
          const { doctor, slots } = await this.booking.freeSlots(clinicId, staffId, {
            fromDate: input.date,
            days: 1,
            settings,
          });
          const times = slots.filter((s) => keep(s.time)).map((s) => s.time);
          if (times.length) {
            return {
              ok: true,
              doctor: `${doctor.full_name} (${doctor.specialty_label})`,
              days: [
                { date: input.date, label: dayLabel(input.date, today), times: times.slice(0, 12) },
              ],
            };
          }
          const later = await this.booking.freeSlots(clinicId, staffId, {
            fromDate: addDays(input.date, 1),
            settings,
          });
          return {
            ok: true,
            doctor: `${doctor.full_name} (${doctor.specialty_label})`,
            days: [],
            note: `${dayLabel(input.date, today)} kuni bo'sh vaqt yo'q.`,
            nearest: groupByDate(later.slots.filter((s) => keep(s.time)))
              .slice(0, 2)
              .map((g) => ({
                date: g.date,
                label: dayLabel(g.date, today),
                times: g.times.slice(0, 8),
              })),
          };
        }
        const { doctor, slots } = await this.booking.freeSlots(clinicId, staffId, { settings });
        const days = groupByDate(slots.filter((s) => keep(s.time)))
          .slice(0, 3)
          .map((g) => ({
            date: g.date,
            label: dayLabel(g.date, today),
            times: g.times.slice(0, 8),
          }));
        return {
          ok: true,
          doctor: `${doctor.full_name} (${doctor.specialty_label})`,
          days,
          ...(days.length
            ? {}
            : { note: `Yaqin ${settings.booking_horizon_days} kunda bo'sh vaqt yo'q.` }),
        };
      }

      case 'book_appointment': {
        const input = BookInput.parse(raw);
        const staffId = state.doctors[input.doctor_id.trim().toUpperCase()];
        if (!staffId) return { ok: false, error: 'UNKNOWN_DOCTOR', message: "Bunday kod yo'q" };
        const [h, m] = input.time.split(':').map(Number);
        const startIso = new Date(
          localMidnightUtcMs(input.date) + parseHm(`${h}:${String(m).padStart(2, '0')}`) * 60_000,
        ).toISOString();
        // Telegram: raqam Telegram tasdiqlagan — o'zgartirilmaydi
        const phone =
          call.channel === 'telegram'
            ? call.caller_phone
            : (normalizeUzPhone(input.patient_phone) ?? call.caller_phone);
        try {
          const r = await this.booking.reserve(clinicId, {
            staffId,
            startIso,
            patient: { full_name: input.patient_full_name, phone },
            reason: input.reason ?? null,
            source: call.channel === 'phone' ? 'ai_phone' : 'ai_chat',
            callId: call.id,
            dryRun: ctx.dryRun,
          });
          flags.outcome = 'booked';
          flags.appointmentId = r.appointment_id;
          flags.patientId = r.patient_id;
          ctx.events.push(
            `✅ Yozildi: ${r.patient_name} → ${r.doctor.full_name}, ${r.date} ${r.time}` +
              (r.dry_run ? ' (sinov — saqlanmadi)' : ''),
          );
          return {
            ok: true,
            booked: {
              doctor: `${r.doctor.full_name} (${r.doctor.specialty_label})`,
              date: r.date,
              day_label: dayLabel(r.date, today),
              time: r.time,
              patient: r.patient_name,
              price_uzs: r.price_uzs,
              new_patient_card: r.new_patient,
            },
            ...(r.dry_run ? { test_mode: true } : {}),
          };
        } catch (e) {
          if (!(e instanceof BookingError)) throw e;
          ctx.events.push(`⚠️ Yozilmadi: ${e.message}`);
          const out: Record<string, unknown> = { ok: false, error: e.code, message: e.message };
          if (
            [
              'SLOT_TAKEN',
              'TOO_SOON',
              'OUTSIDE_SCHEDULE',
              'DOCTOR_OFF',
              'CLINIC_CLOSED',
              'SLOT_IN_PAST',
            ].includes(e.code)
          ) {
            const alt = await this.booking
              .freeSlots(clinicId, staffId, { fromDate: input.date, settings })
              .catch(() => null);
            if (alt) {
              out.alternatives = groupByDate(alt.slots)
                .slice(0, 2)
                .map((g) => ({
                  date: g.date,
                  label: dayLabel(g.date, today),
                  times: g.times.slice(0, 6),
                }));
            }
          }
          return out;
        }
      }

      case 'find_my_appointments': {
        if (!call.caller_phone) {
          return {
            ok: false,
            error: 'PHONE_UNKNOWN',
            message: "Qo'ng'iroq raqami aniqlanmadi — yozuvlarni faqat qabulxona aytib bera oladi.",
          };
        }
        const list = await this.booking.upcomingForPhone([clinicId], call.caller_phone);
        state.appts = {};
        return {
          ok: true,
          appointments: list.map((a, i) => {
            const ref = `A${i + 1}`;
            state.appts[ref] = a.appointment_id;
            return {
              ref,
              patient: a.patient_name,
              doctor: a.doctor_name,
              date: a.date,
              day_label: dayLabel(a.date, today),
              time: a.time,
            };
          }),
        };
      }

      case 'cancel_appointment': {
        const input = CancelInput.parse(raw);
        const id = state.appts[input.appointment_ref.trim().toUpperCase()];
        if (!id) {
          return { ok: false, error: 'UNKNOWN_REF', message: 'Avval find_my_appointments chaqir.' };
        }
        if (ctx.dryRun) {
          ctx.events.push('❌ Bekor qilindi (sinov — saqlanmadi)');
          flags.outcome = strongerOutcome(flags.outcome, 'cancelled');
          return { ok: true, cancelled: true, test_mode: true };
        }
        await this.booking.cancel(clinicId, id, {
          by: 'patient',
          phone: call.caller_phone,
          reason:
            call.channel === 'phone'
              ? 'Bemor AI qo‘ng‘irog‘ida bekor qildi'
              : 'Bemor Telegram AI orqali bekor qildi',
        });
        ctx.events.push('❌ Yozuv bekor qilindi');
        flags.outcome = strongerOutcome(flags.outcome, 'cancelled');
        return { ok: true, cancelled: true };
      }

      case 'search_services': {
        const input = ServicesInput.parse(raw);
        return { ok: true, services: await this.searchServices(clinicId, input.query) };
      }

      case 'transfer_to_human': {
        const input = ReasonInput.parse(raw);
        if (call.channel === 'phone' && normalizeUzPhone(settings.transfer_phone)) {
          flags.transfer = true;
          flags.outcome = strongerOutcome(flags.outcome, 'transferred');
          ctx.events.push(`↪️ Xodimga ulanmoqda (${input.reason ?? ''})`);
          return {
            ok: true,
            instruction:
              "Bemorga qisqa ayt: 'Hozir sizni qabulxona xodimiga ulayman, biroz kuting.'",
          };
        }
        flags.callback = true;
        flags.callbackNote = input.reason ?? 'Bemor odam bilan gaplashmoqchi';
        flags.outcome = strongerOutcome(flags.outcome, 'callback');
        ctx.events.push(`📞 Qayta qo'ng'iroq so'rovi: ${flags.callbackNote}`);
        return {
          ok: false,
          instruction:
            "Hozir xodimga ulab bo'lmaydi. Bemorga qabulxona tez orada o'zi bog'lanishini ayt (raqami bizda bor).",
        };
      }

      case 'request_callback': {
        const input = NoteInput.parse(raw);
        flags.callback = true;
        flags.callbackNote = input.note ?? null;
        flags.outcome = strongerOutcome(flags.outcome, 'callback');
        ctx.events.push(`📞 Qayta qo'ng'iroq so'rovi: ${input.note ?? ''}`);
        return { ok: true };
      }

      case 'end_conversation': {
        const input = EndInput.parse(raw);
        flags.end = true;
        if (input.outcome) flags.outcome = strongerOutcome(flags.outcome, input.outcome);
        return { ok: true };
      }

      default:
        return { ok: false, error: 'UNKNOWN_TOOL' };
    }
  }

  private async searchServices(clinicId: string, query: string) {
    const { data } = await this.supabase
      .admin()
      .from('services')
      .select('name_i18n, price_uzs')
      .eq('clinic_id', clinicId)
      .eq('is_archived', false)
      .limit(1000);
    const tokens = searchNorm(query).split(' ').filter(Boolean);
    const rows = (data ?? []) as Array<{
      name_i18n: Record<string, string> | null;
      price_uzs: number | null;
    }>;
    const scored = rows
      .map((r) => {
        const names = Object.values(r.name_i18n ?? {}).filter(Boolean);
        const norm = names.map((n) => searchNorm(n)).join(' ');
        const words = norm.split(' ');
        const hit = tokens.every((t) => words.some((w) => w.startsWith(t)));
        return hit
          ? {
              name: r.name_i18n?.['uz-Latn'] ?? names[0] ?? '',
              price_uzs: r.price_uzs == null ? null : Number(r.price_uzs),
              len: norm.length,
            }
          : null;
      })
      .filter((x): x is { name: string; price_uzs: number | null; len: number } => !!x)
      .sort((a, b) => a.len - b.len)
      .slice(0, 6);
    return scored.map(({ name, price_uzs }) => ({ name, price_uzs }));
  }

  // ==========================================================================
  // Yakunlash
  // ==========================================================================
  async endSession(
    callId: string,
    patch: {
      durationSec?: number;
      sttSeconds?: number;
      ttsChars?: number;
      hangupBy?: string;
      error?: string | null;
      voicemailTranscript?: string | null;
      hasRecording?: boolean;
    },
  ) {
    return this.withLock(callId, async () => {
      const call = await this.loadCall(callId);
      const settings = await this.settingsSvc.get(call.clinic_id).catch(() => null);
      const at = new Date().toISOString();
      const transcript = [...(call.transcript ?? [])];
      if (patch.voicemailTranscript?.trim()) {
        transcript.push({ role: 'caller', text: patch.voicemailTranscript.trim(), at });
      }
      const callerSpoke = transcript.some((t) => t.role === 'caller');
      const isVoicemail = call.mode === 'voicemail';
      const voicemailLeft =
        isVoicemail && (!!patch.hasRecording || !!patch.voicemailTranscript?.trim());
      const needsCallback = call.needs_callback || voicemailLeft;
      const outcome =
        call.outcome ??
        (isVoicemail
          ? voicemailLeft
            ? 'voicemail'
            : 'abandoned'
          : call.mode === 'reject'
            ? 'abandoned'
            : callerSpoke
              ? 'info'
              : 'abandoned');
      const totals = {
        llm_input_tokens: call.llm_input_tokens ?? 0,
        llm_output_tokens: call.llm_output_tokens ?? 0,
        stt_seconds: Number(call.stt_seconds ?? 0) + (patch.sttSeconds ?? 0),
        tts_chars: (call.tts_chars ?? 0) + (patch.ttsChars ?? 0),
      };
      const duration =
        patch.durationSec ??
        Math.max(0, Math.round((Date.now() - Date.parse(call.started_at)) / 1000));
      const { error } = await this.supabase
        .admin()
        .from('ai_calls')
        .update({
          status: patch.error ? 'failed' : 'ended',
          ended_at: at,
          duration_sec: duration,
          transcript,
          outcome,
          needs_callback: needsCallback,
          callback_note:
            call.callback_note ??
            (voicemailLeft ? patch.voicemailTranscript?.trim() || 'Ovozli xabar' : null),
          ...totals,
          est_cost_uzs: estimateCostUzs(totals),
          meta: { ...(call.meta ?? {}), hangup_by: patch.hangupBy ?? null },
          ...(patch.error ? { error: patch.error.slice(0, 500) } : {}),
        })
        .eq('id', callId);
      if (error) this.log.error(`endSession (${callId}): ${error.message}`);

      if (needsCallback && call.channel === 'phone' && settings?.notify_owner_telegram) {
        void this.notifier
          .callbackNeeded(call.clinic_id, {
            caller_phone: call.caller_phone,
            note: call.callback_note ?? patch.voicemailTranscript ?? null,
            channel: call.channel,
            mode: call.mode,
          })
          .catch(() => undefined);
      }
      return { ok: true, outcome, needs_callback: needsCallback };
    });
  }

  // ==========================================================================
  // Anthropic klienti: klinika kaliti (Sozlamalar → Integratsiyalar) yoki env
  // ==========================================================================
  private async getClient(clinicId: string): Promise<Anthropic> {
    const hit = this.clients.get(clinicId);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.client;
    let apiKey: string | null = null;
    try {
      const raw = await this.vault.getActiveSecret(clinicId, 'ai', 'anthropic');
      if (raw) {
        try {
          apiKey = (JSON.parse(raw) as { api_key?: string }).api_key ?? null;
        } catch {
          apiKey = raw.trim() || null;
        }
      }
    } catch (e) {
      this.log.warn(`vault: ${(e as Error).message}`);
    }
    apiKey = apiKey || process.env.ANTHROPIC_API_KEY || null;
    if (!apiKey) {
      throw new ServiceUnavailableException('AI kaliti sozlanmagan (ANTHROPIC_API_KEY).');
    }
    // Telefon suhbati: uzoq kutish bo'lmasin — 20 s, bitta qayta urinish
    const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
    this.clients.set(clinicId, { at: Date.now(), client });
    return client;
  }
}
