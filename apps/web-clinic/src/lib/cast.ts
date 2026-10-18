import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from './supabase';

// =============================================================================
// Clary Cast — TV ga chaqiruv yuborish (Supabase Realtime Broadcast).
// TV (/kiosk) `clinic-<id>-cast` kanalini tinglaydi va "call" kelganda katta
// ekranda ism + ovozli chaqiruv ko'rsatadi. Bu yordamchi qabulxona, navbat va
// shifokor oynasidan bir xil yuborish uchun.
// =============================================================================

export interface CastCallPayload {
  patient_name: string;
  doctor_name?: string;
  room?: string;
  /** Faqat shu TV (yo'q — klinikadagi barcha TV) */
  device_id?: string | null;
  lang?: 'uz' | 'ru' | 'en';
}

const channels = new Map<string, RealtimeChannel>();

function channelFor(clinicId: string): RealtimeChannel {
  let ch = channels.get(clinicId);
  if (!ch) {
    ch = supabase.channel(`clinic-${clinicId}-cast`);
    ch.subscribe();
    channels.set(clinicId, ch);
  }
  return ch;
}

/** TV ga chaqiruv. Kanal hali ulanmagan bo'lsa supabase-js REST orqali yuboradi. */
export function castCall(clinicId: string | null | undefined, payload: CastCallPayload): void {
  if (!clinicId || !payload.patient_name) return;
  void channelFor(clinicId).send({
    type: 'broadcast',
    event: 'call',
    payload: { room: '', doctor_name: '', device_id: null, lang: 'uz', ...payload },
  });
}
