import { useEffect, useState } from 'react';
import { Ruler } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@clary/ui-web';

import { desktopCalibrationJob } from '@/lib/desktop-print';
import {
  receiptPrinterProfile,
  setReceiptPrinterProfile,
  type ReceiptCols,
  type ReceiptDots,
} from '@/lib/desktop-printer';

// =============================================================================
// Chek printerini KALIBRLASH — "qog'oz kengligi 80mm" printerning haqiqiy
// bosish kengligini aytmaydi (576 yoki 512 nuqta; 48 yoki 42 belgi). Noto'g'ri
// kenglik chekni kesadi yoki "axlat" qiladi. Foydalanuvchi sinov chizig'ini
// bosadi va qaysi variant TO'LIQ chiqqanini tanlaydi — printer nomi bilan saqlanadi.
// =============================================================================

const DOTS_OPTIONS: Array<{ v: ReceiptDots; label: string }> = [
  { v: 384, label: '384 nuqta (58mm)' },
  { v: 512, label: '512 nuqta (80mm, tor)' },
  { v: 576, label: '576 nuqta (80mm)' },
];
const COLS_OPTIONS: Array<{ v: ReceiptCols; label: string }> = [
  { v: 32, label: '32 belgi (58mm)' },
  { v: 42, label: '42 belgi (80mm, tor)' },
  { v: 48, label: '48 belgi (80mm)' },
];

export function ReceiptCalibration({ printerName }: { printerName: string }) {
  const [dots, setDots] = useState<ReceiptDots | ''>('');
  const [cols, setCols] = useState<ReceiptCols | ''>('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const p = receiptPrinterProfile(printerName);
    setDots(p.dots ?? '');
    setCols(p.cols ?? '');
  }, [printerName]);

  if (!printerName) return null;

  const persist = (next: { dots?: ReceiptDots | ''; cols?: ReceiptCols | '' }) => {
    const d = next.dots ?? dots;
    const c = next.cols ?? cols;
    setReceiptPrinterProfile(printerName, {
      ...(d ? { dots: d } : {}),
      ...(c ? { cols: c } : {}),
    });
    toast.success(`"${printerName}" uchun saqlandi`);
  };

  async function sendRuler() {
    setSending(true);
    try {
      const job = await desktopCalibrationJob();
      if (job) {
        toast.success('Kalibrlash cheki yuborildi', {
          description:
            job.mode === 'raster'
              ? "Qaysi chiziq chetdan chetga BUTUN chiqdi — o'shani tanlang"
              : "Qaysi o'lchov qatori BITTA qatorga sig'di — o'shani tanlang",
        });
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-muted/30 space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Ruler className="h-3.5 w-3.5" /> Kalibrlash — chek kesilsa yoki "axlat" chiqsa
        </div>
        <Button variant="outline" size="sm" disabled={sending} onClick={() => void sendRuler()}>
          {sending ? 'Yuborilmoqda…' : "Sinov chizig'i"}
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Rasmli chek kengligi</span>
          <select
            value={dots}
            onChange={(e) => {
              const v = (Number(e.target.value) || '') as ReceiptDots | '';
              setDots(v);
              persist({ dots: v });
            }}
            className="bg-background h-8 w-full rounded-md border px-2 text-sm"
          >
            <option value="">Avtomatik (qog‘oz kengligidan)</option>
            {DOTS_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Matnli chek: qatordagi belgilar</span>
          <select
            value={cols}
            onChange={(e) => {
              const v = (Number(e.target.value) || '') as ReceiptCols | '';
              setCols(v);
              persist({ cols: v });
            }}
            className="bg-background h-8 w-full rounded-md border px-2 text-sm"
          >
            <option value="">Avtomatik (qog‘oz kengligidan)</option>
            {COLS_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-muted-foreground text-[11px]">
        Yangi desktop ilova chekni rasm qilib chiqaradi (kenglik — nuqta), eski versiya — matn
        (belgilar soni). Ikkalasini ham sozlab qo‘ysangiz, yangilangandan keyin ham to‘g‘ri chiqadi.
      </p>
    </div>
  );
}
