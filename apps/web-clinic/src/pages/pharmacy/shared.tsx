import { useState, type ReactNode } from 'react';
import { FileText, Printer } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@clary/ui-web';
import { formatStock, type MedUnitInfo } from '@clary/utils';

import { qrSvg } from '@/lib/labels';
import type { ReceiptMode } from '@/lib/pharmacy/print';

export const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('uz-UZ');

// Prixot qatori/panel uchun yorliqli maydon
export function LineField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="text-muted-foreground text-[11px] font-medium">{label}</div>
      {children}
    </label>
  );
}

export function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'primary' | 'success';
}) {
  return (
    <div className="bg-card rounded-lg border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div
        className={
          'mt-1 text-lg font-semibold ' +
          (tone === 'success' ? 'text-emerald-600' : tone === 'primary' ? 'text-primary' : '')
        }
      >
        {value}
      </div>
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

/** Qoldiq: "3 qadoq + 5 dona" (qadoqda > 1 dona bo'lsa). */
export function StockText({ qty, med }: { qty: number; med: MedUnitInfo }) {
  return <>{formatStock(qty, med)}</>;
}

export type PharmPeriod = 'today' | 'week' | 'month' | 'year' | 'all';

export function pharmRange(p: PharmPeriod): { from?: string; to?: string } {
  if (p === 'all') return {};
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  if (p === 'today') start.setHours(0, 0, 0, 0);
  else if (p === 'week') {
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else if (p === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (p === 'year') {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

// ---------------------------------------------------------------------------
// QR yorliq — LOKAL QR (ilgari tashqi api.qrserver.com'ga so'rov ketardi:
// internet yo'q bo'lsa chiqmasdi va dori ma'lumoti tashqariga ketardi)
// ---------------------------------------------------------------------------
export function QrLabelModal({
  open,
  med,
  onClose,
}: {
  open: boolean;
  med: { name: string; barcode: string; price_uzs: number; strength?: string } | null;
  onClose: () => void;
}) {
  if (!med) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>QR yorliq</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 rounded-lg border p-4">
          <div
            className="h-36 w-36 [&_svg]:h-full [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qrSvg(med.barcode, 144) }}
          />
          <div className="text-center">
            <div className="text-sm font-semibold">{med.name}</div>
            {med.strength && <div className="text-muted-foreground text-xs">{med.strength}</div>}
            <div className="mt-1 font-mono text-xs">{med.barcode}</div>
            {med.price_uzs > 0 && (
              <div className="mt-1 text-sm font-bold">{fmt(med.price_uzs)} so'm</div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Yopish
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" />
            Chop etish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Sotuvdan keyin chek turini so'raydigan dialog. "Eslab qol" belgilansa
 * keyingi safar so'ralmaydi.
 */
export function ReceiptChoiceDialog({
  open,
  summary,
  onPick,
  onClose,
}: {
  open: boolean;
  summary: string;
  onPick: (m: Exclude<ReceiptMode, 'ask'>, remember: boolean) => void;
  onClose: () => void;
}) {
  const [remember, setRemember] = useState(false);
  const pick = (m: Exclude<ReceiptMode, 'ask'>) => {
    onPick(m, remember);
    setRemember(false);
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Chekni qanday chiqaramiz?</DialogTitle>
          <DialogDescription>{summary}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Button className="h-auto justify-start py-3" onClick={() => pick('thermal')} autoFocus>
            <Printer className="mr-2.5 h-4 w-4 shrink-0" />
            <span className="text-left">
              Termal chek
              <span className="block text-xs font-normal opacity-80">
                Kassa printeri (58/80 mm)
              </span>
            </span>
          </Button>
          <Button
            variant="outline"
            className="h-auto justify-start py-3"
            onClick={() => pick('a4')}
          >
            <FileText className="mr-2.5 h-4 w-4 shrink-0" />
            <span className="text-left">
              A4 chek
              <span className="text-muted-foreground block text-xs font-normal">
                To‘liq varaq — korxona/klinika uchun
              </span>
            </span>
          </Button>
          <Button variant="ghost" className="justify-start" onClick={() => pick('none')}>
            Chek kerak emas
          </Button>
        </div>
        <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Bu tanlovni eslab qol — keyingi sotuvlarda so‘ralmasin
        </label>
      </DialogContent>
    </Dialog>
  );
}

/** Supabase storage'ga dori rasmi. */
export async function uploadMedImage(file: File): Promise<string> {
  const { supabase } = await import('@/lib/supabase');
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `medications/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from('staff-files')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from('staff-files').getPublicUrl(path);
  return data.publicUrl;
}

/** Xatodan foydalanuvchiga ko'rsatiladigan matn. */
export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? 'Xato');
}
