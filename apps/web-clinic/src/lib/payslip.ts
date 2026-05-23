// Maosh varaqasi (payslip) — A4 hujjat, brauzer print orqali PDF saqlash mumkin
// (Ctrl+P → Save as PDF). Alohida package shart emas — yangi oyna ochib HTML
// chiqaramiz, foydalanuvchi chop etadi yoki PDF qiladi.

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

const fmt = (n: number) => n.toLocaleString('uz-UZ');

export function printPayslip(data: PayslipData): void {
  const w = window.open('', '_blank', 'width=900,height=1200');
  if (!w) {
    alert("Brauzer popup'ni bloklab qo'ydi. Iltimos, popup'larga ruxsat bering.");
    return;
  }

  const html = payslipHtml(data);
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Brauzer renderlab bo'lgach print dialog'i ochiladi
  w.onload = () => {
    setTimeout(() => {
      w.focus();
      w.print();
    }, 200);
  };
}

export function payslipHtml(d: PayslipData): string {
  const periodLabel = `${d.period_from} — ${d.period_to}`;
  const gen = new Date(d.generated_at).toLocaleString('uz-UZ');

  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <title>Maosh varaqasi — ${d.employee_name}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
      color: #111;
      margin: 0;
      padding: 0;
      font-size: 13px;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #111;
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .clinic { font-size: 20px; font-weight: 700; margin: 0 0 4px 0; }
    .clinic-info { font-size: 11px; color: #555; }
    .doc-title { font-size: 16px; font-weight: 600; text-align: right; }
    .doc-meta { font-size: 11px; color: #555; text-align: right; }
    h1 {
      font-size: 22px;
      text-align: center;
      margin: 24px 0;
      letter-spacing: 0.5px;
    }
    .employee {
      background: #f8f8f8;
      border: 1px solid #ddd;
      padding: 12px 16px;
      border-radius: 4px;
      margin-bottom: 20px;
    }
    .employee-row { display: flex; justify-content: space-between; padding: 3px 0; }
    .employee-row .label { color: #555; }
    .employee-row .value { font-weight: 600; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    th, td {
      border: 1px solid #ccc;
      padding: 8px 12px;
      text-align: left;
    }
    th {
      background: #f0f0f0;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    td.amount { text-align: right; font-variant-numeric: tabular-nums; }
    .section-title {
      background: #e8eef5;
      font-weight: 700;
      font-size: 12px;
      text-transform: uppercase;
    }
    .total-row { background: #f8f8f8; font-weight: 700; }
    .net-row {
      background: #d4edda;
      font-weight: 700;
      font-size: 16px;
      color: #155724;
    }
    .footer {
      margin-top: 40px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .signature {
      width: 45%;
      border-top: 1px solid #111;
      padding-top: 6px;
      font-size: 11px;
      color: #555;
      text-align: center;
    }
    .meta {
      margin-top: 30px;
      font-size: 10px;
      color: #888;
      text-align: center;
    }
    @media print {
      .no-print { display: none !important; }
    }
    .print-btn {
      position: fixed;
      top: 16px;
      right: 16px;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 6px;
      padding: 10px 18px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">🖨️ Chop etish / PDF</button>

  <div class="header">
    <div>
      <div class="clinic">${escapeHtml(d.clinic_name)}</div>
      <div class="clinic-info">
        ${d.clinic_address ? escapeHtml(d.clinic_address) + '<br/>' : ''}
        ${d.clinic_phone ? escapeHtml(d.clinic_phone) : ''}
      </div>
    </div>
    <div>
      <div class="doc-title">MAOSH VARAQASI</div>
      <div class="doc-meta">№ ${shortRef(d)}<br/>Davr: ${escapeHtml(periodLabel)}</div>
    </div>
  </div>

  <h1>Xodim maosh hisoboti</h1>

  <div class="employee">
    <div class="employee-row">
      <span class="label">F.I.O.</span>
      <span class="value">${escapeHtml(d.employee_name)}</span>
    </div>
    ${d.employee_position ? `
    <div class="employee-row">
      <span class="label">Lavozim</span>
      <span class="value">${escapeHtml(d.employee_position)}</span>
    </div>` : ''}
    <div class="employee-row">
      <span class="label">Hisobot davri</span>
      <span class="value">${escapeHtml(periodLabel)}</span>
    </div>
  </div>

  <table>
    <tr class="section-title"><td colspan="2">Daromad (Gross)</td></tr>
    <tr><td>Komissiya (foiz)</td><td class="amount">${fmt(d.commissions_uzs)} so'm</td></tr>
    <tr><td>Oylik fix maosh</td><td class="amount">${fmt(d.monthly_base_uzs)} so'm</td></tr>
    <tr><td>Bonus</td><td class="amount">${fmt(d.bonuses_uzs)} so'm</td></tr>
    <tr class="total-row"><td>Jami gross</td><td class="amount">${fmt(d.gross_uzs)} so'm</td></tr>

    <tr class="section-title"><td colspan="2">Ushlanmalar (Deductions)</td></tr>
    <tr><td>Avans</td><td class="amount">−${fmt(d.advances_uzs)} so'm</td></tr>
    <tr><td>Jarima</td><td class="amount">−${fmt(d.penalties_uzs)} so'm</td></tr>
    <tr class="total-row"><td>Jami ushlanma</td><td class="amount">−${fmt(d.deductions_uzs)} so'm</td></tr>

    <tr class="net-row"><td>SOF MAOSH (NET)</td><td class="amount">${fmt(d.net_uzs)} so'm</td></tr>
  </table>

  <div class="footer">
    <div class="signature">Hisobchi (imzo)</div>
    <div class="signature">Xodim (imzo)</div>
  </div>

  <div class="meta">
    Hujjat tayyorlangan: ${escapeHtml(gen)} • Clary Clinic CRM
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
