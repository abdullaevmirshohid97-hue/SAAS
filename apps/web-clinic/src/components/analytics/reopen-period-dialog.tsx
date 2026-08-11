import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, RotateCcw, Unlock } from 'lucide-react';
import { toast } from 'sonner';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Textarea,
} from '@clary/ui-web';
import type { FinancePeriodClosing } from '@clary/api-client';

import { api } from '@/lib/api';

// =============================================================================
// YOPISHNI QAYTARISH
// =============================================================================
// Yopish tugmasi IKKI XIL holatda bosiladi va qaytarish ham shunga qarab
// boshqacha bo'lishi kerak:
//
//   (a) Pul HAQIQATAN seyfga qo'yilgan, lekin davrni noto'g'ri tanlagan —
//       unda faqat QULF ochiladi. Inkasatsiyani bekor qilish kitobni
//       yolg'onga aylantiradi: pul seyfda turibdi-ku.
//
//   (b) Xato bosilgan, pul kassada qolgan — unda inkasatsiya ham BEKOR
//       QILINISHI SHART, aks holda tizim pulni seyfda deb ko'rsatib turadi
//       va kassir ertaga hisobni jo'natolmaydi.
//
// Qaysi holat ekanini faqat odam biladi — shuning uchun tanlov beriladi,
// biz taxmin qilmaymiz. Bekor qilish O'CHIRISH emas: yozuv `is_void` bilan
// belgilanadi va izohiga audit qatori qo'shiladi.
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

export function ReopenPeriodDialog({
  closing,
  onDone,
  trigger,
}: {
  closing: Pick<
    FinancePeriodClosing,
    'id' | 'period_from' | 'period_to' | 'moved_to_safe_uzs' | 'settled_uzs' | 'cash_diff_uzs'
  >;
  onDone: () => void;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [undoCash, setUndoCash] = useState(false);
  const [undoSettle, setUndoSettle] = useState(false);
  const [undoCorrection, setUndoCorrection] = useState(false);

  const hasCash = closing.moved_to_safe_uzs > 0;
  const hasSettle = closing.settled_uzs > 0;
  const hasCorrection = closing.cash_diff_uzs !== 0;

  const mut = useMutation({
    mutationFn: () =>
      api.financeReport.reopen({
        id: closing.id,
        reason: reason.trim(),
        undo_cash_move: undoCash,
        undo_settlement: undoSettle,
        undo_correction: undoCorrection,
      }),
    onSuccess: (r) => {
      toast.success(r.note, { description: r.undone.join(' · '), duration: 8000 });
      setOpen(false);
      setReason('');
      setUndoCash(false);
      setUndoSettle(false);
      setUndoCorrection(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const anyUndo = undoCash || undoSettle || undoCorrection;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Yopishni qaytarish
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Yopishni qaytarish — {closing.period_from} → {closing.period_to}
          </DialogTitle>
          <DialogDescription>
            Davr qulfi ochiladi. Pul harakatlarini ham bekor qilish — alohida tanlov.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 rounded-lg border p-3">
          <div className="text-sm font-semibold">Yopishda nima bo‘lgan edi</div>
          <ul className="text-muted-foreground space-y-1 text-sm">
            <li>
              {hasCash ? '💵' : '—'} Seyfga o‘tkazildi: <b>{fmt(closing.moved_to_safe_uzs)}</b> so‘m
            </li>
            <li>
              {hasSettle ? '🏦' : '—'} Bankka olindi: <b>{fmt(closing.settled_uzs)}</b> so‘m
            </li>
            <li>
              {hasCorrection ? '⚖️' : '—'} Kassa svertkasi tuzatuvi:{' '}
              <b>{fmt(closing.cash_diff_uzs)}</b> so‘m
            </li>
          </ul>
        </div>

        <div className="space-y-2.5 rounded-lg border p-3">
          <div className="text-sm font-semibold">Nimani bekor qilamiz?</div>
          <p className="text-muted-foreground text-xs">
            <b>Pul haqiqatan seyfga qo‘yilgan bo‘lsa</b> — hech narsani belgilamang, faqat qulf
            ochiladi. <b>Xato bosilgan, pul kassada qolgan bo‘lsa</b> — inkasatsiyani belgilang,
            aks holda tizim pulni seyfda deb ko‘rsatib turadi.
          </p>

          {hasCash && (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={undoCash}
                onChange={(e) => setUndoCash(e.target.checked)}
              />
              <span>
                Inkasatsiyani bekor qilish
                <span className="text-muted-foreground block text-xs">
                  {fmt(closing.moved_to_safe_uzs)} so‘m seyfdan kassaga qaytadi
                </span>
              </span>
            </label>
          )}
          {hasSettle && (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={undoSettle}
                onChange={(e) => setUndoSettle(e.target.checked)}
              />
              <span>
                Bankka olishni bekor qilish
                <span className="text-muted-foreground block text-xs">
                  {fmt(closing.settled_uzs)} so‘m yana “yo‘ldagi pul”ga qaytadi
                </span>
              </span>
            </label>
          )}
          {hasCorrection && (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={undoCorrection}
                onChange={(e) => setUndoCorrection(e.target.checked)}
              />
              <span>
                Kassa svertkasi tuzatuvini bekor qilish
                <span className="text-muted-foreground block text-xs">
                  Sanoq noto‘g‘ri kiritilgan bo‘lsa belgilang
                </span>
              </span>
            </label>
          )}
          {!hasCash && !hasSettle && !hasCorrection && (
            <p className="text-muted-foreground text-xs">
              Bu yopishda pul harakati bo‘lmagan — faqat qulf ochiladi.
            </p>
          )}
        </div>

        {anyUndo && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Bekor qilingan yozuvlar o‘chmaydi — ular “bekor qilingan” deb belgilanadi va
              izohida kim, qachon, nega qilgani qoladi.
            </span>
          </div>
        )}

        <Textarea
          rows={2}
          placeholder="Sabab (majburiy) — masalan: davr noto‘g‘ri tanlangan"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Bekor
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || reason.trim().length < 3}
          >
            <Unlock className="mr-1.5 h-4 w-4" />
            {mut.isPending ? 'Bajarilmoqda…' : 'Qaytarish'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
