import { searchNorm } from '@clary/utils';

import { compareRoomNumber } from './inpatient-quick-admit';

// =============================================================================
// Qabulxona: "Statsionardagilar" (F2) — hozir yotgan bemorni ismi bo'yicha
// topib, qaysi qavat / xonada ekanini ko'rsatish.
// =============================================================================

export interface FinderStay {
  id: string;
  room_id: string | null;
  bed_no: string | null;
  admitted_at: string;
  planned_discharge_at?: string | null;
  admission_reason?: string | null;
  patient?: { id: string; full_name: string; phone?: string | null } | null;
  room?: {
    id: string;
    number: string;
    section: string | null;
    floor: number | null;
    building?: string | null;
  } | null;
  doctor?: { id: string; full_name: string } | null;
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/**
 * Qidiruv: ismning barcha so'zlari (tartibi muhim emas, lotin/kirill farqsiz),
 * telefon raqami (3+ raqam) yoki xona raqami (faqat raqam yozilsa).
 * Bo'sh so'rov — hammasi. Natija: qavat → xona → yotoq tartibida.
 */
export function filterInpatients<T extends FinderStay>(stays: T[], query: string): T[] {
  const q = query.trim();
  const qDigits = digits(q);
  const onlyDigits = q.length > 0 && /^[\d\s+()-]+$/.test(q);
  const tokens = searchNorm(q).split(/\s+/).filter(Boolean);

  const hit = (s: T): boolean => {
    if (!q) return true;
    if (onlyDigits) {
      if (s.room && digits(s.room.number) === qDigits) return true;
      return qDigits.length >= 3 && digits(s.patient?.phone).includes(qDigits);
    }
    const name = searchNorm(s.patient?.full_name);
    return tokens.length > 0 && tokens.every((t) => name.includes(t));
  };

  return stays.filter(hit).sort(compareStays);
}

export function compareStays(a: FinderStay, b: FinderStay): number {
  const fa = a.room?.floor ?? Number.MAX_SAFE_INTEGER;
  const fb = b.room?.floor ?? Number.MAX_SAFE_INTEGER;
  if (fa !== fb) return fa - fb;
  const r = compareRoomNumber(a.room?.number ?? '~', b.room?.number ?? '~');
  if (r !== 0) return r;
  return compareRoomNumber(a.bed_no ?? '', b.bed_no ?? '');
}

/** Necha kundan beri yotibdi (qabul kuni = 1-kun). */
export function stayDays(admittedAt: string, now = new Date()): number {
  const start = new Date(admittedAt);
  const d0 = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const d1 = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(1, Math.round((d1 - d0) / 86_400_000) + 1);
}
