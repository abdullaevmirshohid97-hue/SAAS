// Statsionar chiqish hisob-faktura — A4 PDF (jsPDF).
// DOM kerak emas — ma'lumotlardan to'g'ridan-to'g'ri chizamiz (kontrolli layout).
// jsPDF ~250KB, shu sababli dynamic import (faqat "PDF" bosilganda yuklanadi).

export type InpatientInvoiceData = {
  clinicName: string;
  patientName: string;
  patientPhone?: string | null;
  roomLabel?: string | null;
  doctorName?: string | null;
  attendantName?: string | null;
  admittedAt: string; // ISO
  dischargedAt?: string | null; // ISO
  days: number;
  // Qo'shimcha xizmatlar (transactions)
  services: Array<{ name: string; quantity: number; amount_uzs: number; doctor_name?: string | null }>;
  // Kunlik to'lovlar (charges) — ixtiyoriy umumlashtirilgan satr
  totalDailyChargedUzs: number;
  totalServicesUzs: number;
  totalDepositedUzs: number;
  balanceUzs: number; // + depozit qoldig'i, − qarz
};

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('uz-UZ') : '—';

export async function exportInpatientInvoicePdf(
  data: InpatientInvoiceData,
  filename = 'statsionar-hisob.pdf',
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const marginL = 15;
  const marginR = pageW - 15;
  let y = 18;

  // Sarlavha
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text(data.clinicName, pageW / 2, y, { align: 'center' });
  y += 7;
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');
  pdf.text('STATSIONAR HISOB-FAKTURA', pageW / 2, y, { align: 'center' });
  y += 6;
  pdf.setDrawColor(180);
  pdf.line(marginL, y, marginR, y);
  y += 7;

  // Bemor ma'lumotlari (2 ustun)
  pdf.setFontSize(10);
  const row = (label: string, value: string, yy: number) => {
    pdf.setFont('helvetica', 'bold');
    pdf.text(label, marginL, yy);
    pdf.setFont('helvetica', 'normal');
    pdf.text(value, marginL + 38, yy);
  };
  row('Bemor:', data.patientName || '—', y);
  if (data.patientPhone) {
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Tel: ${data.patientPhone}`, marginL + 110, y);
  }
  y += 6;
  row('Xona / yotoq:', data.roomLabel || '—', y);
  y += 6;
  if (data.doctorName) {
    row('Shifokor:', data.doctorName, y);
    y += 6;
  }
  if (data.attendantName) {
    row('Qarovchi:', data.attendantName, y);
    y += 6;
  }
  row('Qabul sanasi:', fmtDate(data.admittedAt), y);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Chiqish: ${fmtDate(data.dischargedAt)}`, marginL + 110, y);
  y += 6;
  row('Davolanish:', `${data.days} kun`, y);
  y += 8;

  pdf.setDrawColor(180);
  pdf.line(marginL, y, marginR, y);
  y += 6;

  // Xizmatlar jadvali
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.text('Qo‘shimcha xizmatlar', marginL, y);
  y += 5;
  // Jadval sarlavhasi
  pdf.setFontSize(9);
  pdf.text('№', marginL, y);
  pdf.text('Xizmat', marginL + 8, y);
  pdf.text('Shifokor', marginL + 95, y);
  pdf.text('Soni', marginR - 32, y, { align: 'right' });
  pdf.text('Summa', marginR, y, { align: 'right' });
  y += 2;
  pdf.line(marginL, y, marginR, y);
  y += 5;
  pdf.setFont('helvetica', 'normal');

  if (data.services.length === 0) {
    pdf.text('Qo‘shimcha xizmatlar yo‘q', marginL + 8, y);
    y += 6;
  } else {
    data.services.forEach((s, i) => {
      if (y > 270) {
        pdf.addPage();
        y = 18;
      }
      pdf.text(String(i + 1), marginL, y);
      pdf.text(pdf.splitTextToSize(s.name, 80)[0] ?? s.name, marginL + 8, y);
      pdf.text(s.doctor_name ? (pdf.splitTextToSize(s.doctor_name, 35)[0] ?? '') : '—', marginL + 95, y);
      pdf.text(String(s.quantity), marginR - 32, y, { align: 'right' });
      pdf.text(fmt(s.amount_uzs), marginR, y, { align: 'right' });
      y += 6;
    });
  }

  y += 2;
  pdf.line(marginL, y, marginR, y);
  y += 7;

  // Yakuniy hisob-kitob
  const totalRow = (label: string, value: string, bold = false) => {
    if (y > 275) {
      pdf.addPage();
      y = 18;
    }
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(bold ? 11 : 10);
    pdf.text(label, marginR - 60, y, { align: 'right' });
    pdf.text(`${value} so‘m`, marginR, y, { align: 'right' });
    y += 6;
  };
  totalRow('Kunlik to‘lovlar (xona+ovqat+qarovchi):', fmt(data.totalDailyChargedUzs));
  totalRow('Qo‘shimcha xizmatlar:', fmt(data.totalServicesUzs));
  totalRow('To‘langan (depozit):', fmt(data.totalDepositedUzs));
  y += 2;
  pdf.line(marginR - 80, y, marginR, y);
  y += 6;
  if (data.balanceUzs < 0) {
    totalRow('QARZ:', fmt(Math.abs(data.balanceUzs)), true);
  } else {
    totalRow('QOLDIQ (depozit):', fmt(data.balanceUzs), true);
  }

  // Footer
  y += 10;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(120);
  pdf.text(
    `Chop etilgan: ${new Date().toLocaleString('uz-UZ')}`,
    pageW / 2,
    287,
    { align: 'center' },
  );

  pdf.save(filename);
}
