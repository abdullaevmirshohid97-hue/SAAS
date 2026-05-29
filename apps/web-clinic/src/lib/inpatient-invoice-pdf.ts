// Statsionar chiqish hisob-faktura — A4 HTML print.
// jsPDF helvetica kirill/o'zbek harflarni (Ганиев, so'm, qo'shimcha) buzib
// ko'rsatadi. Shuning uchun chiroyli HTML hisob-faktura yangi oynada ochiladi
// va brauzer print dialogi orqali "PDF saqlash" yoki bosib chiqarish mumkin —
// brauzer barcha Unicode harflarni to'g'ri ko'rsatadi.

export type InpatientInvoiceData = {
  clinicName: string;
  patientName: string;
  patientPhone?: string | null;
  patientDob?: string | null;
  patientGender?: string | null;
  patientAddress?: string | null;
  roomLabel?: string | null;
  doctorName?: string | null;
  admittedAt: string; // ISO
  dischargedAt?: string | null; // ISO
  days: number;
  services: Array<{ name: string; quantity: number; amount_uzs: number; doctor_name?: string | null }>;
  roomDailyUzs: number;
  mealDailyUzs: number;
  attendantDailyUzs: number;
  totalRoomUzs: number;
  totalMealUzs: number;
  totalAttendantUzs: number;
  attendantName?: string | null;
  attendantPhone?: string | null;
  attendantAge?: number | null;
  attendantGender?: string | null;
  totalDailyChargedUzs: number;
  totalServicesUzs: number;
  totalDepositedUzs: number;
  balanceUzs: number; // + depozit qoldig'i, − qarz
};

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('uz-UZ') : '—';
const esc = (s: string) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );

const GENDER: Record<string, string> = { male: 'Erkak', female: 'Ayol', other: 'Boshqa' };

function ageFromDob(dob?: string | null): string {
  if (!dob) return '—';
  const b = new Date(dob);
  if (isNaN(b.getTime())) return '—';
  const t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return `${a} yosh`;
}

export async function exportInpatientInvoicePdf(
  data: InpatientInvoiceData,
  _filename = 'statsionar-hisob.pdf',
): Promise<void> {
  const debt = data.balanceUzs < 0 ? Math.abs(data.balanceUzs) : 0;
  const deposit = data.balanceUzs > 0 ? data.balanceUzs : 0;

  // Xizmatlar satrlari
  const serviceRows =
    data.services.length === 0
      ? `<tr><td colspan="4" class="muted center">Qo'shimcha xizmatlar yo'q</td></tr>`
      : data.services
          .map(
            (s, i) => `<tr>
              <td>${i + 1}</td>
              <td>${esc(s.name)}</td>
              <td>${esc(s.doctor_name ?? '—')}</td>
              <td class="r">${fmt(s.amount_uzs)}</td>
            </tr>`,
          )
          .join('');

  // Kunlik tarkib satrlari
  const breakdownRows = [
    `<tr><td>Xona (${data.days} kun × ${fmt(data.roomDailyUzs)})</td><td class="r">${fmt(data.totalRoomUzs)}</td></tr>`,
    data.mealDailyUzs > 0
      ? `<tr><td>Ovqat (${data.days} kun × ${fmt(data.mealDailyUzs)})</td><td class="r">${fmt(data.totalMealUzs)}</td></tr>`
      : '',
    data.attendantDailyUzs > 0
      ? `<tr><td>Qarovchi${data.attendantName ? ' (' + esc(data.attendantName) + ')' : ''} (${data.days} kun × ${fmt(data.attendantDailyUzs)})</td><td class="r">${fmt(data.totalAttendantUzs)}</td></tr>`
      : '',
    data.totalServicesUzs > 0
      ? `<tr><td>Qo'shimcha xizmatlar</td><td class="r">${fmt(data.totalServicesUzs)}</td></tr>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  // Qarovchi bloki
  const attendantBlock = data.attendantName
    ? `<div class="box">
        <div class="box-title">Qarovchi</div>
        <div class="kv"><span>F.I.O.</span><b>${esc(data.attendantName)}</b></div>
        <div class="kv"><span>Telefon</span><b>${esc(data.attendantPhone ?? '—')}</b></div>
        <div class="kv"><span>Yoshi</span><b>${data.attendantAge != null ? data.attendantAge + ' yosh' : '—'}</b></div>
        <div class="kv"><span>Jinsi</span><b>${data.attendantGender ? GENDER[data.attendantGender] ?? data.attendantGender : '—'}</b></div>
      </div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="utf-8" />
<title>Statsionar hisob-faktura — ${esc(data.patientName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 20mm 16mm; font-size: 12px; }
  h1 { font-size: 20px; text-align: center; margin: 0 0 2px; }
  .sub { text-align: center; color: #666; font-size: 12px; margin-bottom: 14px; }
  hr { border: none; border-top: 1px solid #ccc; margin: 10px 0; }
  .grid { display: flex; gap: 16px; flex-wrap: wrap; }
  .box { flex: 1; min-width: 220px; border: 1px solid #ddd; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; }
  .box-title { font-weight: 700; font-size: 11px; text-transform: uppercase; color: #666; margin-bottom: 6px; }
  .kv { display: flex; justify-content: space-between; padding: 2px 0; }
  .kv span { color: #777; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 14px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
  th { background: #f5f5f5; font-size: 11px; text-transform: uppercase; color: #555; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  .center { text-align: center; }
  .muted { color: #999; }
  .totals { margin-left: auto; width: 60%; }
  .totals .kv { padding: 4px 0; }
  .totals .total { font-size: 15px; font-weight: 700; border-top: 2px solid #333; padding-top: 8px; margin-top: 4px; }
  .debt { color: #c00; }
  .deposit { color: #090; }
  .foot { margin-top: 24px; text-align: center; color: #aaa; font-size: 10px; }
  @media print { body { padding: 12mm; } @page { size: A4; margin: 0; } }
</style>
</head>
<body>
  <h1>${esc(data.clinicName)}</h1>
  <div class="sub">STATSIONAR HISOB-FAKTURA</div>

  <div class="grid">
    <div class="box">
      <div class="box-title">Bemor</div>
      <div class="kv"><span>F.I.O.</span><b>${esc(data.patientName)}</b></div>
      <div class="kv"><span>Telefon</span><b>${esc(data.patientPhone ?? '—')}</b></div>
      <div class="kv"><span>Yoshi</span><b>${ageFromDob(data.patientDob)}</b></div>
      <div class="kv"><span>Jinsi</span><b>${data.patientGender ? GENDER[data.patientGender] ?? data.patientGender : '—'}</b></div>
      ${data.patientAddress ? `<div class="kv"><span>Manzil</span><b>${esc(data.patientAddress)}</b></div>` : ''}
    </div>
    ${attendantBlock}
  </div>

  <div class="grid">
    <div class="box">
      <div class="box-title">Davolanish</div>
      <div class="kv"><span>Xona / yotoq</span><b>${esc(data.roomLabel ?? '—')}</b></div>
      <div class="kv"><span>Shifokor</span><b>${esc(data.doctorName ?? '—')}</b></div>
      <div class="kv"><span>Qabul sanasi</span><b>${fmtDate(data.admittedAt)}</b></div>
      <div class="kv"><span>Chiqish sanasi</span><b>${fmtDate(data.dischargedAt)}</b></div>
      <div class="kv"><span>Davolangan kun</span><b>${data.days} kun</b></div>
    </div>
  </div>

  <h3 style="font-size:13px;margin:8px 0 4px;">Qo'shimcha xizmatlar</h3>
  <table>
    <thead><tr><th>№</th><th>Xizmat</th><th>Shifokor</th><th class="r">Summa</th></tr></thead>
    <tbody>${serviceRows}</tbody>
  </table>

  <h3 style="font-size:13px;margin:8px 0 4px;">Kunlik to'lov tarkibi</h3>
  <table>
    <tbody>${breakdownRows}</tbody>
  </table>

  <div class="totals">
    <div class="kv"><span>Kunlik to'lovlar jami</span><b>${fmt(data.totalDailyChargedUzs)} so'm</b></div>
    <div class="kv"><span>To'langan (depozit)</span><b>${fmt(data.totalDepositedUzs)} so'm</b></div>
    ${
      debt > 0
        ? `<div class="kv total debt"><span>JAMI TO'LOV (QARZ)</span><span>${fmt(debt)} so'm</span></div>`
        : `<div class="kv total deposit"><span>QOLDIQ (depozit)</span><span>${fmt(deposit)} so'm</span></div>`
    }
  </div>

  <div class="foot">Chop etilgan: ${new Date().toLocaleString('uz-UZ')}</div>
</body>
</html>`;

  // Yangi oynada ochib, print dialogini chaqiramiz (PDF saqlash yoki bosib chiqarish).
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) {
    throw new Error('Yangi oyna ochilmadi — brauzer popup bloklagan bo‘lishi mumkin');
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Rasm/shrift yuklanishi uchun biroz kutib, print chaqiramiz.
  w.onload = () => {
    w.focus();
    w.print();
  };
  // Fallback: onload ishlamasa
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
      /* allaqachon print qilingan */
    }
  }, 500);
}
