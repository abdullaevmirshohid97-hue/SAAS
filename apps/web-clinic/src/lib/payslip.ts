// Maosh varaqasi (payslip) — 2 format:
//  - A4: rasmiy hujjat, brauzer print orqali PDF saqlash (Ctrl+P → Save as PDF)
//  - Thermal 80mm: chek printeri uchun (kassa printeri, silent print)

export type PayslipData = {
  clinic_name: string;
  clinic_address?: string;
  clinic_phone?: string;
  employee_name: string;
  employee_position?: string;
  period_from: string; // YYYY-MM-DD
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

export type PayslipFormat = 'a4' | 'thermal80';

const fmt = (n: number) => n.toLocaleString('uz-UZ');

export function printPayslip(data: PayslipData, format: PayslipFormat = 'a4'): void {
  const w = window.open('', '_blank', format === 'a4' ? 'width=900,height=1200' : 'width=400,height=900');
  if (!w) {
    alert("Brauzer popup'ni bloklab qo'ydi. Iltimos, popup'larga ruxsat bering.");
    return;
  }

  const html = format === 'thermal80' ? thermalPayslipHtml(data) : a4PayslipHtml(data);
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

// =============================================================================
// A4 — rasmiy hujjat dizayni
// =============================================================================
export function a4PayslipHtml(d: PayslipData): string {
  const periodLabel = `${d.period_from} — ${d.period_to}`;
  const gen = new Date(d.generated_at).toLocaleString('uz-UZ');

  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <title>Maosh varaqasi — ${escapeHtml(d.employee_name)}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #f3f4f6; }
    body {
      font-family: 'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
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

    /* === Sarlavha (gradient bilan) === */
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
      top: -50%;
      right: -10%;
      width: 60%;
      height: 200%;
      background: rgba(255,255,255,0.06);
      transform: rotate(15deg);
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      position: relative;
      z-index: 1;
    }
    .clinic-name {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.3px;
      margin-bottom: 4px;
    }
    .clinic-meta {
      font-size: 11px;
      opacity: 0.9;
    }
    .doc-badge {
      background: rgba(255,255,255,0.18);
      border: 1px solid rgba(255,255,255,0.3);
      backdrop-filter: blur(8px);
      padding: 8px 14px;
      border-radius: 8px;
      text-align: right;
    }
    .doc-badge .label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.85; }
    .doc-badge .num { font-size: 14px; font-weight: 700; margin-top: 2px; }

    /* === H1 === */
    h1 {
      font-size: 24px;
      text-align: center;
      margin: 0 0 24px 0;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #0f172a;
    }
    h1::after {
      content: '';
      display: block;
      width: 60px;
      height: 3px;
      background: linear-gradient(90deg, #0ea5e9, #2563eb);
      margin: 8px auto 0;
      border-radius: 2px;
    }

    /* === Employee card === */
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

    /* === Tables === */
    .section {
      margin-bottom: 18px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      overflow: hidden;
    }
    .section-title {
      background: #f8fafc;
      padding: 10px 16px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #64748b;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-title .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .section-title.gross .dot { background: #10b981; }
    .section-title.deduct .dot { background: #ef4444; }

    .row {
      display: flex;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid #f1f5f9;
    }
    .row:last-child { border-bottom: none; }
    .row .name { color: #475569; }
    .row .amount {
      font-family: 'JetBrains Mono', ui-monospace, 'Cascadia Code', monospace;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .row.subtotal {
      background: #f8fafc;
      font-weight: 700;
    }
    .row.subtotal .name { color: #0f172a; }

    /* === NET hero block === */
    .net-block {
      margin-top: 20px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: #fff;
      padding: 22px 26px;
      border-radius: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 8px 20px rgba(16, 185, 129, 0.25);
    }
    .net-block .label {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      opacity: 0.95;
    }
    .net-block .value {
      font-size: 28px;
      font-weight: 800;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: -0.5px;
    }
    .net-block.negative {
      background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
      box-shadow: 0 8px 20px rgba(239, 68, 68, 0.25);
    }

    /* === Signatures === */
    .signatures {
      margin-top: 36px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
    }
    .signature {
      border-top: 1.5px solid #0f172a;
      padding-top: 8px;
      font-size: 11px;
      color: #64748b;
      text-align: center;
    }
    .signature strong { color: #0f172a; display: block; font-size: 12px; }

    /* === Footer === */
    .footer {
      margin-top: 30px;
      padding-top: 14px;
      border-top: 1px dashed #cbd5e1;
      font-size: 10px;
      color: #94a3b8;
      text-align: center;
      letter-spacing: 0.3px;
    }
    .footer .brand { font-weight: 600; color: #64748b; }

    /* === Print button (faqat ekranda) === */
    @media print {
      .no-print { display: none !important; }
      body { background: #fff; padding: 0; }
      .sheet { box-shadow: none; margin: 0; }
    }
    .print-btn {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 12px 22px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
      transition: transform 0.15s;
    }
    .print-btn:hover { transform: translateY(-1px); }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">🖨️ Chop etish / PDF saqlash</button>

  <div class="sheet">
    <div class="header">
      <div class="header-row">
        <div>
          <div class="clinic-name">${escapeHtml(d.clinic_name)}</div>
          <div class="clinic-meta">
            ${d.clinic_address ? escapeHtml(d.clinic_address) + ' • ' : ''}
            ${d.clinic_phone ? escapeHtml(d.clinic_phone) : ''}
          </div>
        </div>
        <div class="doc-badge">
          <div class="label">Hujjat</div>
          <div class="num">${shortRef(d)}</div>
        </div>
      </div>
    </div>

    <h1>Maosh varaqasi</h1>

    <div class="employee">
      <div class="field">
        <span class="label">Xodim F.I.O.</span>
        <span class="value">${escapeHtml(d.employee_name)}</span>
      </div>
      <div class="field">
        <span class="label">Hisobot davri</span>
        <span class="value">${escapeHtml(periodLabel)}</span>
      </div>
      ${d.employee_position ? `
      <div class="field">
        <span class="label">Lavozim</span>
        <span class="value">${escapeHtml(d.employee_position)}</span>
      </div>` : ''}
      <div class="field">
        <span class="label">Hujjat sanasi</span>
        <span class="value">${escapeHtml(gen)}</span>
      </div>
    </div>

    <div class="section">
      <div class="section-title gross"><span class="dot"></span>Daromad (Gross)</div>
      <div class="row"><span class="name">Komissiya (foiz asosida)</span><span class="amount">${fmt(d.commissions_uzs)} so'm</span></div>
      <div class="row"><span class="name">Oylik fix maosh</span><span class="amount">${fmt(d.monthly_base_uzs)} so'm</span></div>
      <div class="row"><span class="name">Bonus</span><span class="amount">+${fmt(d.bonuses_uzs)} so'm</span></div>
      <div class="row subtotal"><span class="name">Jami gross</span><span class="amount">${fmt(d.gross_uzs)} so'm</span></div>
    </div>

    <div class="section">
      <div class="section-title deduct"><span class="dot"></span>Ushlanmalar (Deductions)</div>
      <div class="row"><span class="name">Avans</span><span class="amount">−${fmt(d.advances_uzs)} so'm</span></div>
      <div class="row"><span class="name">Jarima</span><span class="amount">−${fmt(d.penalties_uzs)} so'm</span></div>
      <div class="row subtotal"><span class="name">Jami ushlanma</span><span class="amount">−${fmt(d.deductions_uzs)} so'm</span></div>
    </div>

    <div class="net-block ${d.net_uzs < 0 ? 'negative' : ''}">
      <div class="label">Sof maosh (NET)</div>
      <div class="value">${fmt(d.net_uzs)} so'm</div>
    </div>

    <div class="signatures">
      <div class="signature"><strong>Hisobchi</strong>(imzo va sana)</div>
      <div class="signature"><strong>Xodim</strong>(imzo va sana)</div>
    </div>

    <div class="footer">
      <span class="brand">Clary Clinic CRM</span> • Avtomatik hosil qilingan hujjat
    </div>
  </div>
</body>
</html>`;
}

// =============================================================================
// Thermal 80mm — chek printer dizayni (monospace, kompakt)
// =============================================================================
export function thermalPayslipHtml(d: PayslipData): string {
  const periodLabel = `${d.period_from} — ${d.period_to}`;
  const gen = new Date(d.generated_at).toLocaleString('uz-UZ', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

  // 80mm chek qog'ozda taxminan 32-42 belgi sig'adi (font-size'ga qarab)
  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <title>Payslip — ${escapeHtml(d.employee_name)}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #f1f5f9; }
    body {
      font-family: 'JetBrains Mono', 'Courier New', ui-monospace, monospace;
      font-size: 12px;
      line-height: 1.45;
      color: #000;
      padding: 12px;
    }
    .receipt {
      width: 72mm;
      margin: 0 auto;
      background: #fff;
      padding: 5mm 4mm;
      box-shadow: 0 4px 16px rgba(0,0,0,0.08);
    }

    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: 700; }
    .big {
      font-size: 16px;
      font-weight: 900;
      letter-spacing: 1px;
    }
    .small { font-size: 10px; }
    .muted { color: #444; }

    .divider {
      border-top: 1px dashed #000;
      margin: 6px 0;
    }
    .divider-solid {
      border-top: 1.5px solid #000;
      margin: 6px 0;
    }

    .clinic {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }

    .title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin: 8px 0 4px 0;
    }

    .row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      margin: 3px 0;
    }
    .row .label { flex: 1; }
    .row .amount {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .section-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 8px 0 2px 0;
      padding-bottom: 2px;
      border-bottom: 1px solid #000;
    }

    .net {
      margin-top: 8px;
      padding: 8px 4px;
      border: 2px solid #000;
      text-align: center;
    }
    .net .label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .net .value {
      font-size: 18px;
      font-weight: 900;
      font-variant-numeric: tabular-nums;
      margin-top: 3px;
    }

    .signatures {
      margin-top: 14px;
      font-size: 10px;
    }
    .sig-line {
      margin-top: 18px;
      border-top: 1px solid #000;
      padding-top: 2px;
      text-align: center;
    }

    .footer {
      margin-top: 10px;
      font-size: 9px;
      text-align: center;
      color: #555;
    }

    @media print {
      .no-print { display: none !important; }
      body { background: #fff; padding: 0; }
      .receipt {
        box-shadow: none;
        width: 72mm;
        margin: 0;
        padding: 3mm 3mm;
      }
    }
    .print-btn {
      position: fixed;
      top: 12px;
      right: 12px;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 8px 14px;
      cursor: pointer;
      font-family: 'Inter', sans-serif;
      font-size: 12px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">🖨️ Print</button>

  <div class="receipt">
    <div class="center clinic">${escapeHtml(d.clinic_name)}</div>
    ${d.clinic_address ? `<div class="center small muted">${escapeHtml(d.clinic_address)}</div>` : ''}
    ${d.clinic_phone ? `<div class="center small muted">${escapeHtml(d.clinic_phone)}</div>` : ''}

    <div class="divider-solid"></div>

    <div class="center big">PAYSLIP</div>
    <div class="center small">${shortRef(d)}</div>

    <div class="divider"></div>

    <div class="row"><span class="label">Xodim:</span></div>
    <div class="bold">${escapeHtml(d.employee_name)}</div>
    ${d.employee_position ? `<div class="small muted">${escapeHtml(d.employee_position)}</div>` : ''}

    <div class="row" style="margin-top:6px">
      <span class="label small">Davr:</span>
      <span class="small bold">${escapeHtml(periodLabel)}</span>
    </div>

    <div class="divider"></div>

    <div class="section-label">Daromad</div>
    <div class="row"><span class="label">Komissiya</span><span class="amount">${fmt(d.commissions_uzs)}</span></div>
    <div class="row"><span class="label">Oylik fix</span><span class="amount">${fmt(d.monthly_base_uzs)}</span></div>
    <div class="row"><span class="label">Bonus</span><span class="amount">+${fmt(d.bonuses_uzs)}</span></div>
    <div class="row bold"><span class="label">Gross:</span><span class="amount">${fmt(d.gross_uzs)}</span></div>

    <div class="section-label">Ushlanmalar</div>
    <div class="row"><span class="label">Avans</span><span class="amount">−${fmt(d.advances_uzs)}</span></div>
    <div class="row"><span class="label">Jarima</span><span class="amount">−${fmt(d.penalties_uzs)}</span></div>
    <div class="row bold"><span class="label">Jami:</span><span class="amount">−${fmt(d.deductions_uzs)}</span></div>

    <div class="net">
      <div class="label">SOF MAOSH (NET)</div>
      <div class="value">${fmt(d.net_uzs)} so'm</div>
    </div>

    <div class="signatures">
      <div class="sig-line">Hisobchi</div>
      <div class="sig-line">Xodim</div>
    </div>

    <div class="divider"></div>

    <div class="footer">
      ${escapeHtml(gen)}<br/>
      Clary Clinic CRM
    </div>
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

// Eski API saqlanadi (backward compat)
export const payslipHtml = a4PayslipHtml;
