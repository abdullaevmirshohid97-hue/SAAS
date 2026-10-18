// =============================================================================
// Clary Cast — navbat chaqiruvi iboralari.
//
// TV robot ovozida gapirmasligi uchun chaqiruv oldindan YOZIB OLINGAN bo'laklardan
// yig'iladi (aeroport/bank navbatlaridagi kabi):
//
//   [qo'ng'iroq] "to'rt" + "raqamli bemor" + "sakkizinchi" + "xonaga marhamat"
//
// Shu fayl — bo'laklar ro'yxati (yozib olish sahifasi uchun) va chaqiruv rejasi
// (TV uchun). Bo'lak yetishmasa reja `clips: null` qaytaradi va TV qurilmaning
// tabiiy o'zbek ovoziga (bo'lsa) `text` ni beradi.
// =============================================================================

export type CastVoiceGroup = 'phrase' | 'number' | 'ordinal';

export interface CastVoiceClip {
  key: string;
  /** Diktor o'qiydigan matn */
  text: string;
  group: CastVoiceGroup;
}

const ONES = ['', 'bir', 'ikki', 'uch', "to'rt", 'besh', 'olti', 'yetti', 'sakkiz', "to'qqiz"];
const TENS = [
  '',
  "o'n",
  'yigirma',
  "o'ttiz",
  'qirq',
  'ellik',
  'oltmish',
  'yetmish',
  'sakson',
  "to'qson",
];

const ordinalWord = (w: string) => (/[aeiou]$/.test(w) ? `${w}nchi` : `${w}inchi`);

/** Asosiy so'z: 1..9 → ONES, 10..90 → TENS, 100 → "yuz". */
function baseWord(n: number): string {
  if (n === 100) return 'yuz';
  if (n >= 10) return TENS[n / 10] as string;
  return ONES[n] as string;
}

const BASES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export const CAST_VOICE_CLIPS: ReadonlyArray<CastVoiceClip> = [
  { key: 'p_patient', text: 'raqamli bemor', group: 'phrase' },
  { key: 'p_room', text: 'xonaga marhamat', group: 'phrase' },
  { key: 'p_welcome', text: 'qabulga marhamat', group: 'phrase' },
  { key: 'p_next', text: 'navbatdagi bemor', group: 'phrase' },
  ...BASES.map((n) => ({ key: `n${n}`, text: baseWord(n), group: 'number' as const })),
  ...BASES.map((n) => ({
    key: `o${n}`,
    text: ordinalWord(baseWord(n)),
    group: 'ordinal' as const,
  })),
];

export const CAST_VOICE_KEYS: ReadonlySet<string> = new Set(CAST_VOICE_CLIPS.map((c) => c.key));

/** 1..999 → bo'lak kalitlari. 245 → [n2, n100, n40, n5]; ordinal → [.., o5]. */
function numberClips(n: number, ordinal: boolean): string[] {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  const parts: number[] = [];
  if (h > 0) {
    if (h > 1) parts.push(h);
    parts.push(100);
  }
  if (t > 0) parts.push(t * 10);
  if (o > 0) parts.push(o);
  return parts.map((p, i) => (ordinal && i === parts.length - 1 ? `o${p}` : `n${p}`));
}

function numberWords(n: number, ordinal: boolean): string {
  return numberClips(n, ordinal)
    .map((k) => {
      const v = Number(k.slice(1));
      return k[0] === 'o' ? ordinalWord(baseWord(v)) : baseWord(v);
    })
    .join(' ');
}

/** "7", "№7", "7-xona", "7 kabinet" → 7; "UZI", "12A" → null. */
export function castRoomNumber(room: string | null | undefined): number | null {
  const m = (room ?? '')
    .trim()
    .match(/^(?:№\s*)?(\d{1,3})(?:\s*-?\s*(?:xona|kabinet|каб\.?|кабинет))?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 999 ? n : null;
}

/** Ekranda: "7-xona" yoki "UZI". */
export function castRoomDisplay(room: string | null | undefined): string {
  const r = (room ?? '').trim();
  if (!r) return '';
  const n = castRoomNumber(r);
  return n != null ? `${n}-xona` : r;
}

/** Navbat raqami: queue_seq, bo'lmasa chiptadagi oxirgi raqamlar ("A-004" → 4). */
export function castSeq(ticketCode: string | null | undefined, seq?: number | null): number | null {
  if (typeof seq === 'number' && seq >= 1 && seq <= 999) return seq;
  const m = (ticketCode ?? '').match(/(\d{1,3})\s*$/);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 999 ? n : null;
}

export interface CastAnnouncePlan {
  /** Qurilma ovozi uchun to'liq matn */
  text: string;
  /** Yozib olingan bo'laklar ketma-ketligi; null — bo'laklar bilan aytib bo'lmaydi */
  clips: string[] | null;
}

export function castAnnouncementPlan(input: {
  seq?: number | null;
  room?: string | null;
}): CastAnnouncePlan {
  const seq = input.seq != null && input.seq >= 1 && input.seq <= 999 ? input.seq : null;
  const roomRaw = (input.room ?? '').trim();
  const roomNo = castRoomNumber(roomRaw);

  const head = seq != null ? [...numberClips(seq, false), 'p_patient'] : ['p_next'];
  const headText = seq != null ? `${numberWords(seq, false)} raqamli bemor` : 'navbatdagi bemor';

  let tail: string[] | null;
  let tailText: string;
  if (roomNo != null) {
    tail = [...numberClips(roomNo, true), 'p_room'];
    tailText = `${numberWords(roomNo, true)} xonaga marhamat`;
  } else if (roomRaw) {
    tail = null; // "UZI" kabi nomni bo'laklardan yig'ib bo'lmaydi
    tailText = `${roomRaw} xonasiga marhamat`;
  } else {
    tail = ['p_welcome'];
    tailText = 'qabulga marhamat';
  }

  const text = `${headText}, ${tailText}.`;
  return {
    text: text.charAt(0).toUpperCase() + text.slice(1),
    clips: tail ? [...head, ...tail] : null,
  };
}
