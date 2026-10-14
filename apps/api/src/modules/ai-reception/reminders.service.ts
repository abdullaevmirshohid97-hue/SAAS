import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { addDays, localDateOf, localMidnightUtcMs } from '@clary/utils';

import { SupabaseService } from '../../common/services/supabase.service';

import { PatientNotifierService } from './patient-notifier.service';
import { AiReceptionSettingsService, isMissingSchema } from './settings.service';

// =============================================================================
// AI qabulxona — fon ishlari (har 10 daqiqada)
// =============================================================================
//   1) Eslatma: ertangi qabullar — qabuldan BIR KUN oldin, sozlamadagi soatdan
//      (default 18:00) keyin. Telegram (tugmalar bilan) → bo'lmasa SMS (yoqilgan
//      bo'lsa). Yaqinda (3 soat ichida) yozilganlarga yuborilmaydi — tasdiq yetarli.
//   2) "Kelmadi": AI/Telegram yozgan, 4 soatdan oshib ketgan, kelmagan qabullar
//      no_show bo'ladi (jurnalda "kutilmoqda" bo'lib osilib qolmasin).
//   3) Osilib qolgan faol suhbatlar (2 soat harakatsiz) yopiladi.
// =============================================================================

@Injectable()
export class AiReceptionRemindersService {
  private readonly log = new Logger('AiReceptionCron');
  private running = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly settings: AiReceptionSettingsService,
    private readonly notifier: PatientNotifierService,
  ) {}

  @Cron('*/10 * * * *')
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.sendReminders();
      await this.markNoShows();
      await this.closeStaleCalls();
    } catch (e) {
      this.log.error(`cron: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Ertangi oldindan yozilgan qabullar. Sozlama qatori yo'q klinikalarga ham
   * standart qiymat (yoqilgan, 18:00) amal qiladi — Telegram navbat sozlamasiz
   * ham ishlaydi, eslatma ham shunday bo'lsin.
   */
  async sendReminders(now = new Date()) {
    const admin = this.supabase.admin();
    const hourNow = Number(new Date(now.getTime() + 5 * 3600_000).toISOString().slice(11, 13));
    // Eng erta eslatma soati 6, kechki 22 dan keyin bezovta qilinmaydi
    if (hourNow < 6 || hourNow >= 22) return;
    const today = localDateOf(now);
    const tomorrow = addDays(today, 1);
    const from = new Date(localMidnightUtcMs(tomorrow)).toISOString();
    const to = new Date(localMidnightUtcMs(addDays(tomorrow, 1))).toISOString();
    const createdBefore = new Date(now.getTime() - 3 * 3600_000).toISOString();

    const { data: appts, error } = await admin
      .from('appointments')
      .select(
        'id, clinic_id, scheduled_at, patient:patients(full_name, phone), doctor:profiles!appointments_doctor_id_fkey(full_name)',
      )
      .eq('status', 'scheduled')
      .is('reminder_sent_at', null)
      .gte('scheduled_at', from)
      .lt('scheduled_at', to)
      .lt('created_at', createdBefore)
      .limit(2000);
    if (error) {
      if (!isMissingSchema(error)) this.log.warn(`eslatma: ${error.message}`);
      return;
    }
    const byClinic = new Map<
      string,
      Array<{
        id: string;
        scheduled_at: string;
        patient: { full_name: string | null; phone: string | null } | null;
        doctor: { full_name: string | null } | null;
      }>
    >();
    for (const a of (appts ?? []) as unknown as Array<{
      id: string;
      clinic_id: string;
      scheduled_at: string;
      patient: { full_name: string | null; phone: string | null } | null;
      doctor: { full_name: string | null } | null;
    }>) {
      const arr = byClinic.get(a.clinic_id) ?? [];
      arr.push(a);
      byClinic.set(a.clinic_id, arr);
    }
    if (byClinic.size === 0) return;
    const settingsMap = await this.settings.getMany([...byClinic.keys()]);

    for (const [clinicId, list] of byClinic) {
      const s = settingsMap.get(clinicId) ?? (await this.settings.get(clinicId));
      if (!s.reminder_enabled || hourNow < (s.reminder_hour ?? 18)) continue;
      const clinic = await this.settings.clinicContext(clinicId);
      let sent = 0;
      for (const a of list) {
        try {
          const ok = await this.notifier.reminder(clinicId, s, clinic, {
            id: a.id,
            scheduled_at: a.scheduled_at,
            patient_name: a.patient?.full_name ?? '',
            patient_phone: a.patient?.phone ?? null,
            doctor_name: a.doctor?.full_name ?? '',
          });
          if (ok) sent++;
        } catch (e) {
          this.log.warn(`eslatma ${a.id}: ${(e as Error).message}`);
        }
        // Kanal bo'lmasa ham belgilaymiz — har 10 daqiqada qayta urinmasin
        await admin
          .from('appointments')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', a.id);
      }
      if (sent) this.log.log(`eslatma: klinika ${clinicId} — ${sent}/${list.length}`);
    }
  }

  /** Standart — yoqilgan; faqat sozlamada o'chirgan klinikalar chiqarib tashlanadi. */
  async markNoShows(now = new Date()) {
    const admin = this.supabase.admin();
    const { data: rows, error } = await admin
      .from('ai_reception_settings')
      .select('clinic_id')
      .eq('mark_no_show', false);
    if (error) return;
    const excluded = ((rows ?? []) as Array<{ clinic_id: string }>).map((r) => r.clinic_id);
    let q = admin
      .from('appointments')
      .update({ status: 'no_show' })
      .eq('status', 'scheduled')
      .in('source', ['ai_phone', 'telegram', 'ai_chat', 'portal'])
      .lt('scheduled_at', new Date(now.getTime() - 4 * 3600_000).toISOString());
    if (excluded.length) q = q.not('clinic_id', 'in', `(${excluded.join(',')})`);
    const { error: upErr } = await q;
    if (upErr && !isMissingSchema(upErr)) this.log.warn(`no_show: ${upErr.message}`);
  }

  async closeStaleCalls(now = new Date()) {
    const admin = this.supabase.admin();
    const stale = new Date(now.getTime() - 2 * 3600_000).toISOString();
    const { data, error } = await admin
      .from('ai_calls')
      .select('id, outcome, transcript')
      .eq('status', 'active')
      .lt('last_activity_at', stale)
      .limit(200);
    if (error) return;
    for (const c of (data ?? []) as Array<{
      id: string;
      outcome: string | null;
      transcript: Array<{ role: string }> | null;
    }>) {
      const spoke = (c.transcript ?? []).some((t) => t.role === 'caller');
      await admin
        .from('ai_calls')
        .update({
          status: 'ended',
          ended_at: now.toISOString(),
          outcome: c.outcome ?? (spoke ? 'info' : 'abandoned'),
        })
        .eq('id', c.id)
        .eq('status', 'active');
    }
  }
}
