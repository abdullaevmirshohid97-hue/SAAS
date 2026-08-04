import type { AdminContract, AdminInvoice, BillingParty, BillingSettings } from '@clary/api-client';

// =============================================================================
// BILLING DOCS — chop etiladigan hujjatlar (invoys, 2 tomonlama shartnoma, oferta)
// =============================================================================
// Hammasi bitta o'zini-o'zi ushlab turadigan HTML: tashqi shrift/CSS YO'Q, chunki
// hujjat yangi oynada ochilib darhol chop etiladi (offline printerda ham ishlaydi).
// Uslub: "5 yulduzli mehmonxona hisobi" — keng bo'sh joy, ingichka oltin chiziq,
// serif sarlavha, tabular raqamlar. Bezak matnni bosib ketmaydi.
// =============================================================================

export type DocLang = 'uz' | 'ru';

const fmtUzs = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('ru-RU');

function fmtDate(iso: string | null | undefined, lang: DocLang): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return lang === 'ru' ? `${dd}.${mm}.${d.getFullYear()}` : `${dd}.${mm}.${d.getFullYear()}`;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Summani so'z bilan yozish (O'zbekistonda hisob-fakturada majburiy odat) ---

const UZ_ONES = ['', 'bir', 'ikki', 'uch', 'to‘rt', 'besh', 'olti', 'yetti', 'sakkiz', 'to‘qqiz'];
const UZ_TENS = [
  '',
  'o‘n',
  'yigirma',
  'o‘ttiz',
  'qirq',
  'ellik',
  'oltmish',
  'yetmish',
  'sakson',
  'to‘qson',
];
const RU_ONES = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const RU_TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const RU_TENS = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто',
];
const RU_HUNDREDS = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот',
];

function uzTriple(n: number): string {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  if (h) out.push(`${UZ_ONES[h]} yuz`);
  if (t) out.push(UZ_TENS[t]!);
  if (o) out.push(UZ_ONES[o]!);
  return out.join(' ');
}

function ruTriple(n: number, feminine: boolean): string {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) out.push(RU_HUNDREDS[h]!);
  if (rest >= 10 && rest < 20) {
    out.push(RU_TEENS[rest - 10]!);
  } else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    if (t) out.push(RU_TENS[t]!);
    if (o) {
      if (feminine && o === 1) out.push('одна');
      else if (feminine && o === 2) out.push('две');
      else out.push(RU_ONES[o]!);
    }
  }
  return out.join(' ');
}

/** Rus tilida son bilan kelgan so'z shakli (1 тысяча / 2 тысячи / 5 тысяч). */
function ruPlural(n: number, forms: [string, string, string]): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
  return forms[2];
}

/** 1 250 000 → "bir million ikki yuz ellik ming so‘m" */
export function amountInWords(amount: number, lang: DocLang): string {
  const n = Math.floor(Math.abs(Number(amount) || 0));
  if (n === 0) return lang === 'ru' ? 'ноль сум' : 'nol so‘m';

  const groups: number[] = [];
  let rest = n;
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }

  const parts: string[] = [];
  if (lang === 'uz') {
    const scale = ['', 'ming', 'million', 'milliard', 'trillion'];
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i]!;
      if (!g) continue;
      // 1000 → "ming" (bir ming EMAS) — o'zbekcha me'yor.
      const words = g === 1 && i === 1 ? '' : uzTriple(g);
      parts.push([words, scale[i]].filter(Boolean).join(' '));
    }
    return `${parts.join(' ')} so‘m`;
  }

  const scale: Array<[string, string, string] | null> = [
    null,
    ['тысяча', 'тысячи', 'тысяч'],
    ['миллион', 'миллиона', 'миллионов'],
    ['миллиард', 'миллиарда', 'миллиардов'],
    ['триллион', 'триллиона', 'триллионов'],
  ];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (!g) continue;
    const forms = scale[i];
    parts.push([ruTriple(g, i === 1), forms ? ruPlural(g, forms) : ''].filter(Boolean).join(' '));
  }
  return `${parts.join(' ')} сум`;
}

// --- Umumiy uslub (barcha hujjatlar uchun bitta manba) ---------------------

const BASE_CSS = `
  @page { size: A4; margin: 14mm 15mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Georgia", "Times New Roman", serif;
    color: #1c1b19;
    font-size: 11.5px;
    line-height: 1.6;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet { max-width: 190mm; margin: 0 auto; }
  .rule { height: 1px; background: linear-gradient(90deg, #b08d4f 0%, #e5d9c0 60%, transparent 100%); border: 0; margin: 0; }
  .rule-thin { height: 1px; background: #e2ddd4; border: 0; margin: 0; }
  .eyebrow {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 8px; letter-spacing: .22em; text-transform: uppercase;
    color: #9a8f7d; font-weight: 600;
  }
  .brand { font-size: 22px; letter-spacing: .18em; font-weight: 400; color: #12100e; text-transform: uppercase; }
  .brand-sub { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 8.5px; letter-spacing: .2em; color: #9a8f7d; text-transform: uppercase; }
  h1.doc-title { font-size: 17px; font-weight: 400; letter-spacing: .1em; margin: 0; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; }
  .num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; white-space: nowrap; }
  .muted { color: #7c7364; }
  .party-label { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 8px; letter-spacing: .2em; text-transform: uppercase; color: #b08d4f; font-weight: 700; }
  .party-name { font-size: 13px; font-weight: 700; margin: 3px 0 5px; }
  .kv { font-size: 10px; line-height: 1.75; }
  .kv b { font-weight: 400; color: #7c7364; display: inline-block; min-width: 78px; }
  .footer-note { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 8px; color: #a89e8d; letter-spacing: .04em; }
  @media print { .no-print { display: none !important; } body { font-size: 11px; } }
  .no-print-bar {
    position: sticky; top: 0; z-index: 9; display: flex; gap: 8px; justify-content: center;
    padding: 10px; background: #12100e; margin: -14mm -15mm 10mm;
  }
  .no-print-bar button {
    font-family: "Helvetica Neue", Arial, sans-serif; font-size: 12px; cursor: pointer;
    padding: 7px 20px; border-radius: 2px; border: 1px solid #b08d4f;
    background: #b08d4f; color: #12100e; letter-spacing: .08em; text-transform: uppercase;
  }
  .no-print-bar button.ghost { background: transparent; color: #e5d9c0; }
`;

function shell(title: string, body: string, printLabel: string, closeLabel: string): string {
  return `<!doctype html>
<html lang="uz"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${BASE_CSS}</style></head>
<body>
  <div class="no-print-bar no-print">
    <button onclick="window.print()">${esc(printLabel)}</button>
    <button class="ghost" onclick="window.close()">${esc(closeLabel)}</button>
  </div>
  <div class="sheet">${body}</div>
</body></html>`;
}

/** Hujjatni yangi oynada ochadi (chop etish/PDF saqlash uchun). */
export function openDoc(html: string) {
  const w = window.open('', '_blank', 'width=920,height=1000');
  if (!w) {
    // Popup bloklangan — foydalanuvchi sababini bilsin.
    throw new Error('Brauzer yangi oynani blokladi. Popup ruxsatini yoqing.');
  }
  w.document.write(html);
  w.document.close();
}

// --- Letterhead (barcha hujjatlarda bir xil) -------------------------------

function letterhead(issuer: BillingParty, right: string): string {
  return `
  <table style="margin-bottom:10px"><tr>
    <td style="vertical-align:top">
      <div class="brand">Clary</div>
      <div class="brand-sub">Healthcare&nbsp;ERP</div>
      <div class="kv muted" style="margin-top:8px">
        ${issuer.legal_name || issuer.company_name ? `<div>${esc(issuer.legal_name || issuer.company_name)}</div>` : ''}
        ${issuer.address ? `<div>${esc(issuer.address)}</div>` : ''}
        ${issuer.phone ? `<div>${esc(issuer.phone)}</div>` : ''}
        ${issuer.website ? `<div>${esc(issuer.website)}</div>` : ''}
      </div>
    </td>
    <td style="vertical-align:top;text-align:right;width:47%">${right}</td>
  </tr></table>
  <hr class="rule">`;
}

function partyBlock(label: string, p: BillingParty, L: Record<string, string>): string {
  const name = p.legal_name || p.company_name || p.name || '—';
  return `
    <div class="party-label">${esc(label)}</div>
    <div class="party-name">${esc(name)}</div>
    <div class="kv">
      ${p.name && p.legal_name ? `<div><b>${esc(L.brand)}</b> ${esc(p.name)}</div>` : ''}
      ${p.tax_id ? `<div><b>${esc(L.taxId)}</b> ${esc(p.tax_id)}</div>` : ''}
      ${p.oked ? `<div><b>${esc(L.oked)}</b> ${esc(p.oked)}</div>` : ''}
      ${p.address ? `<div><b>${esc(L.address)}</b> ${esc(p.address)}</div>` : ''}
      ${p.phone ? `<div><b>${esc(L.phone)}</b> ${esc(p.phone)}</div>` : ''}
      ${p.email ? `<div><b>${esc(L.email)}</b> ${esc(p.email)}</div>` : ''}
      ${p.bank_name ? `<div><b>${esc(L.bank)}</b> ${esc(p.bank_name)}</div>` : ''}
      ${p.bank_account ? `<div><b>${esc(L.account)}</b> <span class="num">${esc(p.bank_account)}</span></div>` : ''}
      ${p.bank_mfo ? `<div><b>${esc(L.mfo)}</b> <span class="num">${esc(p.bank_mfo)}</span></div>` : ''}
    </div>`;
}

// --- Lug'at ---------------------------------------------------------------

const DICT: Record<DocLang, Record<string, string>> = {
  uz: {
    print: 'Chop etish',
    close: 'Yopish',
    invoice: 'Hisob-faktura',
    invoiceNo: 'Hujjat №',
    issued: 'Sana',
    due: 'To‘lov muddati',
    period: 'Xizmat davri',
    supplier: 'Ijrochi',
    customer: 'Buyurtmachi',
    brand: 'Brend',
    taxId: 'STIR',
    oked: 'OKED',
    address: 'Manzil',
    phone: 'Telefon',
    email: 'E-pochta',
    bank: 'Bank',
    account: 'H/r',
    mfo: 'MFO',
    no: '№',
    description: 'Xizmat nomi',
    unit: 'Birlik',
    qty: 'Miqdor',
    price: 'Narx',
    amount: 'Summa',
    subtotal: 'Jami',
    discount: 'Chegirma',
    vat: 'QQS',
    total: 'To‘lovga',
    inWords: 'Summa so‘z bilan',
    paymentDetails: 'To‘lov rekvizitlari',
    paymentPurpose: 'To‘lov maqsadi',
    supplierSign: 'Ijrochi',
    customerSign: 'Buyurtmachi',
    signature: 'imzo',
    stamp: 'M.O‘.',
    paid: 'TO‘LANGAN',
    void: 'BEKOR QILINGAN',
    overdue: 'MUDDATI O‘TGAN',
    draft: 'QORALAMA',
    footer:
      'Hujjat Clary Care axborot tizimida shakllantirildi. Elektron nusxa asl nusxaga tenglashtiriladi.',
    contract: 'Shartnoma',
    contractNo: 'Shartnoma №',
    offer: 'Ommaviy oferta',
  },
  ru: {
    print: 'Печать',
    close: 'Закрыть',
    invoice: 'Счёт-фактура',
    invoiceNo: 'Документ №',
    issued: 'Дата',
    due: 'Срок оплаты',
    period: 'Период услуг',
    supplier: 'Исполнитель',
    customer: 'Заказчик',
    brand: 'Бренд',
    taxId: 'ИНН',
    oked: 'ОКЭД',
    address: 'Адрес',
    phone: 'Телефон',
    email: 'Эл. почта',
    bank: 'Банк',
    account: 'Р/с',
    mfo: 'МФО',
    no: '№',
    description: 'Наименование услуги',
    unit: 'Ед.',
    qty: 'Кол-во',
    price: 'Цена',
    amount: 'Сумма',
    subtotal: 'Итого',
    discount: 'Скидка',
    vat: 'НДС',
    total: 'К оплате',
    inWords: 'Сумма прописью',
    paymentDetails: 'Платёжные реквизиты',
    paymentPurpose: 'Назначение платежа',
    supplierSign: 'Исполнитель',
    customerSign: 'Заказчик',
    signature: 'подпись',
    stamp: 'М.П.',
    paid: 'ОПЛАЧЕНО',
    void: 'АННУЛИРОВАН',
    overdue: 'ПРОСРОЧЕН',
    draft: 'ЧЕРНОВИК',
    footer:
      'Документ сформирован в информационной системе Clary Care. Электронная копия приравнивается к оригиналу.',
    contract: 'Договор',
    contractNo: 'Договор №',
    offer: 'Публичная оферта',
  },
};

// =============================================================================
// 1) INVOYS
// =============================================================================

function statusStamp(inv: AdminInvoice, L: Record<string, string>): string {
  const map: Record<string, { text: string; color: string } | null> = {
    paid: { text: L.paid!, color: '#1f7a4d' },
    void: { text: L.void!, color: '#9b1c1c' },
    draft: { text: L.draft!, color: '#9a8f7d' },
    sent: inv.is_overdue ? { text: L.overdue!, color: '#9b1c1c' } : null,
  };
  const s = map[inv.status];
  if (!s) return '';
  return `<div style="display:inline-block;margin-top:10px;padding:4px 14px;border:1.5px solid ${s.color};color:${s.color};
    font-family:'Helvetica Neue',Arial,sans-serif;font-size:9px;letter-spacing:.18em;font-weight:700;transform:rotate(-1.2deg)">
    ${esc(s.text)}</div>`;
}

export function invoiceHtml(inv: AdminInvoice, langOverride?: DocLang): string {
  const lang: DocLang = langOverride ?? inv.lang ?? 'uz';
  const L = DICT[lang]!;
  const issuer = inv.issuer ?? {};
  const customer = inv.customer ?? {};

  const meta = `
    <div class="eyebrow">${esc(L.invoice)}</div>
    <h1 class="doc-title" style="margin-top:4px">${esc(inv.number ?? '—')}</h1>
    <div class="kv" style="margin-top:10px">
      <div><b>${esc(L.issued)}</b> <span class="num">${fmtDate(inv.issued_at, lang)}</span></div>
      <div><b>${esc(L.due)}</b> <span class="num" style="font-weight:700">${fmtDate(inv.due_at, lang)}</span></div>
    </div>
    ${statusStamp(inv, L)}`;

  const rows = (inv.items ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(
      (it, i) => `
      <tr>
        <td style="padding:9px 6px;border-bottom:1px solid #efece5;color:#a89e8d" class="num">${i + 1}</td>
        <td style="padding:9px 6px;border-bottom:1px solid #efece5">
          <div style="font-weight:600">${esc(it.title)}</div>
          ${it.description ? `<div class="muted" style="font-size:10px">${esc(it.description)}</div>` : ''}
        </td>
        <td style="padding:9px 6px;border-bottom:1px solid #efece5;text-align:center" class="muted">${esc(it.unit)}</td>
        <td style="padding:9px 6px;border-bottom:1px solid #efece5;text-align:right" class="num">${Number(it.quantity)}</td>
        <td style="padding:9px 6px;border-bottom:1px solid #efece5;text-align:right" class="num">${fmtUzs(it.unit_price_uzs)}</td>
        <td style="padding:9px 6px;border-bottom:1px solid #efece5;text-align:right;font-weight:600" class="num">${fmtUzs(it.amount_uzs)}</td>
      </tr>`,
    )
    .join('');

  const totalsRow = (label: string, value: string, strong = false) => `
    <tr>
      <td style="padding:${strong ? '10px' : '4px'} 0;text-align:right;color:${strong ? '#12100e' : '#7c7364'};
        font-size:${strong ? '12px' : '10.5px'};letter-spacing:${strong ? '.06em' : '0'};
        ${strong ? 'text-transform:uppercase;font-weight:700' : ''}">${esc(label)}</td>
      <td class="num" style="padding:${strong ? '10px' : '4px'} 0 ${strong ? '10px' : '4px'} 22px;text-align:right;
        font-size:${strong ? '17px' : '11px'};font-weight:${strong ? '700' : '400'};white-space:nowrap">${value}</td>
    </tr>`;

  const body = `
  ${letterhead(issuer, meta)}

  <table style="margin-top:16px"><tr>
    <td style="vertical-align:top;width:50%;padding-right:16px">${partyBlock(L.supplier!, issuer, L)}</td>
    <td style="vertical-align:top;width:50%;padding-left:16px;border-left:1px solid #efece5">
      ${partyBlock(L.customer!, customer, L)}
    </td>
  </tr></table>

  ${
    inv.period_start
      ? `<div style="margin-top:16px;padding:9px 14px;background:#faf8f4;border-left:2px solid #b08d4f">
           <span class="eyebrow">${esc(L.period)}</span>
           <span class="num" style="margin-left:10px;font-size:12px;font-weight:700">
             ${fmtDate(inv.period_start, lang)} — ${fmtDate(inv.period_end, lang)}
           </span>
           <span class="muted" style="margin-left:8px;font-size:10px">(${inv.months} ${lang === 'ru' ? 'мес.' : 'oy'})</span>
         </div>`
      : ''
  }

  <table style="margin-top:16px">
    <thead><tr>
      <th style="text-align:left;padding:0 6px 7px;width:26px" class="eyebrow">${esc(L.no)}</th>
      <th style="text-align:left;padding:0 6px 7px" class="eyebrow">${esc(L.description)}</th>
      <th style="text-align:center;padding:0 6px 7px;width:52px" class="eyebrow">${esc(L.unit)}</th>
      <th style="text-align:right;padding:0 6px 7px;width:58px" class="eyebrow">${esc(L.qty)}</th>
      <th style="text-align:right;padding:0 6px 7px;width:96px" class="eyebrow">${esc(L.price)}</th>
      <th style="text-align:right;padding:0 6px 7px;width:110px" class="eyebrow">${esc(L.amount)}</th>
    </tr></thead>
    <tbody style="border-top:1px solid #d8d2c6">${rows}</tbody>
  </table>

  <table style="margin-top:14px"><tr>
    <td style="vertical-align:top;width:55%;padding-right:20px">
      <div class="eyebrow">${esc(L.inWords)}</div>
      <div style="margin-top:5px;font-style:italic;font-size:11.5px;line-height:1.5">
        ${esc(amountInWords(inv.total_uzs, lang))}
      </div>
      ${inv.notes ? `<div class="muted" style="margin-top:12px;font-size:10px">${esc(inv.notes)}</div>` : ''}
    </td>
    <td style="vertical-align:top;width:45%">
      <table>
        ${totalsRow(L.subtotal!, `${fmtUzs(inv.subtotal_uzs)}`)}
        ${Number(inv.discount_uzs) > 0 ? totalsRow(`${L.discount} (${Number(inv.discount_percent)}%)`, `− ${fmtUzs(inv.discount_uzs)}`) : ''}
        ${Number(inv.vat_percent) > 0 ? totalsRow(`${L.vat} (${Number(inv.vat_percent)}%)`, `${fmtUzs(inv.vat_uzs)}`) : ''}
        <tr><td colspan="2" style="padding:6px 0"><hr class="rule"></td></tr>
        ${totalsRow(L.total!, `${fmtUzs(inv.total_uzs)}`, true)}
        <tr><td colspan="2" class="footer-note" style="text-align:right">UZS</td></tr>
      </table>
    </td>
  </tr></table>

  ${
    issuer.bank_account
      ? `<div style="margin-top:16px;padding:12px 14px;border:1px solid #efece5;background:#fdfcfa">
           <div class="eyebrow">${esc(L.paymentDetails)}</div>
           <div class="kv" style="margin-top:6px">
             ${issuer.bank_name ? `<div><b>${esc(L.bank)}</b> ${esc(issuer.bank_name)}</div>` : ''}
             <div><b>${esc(L.account)}</b> <span class="num">${esc(issuer.bank_account)}</span></div>
             ${issuer.bank_mfo ? `<div><b>${esc(L.mfo)}</b> <span class="num">${esc(issuer.bank_mfo)}</span></div>` : ''}
             ${issuer.tax_id ? `<div><b>${esc(L.taxId)}</b> <span class="num">${esc(issuer.tax_id)}</span></div>` : ''}
             <div><b>${esc(L.paymentPurpose)}</b> ${esc(inv.number ?? '')} — Clary Care${inv.period_start ? `, ${fmtDate(inv.period_start, lang)}—${fmtDate(inv.period_end, lang)}` : ''}</div>
           </div>
           ${issuer.payment_note ? `<div class="muted" style="margin-top:6px;font-size:10px">${esc(issuer.payment_note)}</div>` : ''}
         </div>`
      : ''
  }

  <table style="margin-top:26px"><tr>
    <td style="width:50%;padding-right:20px">
      <div class="eyebrow">${esc(L.supplierSign)}</div>
      <div style="margin-top:26px;border-bottom:1px solid #12100e"></div>
      <div class="footer-note" style="margin-top:4px">
        ${esc(issuer.director_position ?? '')} ${esc(issuer.director_name ?? '')} · ${esc(L.signature)} · ${esc(L.stamp)}
      </div>
    </td>
    <td style="width:50%;padding-left:20px">
      <div class="eyebrow">${esc(L.customerSign)}</div>
      <div style="margin-top:26px;border-bottom:1px solid #12100e"></div>
      <div class="footer-note" style="margin-top:4px">${esc(L.signature)} · ${esc(L.stamp)}</div>
    </td>
  </tr></table>

  <hr class="rule-thin" style="margin-top:22px">
  <div class="footer-note" style="margin-top:6px;text-align:center">${esc(L.footer)}</div>`;

  return shell(`${L.invoice} ${inv.number ?? ''}`, body, L.print!, L.close!);
}

// =============================================================================
// 2) 2 TOMONLAMA SHARTNOMA
// =============================================================================

/**
 * Shartnoma bandlari. Xalqaro SaaS amaliyoti (SLA, ma'lumot himoyasi, IP,
 * javobgarlik chegarasi, fors-major, nizolar) + O'zbekiston FK talablari
 * (yozma shakl, rekvizit, imzo/muhr) hisobga olingan.
 */
function contractClauses(c: AdminContract, lang: DocLang): Array<{ h: string; p: string[] }> {
  const issuer = c.issuer ?? {};
  const customer = c.customer ?? {};
  const issuerName = issuer.legal_name || issuer.company_name || 'Clary Care';
  const customerName = customer.legal_name || customer.name || '—';
  const monthly = fmtUzs(c.monthly_uzs);
  const periodWord =
    c.billing_period === 'yearly'
      ? lang === 'ru'
        ? 'год'
        : 'yil'
      : lang === 'ru'
        ? 'месяц'
        : 'oy';

  if (lang === 'ru') {
    return [
      {
        h: '1. Предмет договора',
        p: [
          `1.1. Исполнитель предоставляет Заказчику право использования (неисключительную лицензию) облачной медицинской информационной системы «Clary Care» (далее — Система), а Заказчик обязуется оплачивать подписку в порядке, установленном настоящим Договором.`,
          `1.2. Система предоставляется по модели SaaS — без передачи экземпляра программы; доступ осуществляется через сеть Интернет.`,
          `1.3. Состав функциональных модулей определяется выбранным тарифом (${esc(c.plan_code ?? '—')}).`,
        ],
      },
      {
        h: '2. Стоимость и порядок расчётов',
        p: [
          `2.1. Стоимость подписки составляет ${monthly} сум за 1 ${periodWord}, НДС — согласно счёту.`,
          `2.2. Исполнитель выставляет счёт-фактуру за расчётный период. Оплата производится в течение 5 (пяти) банковских дней с даты выставления счёта.`,
          `2.3. Датой оплаты считается дата поступления денежных средств на расчётный счёт Исполнителя.`,
          `2.4. При просрочке оплаты свыше 10 (десяти) календарных дней Исполнитель вправе приостановить доступ к Системе, уведомив Заказчика. Данные Заказчика при этом не удаляются.`,
          `2.5. Исполнитель вправе изменить стоимость, письменно уведомив Заказчика не менее чем за 30 календарных дней. Изменение не распространяется на оплаченный период.`,
        ],
      },
      {
        h: '3. Права и обязанности сторон',
        p: [
          `3.1. Исполнитель обязуется обеспечить доступность Системы не менее 99,5% времени в календарный месяц, исключая плановые работы (не более 4 часов в месяц с предварительным уведомлением).`,
          `3.2. Исполнитель обеспечивает резервное копирование данных Заказчика не реже одного раза в сутки и хранение резервных копий не менее 30 дней.`,
          `3.3. Исполнитель оказывает техническую поддержку в рабочие дни; критические инциденты принимаются круглосуточно.`,
          `3.4. Заказчик обязуется использовать Систему в соответствии с законодательством, не передавать учётные данные третьим лицам и обеспечивать достоверность вводимых данных.`,
          `3.5. Заказчик несёт ответственность за действия своих работников, получивших доступ к Системе.`,
        ],
      },
      {
        h: '4. Данные, конфиденциальность и их защита',
        p: [
          `4.1. Все данные, внесённые Заказчиком, включая персональные данные пациентов, остаются собственностью Заказчика. Заказчик выступает владельцем базы персональных данных, Исполнитель — обработчиком по поручению.`,
          `4.2. Исполнитель обрабатывает персональные данные исключительно в объёме, необходимом для оказания услуг, и не передаёт их третьим лицам без письменного согласия Заказчика, кроме случаев, предусмотренных законом.`,
          `4.3. Стороны обязуются соблюдать конфиденциальность в течение срока действия Договора и 3 (трёх) лет после его прекращения.`,
          `4.4. Исполнитель применяет организационные и технические меры защиты: шифрование канала связи, разграничение доступа по ролям, журналирование действий пользователей.`,
          `4.5. При прекращении Договора Заказчик вправе в течение 30 календарных дней получить выгрузку своих данных в машиночитаемом формате. По истечении указанного срока данные могут быть удалены.`,
        ],
      },
      {
        h: '5. Интеллектуальная собственность',
        p: [
          `5.1. Исключительные права на Систему, её исходный код, интерфейсы и товарный знак принадлежат Исполнителю.`,
          `5.2. Заказчику не предоставляется право воспроизводить, декомпилировать, модифицировать Систему или предоставлять доступ к ней третьим лицам на возмездной основе.`,
        ],
      },
      {
        h: '6. Ответственность сторон',
        p: [
          `6.1. Стороны несут ответственность в соответствии с законодательством Республики Узбекистан.`,
          `6.2. Совокупная ответственность Исполнителя ограничивается суммой платежей, фактически полученных от Заказчика за 3 (три) месяца, предшествующих событию, повлёкшему ответственность.`,
          `6.3. Исполнитель не несёт ответственности за медицинские решения, принятые Заказчиком, а также за последствия недостоверных данных, внесённых Заказчиком.`,
          `6.4. Исполнитель не несёт ответственности за недоступность Системы, вызванную сбоями на стороне провайдеров связи, действиями Заказчика либо обстоятельствами непреодолимой силы.`,
        ],
      },
      {
        h: '7. Форс-мажор',
        p: [
          `7.1. Стороны освобождаются от ответственности за неисполнение обязательств, если оно вызвано обстоятельствами непреодолимой силы (стихийные бедствия, военные действия, акты государственных органов, массовые сбои сетей связи).`,
          `7.2. Сторона, для которой наступили такие обстоятельства, уведомляет другую Сторону в течение 10 календарных дней.`,
        ],
      },
      {
        h: '8. Срок действия, изменение и расторжение',
        p: [
          `8.1. Договор вступает в силу с ${fmtDate(c.starts_on, lang)} и действует до ${fmtDate(c.ends_on, lang)}.`,
          `8.2. Если ни одна из Сторон не заявит о прекращении за 30 календарных дней до истечения срока, Договор считается продлённым на тот же срок неограниченное число раз.`,
          `8.3. Каждая Сторона вправе расторгнуть Договор в одностороннем порядке, письменно уведомив другую Сторону не менее чем за 30 календарных дней. Оплаченный, но неиспользованный период возврату не подлежит, если расторжение произошло по инициативе Заказчика.`,
          `8.4. Все изменения оформляются дополнительными соглашениями в письменной форме.`,
        ],
      },
      {
        h: '9. Разрешение споров',
        p: [
          `9.1. Споры разрешаются путём переговоров. Претензионный порядок обязателен; срок ответа на претензию — 15 календарных дней.`,
          `9.2. При недостижении согласия спор передаётся в экономический суд по месту нахождения ответчика в соответствии с законодательством Республики Узбекистан.`,
        ],
      },
      {
        h: '10. Прочие условия',
        p: [
          `10.1. Договор составлен в двух экземплярах, имеющих одинаковую юридическую силу, по одному для каждой Стороны.`,
          `10.2. Документы, переданные по электронной почте с адресов, указанных в реквизитах, признаются имеющими юридическую силу до обмена оригиналами.`,
          `10.3. Настоящий Договор («${esc(issuerName)}» — «${esc(customerName)}») заменяет все предшествующие устные договорённости Сторон по его предмету.`,
        ],
      },
    ];
  }

  return [
    {
      h: '1. Shartnoma predmeti',
      p: [
        `1.1. Ijrochi Buyurtmachiga «Clary Care» bulutli tibbiy axborot tizimidan (keyingi o‘rinlarda — Tizim) foydalanish huquqini (mutlaq bo‘lmagan litsenziya) taqdim etadi, Buyurtmachi esa obuna haqini ushbu Shartnomada belgilangan tartibda to‘lash majburiyatini oladi.`,
        `1.2. Tizim SaaS modeli bo‘yicha taqdim etiladi — dastur nusxasi topshirilmaydi; foydalanish Internet tarmog‘i orqali amalga oshiriladi.`,
        `1.3. Funksional modullar tarkibi tanlangan tarif bilan belgilanadi (${esc(c.plan_code ?? '—')}).`,
      ],
    },
    {
      h: '2. Xizmat qiymati va hisob-kitob tartibi',
      p: [
        `2.1. Obuna qiymati 1 ${periodWord} uchun ${monthly} so‘mni tashkil etadi; QQS hisob-fakturaga muvofiq.`,
        `2.2. Ijrochi hisobot davri uchun hisob-faktura taqdim etadi. To‘lov hisob-faktura sanasidan boshlab 5 (besh) bank kuni ichida amalga oshiriladi.`,
        `2.3. To‘lov sanasi deb pul mablag‘larining Ijrochi hisob raqamiga kelib tushgan sanasi hisoblanadi.`,
        `2.4. To‘lov 10 (o‘n) kalendar kundan ortiq kechiktirilganda Ijrochi Buyurtmachini xabardor qilgan holda Tizimga kirishni to‘xtatib turishga haqli. Bunda Buyurtmachining ma’lumotlari o‘chirilmaydi.`,
        `2.5. Ijrochi kamida 30 kalendar kun oldin yozma xabar berib narxni o‘zgartirishga haqli. O‘zgarish to‘langan davrga tatbiq etilmaydi.`,
      ],
    },
    {
      h: '3. Tomonlarning huquq va majburiyatlari',
      p: [
        `3.1. Ijrochi Tizimning kalendar oy davomida kamida 99,5% vaqt ishlashini ta’minlaydi; rejali ishlar bundan mustasno (oyiga 4 soatdan ko‘p emas, oldindan xabar berilgan holda).`,
        `3.2. Ijrochi Buyurtmachi ma’lumotlarining zaxira nusxasini kamida sutkasiga bir marta oladi va zaxira nusxalarni kamida 30 kun saqlaydi.`,
        `3.3. Ijrochi texnik yordamni ish kunlari ko‘rsatadi; kritik hodisalar kunu tun qabul qilinadi.`,
        `3.4. Buyurtmachi Tizimdan qonunchilikka muvofiq foydalanish, hisob ma’lumotlarini uchinchi shaxslarga bermaslik va kiritilayotgan ma’lumotlar haqqoniyligini ta’minlash majburiyatini oladi.`,
        `3.5. Buyurtmachi Tizimga kirish huquqini olgan o‘z xodimlarining harakatlari uchun javobgardir.`,
      ],
    },
    {
      h: '4. Ma’lumotlar, maxfiylik va ularni himoya qilish',
      p: [
        `4.1. Buyurtmachi kiritgan barcha ma’lumotlar, shu jumladan bemorlarning shaxsiy ma’lumotlari, Buyurtmachi mulki bo‘lib qoladi. Buyurtmachi shaxsiy ma’lumotlar bazasining egasi, Ijrochi esa uning topshirig‘i bo‘yicha ishlov beruvchi hisoblanadi.`,
        `4.2. Ijrochi shaxsiy ma’lumotlarga faqat xizmat ko‘rsatish uchun zarur hajmda ishlov beradi va qonunda nazarda tutilgan hollardan tashqari Buyurtmachining yozma roziligisiz uchinchi shaxslarga bermaydi.`,
        `4.3. Tomonlar Shartnoma amal qilish muddati davomida va u tugaganidan keyin 3 (uch) yil davomida maxfiylikka rioya qiladi.`,
        `4.4. Ijrochi tashkiliy va texnik himoya choralarini qo‘llaydi: aloqa kanalini shifrlash, rollar bo‘yicha kirishni chegaralash, foydalanuvchi harakatlarini jurnallash.`,
        `4.5. Shartnoma bekor qilinganda Buyurtmachi 30 kalendar kun ichida o‘z ma’lumotlarini mashina o‘qiy oladigan formatda yuklab olishga haqli. Ushbu muddat o‘tgach ma’lumotlar o‘chirilishi mumkin.`,
      ],
    },
    {
      h: '5. Intellektual mulk',
      p: [
        `5.1. Tizimga, uning dastlabki kodiga, interfeyslariga va tovar belgisiga bo‘lgan mutlaq huquqlar Ijrochiga tegishli.`,
        `5.2. Buyurtmachiga Tizimni ko‘paytirish, dekompilyatsiya qilish, o‘zgartirish yoki uchinchi shaxslarga haq evaziga foydalanish huquqini berish taqiqlanadi.`,
      ],
    },
    {
      h: '6. Tomonlarning javobgarligi',
      p: [
        `6.1. Tomonlar O‘zbekiston Respublikasi qonunchiligiga muvofiq javobgar bo‘ladilar.`,
        `6.2. Ijrochining jami javobgarligi javobgarlikka sabab bo‘lgan hodisadan oldingi 3 (uch) oy ichida Buyurtmachidan haqiqatda olingan to‘lovlar summasi bilan cheklanadi.`,
        `6.3. Ijrochi Buyurtmachi qabul qilgan tibbiy qarorlar, shuningdek Buyurtmachi kiritgan noto‘g‘ri ma’lumotlar oqibatlari uchun javobgar emas.`,
        `6.4. Ijrochi aloqa provayderlari tomonidagi uzilishlar, Buyurtmachi harakatlari yoki yengib bo‘lmas kuch holatlari sababli Tizimga kirib bo‘lmagani uchun javobgar emas.`,
      ],
    },
    {
      h: '7. Yengib bo‘lmas kuch (fors-major)',
      p: [
        `7.1. Majburiyatlar yengib bo‘lmas kuch holatlari (tabiiy ofatlar, harbiy harakatlar, davlat organlari hujjatlari, aloqa tarmoqlarining ommaviy uzilishi) tufayli bajarilmaganda Tomonlar javobgarlikdan ozod qilinadi.`,
        `7.2. Bunday holatlar yuz bergan Tomon 10 kalendar kun ichida ikkinchi Tomonni xabardor qiladi.`,
      ],
    },
    {
      h: '8. Amal qilish muddati, o‘zgartirish va bekor qilish',
      p: [
        `8.1. Shartnoma ${fmtDate(c.starts_on, lang)} dan kuchga kiradi va ${fmtDate(c.ends_on, lang)} gacha amal qiladi.`,
        `8.2. Muddat tugashiga 30 kalendar kun qolganda Tomonlardan biri bekor qilish haqida bildirmasa, Shartnoma o‘sha muddatga cheksiz marta uzaytirilgan hisoblanadi.`,
        `8.3. Har bir Tomon kamida 30 kalendar kun oldin yozma xabar berib Shartnomani bir tomonlama bekor qilishga haqli. Buyurtmachi tashabbusi bilan bekor qilinganda to‘langan, lekin foydalanilmagan davr qaytarilmaydi.`,
        `8.4. Barcha o‘zgartirishlar yozma shaklda qo‘shimcha kelishuvlar bilan rasmiylashtiriladi.`,
      ],
    },
    {
      h: '9. Nizolarni hal etish',
      p: [
        `9.1. Nizolar muzokaralar yo‘li bilan hal etiladi. Da’vo tartibi majburiy; da’voga javob berish muddati — 15 kalendar kun.`,
        `9.2. Kelishuvga erishilmasa, nizo O‘zbekiston Respublikasi qonunchiligiga muvofiq javobgarning joylashgan yeri bo‘yicha iqtisodiy sudga topshiriladi.`,
      ],
    },
    {
      h: '10. Boshqa shartlar',
      p: [
        `10.1. Shartnoma bir xil yuridik kuchga ega ikki nusxada, har bir Tomon uchun bittadan tuzilgan.`,
        `10.2. Rekvizitlarda ko‘rsatilgan manzillardan elektron pochta orqali yuborilgan hujjatlar asl nusxalar almashilgunga qadar yuridik kuchga ega deb tan olinadi.`,
        `10.3. Ushbu Shartnoma («${esc(issuerName)}» — «${esc(customerName)}») uning predmeti bo‘yicha Tomonlarning barcha oldingi og‘zaki kelishuvlarini almashtiradi.`,
      ],
    },
  ];
}

export function contractHtml(c: AdminContract, langOverride?: DocLang): string {
  const lang: DocLang = langOverride ?? c.lang ?? 'uz';
  const L = DICT[lang]!;
  const issuer = c.issuer ?? {};
  const customer = c.customer ?? {};

  const meta = `
    <div class="eyebrow">${esc(L.contract)}</div>
    <h1 class="doc-title" style="margin-top:4px">${esc(c.number ?? '—')}</h1>
    <div class="kv" style="margin-top:10px">
      <div><b>${esc(L.issued)}</b> <span class="num">${fmtDate(c.created_at, lang)}</span></div>
      <div><b>${lang === 'ru' ? 'Период' : 'Muddat'}</b>
        <span class="num">${fmtDate(c.starts_on, lang)} — ${fmtDate(c.ends_on, lang)}</span></div>
    </div>`;

  const clauses = contractClauses(c, lang)
    .map(
      (s) => `
      <section style="margin-top:15px;break-inside:avoid">
        <h2 style="font-size:12px;font-weight:700;margin:0 0 5px;letter-spacing:.03em">${esc(s.h)}</h2>
        ${s.p.map((t) => `<p style="margin:0 0 5px;text-align:justify">${t}</p>`).join('')}
      </section>`,
    )
    .join('');

  const intro =
    lang === 'ru'
      ? `<p style="margin:0;text-align:justify">
           <b>${esc(issuer.legal_name || issuer.company_name || 'Clary Care')}</b>, именуемое в дальнейшем «Исполнитель»,
           в лице ${esc(issuer.director_position ?? 'директора')} ${esc(issuer.director_name ?? '—')},
           действующего на основании Устава, с одной стороны, и
           <b>${esc(customer.legal_name || customer.name || '—')}</b>, именуемое в дальнейшем «Заказчик»,
           с другой стороны, совместно именуемые «Стороны», заключили настоящий Договор о нижеследующем.
         </p>`
      : `<p style="margin:0;text-align:justify">
           Keyingi o‘rinlarda «Ijrochi» deb ataluvchi <b>${esc(issuer.legal_name || issuer.company_name || 'Clary Care')}</b>
           nomidan Ustav asosida ish yurituvchi ${esc(issuer.director_position ?? 'direktor')}
           ${esc(issuer.director_name ?? '—')} bir tomondan, va keyingi o‘rinlarda «Buyurtmachi» deb ataluvchi
           <b>${esc(customer.legal_name || customer.name || '—')}</b> ikkinchi tomondan, birgalikda «Tomonlar» deb
           ataluvchilar, ushbu Shartnomani quyidagilar to‘g‘risida tuzdilar.
         </p>`;

  const body = `
  ${letterhead(issuer, meta)}

  <h1 class="doc-title" style="text-align:center;margin:20px 0 4px">
    ${lang === 'ru' ? 'ДОГОВОР ОБ ОКАЗАНИИ УСЛУГ' : 'XIZMAT KO‘RSATISH SHARTNOMASI'}
  </h1>
  <div style="text-align:center" class="footer-note">
    ${esc(c.number ?? '')} · ${fmtDate(c.created_at, lang)}
    ${c.terms_version ? ` · ${lang === 'ru' ? 'ред.' : 'tahrir'} ${esc(c.terms_version)}` : ''}
  </div>
  <hr class="rule-thin" style="margin:12px 0 14px">

  ${intro}
  ${clauses}

  <section style="margin-top:22px;break-inside:avoid">
    <h2 style="font-size:12px;font-weight:700;margin:0 0 8px;letter-spacing:.03em">
      ${lang === 'ru' ? '11. Реквизиты и подписи Сторон' : '11. Tomonlarning rekvizitlari va imzolari'}
    </h2>
    <table><tr>
      <td style="vertical-align:top;width:50%;padding-right:16px">${partyBlock(L.supplier!, issuer, L)}
        <div style="margin-top:30px;border-bottom:1px solid #12100e"></div>
        <div class="footer-note" style="margin-top:4px">
          ${esc(issuer.director_position ?? '')} ${esc(issuer.director_name ?? '')} · ${esc(L.stamp)}
        </div>
      </td>
      <td style="vertical-align:top;width:50%;padding-left:16px;border-left:1px solid #efece5">
        ${partyBlock(L.customer!, customer, L)}
        <div style="margin-top:30px;border-bottom:1px solid #12100e"></div>
        <div class="footer-note" style="margin-top:4px">${esc(L.signature)} · ${esc(L.stamp)}</div>
      </td>
    </tr></table>
  </section>

  <hr class="rule-thin" style="margin-top:22px">
  <div class="footer-note" style="margin-top:6px;text-align:center">${esc(L.footer)}</div>`;

  return shell(`${L.contract} ${c.number ?? ''}`, body, L.print!, L.close!);
}

// =============================================================================
// 3) OMMAVIY OFERTA (saytga joylanadigan / mijoz onlayn qabul qiladigan matn)
// =============================================================================

export function offerHtml(s: BillingSettings, lang: DocLang = 'uz'): string {
  const L = DICT[lang]!;
  const issuer: BillingParty = { ...s };
  const name = s.legal_name || s.company_name || 'Clary Care';

  const sections =
    lang === 'ru'
      ? [
          {
            h: '1. Общие положения',
            p: [
              `1.1. Настоящий документ является публичной офертой ${esc(name)} (далее — Исполнитель) и содержит все существенные условия оказания услуг доступа к медицинской информационной системе «Clary Care».`,
              `1.2. Акцептом оферты признаётся регистрация в Системе, оплата счёта либо фактическое начало использования Системы. С момента акцепта договор считается заключённым на условиях настоящей оферты.`,
              `1.3. Действующая редакция оферты размещена по адресу ${esc(s.offer_url || 'clary.uz/oferta')} и может быть изменена Исполнителем с уведомлением не менее чем за 30 календарных дней.`,
            ],
          },
          {
            h: '2. Услуги и тарифы',
            p: [
              `2.1. Исполнитель предоставляет доступ к Системе по модели SaaS в объёме выбранного тарифа.`,
              `2.2. Тарифы публикуются на сайте Исполнителя. Оплаченный период не подлежит одностороннему изменению цены.`,
              `2.3. Пробный (демонстрационный) период предоставляется однократно и не влечёт обязательств по оплате.`,
            ],
          },
          {
            h: '3. Порядок оплаты',
            p: [
              `3.1. Оплата производится авансом за расчётный период на основании счёта, выставленного Исполнителем.`,
              `3.2. При просрочке свыше 10 календарных дней доступ может быть приостановлен; данные Заказчика сохраняются.`,
              `3.3. Возврат средств за неиспользованный период при расторжении по инициативе Заказчика не производится.`,
            ],
          },
          {
            h: '4. Персональные данные',
            p: [
              `4.1. Заказчик является владельцем базы персональных данных пациентов; Исполнитель обрабатывает их по поручению Заказчика исключительно для оказания услуг.`,
              `4.2. Исполнитель обеспечивает конфиденциальность, шифрование канала связи, ролевое разграничение доступа и журналирование действий.`,
              `4.3. Заказчик гарантирует наличие правовых оснований для обработки вносимых им персональных данных.`,
            ],
          },
          {
            h: '5. Уровень сервиса (SLA)',
            p: [
              `5.1. Целевая доступность Системы — не менее 99,5% времени в календарный месяц.`,
              `5.2. Плановые технические работы — не более 4 часов в месяц с предварительным уведомлением.`,
              `5.3. Резервное копирование — не реже одного раза в сутки, хранение копий — не менее 30 дней.`,
            ],
          },
          {
            h: '6. Ответственность',
            p: [
              `6.1. Совокупная ответственность Исполнителя ограничена суммой платежей за 3 месяца, предшествующих событию.`,
              `6.2. Исполнитель не отвечает за медицинские решения Заказчика и за достоверность внесённых им данных.`,
            ],
          },
          {
            h: '7. Заключительные положения',
            p: [
              `7.1. Отношения Сторон регулируются законодательством Республики Узбекистан.`,
              `7.2. Споры рассматриваются в экономическом суде по месту нахождения ответчика после соблюдения претензионного порядка (15 календарных дней).`,
              `7.3. По требованию Заказчика может быть заключён отдельный двусторонний договор в письменной форме.`,
            ],
          },
        ]
      : [
          {
            h: '1. Umumiy qoidalar',
            p: [
              `1.1. Ushbu hujjat ${esc(name)} (keyingi o‘rinlarda — Ijrochi) ning ommaviy ofertasi bo‘lib, «Clary Care» tibbiy axborot tizimiga kirish xizmatini ko‘rsatishning barcha muhim shartlarini o‘z ichiga oladi.`,
              `1.2. Tizimda ro‘yxatdan o‘tish, hisob-fakturani to‘lash yoki Tizimdan amalda foydalanishni boshlash oferta akseptasi hisoblanadi. Aksept lahzasidan shartnoma ushbu oferta shartlarida tuzilgan deb hisoblanadi.`,
              `1.3. Ofertaning amaldagi tahriri ${esc(s.offer_url || 'clary.uz/oferta')} manzilida joylashtiriladi va Ijrochi tomonidan kamida 30 kalendar kun oldin xabar berilgan holda o‘zgartirilishi mumkin.`,
            ],
          },
          {
            h: '2. Xizmatlar va tariflar',
            p: [
              `2.1. Ijrochi Tizimga SaaS modeli bo‘yicha, tanlangan tarif hajmida kirish imkonini beradi.`,
              `2.2. Tariflar Ijrochi saytida e’lon qilinadi. To‘langan davr uchun narx bir tomonlama o‘zgartirilmaydi.`,
              `2.3. Sinov (demo) davri bir marta beriladi va to‘lov majburiyatini keltirib chiqarmaydi.`,
            ],
          },
          {
            h: '3. To‘lov tartibi',
            p: [
              `3.1. To‘lov Ijrochi taqdim etgan hisob-faktura asosida hisobot davri uchun oldindan amalga oshiriladi.`,
              `3.2. 10 kalendar kundan ortiq kechikkanda kirish to‘xtatib turilishi mumkin; Buyurtmachining ma’lumotlari saqlanadi.`,
              `3.3. Buyurtmachi tashabbusi bilan bekor qilinganda foydalanilmagan davr uchun mablag‘ qaytarilmaydi.`,
            ],
          },
          {
            h: '4. Shaxsiy ma’lumotlar',
            p: [
              `4.1. Bemorlarning shaxsiy ma’lumotlari bazasi egasi Buyurtmachi hisoblanadi; Ijrochi ularga faqat xizmat ko‘rsatish uchun, Buyurtmachi topshirig‘i bo‘yicha ishlov beradi.`,
              `4.2. Ijrochi maxfiylikni, aloqa kanalini shifrlashni, rollar bo‘yicha kirishni chegaralashni va harakatlarni jurnallashni ta’minlaydi.`,
              `4.3. Buyurtmachi o‘zi kiritayotgan shaxsiy ma’lumotlarga ishlov berish uchun huquqiy asoslar mavjudligini kafolatlaydi.`,
            ],
          },
          {
            h: '5. Xizmat darajasi (SLA)',
            p: [
              `5.1. Tizimning maqsadli ishlash darajasi — kalendar oyda kamida 99,5% vaqt.`,
              `5.2. Rejali texnik ishlar — oyiga 4 soatdan ko‘p emas, oldindan xabar berilgan holda.`,
              `5.3. Zaxira nusxalash — kamida sutkasiga bir marta, nusxalarni saqlash — kamida 30 kun.`,
            ],
          },
          {
            h: '6. Javobgarlik',
            p: [
              `6.1. Ijrochining jami javobgarligi hodisadan oldingi 3 oylik to‘lovlar summasi bilan cheklanadi.`,
              `6.2. Ijrochi Buyurtmachining tibbiy qarorlari va u kiritgan ma’lumotlar haqqoniyligi uchun javobgar emas.`,
            ],
          },
          {
            h: '7. Yakuniy qoidalar',
            p: [
              `7.1. Tomonlar munosabatlari O‘zbekiston Respublikasi qonunchiligi bilan tartibga solinadi.`,
              `7.2. Nizolar da’vo tartibiga rioya qilingandan so‘ng (15 kalendar kun) javobgarning joylashgan yeri bo‘yicha iqtisodiy sudda ko‘riladi.`,
              `7.3. Buyurtmachi talabiga ko‘ra alohida ikki tomonlama yozma shartnoma tuzilishi mumkin.`,
            ],
          },
        ];

  const body = `
  ${letterhead(
    issuer,
    `
    <div class="eyebrow">${esc(L.offer)}</div>
    <h1 class="doc-title" style="margin-top:4px">${lang === 'ru' ? 'Редакция' : 'Tahrir'} ${esc(s.offer_version ?? '1.0')}</h1>
    <div class="kv" style="margin-top:10px">
      <div><b>${esc(L.issued)}</b> <span class="num">${fmtDate(new Date().toISOString(), lang)}</span></div>
    </div>`,
  )}

  <h1 class="doc-title" style="text-align:center;margin:20px 0 4px">
    ${lang === 'ru' ? 'ПУБЛИЧНАЯ ОФЕРТА' : 'OMMAVIY OFERTA'}
  </h1>
  <div style="text-align:center" class="footer-note">
    ${lang === 'ru' ? 'об оказании услуг доступа к системе Clary Care' : 'Clary Care tizimiga kirish xizmatini ko‘rsatish to‘g‘risida'}
  </div>
  <hr class="rule-thin" style="margin:12px 0 14px">

  ${sections
    .map(
      (sec) => `
      <section style="margin-top:14px;break-inside:avoid">
        <h2 style="font-size:12px;font-weight:700;margin:0 0 5px;letter-spacing:.03em">${esc(sec.h)}</h2>
        ${sec.p.map((t) => `<p style="margin:0 0 5px;text-align:justify">${t}</p>`).join('')}
      </section>`,
    )
    .join('')}

  <section style="margin-top:20px;break-inside:avoid">
    <h2 style="font-size:12px;font-weight:700;margin:0 0 6px;letter-spacing:.03em">
      ${lang === 'ru' ? '8. Реквизиты Исполнителя' : '8. Ijrochi rekvizitlari'}
    </h2>
    ${partyBlock(L.supplier!, issuer, L)}
  </section>

  <hr class="rule-thin" style="margin-top:22px">
  <div class="footer-note" style="margin-top:6px;text-align:center">${esc(L.footer)}</div>`;

  return shell(L.offer!, body, L.print!, L.close!);
}
