import { describe, expect, it, vi } from 'vitest';

import type { SupabaseService } from '../../common/services/supabase.service';
import type { VaultService } from '../vault/vault.module';
import { DEFAULT_SETTINGS, type DoctorEntry } from './ai-reception.types';
import { buildSystemPrompt, cleanForSpeech, detectLang } from './brain-prompt';
import { BookingError, normalizeUzPhone, type BookingService } from './booking.service';
import { estimateCostUzs, ReceptionBrainService, toSpeech } from './brain.service';
import type { PatientNotifierService } from './patient-notifier.service';
import type { AiReceptionSettingsService } from './settings.service';

// ---------------------------------------------------------------------------
// Soxta Supabase: so'rov zanjirini yozadi, javobni jadval bo'yicha handler beradi
// ---------------------------------------------------------------------------
type Op = [string, ...unknown[]];
type Res = { data: unknown; error: { message: string } | null };

function fakeSupabase(handler: (name: string, ops: Op[]) => Res) {
  const calls: Array<{ name: string; ops: Op[] }> = [];
  const builder = (name: string) => {
    const ops: Op[] = [];
    calls.push({ name, ops });
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            const res = handler(name, ops);
            return (ok: (v: Res) => unknown, fail: (e: unknown) => unknown) =>
              Promise.resolve(res).then(ok, fail);
          }
          return (...args: unknown[]) => {
            ops.push([prop, ...args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  const svc = { admin: () => ({ from: builder }) } as unknown as SupabaseService;
  return { svc, calls };
}

const DOCTOR: DoctorEntry = {
  staff_id: 'staff-1',
  clinic_id: 'clinic-1',
  profile_id: 'prof-1',
  full_name: 'Karimova Dilnoza Akramovna',
  position: 'doctor',
  specialization: 'Kardiolog',
  specialty_key: 'cardiology',
  specialty_group: 'cardiology',
  specialty_label: 'Kardiolog',
  photo_url: null,
  booking_enabled: true,
  medical_category: 'highest',
  academic_degree: 'phd',
  academic_title: null,
  experience_years: 15,
  slot_minutes: 30,
  keywords: ['EKG'],
  public_note: 'faqat kattalar',
  service_id: null,
  service_name: null,
  service_price_uzs: 150000,
  sort_order: 0,
  rules: [{ weekday: 1, start_time: '09:00', end_time: '14:00', capacity: 1 }],
  time_off: [],
  credentials: 'oliy toifali, PhD, 15 yil tajriba',
  schedule_summary: 'Du 09:00–14:00',
};

const CLINIC = {
  id: 'clinic-1',
  name: 'Shifo Med',
  address: 'Toshkent, Chilonzor 5',
  phone: '+998712000000',
  slug: 'shifo',
  working_hours_text: 'Du, Se, Ch, Pa, Ju 08:00–18:00',
  working_hours: [],
  closed_dates: [],
};

describe('brain-prompt', () => {
  it('shifokorlar qisqa kod bilan, klinika ma’lumoti va qoidalar promptda', () => {
    const { stable, dynamic } = buildSystemPrompt({
      channel: 'phone',
      clinic: CLINIC,
      settings: { ...DEFAULT_SETTINGS, clinic_id: 'clinic-1' },
      doctors: [{ alias: 'D1', entry: DOCTOR }],
      otherDoctors: [],
      greeting: 'Assalomu alaykum!',
      today: '2026-10-14',
      nowTime: '10:05',
      callerPhone: '+998901234567',
      callerVerified: false,
      knownPatients: 2,
      dryRun: false,
    });
    expect(stable).toContain('D1 · Karimova Dilnoza Akramovna — Kardiolog');
    expect(stable).toContain('oliy toifali, PhD, 15 yil tajriba');
    expect(stable).toContain("qabul narxi: 150 000 so'm");
    expect(stable).toContain('103');
    expect(stable).toContain("SO'Z bilan");
    expect(dynamic).toContain('2026-10-15 — ertaga');
    expect(dynamic).toContain('+998901234567');
    expect(dynamic).toContain('2 ta bemor kartasi');
    // Telefon raqami/ism kabi o'zgaruvchan narsa kesh qismiga tushmasin
    expect(stable).not.toContain('+998901234567');
  });

  it('til aniqlash va ovozga tozalash', () => {
    expect(detectLang('Ertaga soat o‘nda kutamiz')).toBe('uz');
    expect(detectLang('Записал вас на завтра')).toBe('ru');
    expect(cleanForSpeech('**Yozdim!** 😊\n- ertaga')).toBe('Yozdim! ertaga');
    expect(toSpeech('Ertaga soat 10:30 da. Записал на 10:30.')).toBe(
      "Ertaga soat o'n o'ttizda. Записал на 10:30.",
    );
  });

  it('telefon normallashtirish', () => {
    expect(normalizeUzPhone('901234567')).toBe('+998901234567');
    expect(normalizeUzPhone('+998 90 123 45 67')).toBe('+998901234567');
    expect(normalizeUzPhone('+7 916 123 45 67')).toBe(null);
    expect(normalizeUzPhone('anonymous')).toBe(null);
  });

  it('xarajat hisobi (taxminiy)', () => {
    const usage = {
      llm_input_tokens: 1_000_000,
      llm_output_tokens: 0,
      stt_seconds: 60,
      tts_chars: 100,
    };
    // haiku: $1 → 12700; nutq o'zimizning serverda — bepul
    expect(estimateCostUzs(usage)).toBe(12700);
    // tashqi pullik nutq provayderi narxi env bilan
    process.env.AI_STT_UZS_PER_MIN = '425';
    process.env.AI_TTS_UZS_PER_CHAR = '1';
    try {
      expect(estimateCostUzs(usage)).toBe(12700 + 425 + 100);
    } finally {
      delete process.env.AI_STT_UZS_PER_MIN;
      delete process.env.AI_TTS_UZS_PER_CHAR;
    }
  });
});

describe('ReceptionBrainService — tool-use sikli', () => {
  function setup(responses: unknown[], meta: Record<string, unknown> = {}) {
    const call = {
      id: 'call-1',
      clinic_id: 'clinic-1',
      channel: 'phone',
      mode: 'ai',
      status: 'active',
      caller_phone: '+998901234567',
      patient_id: null,
      appointment_id: null,
      outcome: null,
      needs_callback: false,
      callback_note: null,
      transcript: [],
      llm_state: null,
      llm_input_tokens: 0,
      llm_output_tokens: 0,
      stt_seconds: 0,
      tts_chars: 0,
      meta,
      started_at: new Date().toISOString(),
    };
    const updates: Array<Record<string, unknown>> = [];
    const { svc } = fakeSupabase((name, ops) => {
      if (name === 'ai_calls' && ops.some((o) => o[0] === 'update')) {
        updates.push(ops.find((o) => o[0] === 'update')![1] as Record<string, unknown>);
        return { data: null, error: null };
      }
      if (name === 'ai_calls') return { data: call, error: null };
      return { data: null, error: null };
    });
    const booking = {
      directory: vi.fn(async () => [DOCTOR]),
      patientsByPhone: vi.fn(async () => []),
      freeSlots: vi.fn(async () => ({
        doctor: DOCTOR,
        slots: [
          {
            start: '2099-01-05T05:00:00.000Z',
            end: '2099-01-05T05:30:00.000Z',
            date: '2099-01-05',
            time: '10:00',
            capacity: 1,
            taken: 0,
          },
        ],
      })),
      reserve: vi.fn(async () => ({
        appointment_id: 'appt-1',
        patient_id: 'pat-1',
        patient_name: 'Abdullayev Jasur',
        patient_phone: '+998901234567',
        starts_at: '2099-01-05T05:00:00.000Z',
        date: '2099-01-05',
        time: '10:00',
        doctor: DOCTOR,
        price_uzs: 150000,
        dry_run: false,
        new_patient: true,
      })),
    } as unknown as BookingService;
    const settings = {
      get: vi.fn(async () => ({ ...DEFAULT_SETTINGS, clinic_id: 'clinic-1' })),
      clinicContext: vi.fn(async () => CLINIC),
    } as unknown as AiReceptionSettingsService;
    const notifier = {
      callbackNeeded: vi.fn(async () => undefined),
    } as unknown as PatientNotifierService;
    const brain = new ReceptionBrainService(svc, settings, booking, notifier, {} as VaultService);
    const create = vi.fn();
    for (const r of responses) create.mockResolvedValueOnce(r);
    (brain as unknown as { getClient: () => Promise<unknown> }).getClient = async () => ({
      messages: { create },
    });
    return { brain, booking, create, updates };
  }

  const usage = { input_tokens: 100, output_tokens: 20 };

  it("bo'sh vaqt → yozish → yakuniy javob (ovozga moslangan)", async () => {
    const { brain, booking, create, updates } = setup([
      {
        stop_reason: 'tool_use',
        usage,
        content: [
          { type: 'tool_use', id: 't1', name: 'get_free_slots', input: { doctor_id: 'D1' } },
        ],
      },
      {
        stop_reason: 'tool_use',
        usage,
        content: [
          {
            type: 'tool_use',
            id: 't2',
            name: 'book_appointment',
            input: {
              doctor_id: 'd1',
              date: '2099-01-05',
              time: '10:00',
              patient_full_name: 'Abdullayev Jasur',
            },
          },
        ],
      },
      {
        stop_reason: 'end_turn',
        usage,
        content: [
          { type: 'text', text: 'Sizni Karimova shifokorga 5-yanvar soat 10:00 ga yozdim.' },
        ],
      },
    ]);

    const r = await brain.handleTurn('call-1', {
      text: 'Kardiologga yozilmoqchiman',
      sttSeconds: 3,
    });

    expect(create).toHaveBeenCalledTimes(3);
    // 2-chaqiriqda 1-tool natijasi yuborilgan
    const secondMessages = (create.mock.calls[1]![0] as { messages: Array<{ content: unknown }> })
      .messages;
    expect(JSON.stringify(secondMessages)).toContain('tool_result');
    expect(JSON.stringify(secondMessages)).toContain('10:00');

    expect(booking.reserve).toHaveBeenCalledWith(
      'clinic-1',
      expect.objectContaining({
        staffId: 'staff-1',
        startIso: '2099-01-05T05:00:00.000Z',
        source: 'ai_phone',
        callId: 'call-1',
        dryRun: false,
        patient: { full_name: 'Abdullayev Jasur', phone: '+998901234567' },
      }),
    );
    expect(r.say).toBe("Sizni Karimova shifokorga beshinchi yanvar soat o'nga yozdim.");
    expect(r.outcome).toBe('booked');
    expect(r.end).toBe(false);
    expect(updates.at(-1)).toMatchObject({ outcome: 'booked', appointment_id: 'appt-1' });
  });

  it('band vaqt — model xato kodi va muqobil vaqtlarni oladi', async () => {
    const { brain, booking, create } = setup([
      {
        stop_reason: 'tool_use',
        usage,
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'book_appointment',
            input: {
              doctor_id: 'D1',
              date: '2099-01-05',
              time: '10:00',
              patient_full_name: 'Ali Valiyev',
            },
          },
        ],
      },
      { stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'Bu vaqt band.' }] },
    ]);
    (booking.reserve as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new BookingError('SLOT_TAKEN'),
    );
    await brain.handleTurn('call-1', { text: 'ha' });
    const msgs = JSON.stringify((create.mock.calls[1]![0] as { messages: unknown }).messages);
    expect(msgs).toContain('SLOT_TAKEN');
    expect(msgs).toContain('alternatives');
  });

  it('odamga ulash raqami yo‘q — qayta qo‘ng‘iroq so‘rovi, egaga xabar oxirida', async () => {
    const { brain, updates } = setup([
      {
        stop_reason: 'tool_use',
        usage,
        content: [
          { type: 'tool_use', id: 't1', name: 'transfer_to_human', input: { reason: 'operator' } },
        ],
      },
      {
        stop_reason: 'end_turn',
        usage,
        content: [{ type: 'text', text: "Qabulxona tez orada qo'ng'iroq qiladi." }],
      },
    ]);
    const r = await brain.handleTurn('call-1', { text: 'operator bilan gaplashmoqchiman' });
    expect(r.action).toBe('none');
    expect(r.outcome).toBe('callback');
    expect(updates.at(-1)).toMatchObject({ needs_callback: true });
  });

  it('bulutli ATS qo‘ng‘irog‘i — odamga ulash ichki guruhga (raqam sozlanmagan bo‘lsa ham)', async () => {
    const { brain } = setup(
      [
        {
          stop_reason: 'tool_use',
          usage,
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'transfer_to_human',
              input: { reason: 'operator' },
            },
          ],
        },
        {
          stop_reason: 'end_turn',
          usage,
          content: [{ type: 'text', text: 'Hozir qabulxonaga ulayman.' }],
        },
      ],
      { pbx: true },
    );
    const r = await brain.handleTurn('call-1', { text: 'operator bilan gaplashmoqchiman' });
    expect(r.action).toBe('transfer');
    expect(r.transfer_to).toBe('group');
    expect(r.outcome).toBe('transferred');
  });

  it('API xatosida — uzr, qayta qo‘ng‘iroq va qo‘ng‘iroq yakuni', async () => {
    const { brain, create, updates } = setup([]);
    create.mockRejectedValueOnce(new Error('overloaded'));
    const r = await brain.handleTurn('call-1', { text: 'salom' });
    expect(r.end).toBe(true);
    expect(r.say).toContain('texnik nosozlik');
    expect(updates.at(-1)).toMatchObject({ needs_callback: true });
    // Tarix navbatma-navbat qoldi: oxirgi xabar — assistant
    const state = updates.at(-1)!.llm_state as { messages: Array<{ role: string }> };
    expect(state.messages.at(-1)!.role).toBe('assistant');
  });
});
