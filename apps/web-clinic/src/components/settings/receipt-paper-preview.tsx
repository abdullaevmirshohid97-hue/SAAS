import { useEffect, useState } from 'react';

import { printerGeometry, rasterHtml } from '@/lib/desktop-print';
import { DESKTOP_PRINTER_KEY } from '@/lib/desktop-printer';
import { bitsToDataUrl, canvasToBits, renderHtmlDocument } from '@/lib/escpos-raster';
import {
  buildReceiptDoc,
  paymentReceiptHtml,
  type PaymentReceiptData,
  type ReceiptSettings,
} from '@/lib/print-receipt';

const MM_PX = 96 / 25.4;

const SAMPLE = (clinicName: string): PaymentReceiptData => ({
  clinicName,
  ticketNo: 'A-17',
  date: new Date().toLocaleString('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }),
  patientName: 'Karimov Alisher',
  items: [
    { name: 'Ultratovush tekshiruvi (qorin bo‘shlig‘i a’zolari)', qty: 1, amount: 150000 },
    { name: 'Umumiy qon tahlili', qty: 2, amount: 80000 },
  ],
  totalUzs: 230000,
  paidUzs: 200000,
  debtUzs: 30000,
  paymentMethod: 'Naqd',
  transactionId: '7c421648-5a2e-47bd-8ec1-8b30ac717e11',
  doctorName: 'Soliev D.',
  doctorSpecialty: 'Terapevt',
  cashierName: 'Azamat S.',
});

/**
 * "Qog'ozda shunday chiqadi" — printerga ketadigan 1-bit rasmning o'zi
 * (ekrandagi taxminiy HTML emas). Shrift, o'lcham, kenglik va kalibrlash
 * profili qog'ozdagidek hisobga olinadi.
 */
export function ReceiptPaperPreview({
  settings,
  clinicName,
}: {
  settings: ReceiptSettings;
  clinicName: string;
}) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const doc = buildReceiptDoc(paymentReceiptHtml(SAMPLE(clinicName), settings), settings);
        let printer = '';
        try {
          printer = localStorage.getItem(DESKTOP_PRINTER_KEY) ?? '';
        } catch {
          /* ignore */
        }
        const { dots } = printerGeometry(printer || null, doc.paper);
        const canvas = await renderHtmlDocument(
          rasterHtml(doc.html),
          Math.round(doc.contentMm * MM_PX),
          dots,
          200,
        );
        const url = bitsToDataUrl(canvasToBits(canvas, dots));
        if (!cancelled) {
          setSrc(url);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [settings, clinicName]);

  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
        Qog‘ozda shunday chiqadi (printer rasmi)
      </div>
      <div className="flex justify-center rounded-md border bg-white p-2">
        {error ? (
          <p className="text-destructive text-xs">{error}</p>
        ) : src ? (
          // 576 nuqta ≈ 72 mm — ekranda ham taxminan qog'oz kengligida
          <img
            src={src}
            alt="Chek ko'rinishi"
            style={{
              width: settings.paper_width === '58mm' ? '48mm' : '72mm',
              imageRendering: 'pixelated',
            }}
          />
        ) : (
          <p className="text-muted-foreground text-xs">Tayyorlanmoqda…</p>
        )}
      </div>
    </div>
  );
}
