import { Injectable, Logger } from '@nestjs/common';

import { SupabaseService } from './supabase.service';

// =============================================================================
// Clary Cast — chaqiruvni TV'ga SERVERDAN e'lon qilish.
//
// Navbat holati "called" bo'lganda (qabulxona, shifokor ish joyi, mobil — qaysi
// mijozdan bo'lmasin) shu yerdan Supabase Realtime Broadcast (REST) orqali
// `clinic-<id>-cast` kanaliga `call` yuboriladi. Xona shifokor profilidan
// (profiles.room_label) olinadi — mijozlar uni bilishi shart emas.
// =============================================================================

export interface CastCallPayload {
  queue_id: string;
  ticket_code: string | null;
  seq: number | null;
  room: string | null;
  /** Qisqartirilgan ism ("Karimova D.") — umumiy zal ekranida to'liq ism chiqmasin */
  patient_name: string;
  doctor_name: string;
  device_id: string | null;
  lang: 'uz';
}

export function shortPatientName(full: string | null | undefined): string {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  return parts.length === 1 ? parts[0]! : `${parts[0]} ${parts[1]![0]}.`;
}

@Injectable()
export class CastAnnouncer {
  private readonly log = new Logger('CastAnnouncer');

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Shifokorlar xonasi. Migratsiya (room_label) hali qo'llanmagan bo'lsa bo'sh
   * qaytadi — chaqiruv xonasiz aytiladi, hech narsa yiqilmaydi.
   */
  async roomsFor(doctorIds: Array<string | null | undefined>): Promise<Record<string, string>> {
    const ids = [...new Set(doctorIds.filter((x): x is string => !!x))];
    if (ids.length === 0) return {};
    const { data, error } = await this.supabase
      .admin()
      .from('profiles')
      .select('id, room_label')
      .in('id', ids);
    if (error) return {};
    const out: Record<string, string> = {};
    for (const r of (data ?? []) as Array<{ id: string; room_label: string | null }>) {
      const room = r.room_label?.trim();
      if (room) out[r.id] = room;
    }
    return out;
  }

  async payloadFor(clinicId: string, queueId: string): Promise<CastCallPayload | null> {
    const { data } = await this.supabase
      .admin()
      .from('queues')
      .select(
        'id, ticket_code, queue_seq, doctor_id, doctor:profiles!doctor_id(full_name), patient:patients(full_name)',
      )
      .eq('clinic_id', clinicId)
      .eq('id', queueId)
      .maybeSingle();
    const q = data as {
      id: string;
      ticket_code: string | null;
      queue_seq: number | null;
      doctor_id: string | null;
      doctor: { full_name: string | null } | null;
      patient: { full_name: string | null } | null;
    } | null;
    if (!q) return null;
    const rooms = await this.roomsFor([q.doctor_id]);
    return {
      queue_id: q.id,
      ticket_code: q.ticket_code,
      seq: q.queue_seq,
      room: q.doctor_id ? (rooms[q.doctor_id] ?? null) : null,
      patient_name: shortPatientName(q.patient?.full_name),
      doctor_name: q.doctor?.full_name ?? '',
      device_id: null,
      lang: 'uz',
    };
  }

  /** Realtime Broadcast REST — kanalga obuna bo'lmasdan yuboriladi. */
  async broadcast(clinicId: string, event: string, payload: object): Promise<void> {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SERVICE_ROLE_KEY yo‘q');
    const res = await fetch(`${url.replace(/\/$/, '')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ topic: `clinic-${clinicId}-cast`, event, payload, private: false }],
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`broadcast ${res.status}: ${await res.text().catch(() => '')}`);
  }

  async announce(clinicId: string, queueId: string): Promise<CastCallPayload | null> {
    const payload = await this.payloadFor(clinicId, queueId);
    if (!payload) return null;
    await this.broadcast(clinicId, 'call', payload);
    return payload;
  }

  /** Javobni kutdirmaydi: TV e'loni muvaffaqiyatsiz bo'lsa ham navbat ishlayveradi. */
  announceSoon(clinicId: string, queueId: string): void {
    this.announce(clinicId, queueId).catch((e: unknown) =>
      this.log.warn(`TV e'loni yuborilmadi (${queueId}): ${(e as Error).message}`),
    );
  }
}
