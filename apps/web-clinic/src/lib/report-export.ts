// =============================================================================
// A4 hisobot eksporti (Faza 5B) — Report Builder uchun.
// Bitta HTML manbadan ikki chiqish:
//   printA4()      — yashirin iframe orqali A4 chop etish (pop-up bloklanmaydi)
//   downloadA4Pdf() — off-screen A4 div + html2canvas + jsPDF (yuklab olish)
// jsPDF+html2canvas dynamic import (~400KB) — faqat bosilganda yuklanadi.
// =============================================================================

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A4 hujjat uchun umumiy stil — print va PDF'da bir xil ko'rinish.
const A4_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #000; background: #fff; }
  .doc-title { font-size: 18px; font-weight: 700; margin: 0 0 2px; }
  .doc-meta { font-size: 11px; color: #555; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; }
  th { background: #f3f4f6; font-weight: 600; }
  td.r, th.r { text-align: right; }
  tfoot td { font-weight: 700; background: #f9fafb; }
  .doc-footer { margin-top: 16px; font-size: 10px; color: #888; text-align: right; }
`;

/** A4 hujjatni yashirin iframe orqali chop etadi (dialog bilan, pop-up'siz). */
export function printA4(innerHtml: string, title: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<style>@page{size:A4;margin:15mm}${A4_CSS}</style></head>` +
      `<body>${innerHtml}</body></html>`,
  );
  doc.close();

  const win = iframe.contentWindow;
  const done = () => {
    setTimeout(() => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    }, 1000);
  };
  if (win) {
    win.onafterprint = done;
    setTimeout(() => {
      win.focus();
      win.print();
    }, 150);
  } else {
    done();
  }
}

/** A4 hujjatni PDF qilib yuklab oladi (html2canvas + jsPDF, ko'p sahifali). */
export async function downloadA4Pdf(innerHtml: string, filename: string): Promise<void> {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-9999px;top:0;width:210mm;padding:15mm;background:#fff;color:#000;';
  wrap.innerHTML = `<style>${A4_CSS}</style>${innerHtml}`;
  document.body.appendChild(wrap);

  try {
    const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);

    const canvas = await html2canvas(wrap, {
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
    document.body.removeChild(wrap);
  }
}
