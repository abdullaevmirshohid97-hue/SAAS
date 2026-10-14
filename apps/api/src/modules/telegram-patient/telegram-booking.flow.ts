import { Injectable, Logger } from '@nestjs/common';
import {
  localDateOf,
  localTimeOf,
  shortDoctorName,
  uzDateShort,
  uzRelativeDay,
  UZ_MONTHS,
  UZ_WEEKDAYS_SHORT,
  weekdayOf,
} from '@clary/utils';

import type { DoctorEntry } from '../ai-reception/ai-reception.types';
import { BookingError, BookingService } from '../ai-reception/booking.service';
import { ReceptionBrainService } from '../ai-reception/brain.service';
import { AiReceptionSettingsService } from '../ai-reception/settings.service';
import { SttClient } from '../ai-reception/stt.client';

// =============================================================================
// BEMOR BOTI — ONLINE NAVBAT 2.0 (shifokor jadvali bo'yicha) + AI suhbat
// =============================================================================
// Tugmali oqim (BEPUL, AI'siz):
//   klinika → mutaxassislik → shifokor (toifa, daraja) → kun → soat → bemor →
//   tasdiq → yozildi. Bekor qilish / "Kelaman" — eslatma tugmalaridan.
// AI suhbat (premium): ro'yxatdan o'tgan bemor erkin matn yoki OVOZLI xabar
//   yozsa — AI qabulxona javob beradi (xuddi telefondagi "miya").
//
// Callback ma'lumotlari (Telegram cheklovi 64 bayt):
//   nc:<clinic>          klinika tanlash        ns:<clinic>:<spec>  mutaxassislik
//   nd:<staff>           shifokor → kunlar      ny:<staff>:<yyyymmdd> kun → soatlar
//   nt:<staff>:<min36>   soat (epoch daqiqa)    np:<i|new>          bemor tanlash
//   nok / nno            tasdiqlash / bekor     ncx/ncy/ncf:<appt>  bekor/tasdiq
//   na:<clinic>          AI suhbat uchun klinika
// =============================================================================

export interface BotPort {
  send(chatId: number, text: string, replyMarkup?: unknown): Promise<unknown>;
  api(
    method: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; result?: unknown; description?: string }>;
  token(): string | null;
  mainMenu(): unknown;
}

export interface FlowLink {
  chat_id: number;
  phone: string;
}

export interface FlowClinic {
  clinic_id: string;
  patient_id: string | null;
  clinic: { id: string; name: string; slug: string } | null;
}

interface FlowState {
  at: number;
  clinicId?: string;
  staffId?: string;
  startIso?: string;
  candidates?: Array<{ id: string; name: string }>;
  patientId?: string | null;
  newName?: string | null;
  awaitingName?: boolean;
  aiClinicId?: string;
  pendingAiText?: string;
}

const FLOW_TTL_MS = 20 * 60_000;

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function money(n: number | null): string | null {
  return n == null ? null : `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} so'm`;
}

function credShort(d: DoctorEntry): string {
  const parts: string[] = [];
  if (d.academic_title === 'professor') parts.push('prof.');
  else if (d.academic_title === 'docent') parts.push('dots.');
  if (d.academic_degree) parts.push(d.academic_degree === 'dsc' ? 'DSc' : 'PhD');
  if (d.medical_category === 'highest') parts.push('oliy toifa');
  else if (d.medical_category === 'first') parts.push('1-toifa');
  else if (d.medical_category === 'second') parts.push('2-toifa');
  return parts.join(', ');
}

function dayButton(date: string, today: string, count: number): string {
  const rel = uzRelativeDay(date, today);
  const [, m, d] = date.split('-').map(Number);
  const mon = (UZ_MONTHS[(m ?? 1) - 1] ?? '').slice(0, 3);
  return `${rel ? `${cap(rel)}, ` : ''}${d}-${mon} (${UZ_WEEKDAYS_SHORT[weekdayOf(date)]}) · ${count}`;
}

function whenLabel(iso: string): string {
  const date = localDateOf(iso);
  const rel = uzRelativeDay(date, localDateOf(new Date()));
  return `${rel ? `${cap(rel)}, ` : ''}${uzDateShort(date)} · ${localTimeOf(iso)}`;
}

@Injectable()
export class TelegramBookingFlow {
  private readonly log = new Logger('TelegramBooking');
  private readonly flows = new Map<number, FlowState>();

  constructor(
    private readonly booking: BookingService,
    private readonly brain: ReceptionBrainService,
    private readonly settings: AiReceptionSettingsService,
    private readonly stt: SttClient,
  ) {}

  private state(chatId: number): FlowState {
    const cur = this.flows.get(chatId);
    if (cur && Date.now() - cur.at < FLOW_TTL_MS) {
      cur.at = Date.now();
      return cur;
    }
    const fresh: FlowState = { at: Date.now(), aiClinicId: cur?.aiClinicId };
    this.flows.set(chatId, fresh);
    return fresh;
  }

  private resetBooking(chatId: number) {
    const s = this.state(chatId);
    this.flows.set(chatId, { at: Date.now(), aiClinicId: s.aiClinicId });
  }

  // ==========================================================================
  // Navbat oqimi
  // ==========================================================================
  /** "🩺 Online navbat". false — online navbat ochiq klinika yo'q (eski oqim ishlasin). */
  async start(bot: BotPort, chatId: number, clinics: FlowClinic[]): Promise<boolean> {
    const ids = clinics.map((c) => c.clinic_id);
    const bookable = await this.booking.bookableClinics(ids);
    const list = clinics.filter((c) => bookable.has(c.clinic_id) && c.clinic);
    if (list.length === 0) return false;
    this.resetBooking(chatId);
    if (list.length === 1) {
      await this.showSpecialties(bot, chatId, list[0]!.clinic_id, list[0]!.clinic!.name);
      return true;
    }
    await bot.send(chatId, '🏥 Qaysi klinikaga yozilasiz?', {
      inline_keyboard: list.map((c) => [
        { text: c.clinic!.name, callback_data: `nc:${c.clinic_id}` },
      ]),
    });
    return true;
  }

  private async showSpecialties(
    bot: BotPort,
    chatId: number,
    clinicId: string,
    clinicName?: string,
  ) {
    const doctors = await this.booking.directory(clinicId, { onlyEnabled: true });
    if (doctors.length === 0) {
      await bot.send(
        chatId,
        'Bu klinikada hozircha online navbat yopiq. Klinikaga qo‘ng‘iroq qiling.',
      );
      return;
    }
    const groups = new Map<string, { label: string; count: number }>();
    for (const d of doctors) {
      const g = groups.get(d.specialty_group) ?? { label: d.specialty_label, count: 0 };
      g.count += 1;
      groups.set(d.specialty_group, g);
    }
    if (groups.size === 1) {
      await this.showDoctors(bot, chatId, clinicId, [...groups.keys()][0]!);
      return;
    }
    const rows = [...groups.entries()]
      .sort((a, b) => a[1].label.localeCompare(b[1].label))
      .map(([key, g]) => [
        { text: `${g.label} (${g.count})`, callback_data: `ns:${clinicId}:${key}`.slice(0, 64) },
      ]);
    rows.push([{ text: '👨‍⚕️ Barcha shifokorlar', callback_data: `ns:${clinicId}:all` }]);
    await bot.send(
      chatId,
      `${clinicName ? `🏥 <b>${esc(clinicName)}</b>\n\n` : ''}Qaysi mutaxassis kerak?`,
      { inline_keyboard: rows },
    );
  }

  private async showDoctors(bot: BotPort, chatId: number, clinicId: string, group: string) {
    const doctors = (await this.booking.directory(clinicId, { onlyEnabled: true })).filter(
      (d) => group === 'all' || d.specialty_group === group,
    );
    if (doctors.length === 0) {
      await bot.send(chatId, 'Shifokor topilmadi.');
      return;
    }
    const lines = doctors.map((d, i) => {
      const meta = [d.credentials, d.schedule_summary ? `🗓 ${d.schedule_summary}` : null]
        .filter(Boolean)
        .join('\n   ');
      const price = money(d.service_price_uzs);
      return (
        `${i + 1}. <b>${esc(d.full_name)}</b> — ${esc(d.specialty_label)}` +
        (meta ? `\n   ${esc(meta)}` : '') +
        (price ? `\n   💵 ${esc(price)}` : '') +
        (d.public_note ? `\n   ℹ️ ${esc(d.public_note)}` : '')
      );
    });
    await bot.send(chatId, `👨‍⚕️ <b>Shifokorni tanlang</b>\n\n${lines.join('\n\n')}`, {
      inline_keyboard: doctors.map((d) => {
        const c = credShort(d);
        return [
          {
            text: `${shortDoctorName(d.full_name)}${c ? ` · ${c}` : ''}`,
            callback_data: `nd:${d.staff_id}`,
          },
        ];
      }),
    });
  }

  private async showDays(bot: BotPort, chatId: number, clinicId: string, staffId: string) {
    const { doctor, slots } = await this.booking.freeSlots(clinicId, staffId);
    const today = localDateOf(new Date());
    const counts = new Map<string, number>();
    for (const s of slots) counts.set(s.date, (counts.get(s.date) ?? 0) + 1);
    const days = [...counts.entries()].slice(0, 10);
    if (days.length === 0) {
      await bot.send(
        chatId,
        `😔 <b>${esc(doctor.full_name)}</b> — yaqin kunlarda bo‘sh vaqt yo‘q. Boshqa shifokorni tanlang yoki klinikaga qo‘ng‘iroq qiling.`,
      );
      return;
    }
    const buttons = days.map(([date, n]) => ({
      text: dayButton(date, today, n),
      callback_data: `ny:${staffId}:${date.replace(/-/g, '')}`,
    }));
    const rows: Array<typeof buttons> = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    await bot.send(
      chatId,
      `👨‍⚕️ <b>${esc(doctor.full_name)}</b>\n${esc(doctor.specialty_label)}` +
        (doctor.credentials ? ` · ${esc(doctor.credentials)}` : '') +
        `\n\n🗓 Kunni tanlang (son — bo‘sh vaqtlar):`,
      { inline_keyboard: rows },
    );
  }

  private async showTimes(
    bot: BotPort,
    chatId: number,
    clinicId: string,
    staffId: string,
    date: string,
  ) {
    const { doctor, slots } = await this.booking.freeSlots(clinicId, staffId, {
      fromDate: date,
      days: 1,
    });
    if (slots.length === 0) {
      await bot.send(chatId, 'Bu kunda bo‘sh vaqt qolmadi — boshqa kunni tanlang.');
      await this.showDays(bot, chatId, clinicId, staffId);
      return;
    }
    const buttons = slots.slice(0, 24).map((s) => ({
      text: s.time,
      callback_data: `nt:${staffId}:${Math.round(Date.parse(s.start) / 60_000).toString(36)}`,
    }));
    const rows: Array<typeof buttons> = [];
    for (let i = 0; i < buttons.length; i += 4) rows.push(buttons.slice(i, i + 4));
    rows.push([{ text: '↩️ Boshqa kun', callback_data: `nd:${staffId}` }]);
    await bot.send(
      chatId,
      `👨‍⚕️ <b>${esc(doctor.full_name)}</b>\n🗓 ${esc(cap(uzRelativeDay(date, localDateOf(new Date())) ?? ''))}` +
        `${uzRelativeDay(date, localDateOf(new Date())) ? ', ' : ''}${esc(uzDateShort(date))}\n\n⏰ Vaqtni tanlang:`,
      { inline_keyboard: rows },
    );
  }

  private async pickTime(
    bot: BotPort,
    chatId: number,
    link: FlowLink,
    clinicId: string,
    staffId: string,
    startMs: number,
  ) {
    const startIso = new Date(startMs).toISOString();
    const date = localDateOf(startIso);
    // Vaqt hali bo'shmi (boshqa kanal band qilgan bo'lishi mumkin)
    const { slots } = await this.booking.freeSlots(clinicId, staffId, { fromDate: date, days: 1 });
    if (!slots.some((s) => Date.parse(s.start) === startMs)) {
      await bot.send(chatId, '⚠️ Bu vaqt band bo‘lib qoldi — boshqasini tanlang.');
      await this.showTimes(bot, chatId, clinicId, staffId, date);
      return;
    }
    const st = this.state(chatId);
    st.clinicId = clinicId;
    st.staffId = staffId;
    st.startIso = startIso;
    st.patientId = null;
    st.newName = null;
    st.awaitingName = false;

    const candidates = (await this.booking.patientsByPhone(clinicId, link.phone)).map((p) => ({
      id: p.id,
      name: p.full_name,
    }));
    st.candidates = candidates.slice(0, 6);
    if (candidates.length === 0) {
      st.awaitingName = true;
      await bot.send(
        chatId,
        '👤 Bemorning <b>familiyasi va ismini</b> yozing.\nMasalan: <code>Abdullayev Jasur</code>',
      );
      return;
    }
    if (candidates.length === 1) {
      st.patientId = candidates[0]!.id;
      await this.showConfirm(bot, chatId);
      return;
    }
    await bot.send(chatId, '👤 Kim uchun yozilmoqda?', {
      inline_keyboard: [
        ...st.candidates.map((c, i) => [{ text: c.name, callback_data: `np:${i}` }]),
        [{ text: '➕ Boshqa odam', callback_data: 'np:new' }],
      ],
    });
  }

  private async showConfirm(bot: BotPort, chatId: number) {
    const st = this.state(chatId);
    if (!st.clinicId || !st.staffId || !st.startIso) {
      await bot.send(chatId, 'Jarayon eskirdi — qaytadan boshlang: 🩺 Online navbat');
      return;
    }
    const doctor = await this.booking.findDoctor(st.clinicId, st.staffId);
    const patientName =
      st.newName ?? st.candidates?.find((c) => c.id === st.patientId)?.name ?? '—';
    const price = money(doctor.service_price_uzs);
    await bot.send(
      chatId,
      `📝 <b>Tasdiqlang</b>\n\n` +
        `👨‍⚕️ ${esc(doctor.full_name)} — ${esc(doctor.specialty_label)}\n` +
        `🗓 ${esc(whenLabel(st.startIso))}\n` +
        `👤 ${esc(patientName)}\n` +
        (price ? `💵 Qabul: ${esc(price)}\n` : ''),
      {
        inline_keyboard: [
          [{ text: '✅ Tasdiqlash', callback_data: 'nok' }],
          [
            {
              text: '↩️ Boshqa vaqt',
              callback_data: `ny:${st.staffId}:${localDateOf(st.startIso).replace(/-/g, '')}`,
            },
            { text: '❌ Bekor', callback_data: 'nno' },
          ],
        ],
      },
    );
  }

  private async confirm(bot: BotPort, chatId: number, link: FlowLink) {
    const st = this.state(chatId);
    if (!st.clinicId || !st.staffId || !st.startIso || (!st.patientId && !st.newName)) {
      await bot.send(
        chatId,
        'Jarayon eskirdi — qaytadan boshlang: 🩺 Online navbat',
        bot.mainMenu(),
      );
      return;
    }
    try {
      const r = await this.booking.reserve(st.clinicId, {
        staffId: st.staffId,
        startIso: st.startIso,
        patient: st.patientId ? { id: st.patientId } : { full_name: st.newName, phone: link.phone },
        source: 'telegram',
      });
      this.resetBooking(chatId);
      const ctx = await this.settings.clinicContext(r.doctor.clinic_id);
      await bot.send(
        chatId,
        `✅ <b>Yozildingiz!</b>\n\n` +
          `🏥 ${esc(ctx.name)}\n` +
          `👨‍⚕️ ${esc(r.doctor.full_name)} — ${esc(r.doctor.specialty_label)}\n` +
          `🗓 ${esc(whenLabel(r.starts_at))}\n` +
          `👤 ${esc(r.patient_name)}\n` +
          (ctx.address ? `📍 ${esc(ctx.address)}\n` : '') +
          `\nIltimos, 10–15 daqiqa oldin keling. Qabuldan bir kun oldin eslatma yuboramiz.`,
        r.appointment_id
          ? {
              inline_keyboard: [
                [{ text: '❌ Bekor qilish', callback_data: `ncx:${r.appointment_id}` }],
              ],
            }
          : undefined,
      );
    } catch (e) {
      const msg =
        e instanceof BookingError ? e.message : 'Texnik xato — birozdan so‘ng urinib ko‘ring';
      this.log.warn(`telegram navbat xato: ${(e as Error).message}`);
      await bot.send(chatId, `❌ ${esc(msg)}`);
      if (e instanceof BookingError && st.clinicId && st.staffId && st.startIso) {
        await this.showTimes(bot, chatId, st.clinicId, st.staffId, localDateOf(st.startIso));
      }
    }
  }

  /** "📋 Yozuvlarim" */
  async myAppointments(bot: BotPort, chatId: number, link: FlowLink, clinics: FlowClinic[]) {
    let list: Awaited<ReturnType<BookingService['upcomingForPhone']>> = [];
    try {
      list = await this.booking.upcomingForPhone(
        clinics.map((c) => c.clinic_id),
        link.phone,
      );
    } catch (e) {
      this.log.warn(`yozuvlar: ${(e as Error).message}`);
    }
    if (list.length === 0) {
      await bot.send(
        chatId,
        'Sizda kelgusi navbat yo‘q. 🩺 Online navbat orqali yozilishingiz mumkin.',
        bot.mainMenu(),
      );
      return;
    }
    const text = list
      .map(
        (a, i) =>
          `${i + 1}. <b>${esc(a.doctor_name)}</b>\n   🏥 ${esc(a.clinic_name)}\n   🗓 ${esc(whenLabel(a.scheduled_at))}\n` +
          `   👤 ${esc(a.patient_name)}${a.confirmed ? ' · ✅ tasdiqlangan' : ''}`,
      )
      .join('\n\n');
    await bot.send(chatId, `📋 <b>Navbatlaringiz</b>\n\n${text}`, {
      inline_keyboard: list.map((a, i) => [
        { text: `❌ ${i + 1}-navbatni bekor qilish`, callback_data: `ncx:${a.appointment_id}` },
      ]),
    });
  }

  // ==========================================================================
  // Callback'lar
  // ==========================================================================
  /** true — bu oqimga tegishli callback edi (qayta ishlandi). */
  async onCallback(
    bot: BotPort,
    chatId: number,
    data: string,
    link: FlowLink | null,
    clinics: FlowClinic[],
  ): Promise<boolean> {
    const prefix = data.split(':')[0] ?? '';
    if (
      !['nc', 'ns', 'nd', 'ny', 'nt', 'np', 'nok', 'nno', 'ncx', 'ncy', 'ncf', 'na'].includes(
        prefix,
      )
    ) {
      return false;
    }
    if (!link) {
      await bot.send(chatId, 'Avval raqamingizni tasdiqlang: /start');
      return true;
    }
    const myIds = new Set(clinics.map((c) => c.clinic_id));
    const parts = data.split(':');
    try {
      switch (prefix) {
        case 'nc': {
          const clinicId = parts[1] ?? '';
          if (!myIds.has(clinicId)) return this.deny(bot, chatId);
          const c = clinics.find((x) => x.clinic_id === clinicId);
          await this.showSpecialties(bot, chatId, clinicId, c?.clinic?.name);
          return true;
        }
        case 'ns': {
          const clinicId = parts[1] ?? '';
          if (!myIds.has(clinicId)) return this.deny(bot, chatId);
          await this.showDoctors(bot, chatId, clinicId, parts[2] ?? 'all');
          return true;
        }
        case 'nd': {
          const staffId = parts[1] ?? '';
          const clinicId = await this.booking.clinicOfStaff(staffId);
          if (!clinicId || !myIds.has(clinicId)) return this.deny(bot, chatId);
          await this.showDays(bot, chatId, clinicId, staffId);
          return true;
        }
        case 'ny': {
          const staffId = parts[1] ?? '';
          const raw = parts[2] ?? '';
          const clinicId = await this.booking.clinicOfStaff(staffId);
          if (!clinicId || !myIds.has(clinicId) || !/^\d{8}$/.test(raw))
            return this.deny(bot, chatId);
          const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
          await this.showTimes(bot, chatId, clinicId, staffId, date);
          return true;
        }
        case 'nt': {
          const staffId = parts[1] ?? '';
          const minutes = parseInt(parts[2] ?? '', 36);
          const clinicId = await this.booking.clinicOfStaff(staffId);
          if (!clinicId || !myIds.has(clinicId) || !Number.isFinite(minutes))
            return this.deny(bot, chatId);
          await this.pickTime(bot, chatId, link, clinicId, staffId, minutes * 60_000);
          return true;
        }
        case 'np': {
          const st = this.state(chatId);
          if (parts[1] === 'new') {
            st.patientId = null;
            st.awaitingName = true;
            await bot.send(
              chatId,
              '👤 Bemorning <b>familiyasi va ismini</b> yozing.\nMasalan: <code>Abdullayev Jasur</code>',
            );
            return true;
          }
          const c = st.candidates?.[Number(parts[1])];
          if (!c) {
            await bot.send(chatId, 'Jarayon eskirdi — qaytadan boshlang: 🩺 Online navbat');
            return true;
          }
          st.patientId = c.id;
          st.newName = null;
          await this.showConfirm(bot, chatId);
          return true;
        }
        case 'nok':
          await this.confirm(bot, chatId, link);
          return true;
        case 'nno':
          this.resetBooking(chatId);
          await bot.send(chatId, 'Bekor qilindi.', bot.mainMenu());
          return true;
        case 'ncx': {
          const apptId = parts[1] ?? '';
          const clinicId = await this.booking.clinicOfAppointment(apptId);
          if (!clinicId) return this.deny(bot, chatId);
          const a = await this.booking.loadOwnAppointment(clinicId, apptId, link.phone);
          if (a.status !== 'scheduled') {
            await bot.send(chatId, 'Bu navbat allaqachon yopilgan.');
            return true;
          }
          await bot.send(
            chatId,
            `Rostdan bekor qilasizmi?\n\n👨‍⚕️ ${esc(a.doctor_name)}\n🗓 ${esc(whenLabel(a.scheduled_at))}\n👤 ${esc(a.patient_name)}`,
            {
              inline_keyboard: [
                [
                  { text: '❌ Ha, bekor qilaman', callback_data: `ncy:${apptId}` },
                  { text: '↩️ Yo‘q', callback_data: 'nno' },
                ],
              ],
            },
          );
          return true;
        }
        case 'ncy': {
          const apptId = parts[1] ?? '';
          const clinicId = await this.booking.clinicOfAppointment(apptId);
          if (!clinicId) return this.deny(bot, chatId);
          await this.booking.cancel(clinicId, apptId, {
            by: 'patient',
            phone: link.phone,
            reason: 'Bemor Telegram orqali bekor qildi',
          });
          await bot.send(
            chatId,
            '❌ Navbat bekor qilindi. Yana kerak bo‘lsa — 🩺 Online navbat.',
            bot.mainMenu(),
          );
          return true;
        }
        case 'ncf': {
          const apptId = parts[1] ?? '';
          const clinicId = await this.booking.clinicOfAppointment(apptId);
          if (!clinicId) return this.deny(bot, chatId);
          const r = await this.booking.patientConfirm(clinicId, apptId, link.phone);
          await bot.send(
            chatId,
            r.ok ? '✅ Rahmat! Sizni kutamiz.' : 'Bu navbat allaqachon yopilgan.',
          );
          return true;
        }
        case 'na': {
          const clinicId = parts[1] ?? '';
          if (!myIds.has(clinicId)) return this.deny(bot, chatId);
          const st = this.state(chatId);
          st.aiClinicId = clinicId;
          const pending = st.pendingAiText;
          st.pendingAiText = undefined;
          if (pending) await this.askAi(bot, chatId, link, clinicId, pending);
          else await bot.send(chatId, 'Savolingizni yozing yoki ovozli xabar yuboring 🎙');
          return true;
        }
      }
    } catch (e) {
      const msg =
        e instanceof BookingError || (e as { status?: number }).status === 403
          ? (e as Error).message
          : 'Texnik xato — birozdan so‘ng urinib ko‘ring';
      this.log.warn(`callback ${prefix}: ${(e as Error).message}`);
      await bot.send(chatId, `❌ ${esc(msg)}`);
      return true;
    }
    return false;
  }

  private async deny(bot: BotPort, chatId: number): Promise<boolean> {
    await bot.send(
      chatId,
      'Bu tugma eskirgan yoki sizga tegishli emas. 🩺 Online navbatdan qayta boshlang.',
    );
    return true;
  }

  // ==========================================================================
  // Erkin matn / ovoz
  // ==========================================================================
  /** true — matn shu yerda qayta ishlandi (ism kutilayotgan edi yoki AI javob berdi). */
  async onText(
    bot: BotPort,
    chatId: number,
    text: string,
    link: FlowLink,
    clinics: FlowClinic[],
  ): Promise<boolean> {
    const st = this.state(chatId);
    if (st.awaitingName) {
      const name = text.replace(/\s+/g, ' ').trim();
      if (name.split(' ').length < 2 || name.length > 80 || /\d/.test(name)) {
        await bot.send(
          chatId,
          'Familiya va ismni bo‘sh joy bilan yozing. Masalan: <code>Abdullayev Jasur</code>',
        );
        return true;
      }
      st.awaitingName = false;
      st.newName = name;
      st.patientId = null;
      await this.showConfirm(bot, chatId);
      return true;
    }
    if (text.startsWith('/')) return false;

    const aiClinics = await this.aiClinics(clinics);
    if (aiClinics.length === 0) return false;
    let clinicId =
      st.aiClinicId && aiClinics.some((c) => c.clinic_id === st.aiClinicId) ? st.aiClinicId : null;
    if (!clinicId && aiClinics.length === 1) clinicId = aiClinics[0]!.clinic_id;
    if (!clinicId) {
      st.pendingAiText = text;
      await bot.send(chatId, '🏥 Qaysi klinika bo‘yicha savol?', {
        inline_keyboard: aiClinics.map((c) => [
          { text: c.clinic?.name ?? 'Klinika', callback_data: `na:${c.clinic_id}` },
        ]),
      });
      return true;
    }
    st.aiClinicId = clinicId;
    await this.askAi(bot, chatId, link, clinicId, text);
    return true;
  }

  async onVoice(
    bot: BotPort,
    chatId: number,
    voice: { file_id: string; duration?: number; mime_type?: string },
    link: FlowLink,
    clinics: FlowClinic[],
  ): Promise<boolean> {
    const aiClinics = await this.aiClinics(clinics);
    if (aiClinics.length === 0) return false;
    if (!this.stt.enabled) {
      await bot.send(
        chatId,
        '🎙 Ovozli xabar hozircha qabul qilinmaydi — iltimos, yozib yuboring.',
      );
      return true;
    }
    if ((voice.duration ?? 0) > 120) {
      await bot.send(chatId, '🎙 Xabar juda uzun — 2 daqiqagacha bo‘lsin yoki yozib yuboring.');
      return true;
    }
    await bot.api('sendChatAction', { chat_id: chatId, action: 'typing' });
    const token = bot.token();
    const file = await bot.api('getFile', { file_id: voice.file_id });
    const path = (file.result as { file_path?: string } | undefined)?.file_path;
    if (!token || !file.ok || !path) {
      await bot.send(chatId, 'Ovozli xabarni ololmadim — yozib yuboring.');
      return true;
    }
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = voice.mime_type ?? 'audio/ogg';
    // O'zbek va rus — ikkalasi parallel; qaysi biri ma'noli ekanini AI tanlaydi
    const [uz, ru] = await Promise.all([
      this.stt.transcribe(buf, { mime, filename: 'voice.ogg', lang: 'uz' }).catch(() => ''),
      this.stt.transcribe(buf, { mime, filename: 'voice.ogg', lang: 'ru' }).catch(() => ''),
    ]);
    if (!uz && !ru) {
      await bot.send(chatId, 'Tushunolmadim 😔 Iltimos, yozib yuboring.');
      return true;
    }
    await bot.send(chatId, `🎙 <i>${esc(uz || ru)}</i>`);
    const st = this.state(chatId);
    let clinicId =
      st.aiClinicId && aiClinics.some((c) => c.clinic_id === st.aiClinicId) ? st.aiClinicId : null;
    if (!clinicId) clinicId = aiClinics[0]!.clinic_id;
    st.aiClinicId = clinicId;
    await this.askAi(bot, chatId, link, clinicId, uz || ru, ru && uz ? ru : null, voice.duration);
    return true;
  }

  private async aiClinics(clinics: FlowClinic[]): Promise<FlowClinic[]> {
    const map = await this.settings.getMany(clinics.map((c) => c.clinic_id));
    return clinics.filter((c) => {
      const s = map.get(c.clinic_id);
      return !!s && s.telegram_ai_chat && this.settings.aiEffective(s);
    });
  }

  private async askAi(
    bot: BotPort,
    chatId: number,
    link: FlowLink,
    clinicId: string,
    text: string,
    altRu: string | null = null,
    sttSeconds?: number,
  ) {
    await bot.api('sendChatAction', { chat_id: chatId, action: 'typing' });
    const session = async () =>
      (await this.brain.activeChatSession(clinicId, chatId)) ??
      (
        await this.brain.startSession({
          clinicId,
          channel: 'telegram',
          externalId: String(chatId),
          callerPhone: link.phone,
        })
      ).callId;
    try {
      let callId = await session();
      let r;
      try {
        r = await this.brain.handleTurn(callId, { text, altTextRu: altRu, sttSeconds });
      } catch (e) {
        if ((e as Error).message !== 'SESSION_ENDED') throw e;
        callId = (
          await this.brain.startSession({
            clinicId,
            channel: 'telegram',
            externalId: String(chatId),
            callerPhone: link.phone,
          })
        ).callId;
        r = await this.brain.handleTurn(callId, { text, altTextRu: altRu, sttSeconds });
      }
      await bot.send(chatId, esc(r.say));
    } catch (e) {
      this.log.warn(`AI chat (${chatId}): ${(e as Error).message}`);
      await bot.send(
        chatId,
        'Kechirasiz, hozir javob bera olmayman. 🩺 Online navbat tugmasi orqali yozilishingiz mumkin.',
        bot.mainMenu(),
      );
    }
  }

  /** Klinika havolasi: t.me/<bot>?start=c_<slug> — bemorni klinikaga bog'lash uchun. */
  static clinicSlugFromPayload(payload: string): string | null {
    if (!payload.startsWith('c_')) return null;
    const slug = payload.slice(2);
    return /^[a-z0-9-]{2,60}$/i.test(slug) ? slug : null;
  }
}
