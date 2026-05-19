// =============================================================================
// Termal chek chop etish — 58mm / 80mm qog'oz.
//
// Muammo: window.print() Radix Dialog ichidan chaqirilganda print CSS
// hammasini yashiradi → oppoq sahifa. Yechim: alohida window.open() oynaga
// o'z ichiga to'liq HTML yoziladi, @page bilan qog'oz kengligi beriladi,
// va print() KONTENT YUKLANGACH chaqiriladi (onload + setTimeout).
// =============================================================================

export type ReceiptWidth = '58mm' | '80mm';

const WIDTH_KEY = 'clary_receipt_width';

/** Klinika tanlagan qog'oz kengligini localStorage'dan o'qiydi (default 80mm). */
export function getReceiptWidth(): ReceiptWidth {
  const v = localStorage.getItem(WIDTH_KEY);
  return v === '58mm' ? '58mm' : '80mm';
}

/** Qog'oz kengligini saqlaydi — keyingi safar esda qoladi. */
export function setReceiptWidth(w: ReceiptWidth): void {
  localStorage.setItem(WIDTH_KEY, w);
}

/**
 * Chekni alohida oynada chop etadi.
 * @param bodyHtml — chek tanasi (faqat ichki HTML, <body> kerakmas).
 * @param width — '58mm' yoki '80mm'.
 */
export function printReceipt(bodyHtml: string, width: ReceiptWidth = getReceiptWidth()): void {
  // Kontent kengligi — qog'oz chetidagi bo'sh joyni hisobga olib.
  const contentMm = width === '58mm' ? 48 : 72;
  const fontSize = width === '58mm' ? 11 : 12;

  const win = window.open('', '_blank', 'width=380,height=600');
  if (!win) {
    // Pop-up bloklangan bo'lsa — foydalanuvchini ogohlantirish.
    alert('Chek oynasi ochilmadi. Brauzer pop-up blokini o‘chiring.');
    return;
  }

  win.document.write(`<!doctype html><html><head><meta charset="utf-8">
<title>Chek</title>
<style>
  @page { size: ${width} auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${contentMm}mm;
    padding: 3mm;
    font-family: 'Courier New', monospace;
    font-size: ${fontSize}px;
    line-height: 1.4;
    color: #000;
    background: #fff;
  }
  .center { text-align: center; }
  .big { font-size: ${fontSize + 14}px; font-weight: 900; }
  .bold { font-weight: 700; }
  .muted { color: #444; }
  .line { border-top: 1px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
  .row .label { color: #444; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 0; vertical-align: top; }
  .r { text-align: right; }
</style></head><body>${bodyHtml}</body></html>`);
  win.document.close();
  win.focus();

  // Kontent yuklangach chop etish — oppoq sahifa muammosini hal qiladi.
  const doPrint = () => {
    win.print();
    // Ba'zi brauzerlar print'dan keyin oynani ochiq qoldiradi.
    setTimeout(() => win.close(), 400);
  };
  if (win.document.readyState === 'complete') {
    setTimeout(doPrint, 200);
  } else {
    win.onload = () => setTimeout(doPrint, 200);
    // onload ishlamay qolsa — zaxira.
    setTimeout(doPrint, 600);
  }
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));

/** Navbat cheki HTML — navbat oynasi uchun. */
export function queueTicketHtml(d: {
  clinicName: string;
  ticketNo: string;
  date: string;
  time: string;
  patientName: string;
  doctorName: string;
  doctorRole: string;
  serviceName?: string;
}): string {
  return `
    <div class="center bold">${esc(d.clinicName)}</div>
    <div class="line"></div>
    <div class="center big">${esc(d.ticketNo)}</div>
    <div class="center muted" style="font-size:10px">NAVBAT RAQAMI</div>
    <div class="line"></div>
    <div class="row"><span class="label">Sana:</span><span>${esc(d.date)}</span></div>
    <div class="row"><span class="label">Vaqt:</span><span>${esc(d.time)}</span></div>
    <div class="line"></div>
    <div class="row"><span class="label">Bemor:</span><span>${esc(d.patientName || '—')}</span></div>
    <div class="line"></div>
    <div class="row"><span class="label">Shifokor:</span><span>${esc(d.doctorName)}</span></div>
    <div class="row"><span class="label">Soha:</span><span>${esc(d.doctorRole)}</span></div>
    ${d.serviceName && d.serviceName !== '—' ? `<div class="row"><span class="label">Xizmat:</span><span>${esc(d.serviceName)}</span></div>` : ''}
    <div class="line"></div>
    <div class="center muted" style="font-size:10px">Sog'ligingizga shifo tilaymiz!</div>
  `;
}

/** To'lov cheki HTML — qabulxona checkout uchun. */
export function paymentReceiptHtml(d: {
  clinicName: string;
  ticketNo: string | null;
  date: string;
  patientName: string;
  items: Array<{ name: string; qty: number; amount: number }>;
  totalUzs: number;
  paidUzs: number;
  debtUzs: number;
  paymentMethod: string;
  transactionId: string;
}): string {
  const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
  const itemRows = d.items
    .map(
      (it) =>
        `<tr><td>${esc(it.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}</td><td class="r">${fmt(it.amount)}</td></tr>`,
    )
    .join('');
  return `
    <div class="center bold">${esc(d.clinicName)}</div>
    <div class="center muted" style="font-size:10px">TO'LOV CHEKI</div>
    <div class="line"></div>
    <div class="row"><span class="label">Sana:</span><span>${esc(d.date)}</span></div>
    <div class="row"><span class="label">Bemor:</span><span>${esc(d.patientName || '—')}</span></div>
    ${d.ticketNo ? `<div class="row"><span class="label">Navbat:</span><span class="bold">${esc(d.ticketNo)}</span></div>` : ''}
    <div class="line"></div>
    <table>${itemRows}</table>
    <div class="line"></div>
    <div class="row bold"><span>JAMI:</span><span>${fmt(d.totalUzs)} so'm</span></div>
    <div class="row"><span class="label">To'landi:</span><span>${fmt(d.paidUzs)} so'm</span></div>
    ${d.debtUzs > 0 ? `<div class="row"><span class="label">Qarz:</span><span>${fmt(d.debtUzs)} so'm</span></div>` : ''}
    <div class="row"><span class="label">To'lov usuli:</span><span>${esc(d.paymentMethod)}</span></div>
    <div class="line"></div>
    <div class="center muted" style="font-size:9px">№ ${esc(d.transactionId)}</div>
    <div class="center muted" style="font-size:10px">Rahmat! Sog'ligingizga shifo tilaymiz!</div>
  `;
}
