// Lazy-loaded PDF export — html2canvas + jsPDF.
// jsPDF + html2canvas bundle ~400KB, shu sababli dynamic import qilamiz
// (faqat user "PDF" tugmasini bossa yuklanadi).

export async function exportLabResultPdf(filename = 'lab-result.pdf'): Promise<void> {
  // .lab-print-area DOM'da hidden, lekin print-only CSS bilan
  // o'sha sahifa avtomatik chop etiladi. PDF uchun esa biz uni
  // **vaqtincha ko'rinarli** qilib html2canvas bilan rasm olamiz,
  // keyin jsPDF bilan A4 PDF yaratamiz.
  const area = document.querySelector<HTMLElement>('.lab-print-area');
  if (!area) {
    throw new Error('Lab print area DOM\'da topilmadi');
  }

  // 1) Vaqtincha ko'rinarli qilamiz (off-screen)
  const orig = {
    display: area.style.display,
    position: area.style.position,
    left: area.style.left,
    top: area.style.top,
    width: area.style.width,
    background: area.style.background,
    padding: area.style.padding,
    color: area.style.color,
    visibility: area.style.visibility,
  };
  area.style.display = 'block';
  area.style.visibility = 'visible';
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  area.style.top = '0';
  area.style.width = '210mm'; // A4 width
  area.style.padding = '20mm 15mm';
  area.style.background = '#fff';
  area.style.color = '#000';

  try {
    const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);

    const canvas = await html2canvas(area, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#fff',
      logging: false,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

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
    pdf.save(filename);
  } finally {
    // Restore inline styles so @media print CSS hides it again next time
    area.style.display = orig.display;
    area.style.visibility = orig.visibility;
    area.style.position = orig.position;
    area.style.left = orig.left;
    area.style.top = orig.top;
    area.style.width = orig.width;
    area.style.padding = orig.padding;
    area.style.background = orig.background;
    area.style.color = orig.color;
  }
}
