// =============================================================================
// HL7 v2.x ER7 (pipe-delimited) parser — laboratoriya ORU^R01 natija xabari
// =============================================================================
// To'liq HL7 implementatsiyasi EMAS — laboratoriya analizatorlari yuboradigan
// ORU^R01 (Observation Result) xabaridan natijalarni ajratish uchun yetarli
// qism. Muhim segmentlar:
//   MSH — xabar sarlavhasi (ajratgich belgilarni o'rnatadi)
//   OBR — buyurtma (filler order number → probirka barkodi)
//   OBX — kuzatuv natijasi (test, qiymat, birlik, referens)
//   SPM — namuna (mavjud bo'lsa, barkod ishonchliroq manba)

/** Bitta HL7 segment — nomi + tarkibiy maydonlari. */
export interface Hl7Segment {
  name: string;
  /** fields[n] — n-maydon (1-indeksli HL7 raqami n bo'yicha). fields[0]=segment nomi. */
  fields: string[];
}

/** HL7 ajratgich belgilari — MSH-1/MSH-2 dan o'qiladi. */
export interface Hl7Delimiters {
  field: string;
  component: string;
  repetition: string;
  escape: string;
  subcomponent: string;
}

const DEFAULT_DELIMITERS: Hl7Delimiters = {
  field: '|',
  component: '^',
  repetition: '~',
  escape: '\\',
  subcomponent: '&',
};

/**
 * Xom HL7 xabarni segmentlarga ajratadi. Segmentlar \r, \n yoki \r\n bilan
 * ajratiladi (analizatorlar har xil ishlatadi). MSH segmenti maxsus —
 * MSH-1 ajratgich belgisining o'zi.
 */
export function parseHl7Message(raw: string): {
  segments: Hl7Segment[];
  delimiters: Hl7Delimiters;
} {
  const lines = raw
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let delimiters = { ...DEFAULT_DELIMITERS };

  // MSH segmentidan ajratgichlarni aniqlaymiz
  const msh = lines.find((l) => l.startsWith('MSH'));
  if (msh && msh.length >= 8) {
    delimiters = {
      field: msh[3] ?? '|',
      component: msh[4] ?? '^',
      repetition: msh[5] ?? '~',
      escape: msh[6] ?? '\\',
      subcomponent: msh[7] ?? '&',
    };
  }

  const segments: Hl7Segment[] = lines.map((line) => {
    const name = line.slice(0, 3);
    if (name === 'MSH') {
      // MSH uchun: MSH-1 = field separator, MSH-2 = encoding chars.
      // fields[1] field separator bo'lishi uchun qo'lda joylaymiz.
      const rest = line.slice(4).split(delimiters.field);
      return { name, fields: [name, delimiters.field, ...rest] };
    }
    return { name, fields: line.split(delimiters.field) };
  });

  return { segments, delimiters };
}

/** Maydonning ko'rsatilgan komponentini qaytaradi (1-indeksli). */
export function hl7Component(
  field: string | undefined,
  index: number,
  delimiters: Hl7Delimiters,
): string {
  if (!field) return '';
  const parts = field.split(delimiters.component);
  return (parts[index - 1] ?? '').trim();
}

/** HL7 vaqt (YYYYMMDDHHMMSS) → ISO 8601. Aniqlay olmasa null. */
export function hl7TimeToIso(ts: string | undefined): string | null {
  if (!ts) return null;
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?/);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** OBX-2 (qiymat tipi) raqamli bo'lsa true — NM, SN. */
export function isNumericValueType(obx2: string): boolean {
  return obx2 === 'NM' || obx2 === 'SN';
}
