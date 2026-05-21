// =============================================================================
// Termal chek chop etish — 58mm / 80mm qog'oz.
//
// Eng ishonchli usul — yashirin IFRAME orqali print qilish.
// Pop-up bloklanmaydi, brauzer tab ochilmaydi, oppoq sahifa muammosi
// ham bo'lmaydi. Dialog so'ramaydi — darhol print qiladi.
// Sozlamalar (shrift, brand, QR) klinikadan keladi.
// =============================================================================

export type ReceiptWidth = '58mm' | '80mm';

// Klinika tomonidan sozlanadigan chek printer ko'rinishi.
export type ReceiptSettings = {
  paper_width: ReceiptWidth;
  font_family: 'monospace' | 'sans-serif' | 'serif';
  font_size: number; // 8 - 24
  font_weight: 'normal' | 'bold';
  brand_name: string | null;
  slogan: string | null;
  qr_text: string | null;
  qr_enabled: boolean;
  show_transaction_id: boolean;
  footer_note: string | null;
};

const DEFAULT_SETTINGS: ReceiptSettings = {
  paper_width: '80mm',
  font_family: 'monospace',
  font_size: 12,
  font_weight: 'normal',
  brand_name: null,
  slogan: null,
  qr_text: null,
  qr_enabled: false,
  show_transaction_id: false,
  footer_note: "Rahmat! Sog'ligingizga shifo tilaymiz!",
};

const WIDTH_KEY = 'clary_receipt_width';
const SETTINGS_KEY = 'clary_receipt_settings';

/** Klinika tanlagan qog'oz kengligini localStorage'dan o'qiydi (default 80mm). */
export function getReceiptWidth(): ReceiptWidth {
  const v = localStorage.getItem(WIDTH_KEY);
  return v === '58mm' ? '58mm' : '80mm';
}

/** Qog'oz kengligini saqlaydi — keyingi safar esda qoladi. */
export function setReceiptWidth(w: ReceiptWidth): void {
  localStorage.setItem(WIDTH_KEY, w);
}

/** Klinika sozlamalarini localStorage'ga keshlash (api'dan kelganda). */
export function setReceiptSettingsCache(s: Partial<ReceiptSettings>): void {
  const merged = { ...getReceiptSettings(), ...s };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  if (merged.paper_width) setReceiptWidth(merged.paper_width);
}

/** Hozirgi sozlamalarni qaytaradi (cache yoki default). */
export function getReceiptSettings(): ReceiptSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS, paper_width: getReceiptWidth() };
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));

/**
 * QR kod uchun SVG generator — Google Chart API ishlatadi
 * (eng oddiy, offline ishlamaydi, lekin print uchun yetadi).
 * Alternative: qrcode kutubxonasi (paket yuklash kerak).
 */
function qrImgTag(text: string, sizePx = 80): string {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${sizePx * 2}x${sizePx * 2}&data=${encodeURIComponent(text)}`;
  return `<img src="${esc(url)}" width="${sizePx}" height="${sizePx}" style="display:block;margin:6px auto" alt="QR" />`;
}

/**
 * Chekni alohida iframe'da chop etadi.
 * Hech qanday dialog ko'rsatmaydi — sozlamalar avtomatik qo'llanadi.
 */
export function printReceipt(
  bodyHtml: string,
  settingsOverride?: Partial<ReceiptSettings>,
): void {
  const settings = { ...getReceiptSettings(), ...settingsOverride };
  const width = settings.paper_width;
  const contentMm = width === '58mm' ? 48 : 72;
  const baseSize = settings.font_size || 12;

  const fontMap = {
    monospace: "'Courier New', 'Roboto Mono', monospace",
    'sans-serif': "'Inter', 'Helvetica Neue', Arial, sans-serif",
    serif: "'Times New Roman', Georgia, serif",
  };
  const fontFamily = fontMap[settings.font_family] ?? fontMap.monospace;

  const css = `
    @page { size: ${width} auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      width: ${contentMm}mm;
      padding: 3mm;
      font-family: ${fontFamily};
      font-size: ${baseSize}px;
      font-weight: ${settings.font_weight};
      line-height: 1.4;
      color: #000;
      background: #fff;
    }
    .center { text-align: center; }
    .big { font-size: ${baseSize + 14}px; font-weight: 900; }
    .bold { font-weight: 700; }
    .muted { color: #444; }
    .small { font-size: ${Math.max(8, baseSize - 2)}px; }
    .line { border-top: 1px dashed #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
    .row .label { color: #444; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 1px 0; vertical-align: top; }
    .r { text-align: right; }
    .brand { font-size: ${baseSize + 4}px; font-weight: 900; letter-spacing: 1px; }
    .slogan { font-style: italic; }
    @media print {
      body { padding: 2mm; }
      .no-print { display: none !important; }
    }
  `;

  // Brand sarlavhasi (klinika tanlasa)
  const brandHtml = settings.brand_name
    ? `<div class="center brand">${esc(settings.brand_name)}</div>`
    : '';
  const sloganHtml = settings.slogan
    ? `<div class="center muted slogan small">${esc(settings.slogan)}</div>`
    : '';
  const qrHtml =
    settings.qr_enabled && settings.qr_text
      ? `<div class="line"></div>${qrImgTag(settings.qr_text, width === '58mm' ? 70 : 90)}<div class="center small muted">${esc(settings.qr_text)}</div>`
      : '';
  const footerHtml = settings.footer_note
    ? `<div class="center muted small">${esc(settings.footer_note)}</div>`
    : '';

  const finalHtml = `${brandHtml}${sloganHtml}${bodyHtml}${qrHtml}${footerHtml}`;

  // Yashirin iframe — pop-up bloklanmaydi, hech qanday dialog yo'q.
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
        /* ignore */
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
      requestAnimationFrame(() => {
        // QR rasmni yuklash uchun biroz uzunroq kutamiz
        const delay = settings.qr_enabled ? 800 : 250;
        setTimeout(() => {
          try {
            win.focus();
            win.print();
          } catch (e) {
            console.error('Print xato:', e);
            alert("Chop etish xato berdi. Brauzeringizdan Ctrl+P bilan urinib ko'ring.");
          } finally {
            cleanup();
          }
        }, delay);
      });
    } catch (e) {
      console.error(e);
      cleanup();
    }
  };

  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    alert("Chop etish ramkasi yaratilmadi.");
    return;
  }

  iframe.onload = doPrint;
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>Chek</title><style>${css}</style></head><body>${finalHtml}</body></html>`,
  );
  doc.close();

  setTimeout(() => {
    if (iframe.parentNode) doPrint();
  }, 2000);
}

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
    <div class="center muted small">NAVBAT RAQAMI</div>
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
  const settings = getReceiptSettings();
  const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
  const itemRows = d.items
    .map(
      (it) =>
        `<tr><td>${esc(it.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}</td><td class="r">${fmt(it.amount)}</td></tr>`,
    )
    .join('');
  return `
    <div class="center bold">${esc(d.clinicName)}</div>
    <div class="center muted small">TO'LOV CHEKI</div>
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
    ${settings.show_transaction_id ? `<div class="line"></div><div class="center muted small">№ ${esc(d.transactionId)}</div>` : ''}
  `;
}
