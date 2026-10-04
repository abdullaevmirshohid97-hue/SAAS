// =============================================================================
// Dorixona cheklari: sotuv (termal / A4), Z-hisobot, narx yorliqlari
// =============================================================================
// Termal chek LAN/desktop printerga silent ketadi (printReceiptHybrid),
// bo'lmasa brauzer oynasi. Fiskal chek yuborilgan bo'lsa — fiskal belgisi va
// QR; aks holda Clary ichki QR (PHS:<id>) — qaytarishda skanerlash uchun.
// =============================================================================

import type { PharmacySaleDetail, PharmacyShift, PharmacyShiftTotals } from '@clary/api-client';
import { CLARY_SALE_QR_PREFIX, formatStock, unitLabel, type UnitKind } from '@clary/utils';

import {
  BARCODE_STICKER_SIZE,
  PRICE_TAG_SIZE,
  barcodeStickerHtml,
  priceTagHtml,
  printLabelBatch,
  qrSvg,
} from '@/lib/labels';
import {
  getPharmacyReceiptSettings,
  printA4Document,
  printReceipt,
  printReceiptHybrid,
  transactionReceiptA4Html,
} from '@/lib/print-receipt';

export const fmtUzs = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('uz-UZ');

export const PAY_LABEL: Record<string, string> = {
  cash: 'Naqd',
  card: 'Plastik',
  humo: 'Humo',
  uzcard: 'UzCard',
  click: 'Click',
  payme: 'Payme',
  uzum: 'Uzum',
  transfer: "O'tkazma",
  debt: 'Qarz',
  mixed: 'Aralash',
  insurance: "Sug'urta",
};

export type ReceiptMode = 'ask' | 'thermal' | 'a4' | 'none';
export const RECEIPT_MODE_KEY = 'clary.pharmacy.receiptMode';
export const RECEIPT_MODE_LABELS: Record<ReceiptMode, string> = {
  ask: 'Har safar so‘rash',
  thermal: 'Termal chek',
  a4: 'A4 chek',
  none: 'Chek chiqarmaslik',
};

export function readReceiptMode(): ReceiptMode {
  try {
    const v = localStorage.getItem(RECEIPT_MODE_KEY);
    return v === 'thermal' || v === 'a4' || v === 'none' ? v : 'ask';
  } catch {
    return 'ask';
  }
}

export function saveReceiptMode(m: ReceiptMode) {
  try {
    if (m === 'ask') localStorage.removeItem(RECEIPT_MODE_KEY);
    else localStorage.setItem(RECEIPT_MODE_KEY, m);
  } catch {
    /* ignore */
  }
}

/** Sotuv qatorlarini dori+birlik bo'yicha guruhlaydi (FEFO bo'lgan partiyalar birlashadi). */
export function groupSaleItems(sale: Pick<PharmacySaleDetail, 'items'>) {
  const map = new Map<
    string,
    {
      name: string;
      kind: UnitKind;
      qty: number;
      unitPrice: number;
      amount: number;
      returned: number;
      factor: number;
    }
  >();
  for (const it of sale.items ?? []) {
    const kind = (it.unit_kind ?? 'unit') as UnitKind;
    const factor = Math.max(1, it.unit_factor ?? 1);
    const key = `${it.medication_id}:${kind}`;
    const g = map.get(key) ?? {
      name: it.name_snapshot,
      kind,
      qty: 0,
      unitPrice: it.unit_price_uzs ?? it.price_snapshot * factor,
      amount: 0,
      returned: 0,
      factor,
    };
    g.qty += it.quantity / factor;
    g.returned += it.returned_qty / factor;
    g.amount += it.subtotal_uzs;
    map.set(key, g);
  }
  return [...map.values()].map((g) => ({
    ...g,
    qty: Math.round(g.qty * 1000) / 1000,
    returned: Math.round(g.returned * 1000) / 1000,
    label: g.kind === 'unit' && g.factor === 1 ? '' : unitLabel(g.kind),
  }));
}

function saleQrValue(sale: PharmacySaleDetail): { value: string; fiscal: boolean } {
  const f = sale.fiscal ?? sale.fiscal_receipts?.find((r) => r.kind === 'sale') ?? null;
  if (f && f.status === 'sent' && f.qr_url) return { value: f.qr_url, fiscal: true };
  return { value: `${CLARY_SALE_QR_PREFIX}${sale.id}`, fiscal: false };
}

function fiscalLines(sale: PharmacySaleDetail): string[] {
  const f = sale.fiscal ?? sale.fiscal_receipts?.find((r) => r.kind === 'sale') ?? null;
  if (!f) return [];
  if (f.status === 'sent') {
    const out = [
      f.is_test ? 'TEST REJIM — fiskal chek EMAS' : 'FISKAL CHEK',
      `FM/Terminal: ${f.terminal_id ?? '—'}`,
      `Chek №: ${f.fiscal_number ?? '—'}`,
      `Fiskal belgi: ${f.fiscal_sign ?? '—'}`,
    ];
    return out;
  }
  return ['Fiskal chek: navbatda (keyin qayta chop eting)'];
}

function paymentLines(sale: PharmacySaleDetail): string[] {
  const out: string[] = [];
  const legs = sale.payments ?? [];
  if (legs.length > 1) {
    for (const l of legs) out.push(`${PAY_LABEL[l.method] ?? l.method}: ${fmtUzs(l.amount_uzs)}`);
  } else {
    out.push(`To'lov: ${PAY_LABEL[legs[0]?.method ?? sale.payment_method] ?? sale.payment_method}`);
  }
  if (sale.received_cash_uzs != null && sale.received_cash_uzs > 0) {
    out.push(`Berildi: ${fmtUzs(sale.received_cash_uzs)}`);
    out.push(`Qaytim: ${fmtUzs(sale.change_uzs ?? 0)}`);
  }
  return out;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Termal chek (silent → brauzer). */
export async function printSaleThermal(
  sale: PharmacySaleDetail,
  clinicName: string,
  opts: { copy?: boolean } = {},
) {
  const groups = groupSaleItems(sale);
  const date = new Date(sale.created_at).toLocaleString('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const qr = saleQrValue(sale);
  const head = [
    `Sana: ${date}`,
    ...(sale.cashier_name ? [`Kassir: ${sale.cashier_name}`] : []),
    ...(sale.register_no ? [`Kassa: ${sale.register_no}`] : []),
    ...(sale.clinic_name ? [`Mijoz: ${sale.clinic_name}`] : []),
  ];
  const tail = [...paymentLines(sale), ...fiscalLines(sale)];
  const title = opts.copy ? 'DORIXONA CHEKI (nusxa)' : 'DORIXONA CHEKI';

  const rowsHtml = groups
    .map(
      (g) =>
        `<tr><td>${esc(g.name)}<br/><span class="muted small">${g.qty}${g.label ? ' ' + esc(g.label) : ''} × ${fmtUzs(g.unitPrice)}</span></td><td class="r">${fmtUzs(g.amount)}</td></tr>`,
    )
    .join('');
  const fallbackHtml = `
    <div class="center bold">${esc(clinicName)}</div>
    <div class="center muted small">${esc(title)}</div>
    <div class="line"></div>
    ${head.map((l) => `<div class="small">${esc(l)}</div>`).join('')}
    <div class="line"></div>
    <table>${rowsHtml}</table>
    <div class="line"></div>
    ${sale.discount_uzs > 0 ? `<div class="row"><span class="label">Chegirma:</span><span>${fmtUzs(sale.discount_uzs)}</span></div>` : ''}
    <div class="row bold"><span>JAMI:</span><span>${fmtUzs(sale.total_uzs)} so'm</span></div>
    ${sale.debt_uzs > 0 ? `<div class="row"><span class="label">Qarz:</span><span>${fmtUzs(sale.debt_uzs)}</span></div>` : ''}
    ${tail.map((l) => `<div class="small">${esc(l)}</div>`).join('')}
    <div class="line"></div>
    <div class="center">${qrSvg(qr.value, 96)}</div>
    <div class="center muted small">${qr.fiscal ? 'Chekni tekshirish uchun skanerlang' : 'Qaytarish uchun chekni saqlang'}</div>
    <div class="center muted small">Rahmat! Sog'lik tilaymiz!</div>
  `;
  await printReceiptHybrid(
    {
      header: clinicName,
      title,
      lines: head.map((text) => ({ text })),
      items: groups.map((g) => ({
        name: `${g.name} (${g.qty}${g.label ? ' ' + g.label : ''} × ${fmtUzs(g.unitPrice)})`,
        qty: 1,
        amount: g.amount,
      })),
      total_uzs: sale.total_uzs,
      paid_uzs: sale.paid_uzs,
      debt_uzs: sale.debt_uzs > 0 ? sale.debt_uzs : undefined,
      footer: [...tail, "Rahmat! Sog'lik tilaymiz!"].join('\n'),
      qr: qr.value,
      cut: true,
    },
    fallbackHtml,
    'receipt',
    getPharmacyReceiptSettings(),
  );
}

export function printSaleA4(sale: PharmacySaleDetail, clinicName: string) {
  const groups = groupSaleItems(sale);
  const qr = saleQrValue(sale);
  const fiscal = fiscalLines(sale);
  printA4Document(
    transactionReceiptA4Html({
      clinicName,
      date: new Date(sale.created_at).toLocaleString('uz-UZ'),
      patientName: sale.patient?.full_name ?? sale.clinic_name ?? 'Dorixona mijozi',
      patientPhone: sale.patient?.phone ?? null,
      doctorName: sale.doctor_name,
      cashierName: sale.cashier_name,
      paymentMethod: PAY_LABEL[sale.payment_method] ?? sale.payment_method,
      transactionId: sale.id,
      items: groups.map((g) => ({
        name: `${g.name}${g.label ? ` (${g.label})` : ''}`,
        qty: g.qty,
        unitPrice: g.unitPrice,
        discount: 0,
        amount: g.amount,
      })),
      totalUzs: sale.total_uzs,
      paidUzs: sale.paid_uzs,
      debtUzs: sale.debt_uzs,
      qrHtml:
        `<div style="margin-top:12px;display:flex;gap:12px;align-items:center">${qrSvg(qr.value, 90)}` +
        `<div class="small muted">${fiscal.map(esc).join('<br/>')}</div></div>`,
    }),
    'Dorixona cheki',
  );
}

export async function printSale(
  sale: PharmacySaleDetail,
  mode: Exclude<ReceiptMode, 'ask'>,
  clinicName: string,
  opts: { copy?: boolean } = {},
) {
  if (mode === 'none') return;
  if (mode === 'a4') return printSaleA4(sale, clinicName);
  return printSaleThermal(sale, clinicName, opts);
}

/** Z (yoki X) hisobot — termal. */
export function printShiftReport(
  totals: PharmacyShiftTotals,
  shift: Pick<
    PharmacyShift,
    'register_no' | 'opened_at' | 'closed_at' | 'z_no' | 'opened_by_name' | 'closed_by_name'
  >,
  clinicName: string,
) {
  const isZ = !!shift.closed_at;
  const lines: string[] = [
    `${isZ ? `Z-HISOBOT № ${shift.z_no ?? '—'}` : 'X-HISOBOT (oraliq)'} · Kassa ${shift.register_no}`,
    `Ochildi: ${new Date(shift.opened_at).toLocaleString('uz-UZ')}${shift.opened_by_name ? ` (${shift.opened_by_name})` : ''}`,
    ...(shift.closed_at
      ? [
          `Yopildi: ${new Date(shift.closed_at).toLocaleString('uz-UZ')}${shift.closed_by_name ? ` (${shift.closed_by_name})` : ''}`,
        ]
      : []),
    `Sotuvlar: ${totals.sales_count} ta (bekor: ${totals.void_count})`,
    `Yalpi savdo: ${fmtUzs(totals.gross_uzs)}`,
    `Chegirma: ${fmtUzs(totals.discount_uzs)}`,
    ...Object.entries(totals.by_method ?? {}).map(([m, v]) => `${PAY_LABEL[m] ?? m}: ${fmtUzs(v)}`),
    `Qarzga: ${fmtUzs(totals.debt_uzs)}`,
    `Qaytarishlar: ${fmtUzs(totals.refunds_uzs)} (${totals.returns_count} ta)`,
    ...Object.entries(totals.movements ?? {})
      .filter(([k]) => k !== 'refund')
      .map(([k, v]) => `${MOVE_LABEL[k] ?? k}: ${fmtUzs(v)}`),
    `Boshlang'ich naqd: ${fmtUzs(totals.opening_cash_uzs)}`,
    `KUTILGAN NAQD: ${fmtUzs(totals.expected_cash_uzs)}`,
    ...(totals.actual_cash_uzs != null
      ? [
          `Sanalgan naqd: ${fmtUzs(totals.actual_cash_uzs)}`,
          `Farq: ${fmtUzs(totals.diff_uzs ?? 0)}`,
        ]
      : []),
  ];
  const html =
    `<div class="center bold">${esc(clinicName)}</div><div class="line"></div>` +
    lines.map((l) => `<div class="small">${esc(l)}</div>`).join('');
  void printReceiptHybrid(
    {
      header: clinicName,
      title: isZ ? 'Z-HISOBOT' : 'X-HISOBOT',
      lines: lines.map((text) => ({ text })),
      cut: true,
    },
    html,
    'other',
    getPharmacyReceiptSettings(),
  );
}

export const MOVE_LABEL: Record<string, string> = {
  supplier_payment: "Firmaga to'lov",
  expense: 'Rasxod',
  encashment: 'Inkassatsiya',
  debt_collection: 'Qarz undirildi',
  cash_in: 'Kassaga kirim',
  cash_out: 'Kassadan chiqim',
  refund: 'Qaytarish',
};

/** Narx yorliqlari (javon uchun) — bir nechta dori bir ishda. */
export async function printPriceTags(
  items: Array<{
    name: string;
    strength?: string | null;
    price: number;
    unitText?: string | null;
    barcode?: string | null;
  }>,
  clinicName: string,
) {
  await printLabelBatch(
    items.map((it) =>
      priceTagHtml({
        name: it.name,
        strength: it.strength,
        priceText: `${fmtUzs(it.price)} so'm`,
        unitText: it.unitText,
        barcodeValue: it.barcode || null,
        clinicName,
      }),
    ),
    PRICE_TAG_SIZE,
  );
}

export async function printBarcodeStickers(
  items: Array<{ name: string; code: string; copies?: number }>,
) {
  const bodies: string[] = [];
  for (const it of items) {
    for (let i = 0; i < Math.max(1, it.copies ?? 1); i++) bodies.push(barcodeStickerHtml(it));
  }
  await printLabelBatch(bodies, BARCODE_STICKER_SIZE);
}

/** Brauzer chek oynasi (silent printer yo'q holatlar uchun test). */
export function printPlainReceipt(html: string) {
  printReceipt(html, getPharmacyReceiptSettings());
}

export { formatStock };
