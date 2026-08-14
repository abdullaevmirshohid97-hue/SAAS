// =============================================================================
// A4 blanka — BARCHA hujjatlar uchun umumiy sarlavha/kolontitul
// =============================================================================
// Tashxis xulosasi, retsept, yo'llanma, rozilik — hammasi shu generatordan
// chiqadi. Ilgari har biri o'z sarlavhasini yasardi; ular ertami-kechmi
// bir-biridan uzoqlashardi (bittasida logotip bor, boshqasida yo'q).
//
// Sozlama manbai: clinics.document_settings (jsonb). Nega sozlanadigan —
// logotip, litsenziya, muhr va bemor maydonlari har klinikada boshqacha.

export const PATIENT_FIELDS = [
  'dob',
  'gender',
  'phone',
  'address',
  'mrn',
  'pinfl',
  'passport',
] as const;

export type PatientField = (typeof PATIENT_FIELDS)[number];

export const PATIENT_FIELD_LABELS: Record<PatientField, string> = {
  dob: "Tug'ilgan sana",
  gender: 'Jinsi',
  phone: 'Telefon',
  address: 'Manzil',
  mrn: 'Karta raqami',
  pinfl: 'PINFL',
  passport: 'Passport',
};

export interface BlankSettings {
  show_logo?: boolean;
  name_source?: 'name' | 'legal_name';
  show_address?: boolean;
  show_phone?: boolean;
  show_email?: boolean;
  license_text?: string;
  footer_text?: string;
  show_signature?: boolean;
  show_stamp?: boolean;
  patient_fields?: PatientField[];
}

/** Standart qiymatlar — klinika hech narsa sozlamagan holat. */
export const DEFAULT_BLANK: Required<
  Pick<
    BlankSettings,
    | 'show_logo'
    | 'name_source'
    | 'show_address'
    | 'show_phone'
    | 'show_email'
    | 'show_signature'
    | 'show_stamp'
    | 'patient_fields'
  >
> = {
  show_logo: true,
  name_source: 'name',
  show_address: true,
  show_phone: true,
  show_email: false,
  show_signature: true,
  show_stamp: true,
  // PINFL va passport ataylab YO'Q: maxfiy ma'lumot, har bosmada turishi shart emas.
  patient_fields: ['dob', 'gender', 'mrn'],
};

export interface ClinicInfo {
  name?: string | null;
  legal_name?: string | null;
  logo_url?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** To'ldirilgan hujjat uchun. Bo'sh qoldirilsa — nuqtali blanka chiqadi. */
export interface PatientInfo {
  full_name?: string | null;
  dob?: string | null;
  gender?: string | null;
  phone?: string | null;
  address?: string | null;
  mrn?: string | null;
  pinfl?: string | null;
  passport?: string | null;
}

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** To'ldirilmagan joy — qog'ozda qo'lda yoziladigan chiziq. */
export function blank(width = 34): string {
  return `<span style="color:#bbb">${'.'.repeat(width)}</span>`;
}

function fmtDate(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('uz-UZ');
}

function patientValue(field: PatientField, p?: PatientInfo): string {
  if (!p) return '';
  if (field === 'dob') return fmtDate(p.dob);
  const v = p[field];
  return v ? String(v) : '';
}

export interface RenderOptions {
  /** Hujjat sarlavhasi — "Tibbiy xulosa", "Retsept", "Yo'llanma"… */
  title: string;
  clinic: ClinicInfo;
  settings?: BlankSettings;
  /** Bo'sh bo'lsa nuqtali blanka chiqadi. */
  patient?: PatientInfo;
  doctorName?: string | null;
  /** Hujjatning o'ziga xos qismi (HTML). */
  body: string;
  /** Pastki chap burchakdagi kichik izoh (masalan shablon nomi). */
  note?: string;
}

/**
 * To'liq A4 hujjat tanasi: sarlavha + bemor bloki + body + imzo/muhr.
 * printA4Document() va ekrandagi preview AYNI shu natijani ishlatadi.
 */
export function renderA4Blank(o: RenderOptions): string {
  const s = { ...DEFAULT_BLANK, ...(o.settings ?? {}) };
  const c = o.clinic;

  const clinicName =
    (s.name_source === 'legal_name' ? c.legal_name : c.name) || c.name || c.legal_name || 'Klinika';

  const contacts = [
    s.show_address ? c.address : null,
    s.show_phone ? c.phone : null,
    s.show_email ? c.email : null,
  ]
    .filter(Boolean)
    .map((x) => esc(x))
    .join(' · ');

  const logo =
    s.show_logo && c.logo_url
      ? `<img src="${esc(c.logo_url)}" alt="" style="max-height:52px;max-width:150px;object-fit:contain" />`
      : '';

  // Bemor bloki — ism har doim, qolgani sozlamaga qarab.
  const rows: string[] = [
    `<div><span class="k">F.I.Sh.:</span> ${
      o.patient?.full_name ? esc(o.patient.full_name) : blank(30)
    }</div>`,
  ];
  for (const f of s.patient_fields) {
    const v = patientValue(f, o.patient);
    rows.push(
      `<div><span class="k">${esc(PATIENT_FIELD_LABELS[f])}:</span> ${
        v ? esc(v) : blank(18)
      }</div>`,
    );
  }
  rows.push(
    `<div><span class="k">Shifokor:</span> ${
      o.doctorName ? esc(o.doctorName) : blank(24)
    }</div>`,
  );

  const signature = s.show_signature
    ? `<div style="text-align:right">
         <div>Imzo: ______________________</div>
         ${
           s.show_stamp
             ? `<div class="small muted" style="margin-top:16px">M.O. (muhr o'rni)</div>`
             : ''
         }
       </div>`
    : '';

  const footerBits = [s.license_text, s.footer_text].filter(Boolean);
  const footer = footerBits.length
    ? `<div class="line" style="margin-top:22px"></div>
       <div class="small muted center">${footerBits.map((x) => esc(x)).join(' · ')}</div>`
    : '';

  return `
    <div class="head">
      <div style="display:flex;gap:10px;align-items:flex-start">
        ${logo}
        <div>
          <h1>${esc(o.title)}</h1>
          <div class="muted small">${esc(clinicName)}</div>
          ${contacts ? `<div class="muted small">${contacts}</div>` : ''}
        </div>
      </div>
      <div class="right small muted">
        <div>№ ________</div>
        <div>Sana: ____________</div>
      </div>
    </div>
    <div class="line"></div>

    <div class="meta">${rows.join('')}</div>

    ${o.body}

    <div style="margin-top:30px;display:flex;justify-content:space-between;align-items:flex-end">
      <div class="small muted">${o.note ? esc(o.note) : ''}</div>
      ${signature}
    </div>
    ${footer}
  `;
}

/**
 * Ekrandagi preview CSS — print-receipt.ts dagi A4 uslubining nusxasi
 * (@page dan tashqari). O'zgartirsangiz IKKALA joyda ham o'zgartiring.
 */
export const A4_PREVIEW_CSS = `
  .a4-preview * { box-sizing: border-box; }
  .a4-preview { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; }
  .a4-preview h1 { font-size: 20px; margin: 0 0 2px; }
  .a4-preview .muted { color: #666; }
  .a4-preview .small { font-size: 11px; }
  .a4-preview .right { text-align: right; }
  .a4-preview .center { text-align: center; }
  .a4-preview .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
  .a4-preview .line { border-top: 1px solid #000; margin: 10px 0; }
  .a4-preview .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin: 8px 0 14px; }
  .a4-preview .meta .k { color: #666; }
`;

/** Preview va sozlamalar sahifasi uchun namuna bemor. */
export const SAMPLE_PATIENT: PatientInfo = {
  full_name: 'Aliyev Sardor Baxtiyorovich',
  dob: '1988-04-17',
  gender: 'Erkak',
  phone: '+998 90 123-45-67',
  address: "Toshkent sh., Chilonzor t., 12-uy",
  mrn: 'K-004821',
  pinfl: '31704886210017',
  passport: 'AA 1234567',
};
