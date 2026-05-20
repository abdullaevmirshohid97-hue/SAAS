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

  const css = `
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
    @media print {
      body { padding: 2mm; }
      .no-print { display: none !important; }
    }
  `;

  // Eng ishonchli usul — yashirin IFRAME orqali print qilish.
  // Pop-up bloklanmaydi, brauzer tab ochilmaydi, oppoq sahifa muammosi ham
  // bo'lmaydi. iframe ichida onload kafolatlangan ishga tushadi.
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {
        /* allaqachon olib tashlangan */
      }
    }, 1000);
  };

  const doPrint = () => {
    try {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        return;
      }
      // Hech bo'lmaganda 1 frame chizilishini kutamiz — wkitchen sahifani
      // render qilib bo'lguncha vaqt beradi (oppoq sahifaning oldini oladi).
      requestAnimationFrame(() => {
        setTimeout(() => {
          try {
            win.focus();
            win.print();
          } catch (e) {
            console.error('Print xato:', e);
            alert('Chop etish xato berdi. Brauzeringizdan Ctrl+P bilan urinib ko\'ring.');
          } finally {
            cleanup();
          }
        }, 250);
      });
    } catch (e) {
      console.error(e);
      cleanup();
    }
  };

  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    alert('Chop etish ramkasi yaratilmadi.');
    return;
  }

  // iframe ichidagi onload — barcha brauzerlarda ishonchli.
  iframe.onload = doPrint;

  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>Chek</title><style>${css}</style></head><body>${bodyHtml}</body></html>`,
  );
  doc.close();

  // Zaxira — agar onload negadir ishga tushmasa (kam uchraydi).
  setTimeout(() => {
    if (iframe.parentNode) doPrint();
  }, 1500);
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
