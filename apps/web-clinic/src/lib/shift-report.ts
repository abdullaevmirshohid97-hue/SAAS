// Smena hisoboti chop etish — 3 format (A4 PDF, 80mm, 58mm termal)

import {
  SHIFT_FONT_FAMILY_CSS,
  SHIFT_FONT_WEIGHT_LABELS,
  getShiftReportSettings,
  type ShiftReportSettings,
  type ShiftReportWidth,
} from './shift-report-settings';

export type ShiftReportData = {
  clinic_name?: string;
  clinic_address?: string;
  clinic_phone?: string;
  operator_name: string | null;
  opened_at: string;
  closed_at: string | null;
  totals: {
    revenue: number;
    total_expense: number;
    net_profit: number;
  };
  // Kassa naqd yakuni — professional Z-hisobotning markazi: boshlang'ich →
  // kutilgan → haqiqiy sanalgan → FARQ (kamchilik qizil / ortiqcha sariq).
  cash_summary?: {
    opening_uzs: number | null;
    expected_uzs: number | null;
    actual_uzs: number | null;
    diff_uzs: number | null;
  };
  closing_notes?: string | null;
  cash_breakdown?: Record<string, { in: number; out: number; net: number }>;
  transactions: Array<{
    occurred_at: string;
    patient_name: string | null;
    service_name: string | null;
    doctor_name: string | null;
    cashier_name: string | null;
    payment_method: string;
    amount_uzs: number;
    kind?: string;
    is_void?: boolean;
  }>;
  expenses: Array<{
    category: string;
    description: string | null;
    recorder_name: string | null;
    amount_uzs: number;
  }>;
  staff: Array<{
    name: string;
    role: string;
    appointments: number;
    queue: number;
  }>;
  salary_payouts: Array<{
    doctor_name: string;
    net_uzs: number;
  }>;
};

const fmtUzs = (n: number) =>
  Number(n ?? 0).toLocaleString('uz-UZ') + " so'm";

// To'lov usuli — foydalanuvchi tilida (xom 'cash' o'rniga)
const METHOD_LABEL: Record<string, string> = {
  cash: 'Naqd', card: 'Karta', transfer: "O'tkazma", click: 'Click', payme: 'Payme',
  mixed: 'Aralash', insurance: "Sug'urta", uzum: 'Uzum', humo: 'Humo', uzcard: 'Uzcard',
  kaspi: 'Kaspi',
};
const ml = (m: string) => METHOD_LABEL[m] ?? m;
const KIND_LABEL: Record<string, string> = {
  refund: 'Vozvrat', adjustment: 'Inkasatsiya/tuzatish', payment: "To'lov",
};
const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const fmtDateTime = (s: string | null | undefined) =>
  !s
    ? ''
    : new Date(s).toLocaleString('uz-UZ', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

export async function printShiftReport(
  data: ShiftReportData,
  format: ShiftReportWidth = 'a4',
): Promise<void> {
  const settings = getShiftReportSettings();
  if (format === 'a4') {
    await downloadA4Pdf(data, settings);
  } else {
    openThermalWindow(data, settings, format);
  }
}

async function downloadA4Pdf(
  data: ShiftReportData,
  settings: ShiftReportSettings,
): Promise<void> {
  const [{ jsPDF }, html2canvas] = await Promise.all([
    import('jspdf'),
    import('html2canvas').then((m) => m.default),
  ]);

  const html = a4ShiftReportHtml(data, settings, false);
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '-99999px';
  container.style.left = '0';
  container.style.width = '210mm';
  container.style.background = '#fff';
  container.innerHTML = html;
  document.body.appendChild(container);

  const sheet = container.querySelector('.sheet') as HTMLElement | null;
  const target = sheet ?? container;

  try {
    const canvas = await html2canvas(target, {
      scale: 2,
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

    if (imgHeight <= pageHeight) {
      pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
    } else {
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

    const dateStr = data.opened_at.slice(0, 10);
    pdf.save(`smena-hisoboti-${dateStr}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

function openThermalWindow(
  data: ShiftReportData,
  settings: ShiftReportSettings,
  width: '58mm' | '80mm',
): void {
  const w = window.open('', '_blank', 'width=400,height=900');
  if (!w) {
    alert("Brauzer popup'ni bloklab qo'ydi. Iltimos, popup'larga ruxsat bering.");
    return;
  }
  const html = thermalShiftReportHtml(data, settings, width);
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

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// =============================================================================
// A4 dizayni — rasmiy hisobot
// =============================================================================
export function a4ShiftReportHtml(
  d: ShiftReportData,
  settings: ShiftReportSettings = getShiftReportSettings(),
  withPrintButton = true,
): string {
  const S = settings.sections;
  const periodLabel = `${fmtDateTime(d.opened_at)} — ${
    d.closed_at ? fmtDateTime(d.closed_at) : 'ochiq'
  }`;
  const fontFamilyCss = SHIFT_FONT_FAMILY_CSS[settings.font_family];
  const fontWeightCss = SHIFT_FONT_WEIGHT_LABELS[settings.font_weight].css;
  const fontStyleCss = settings.font_style;

  const txRows = d.transactions
    .map(
      (t) => `<tr${t.is_void ? ' style="opacity:.5;text-decoration:line-through"' : ''}>
        <td>${escapeHtml(fmtDateTime(t.occurred_at).slice(11))}</td>
        <td>${escapeHtml(t.patient_name ?? '—')}</td>
        <td>${escapeHtml(t.service_name ?? (t.kind ? KIND_LABEL[t.kind] ?? t.kind : '—'))}</td>
        <td>${escapeHtml(t.doctor_name ?? '—')}</td>
        <td>${escapeHtml(t.cashier_name ?? '—')}</td>
        <td>${escapeHtml(ml(t.payment_method))}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;${t.amount_uzs < 0 ? 'color:#dc2626' : ''}">${
          t.amount_uzs < 0 ? '−' : ''
        }${escapeHtml(fmtUzs(Math.abs(t.amount_uzs)))}</td>
      </tr>`,
    )
    .join('');
  // JAMI (void'lar hisobga olinmaydi) — professional jadval yakuni
  const txTotal = d.transactions
    .filter((t) => !t.is_void)
    .reduce((s, t) => s + Number(t.amount_uzs ?? 0), 0);
  const expTotal = d.expenses.reduce((s, e) => s + Number(e.amount_uzs ?? 0), 0);

  // Kassa naqd yakuni — farq rangli (kamchilik qizil, ortiqcha sariq, 0 yashil)
  const cs = d.cash_summary;
  const diffColor =
    cs?.diff_uzs == null ? '#64748b' : cs.diff_uzs < 0 ? '#dc2626' : cs.diff_uzs > 0 ? '#d97706' : '#059669';
  const diffLabel =
    cs?.diff_uzs == null ? '—' : cs.diff_uzs === 0 ? "0 (kassa aniq)" : `${cs.diff_uzs > 0 ? '+' : '−'}${fmtUzs(Math.abs(cs.diff_uzs))}${cs.diff_uzs < 0 ? ' (KAMCHILIK)' : ' (ortiqcha)'}`;
  const cashSummaryHtml = cs
    ? `
    <h2>Kassa naqd yakuni</h2>
    <table>
      <thead><tr><th>Boshlang'ich kassa</th><th>Kutilgan naqd</th><th>Sanalgan naqd</th><th>Farq</th></tr></thead>
      <tbody><tr>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${escapeHtml(cs.opening_uzs != null ? fmtUzs(cs.opening_uzs) : '—')}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${escapeHtml(cs.expected_uzs != null ? fmtUzs(cs.expected_uzs) : '—')}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:600">${escapeHtml(cs.actual_uzs != null ? fmtUzs(cs.actual_uzs) : '—')}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:${diffColor}">${escapeHtml(diffLabel)}</td>
      </tr></tbody>
    </table>
    ${d.closing_notes ? `<div style="font-size:11px;color:#475569;margin:-2px 0 8px 0"><b>Yopish izohi:</b> ${escapeHtml(d.closing_notes)}</div>` : ''}`
    : '';

  const expRows = d.expenses
    .map(
      (e) => `<tr>
        <td>${escapeHtml(e.category)}</td>
        <td>${escapeHtml(e.description ?? '—')}</td>
        <td>${escapeHtml(e.recorder_name ?? '—')}</td>
        <td style="text-align:right;color:#dc2626;font-variant-numeric:tabular-nums">−${escapeHtml(fmtUzs(e.amount_uzs))}</td>
      </tr>`,
    )
    .join('');

  const staffRows = d.staff
    .map(
      (s) =>
        `<li>${escapeHtml(s.name)} <span style="color:#64748b">— ${escapeHtml(s.role)}</span> · ${s.appointments} qabul · ${s.queue} navbat</li>`,
    )
    .join('');

  const salaryRows = d.salary_payouts
    .map((p) => `<li>${escapeHtml(p.doctor_name)}: <strong style="color:#dc2626">−${escapeHtml(fmtUzs(p.net_uzs))}</strong></li>`)
    .join('');

  const cashRows = d.cash_breakdown
    ? Object.entries(d.cash_breakdown)
        .map(
          ([m, v]) => `<tr>
        <td>${escapeHtml(ml(m))}</td>
        <td style="text-align:right;color:#059669;font-variant-numeric:tabular-nums">+${escapeHtml(fmtUzs(v.in))}</td>
        <td style="text-align:right;color:#dc2626;font-variant-numeric:tabular-nums">−${escapeHtml(fmtUzs(v.out))}</td>
        <td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums">${escapeHtml(fmtUzs(v.net))}</td>
      </tr>`,
        )
        .join('')
    : '';

  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(settings.title)} — ${escapeHtml(d.operator_name ?? 'Operator')}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #f3f4f6; }
    body {
      font-family: ${fontFamilyCss};
      font-weight: ${fontWeightCss};
      font-style: ${fontStyleCss};
      color: #0f172a;
      font-size: 12px;
      line-height: 1.5;
      padding: 20px;
    }
    .sheet {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      background: #fff;
      padding: 15mm 14mm;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #6366f1 0%, #4338ca 100%);
      color: #fff;
      margin: -15mm -14mm 20px -14mm;
      padding: 18mm 14mm 14mm 14mm;
    }
    .clinic-name { font-size: 22px; font-weight: 700; }
    .clinic-meta { font-size: 11px; opacity: 0.9; margin-top: 3px; }
    h1 {
      font-size: 22px;
      text-align: center;
      margin: 4px 0 20px 0;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    h1::after {
      content: '';
      display: block;
      width: 60px;
      height: 3px;
      background: linear-gradient(90deg, #6366f1, #4338ca);
      margin: 6px auto 0;
      border-radius: 2px;
    }
    .meta-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 16px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .meta-box .field { display: flex; flex-direction: column; }
    .meta-box .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; }
    .meta-box .value { font-size: 13px; font-weight: 600; }
    .kpi-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 10px;
      margin-bottom: 18px;
    }
    .kpi {
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
    }
    .kpi.revenue { background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-color: #6ee7b7; }
    .kpi.expense { background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border-color: #fca5a5; }
    .kpi.profit  { background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-color: #93c5fd; }
    .kpi .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #475569; }
    .kpi .value { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 4px; }
    .kpi.revenue .value { color: #047857; }
    .kpi.expense .value { color: #b91c1c; }
    .kpi.profit  .value { color: #1d4ed8; }
    h2 {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #475569;
      border-bottom: 1px solid #e2e8f0;
      padding: 6px 0;
      margin: 16px 0 6px 0;
    }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 11px; }
    th, td { border: 1px solid #e2e8f0; padding: 5px 8px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; font-size: 10px; text-transform: uppercase; }
    ul { margin: 4px 0; padding-left: 20px; font-size: 12px; }
    ul li { padding: 2px 0; }
    .signatures {
      margin-top: 30px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
    }
    .signature {
      border-top: 1.5px solid #0f172a;
      padding-top: 6px;
      font-size: 11px;
      color: #64748b;
      text-align: center;
    }
    .signature strong { color: #0f172a; display: block; font-size: 12px; }
    .footer { margin-top: 24px; padding-top: 10px; border-top: 1px dashed #cbd5e1; font-size: 10px; color: #94a3b8; text-align: center; }
    @media print {
      .no-print { display: none !important; }
      body { background: #fff; padding: 0; }
      .sheet { box-shadow: none; margin: 0; }
    }
    .print-btn { position: fixed; top: 20px; right: 20px; background: #4338ca; color: #fff; border: none; border-radius: 8px; padding: 12px 22px; cursor: pointer; font-size: 14px; font-weight: 600; box-shadow: 0 4px 12px rgba(67, 56, 202, 0.4); }
  </style>
</head>
<body>
  ${withPrintButton ? `<button class="print-btn no-print" onclick="window.print()">🖨️ Chop etish / PDF</button>` : ''}

  <div class="sheet">
    ${S.clinic_header ? `
    <div class="header">
      <div class="clinic-name">${escapeHtml(d.clinic_name ?? 'Klinika')}</div>
      <div class="clinic-meta">
        ${d.clinic_address ? escapeHtml(d.clinic_address) + ' • ' : ''}
        ${d.clinic_phone ? escapeHtml(d.clinic_phone) : ''}
      </div>
    </div>` : ''}

    <h1>${escapeHtml(settings.title)}</h1>

    <div class="meta-box">
      ${S.operator_info ? `
      <div class="field">
        <span class="label">Navbatchi</span>
        <span class="value">${escapeHtml(d.operator_name ?? '—')}</span>
      </div>` : ''}
      ${S.period_info ? `
      <div class="field">
        <span class="label">Smena vaqti</span>
        <span class="value" style="font-size:11px">${escapeHtml(periodLabel)}</span>
      </div>` : ''}
    </div>

    ${S.kpi_block ? `
    <div class="kpi-grid">
      <div class="kpi revenue">
        <div class="label">Umumiy tushum</div>
        <div class="value">${escapeHtml(fmtUzs(d.totals.revenue))}</div>
      </div>
      <div class="kpi expense">
        <div class="label">Umumiy rasxot</div>
        <div class="value">${escapeHtml(fmtUzs(d.totals.total_expense))}</div>
      </div>
      <div class="kpi profit">
        <div class="label">Sof foyda</div>
        <div class="value">${escapeHtml(fmtUzs(d.totals.net_profit))}</div>
      </div>
    </div>` : ''}

    ${cashSummaryHtml}

    ${S.cash_breakdown && cashRows ? `
    <h2>To'lov usullari bo'yicha tafsilot</h2>
    <table>
      <thead><tr><th>Usul</th><th style="text-align:right">Kirim</th><th style="text-align:right">Chiqim</th><th style="text-align:right">NET</th></tr></thead>
      <tbody>${cashRows}</tbody>
    </table>` : ''}

    ${S.transactions_table && d.transactions.length ? `
    <h2>To'lovlar va amallar (${d.transactions.length})</h2>
    <table>
      <thead><tr><th>Vaqt</th><th>Bemor</th><th>Xizmat</th><th>Shifokor</th><th>Kassir</th><th>Usul</th><th style="text-align:right">Summa</th></tr></thead>
      <tbody>${txRows}</tbody>
      <tfoot><tr>
        <td colspan="6" style="text-align:right;font-weight:700;background:#f8fafc">JAMI (bekor qilinganlarsiz):</td>
        <td style="text-align:right;font-weight:700;background:#f8fafc;font-variant-numeric:tabular-nums">${escapeHtml(fmtUzs(txTotal))}</td>
      </tr></tfoot>
    </table>` : ''}

    ${S.expenses_table && d.expenses.length ? `
    <h2>Rasxotlar (${d.expenses.length})</h2>
    <table>
      <thead><tr><th>Toifa</th><th>Izoh</th><th>Xodim</th><th style="text-align:right">Summa</th></tr></thead>
      <tbody>${expRows}</tbody>
      <tfoot><tr>
        <td colspan="3" style="text-align:right;font-weight:700;background:#f8fafc">JAMI:</td>
        <td style="text-align:right;font-weight:700;color:#dc2626;background:#f8fafc;font-variant-numeric:tabular-nums">−${escapeHtml(fmtUzs(expTotal))}</td>
      </tr></tfoot>
    </table>` : ''}

    ${S.staff_list && d.staff.length ? `
    <h2>Ishlagan xodimlar (${d.staff.length})</h2>
    <ul>${staffRows}</ul>` : ''}

    ${S.salary_payouts && salaryRows ? `
    <h2>Berilgan maoshlar</h2>
    <ul>${salaryRows}</ul>` : ''}

    ${S.signatures ? `
    <div class="signatures">
      <div class="signature"><strong>Navbatchi</strong>(imzo va sana)</div>
      <div class="signature"><strong>Boshliq</strong>(imzo va sana)</div>
    </div>` : ''}

    ${S.footer ? `<div class="footer">${escapeHtml(settings.footer_note)} • ${escapeHtml(new Date().toLocaleString('uz-UZ'))}</div>` : ''}
  </div>
</body>
</html>`;
}

// =============================================================================
// Thermal — 58mm yoki 80mm
// =============================================================================
export function thermalShiftReportHtml(
  d: ShiftReportData,
  settings: ShiftReportSettings = getShiftReportSettings(),
  width: '58mm' | '80mm' = '80mm',
): string {
  const S = settings.sections;
  const isNarrow = width === '58mm';
  const contentWidth = isNarrow ? '48mm' : '72mm';
  const baseFont = isNarrow ? Math.max(9, settings.thermal_font_size - 1) : settings.thermal_font_size;
  const bigFont = baseFont + 4;
  const titleFont = baseFont + 1;
  const smallFont = Math.max(8, baseFont - 1);

  const fontFamilyCss = SHIFT_FONT_FAMILY_CSS[settings.font_family];
  const fontWeightCss = SHIFT_FONT_WEIGHT_LABELS[settings.font_weight].css;
  const fontStyleCss = settings.font_style;

  const periodLabel = `${fmtDateTime(d.opened_at)} —\n${
    d.closed_at ? fmtDateTime(d.closed_at) : 'ochiq'
  }`;

  // Termal uchun tranzaksiyalar cheklov bilan
  const maxTx = settings.max_transactions_thermal;
  const txList = d.transactions.slice(0, maxTx);
  const txOverflow = d.transactions.length - txList.length;

  const txRows = txList
    .map(
      (t) => `<div class="row${t.is_void ? ' void' : ''}">
        <span class="label">${escapeHtml((t.patient_name ?? '—').slice(0, isNarrow ? 14 : 22))}</span>
        <span class="amount">${t.amount_uzs < 0 ? '−' : ''}${escapeHtml(fmt(Math.abs(t.amount_uzs)))}</span>
      </div>`,
    )
    .join('');

  const expRows = d.expenses
    .map(
      (e) => `<div class="row">
        <span class="label">${escapeHtml(e.category.slice(0, isNarrow ? 14 : 22))}</span>
        <span class="amount">−${escapeHtml(fmt(e.amount_uzs))}</span>
      </div>`,
    )
    .join('');

  const cashRows = d.cash_breakdown
    ? Object.entries(d.cash_breakdown)
        .map(
          ([m, v]) =>
            `<div class="row"><span class="label">${escapeHtml(ml(m))}</span><span class="amount">${escapeHtml(fmt(v.net))}</span></div>`,
        )
        .join('')
    : '';

  // Kassa naqd yakuni (termal) — kutilgan/sanalgan/farq
  const cs = d.cash_summary;
  const thermalCash = cs
    ? `
    <div class="section-label">Kassa naqd yakuni</div>
    ${cs.opening_uzs != null ? `<div class="row"><span class="label">Boshlang'ich:</span><span class="amount">${escapeHtml(fmt(cs.opening_uzs))}</span></div>` : ''}
    ${cs.expected_uzs != null ? `<div class="row"><span class="label">Kutilgan:</span><span class="amount">${escapeHtml(fmt(cs.expected_uzs))}</span></div>` : ''}
    ${cs.actual_uzs != null ? `<div class="row"><span class="label">Sanalgan:</span><span class="amount">${escapeHtml(fmt(cs.actual_uzs))}</span></div>` : ''}
    ${cs.diff_uzs != null ? `<div class="row net-row"><span class="label">FARQ${cs.diff_uzs < 0 ? ' (KAMCHILIK)' : cs.diff_uzs > 0 ? ' (ortiqcha)' : ''}:</span><span class="amount">${cs.diff_uzs > 0 ? '+' : cs.diff_uzs < 0 ? '−' : ''}${escapeHtml(fmt(Math.abs(cs.diff_uzs)))}</span></div>` : ''}`
    : '';

  const staffRows = d.staff
    .map((s) => `<div class="small">${escapeHtml(s.name)} (${s.appointments})</div>`)
    .join('');

  const salaryRows = d.salary_payouts
    .map(
      (p) => `<div class="row"><span class="label">${escapeHtml(p.doctor_name.slice(0, isNarrow ? 14 : 22))}</span><span class="amount">−${escapeHtml(fmt(p.net_uzs))}</span></div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <title>Smena hisoboti</title>
  <style>
    @page { size: ${width} auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #f1f5f9; }
    body {
      font-family: ${fontFamilyCss};
      font-weight: ${fontWeightCss};
      font-style: ${fontStyleCss};
      font-size: ${baseFont}px;
      line-height: 1.4;
      color: #000;
      padding: 10px;
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
    .title { font-size: ${titleFont}px; font-weight: 700; }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 6px;
      margin: 2px 0;
    }
    .row .label { flex: 1; }
    .row .amount { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .row.void { opacity: 0.5; text-decoration: line-through; }
    .section-label {
      font-size: ${smallFont}px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin: 5px 0 2px 0;
      padding-bottom: 1px;
      border-bottom: 1px solid #000;
    }
    .kpi-box {
      margin: 6px 0;
      padding: 4px 3px;
      border: 1.5px solid #000;
    }
    .kpi-box .row { margin: 1px 0; }
    .net-row { font-weight: 700; font-size: ${baseFont + 1}px; border-top: 1px solid #000; padding-top: 2px; margin-top: 2px; }
    .sig-line { margin-top: 14px; border-top: 1px solid #000; padding-top: 2px; text-align: center; font-size: ${smallFont}px; }
    .footer { margin-top: 6px; font-size: ${Math.max(8, smallFont - 1)}px; text-align: center; color: #555; }
    @media print {
      .no-print { display: none !important; }
      body { background: #fff; padding: 0; }
      .receipt { box-shadow: none; width: ${contentWidth}; margin: 0; padding: 2mm 2mm; }
    }
    .print-btn { position: fixed; top: 12px; right: 12px; background: #4338ca; color: #fff; border: none; border-radius: 6px; padding: 8px 14px; cursor: pointer; font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 600; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">🖨️ Print</button>

  <div class="receipt">
    ${S.clinic_header ? `
    <div class="center title">${escapeHtml(d.clinic_name ?? 'Klinika')}</div>
    ${d.clinic_address ? `<div class="center small muted">${escapeHtml(d.clinic_address)}</div>` : ''}
    ${d.clinic_phone ? `<div class="center small muted">${escapeHtml(d.clinic_phone)}</div>` : ''}
    <div class="divider-solid"></div>` : ''}

    <div class="center big">${escapeHtml(settings.title)}</div>

    <div class="divider"></div>

    ${S.operator_info ? `<div class="bold">Navbatchi: ${escapeHtml(d.operator_name ?? '—')}</div>` : ''}
    ${S.period_info ? `<div class="small">${escapeHtml(periodLabel)}</div>` : ''}

    ${S.kpi_block ? `
    <div class="kpi-box">
      <div class="row"><span class="label">Tushum:</span><span class="amount">+${escapeHtml(fmt(d.totals.revenue))}</span></div>
      <div class="row"><span class="label">Rasxot:</span><span class="amount">−${escapeHtml(fmt(d.totals.total_expense))}</span></div>
      <div class="row net-row"><span class="label">Foyda:</span><span class="amount">${escapeHtml(fmt(d.totals.net_profit))}</span></div>
    </div>` : ''}

    ${thermalCash}

    ${S.cash_breakdown && cashRows ? `
    <div class="section-label">To'lov usullari</div>
    ${cashRows}` : ''}

    ${S.transactions_table && d.transactions.length ? `
    <div class="section-label">To'lovlar (${d.transactions.length})</div>
    ${txRows}
    ${txOverflow > 0 ? `<div class="small muted">+ ${txOverflow} ta yana</div>` : ''}` : ''}

    ${S.expenses_table && d.expenses.length ? `
    <div class="section-label">Rasxotlar (${d.expenses.length})</div>
    ${expRows}` : ''}

    ${S.staff_list && d.staff.length ? `
    <div class="section-label">Xodimlar (${d.staff.length})</div>
    ${staffRows}` : ''}

    ${S.salary_payouts && salaryRows ? `
    <div class="section-label">Maoshlar</div>
    ${salaryRows}` : ''}

    ${S.signatures ? `
    <div class="sig-line">Navbatchi</div>
    <div class="sig-line">Boshliq</div>` : ''}

    <div class="divider"></div>

    ${S.footer ? `<div class="footer">${escapeHtml(settings.footer_note)}<br/>${escapeHtml(new Date().toLocaleString('uz-UZ'))}</div>` : ''}
  </div>
</body>
</html>`;
}
