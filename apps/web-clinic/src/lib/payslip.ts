// Maosh varaqasi (payslip) — 3 format:
//  - A4: jsPDF orqali to'g'ridan-to'g'ri PDF download (print dialog ochilmaydi)
//  - Thermal 80mm: yangi window + window.print() chek printer uchun
//  - Thermal 58mm: yangi window + window.print() kichik chek printer

import {
  FONT_FAMILY_CSS,
  FONT_WEIGHT_LABELS,
  getPayslipSettings,
  type PayslipSettings,
  type PayslipWidth,
} from './payslip-settings';

export type { PayslipWidth } from './payslip-settings';

export type PayslipData = {
  clinic_name: string;
  clinic_address?: string;
  clinic_phone?: string;
  employee_name: string;
  employee_position?: string;
  period_from: string;
  period_to: string;
  commissions_uzs: number;
  monthly_base_uzs: number;
  bonuses_uzs: number;
  advances_uzs: number;
  penalties_uzs: number;
  gross_uzs: number;
  deductions_uzs: number;
  net_uzs: number;
  generated_at: string;
};

// Backward-compat: 'a4' va 'thermal80' eski API
export type PayslipFormat = PayslipWidth | 'a4' | 'thermal80';

const fmt = (n: number) => n.toLocaleString('uz-UZ');

export async function printPayslip(
  data: PayslipData,
  format: PayslipFormat = 'a4',
): Promise<void> {
  // Eski format nomlari mapping
  const width: PayslipWidth =
    format === 'thermal80' ? '80mm' : format === 'a4' ? 'a4' : format;

  const settings = getPayslipSettings();

  if (width === 'a4') {
    await downloadA4Pdf(data, settings);
    return;
  }
  // 58mm yoki 80mm — yangi window + print
  openThermalWindow(data, settings, width);
}

// =============================================================================
// A4 — jsPDF orqali to'g'ridan-to'g'ri PDF download (print dialog ochilmaydi)
// =============================================================================
async function downloadA4Pdf(data: PayslipData, settings: PayslipSettings): Promise<void> {
  // jspdf va html2canvas dynamic import — bundle ni katta qilmaslik uchun
  const [{ jsPDF }, html2canvas] = await Promise.all([
    import('jspdf'),
    import('html2canvas').then((m) => m.default),
  ]);

  // Avval HTML'ni hidden div'da render qilamiz
  const html = a4PayslipHtml(data, settings, false); // false = print button yo'q
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '-99999px';
  container.style.left = '0';
  container.style.width = '210mm';
  container.style.background = '#fff';
  container.innerHTML = html;
  document.body.appendChild(container);

  // Sheet'ni topib canvas qilamiz
  const sheet = container.querySelector('.sheet') as HTMLElement | null;
  const target = sheet ?? container;

  try {
    const canvas = await html2canvas(target, {
      scale: 2, // yuqori sifat
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = 210;
    const pageHeight = 297;
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    // Agar bitta sahifaga sig'sa
    if (imgHeight <= pageHeight) {
      pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
    } else {
      // Ko'p sahifaga bo'lib chiqaramiz
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
    }

    const fileName = `payslip-${slug(data.employee_name)}-${data.period_from}.pdf`;
    pdf.save(fileName);
  } finally {
    document.body.removeChild(container);
  }
}

// =============================================================================
// Thermal — yangi window + auto print
// =============================================================================
function openThermalWindow(
  data: PayslipData,
  settings: PayslipSettings,
  width: '58mm' | '80mm',
): void {
  const w = window.open('', '_blank', 'width=400,height=900');
  if (!w) {
    alert("Brauzer popup'ni bloklab qo'ydi. Iltimos, popup'larga ruxsat bering.");
    return;
  }
  const html = thermalPayslipHtml(data, settings, width);
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = () => {
    setTimeout(() => {
      w.focus();
      w.print();
    }, 200);
  };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/giu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// =============================================================================
// A4 HTML — rasmiy hujjat (modern dizayn)
// =============================================================================
export function a4PayslipHtml(
  d: PayslipData,
  settings: PayslipSettings = getPayslipSettings(),
  withPrintButton = true,
): string {
  const periodLabel = `${d.period_from} — ${d.period_to}`;
  const gen = new Date(d.generated_at).toLocaleString('uz-UZ');
  const S = settings.sections;
  const fontFamilyCss = FONT_FAMILY_CSS[settings.font_family];
  const fontWeightCss = FONT_WEIGHT_LABELS[settings.font_weight].css;
  const fontStyleCss = settings.font_style;

  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(settings.title)} — ${escapeHtml(d.employee_name)}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #f3f4f6; }
    body {
      font-family: ${fontFamilyCss};
      font-weight: ${fontWeightCss};
      font-style: ${fontStyleCss};
      color: #0f172a;
      font-size: 13px;
      line-height: 1.55;
      padding: 20px;
    }
    .sheet {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      background: #fff;
      padding: 18mm 16mm;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
      position: relative;
    }
    .header {
      background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%);
      color: #fff;
      margin: -18mm -16mm 24px -16mm;
      padding: 22mm 16mm 18mm 16mm;
      position: relative;
      overflow: hidden;
    }
    .header::before {
      content: '';
      position: absolute;
      top: -50%; right: -10%;
      width: 60%; height: 200%;
      background: rgba(255,255,255,0.06);
      transform: rotate(15deg);
    }
    .header-row { display: flex; justify-content: space-between; align-items: flex-start; position: relative; z-index: 1; }
    .clinic-name { font-size: 22px; font-weight: 700; letter-spacing: 0.3px; margin-bottom: 4px; }
    .clinic-meta { font-size: 11px; opacity: 0.9; }
    .doc-badge {
      background: rgba(255,255,255,0.18);
      border: 1px solid rgba(255,255,255,0.3);
      padding: 8px 14px;
      border-radius: 8px;
      text-align: right;
    }
    .doc-badge .label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.85; }
    .doc-badge .num { font-size: 14px; font-weight: 700; margin-top: 2px; }
    h1 { font-size: 24px; text-align: center; margin: 0 0 24px 0; font-weight: 700; letter-spacing: 0.5px; }
    h1::after { content: ''; display: block; width: 60px; height: 3px; background: linear-gradient(90deg, #0ea5e9, #2563eb); margin: 8px auto 0; border-radius: 2px; }
    .employee {
      background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
      border: 1px solid #bae6fd;
      padding: 18px 22px;
      border-radius: 10px;
      margin-bottom: 24px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .employee .field { display: flex; flex-direction: column; gap: 2px; }
    .employee .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: #0c4a6e; opacity: 0.7; }
    .employee .value { font-size: 14px; font-weight: 600; color: #0c4a6e; }
    .section { margin-bottom: 18px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
    .section-title {
      background: #f8fafc; padding: 10px 16px;
      font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.8px;
      color: #64748b;
      border-bottom: 1px solid #e2e8f0;
      display: flex; align-items: center; gap: 8px;
    }
    .section-title .dot { width: 8px; height: 8px; border-radius: 50%; }
    .section-title.gross .dot { background: #10b981; }
    .section-title.deduct .dot { background: #ef4444; }
    .row { display: flex; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid #f1f5f9; }
    .row:last-child { border-bottom: none; }
    .row .name { color: #475569; }
    .row .amount { font-family: 'JetBrains Mono', ui-monospace, monospace; font-weight: 600; font-variant-numeric: tabular-nums; }
    .row.subtotal { background: #f8fafc; font-weight: 700; }
    .row.subtotal .name { color: #0f172a; }
    .net-block {
      margin-top: 20px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: #fff; padding: 22px 26px; border-radius: 12px;
      display: flex; justify-content: space-between; align-items: center;
      box-shadow: 0 8px 20px rgba(16, 185, 129, 0.25);
    }
    .net-block .label { font-size: 13px; text-transform: uppercase; letter-spacing: 1.2px; opacity: 0.95; }
    .net-block .value { font-size: 28px; font-weight: 800; font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: -0.5px; }
    .net-block.negative { background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); }
    .signatures { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
    .signature { border-top: 1.5px solid #0f172a; padding-top: 8px; font-size: 11px; color: #64748b; text-align: center; }
    .signature strong { color: #0f172a; display: block; font-size: 12px; }
    .footer { margin-top: 30px; padding-top: 14px; border-top: 1px dashed #cbd5e1; font-size: 10px; color: #94a3b8; text-align: center; letter-spacing: 0.3px; }
    .footer .brand { font-weight: 600; color: #64748b; }
    @media print {
      .no-print { display: none !important; }
      body { background: #fff; padding: 0; }
      .sheet { box-shadow: none; margin: 0; }
    }
    .print-btn { position: fixed; top: 20px; right: 20px; background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 12px 22px; cursor: pointer; font-size: 14px; font-weight: 600; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4); }
  </style>
</head>
<body>
  ${withPrintButton ? `<button class="print-btn no-print" onclick="window.print()">🖨️ Chop etish / PDF saqlash</button>` : ''}

  <div class="sheet">
    ${S.clinic_header ? `
    <div class="header">
      <div class="header-row">
        <div>
          <div class="clinic-name">${escapeHtml(d.clinic_name)}</div>
          <div class="clinic-meta">
            ${d.clinic_address ? escapeHtml(d.clinic_address) + ' • ' : ''}
            ${d.clinic_phone ? escapeHtml(d.clinic_phone) : ''}
          </div>
        </div>
        ${S.doc_badge ? `
        <div class="doc-badge">
          <div class="label">Hujjat</div>
          <div class="num">${shortRef(d)}</div>
        </div>` : ''}
      </div>
    </div>` : ''}

    <h1>${escapeHtml(settings.title)}</h1>

    <div class="employee">
      <div class="field"><span class="label">Xodim F.I.O.</span><span class="value">${escapeHtml(d.employee_name)}</span></div>
      <div class="field"><span class="label">Hisobot davri</span><span class="value">${escapeHtml(periodLabel)}</span></div>
      ${S.employee_position && d.employee_position ? `<div class="field"><span class="label">Lavozim</span><span class="value">${escapeHtml(d.employee_position)}</span></div>` : ''}
      ${S.generated_at ? `<div class="field"><span class="label">Hujjat sanasi</span><span class="value">${escapeHtml(gen)}</span></div>` : ''}
    </div>

    <div class="section">
      <div class="section-title gross"><span class="dot"></span>Daromad (Gross)</div>
      ${S.commissions ? `<div class="row"><span class="name">Komissiya (foiz asosida)</span><span class="amount">${fmt(d.commissions_uzs)} so'm</span></div>` : ''}
      ${S.monthly_base ? `<div class="row"><span class="name">Oylik fix maosh</span><span class="amount">${fmt(d.monthly_base_uzs)} so'm</span></div>` : ''}
      ${S.bonuses ? `<div class="row"><span class="name">Bonus</span><span class="amount">+${fmt(d.bonuses_uzs)} so'm</span></div>` : ''}
      ${S.gross_total ? `<div class="row subtotal"><span class="name">Jami gross</span><span class="amount">${fmt(d.gross_uzs)} so'm</span></div>` : ''}
    </div>

    <div class="section">
      <div class="section-title deduct"><span class="dot"></span>Ushlanmalar (Deductions)</div>
      ${S.advances ? `<div class="row"><span class="name">Avans</span><span class="amount">−${fmt(d.advances_uzs)} so'm</span></div>` : ''}
      ${S.penalties ? `<div class="row"><span class="name">Jarima</span><span class="amount">−${fmt(d.penalties_uzs)} so'm</span></div>` : ''}
      ${S.deductions_total ? `<div class="row subtotal"><span class="name">Jami ushlanma</span><span class="amount">−${fmt(d.deductions_uzs)} so'm</span></div>` : ''}
    </div>

    ${S.net_block ? `
    <div class="net-block ${d.net_uzs < 0 ? 'negative' : ''}">
      <div class="label">Sof maosh (NET)</div>
      <div class="value">${fmt(d.net_uzs)} so'm</div>
    </div>` : ''}

    ${S.signatures ? `
    <div class="signatures">
      <div class="signature"><strong>Hisobchi</strong>(imzo va sana)</div>
      <div class="signature"><strong>Xodim</strong>(imzo va sana)</div>
    </div>` : ''}

    ${S.footer ? `<div class="footer"><span class="brand">${escapeHtml(settings.footer_note)}</span></div>` : ''}
  </div>
</body>
</html>`;
}

// =============================================================================
// Thermal — 58mm yoki 80mm (monospace chek dizayni)
// =============================================================================
export function thermalPayslipHtml(
  d: PayslipData,
  settings: PayslipSettings = getPayslipSettings(),
  width: '58mm' | '80mm' = '80mm',
): string {
  const periodLabel = `${d.period_from} — ${d.period_to}`;
  const gen = new Date(d.generated_at).toLocaleString('uz-UZ', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const S = settings.sections;

  // 58mm: 48mm content (kichik), 80mm: 72mm content
  // 58mm uchun font kichikroq (10px), 80mm uchun (12px)
  const isNarrow = width === '58mm';
  const contentWidth = isNarrow ? '48mm' : '72mm';
  const baseFont = isNarrow ? Math.max(9, settings.thermal_font_size - 2) : settings.thermal_font_size;
  const bigFont = isNarrow ? baseFont + 3 : baseFont + 4;
  const netFont = isNarrow ? baseFont + 5 : baseFont + 6;
  const titleFont = isNarrow ? baseFont + 1 : baseFont + 1;
  const smallFont = isNarrow ? baseFont - 1 : baseFont - 2;

  // Font sozlamalari (foydalanuvchi tanlagani)
  const fontFamilyCss = FONT_FAMILY_CSS[settings.font_family];
  const fontWeightCss = FONT_WEIGHT_LABELS[settings.font_weight].css;
  const fontStyleCss = settings.font_style;

  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <title>Payslip — ${escapeHtml(d.employee_name)}</title>
  <style>
    @page { size: ${width} auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #f1f5f9; }
    body {
      font-family: ${fontFamilyCss};
      font-weight: ${fontWeightCss};
      font-style: ${fontStyleCss};
      font-size: ${baseFont}px;
      line-height: 1.45;
      color: #000;
      padding: 12px;
    }
    .receipt {
      width: ${contentWidth};
      margin: 0 auto;
      background: #fff;
      padding: 4mm 3mm;
      box-shadow: 0 4px 16px rgba(0,0,0,0.08);
    }
    .center { text-align: center; }
    .bold { font-weight: 700; }
    .big { font-size: ${bigFont}px; font-weight: 900; letter-spacing: 0.5px; }
    .small { font-size: ${smallFont}px; }
    .muted { color: #444; }
    .divider { border-top: 1px dashed #000; margin: 4px 0; }
    .divider-solid { border-top: 1.5px solid #000; margin: 4px 0; }
    .clinic { font-size: ${titleFont + 1}px; font-weight: 700; letter-spacing: 0.3px; }
    .title { font-size: ${titleFont}px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin: 6px 0 3px 0; }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 6px;
      margin: 2px 0;
    }
    .row .label { flex: 1; }
    .row .amount { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .section-label {
      font-size: ${smallFont}px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin: 6px 0 2px 0;
      padding-bottom: 2px;
      border-bottom: 1px solid #000;
    }
    .net {
      margin-top: 6px;
      padding: 6px 3px;
      border: 2px solid #000;
      text-align: center;
    }
    .net .label { font-size: ${smallFont}px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; }
    .net .value { font-size: ${netFont}px; font-weight: 900; font-variant-numeric: tabular-nums; margin-top: 2px; letter-spacing: -0.3px; }
    .signatures { margin-top: 10px; font-size: ${smallFont}px; }
    .sig-line { margin-top: 14px; border-top: 1px solid #000; padding-top: 2px; text-align: center; }
    .footer { margin-top: 8px; font-size: ${Math.max(8, smallFont - 1)}px; text-align: center; color: #555; }
    @media print {
      .no-print { display: none !important; }
      body { background: #fff; padding: 0; }
      .receipt { box-shadow: none; width: ${contentWidth}; margin: 0; padding: 2mm 2mm; }
    }
    .print-btn { position: fixed; top: 12px; right: 12px; background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 8px 14px; cursor: pointer; font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 600; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">🖨️ Print</button>

  <div class="receipt">
    ${S.clinic_header ? `
    <div class="center clinic">${escapeHtml(d.clinic_name)}</div>
    ${d.clinic_address ? `<div class="center small muted">${escapeHtml(d.clinic_address)}</div>` : ''}
    ${d.clinic_phone ? `<div class="center small muted">${escapeHtml(d.clinic_phone)}</div>` : ''}
    <div class="divider-solid"></div>
    ` : ''}

    <div class="center big">${escapeHtml(settings.title)}</div>
    ${S.doc_badge ? `<div class="center small">${shortRef(d)}</div>` : ''}

    <div class="divider"></div>

    <div class="bold">${escapeHtml(d.employee_name)}</div>
    ${S.employee_position && d.employee_position ? `<div class="small muted">${escapeHtml(d.employee_position)}</div>` : ''}

    <div class="row" style="margin-top:4px">
      <span class="label small">Davr:</span>
      <span class="small bold">${escapeHtml(periodLabel)}</span>
    </div>

    <div class="divider"></div>

    <div class="section-label">Daromad</div>
    ${S.commissions ? `<div class="row"><span class="label">Komissiya</span><span class="amount">${fmt(d.commissions_uzs)}</span></div>` : ''}
    ${S.monthly_base ? `<div class="row"><span class="label">Oylik fix</span><span class="amount">${fmt(d.monthly_base_uzs)}</span></div>` : ''}
    ${S.bonuses ? `<div class="row"><span class="label">Bonus</span><span class="amount">+${fmt(d.bonuses_uzs)}</span></div>` : ''}
    ${S.gross_total ? `<div class="row bold"><span class="label">Gross:</span><span class="amount">${fmt(d.gross_uzs)}</span></div>` : ''}

    <div class="section-label">Ushlanmalar</div>
    ${S.advances ? `<div class="row"><span class="label">Avans</span><span class="amount">−${fmt(d.advances_uzs)}</span></div>` : ''}
    ${S.penalties ? `<div class="row"><span class="label">Jarima</span><span class="amount">−${fmt(d.penalties_uzs)}</span></div>` : ''}
    ${S.deductions_total ? `<div class="row bold"><span class="label">Jami:</span><span class="amount">−${fmt(d.deductions_uzs)}</span></div>` : ''}

    ${S.net_block ? `
    <div class="net">
      <div class="label">SOF MAOSH (NET)</div>
      <div class="value">${fmt(d.net_uzs)} so'm</div>
    </div>` : ''}

    ${S.signatures ? `
    <div class="signatures">
      <div class="sig-line">Hisobchi</div>
      <div class="sig-line">Xodim</div>
    </div>` : ''}

    <div class="divider"></div>

    ${S.generated_at ? `<div class="footer">${escapeHtml(gen)}</div>` : ''}
    ${S.footer ? `<div class="footer">${escapeHtml(settings.footer_note)}</div>` : ''}
  </div>
</body>
</html>`;
}

function shortRef(d: PayslipData): string {
  const t = new Date(d.generated_at).getTime().toString(36).toUpperCase().slice(-6);
  return `PS-${t}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Backward compat
export const payslipHtml = a4PayslipHtml;
