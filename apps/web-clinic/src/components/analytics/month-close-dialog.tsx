import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck, CheckCircle2, Lock, Vault } from 'lucide-react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Textarea,
} from '@clary/ui-web';
import type { FinanceReport } from '@clary/api-client';

import { api } from '@/lib/api';

// =============================================================================
// OY YOPISH — bank kassiri kun yopish tartibi bilan bir xil ketma-ketlik
// =============================================================================
// NEGA SHUNCHAKI "tugma bosdim → pul seyfga o'tdi" EMAS:
// inkasatsiya JISMONIY hodisa. Tizim "seyfga o'tdi" desa-yu, pul aslida
// kassada qolsa — kitob yolg'on gapiradi va bu aynan "bitta xato millionlab
// zarar" holati. Shuning uchun yopish uch qadam:
//
//   1) NAQDNI SANASH   — tizim nechta deydi, qo'lda nechta chiqdi;
//   2) FARQNI YOZISH   — ortiqcha/kam ochiq tuzatuv yozuvi bilan yopiladi
//                        (bankda "izlishek/nedostacha" — yashirilmaydi);
//   3) SEYFGA O'TKAZISH — kassa nolga tushadi, davr qulflanadi.
//
// Qayta ochish PULNI QAYTARMAYDI — pul seyfda qoladi (jismoniy holat o'zgarmaydi).
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

export function MonthCloseDialog({
  from,
  to,
  report,
  disabled,
  onClosed,
}: {
  from: string;
  to: string;
  report: FinanceReport;
  disabled?: boolean;
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [counted, setCounted] = useState('');
  const [moveCash, setMoveCash] = useState(true);
  const [settleNoncash, setSettleNoncash] = useState(false);
  const [force, setForce] = useState(false);
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.financeReport.close>> | null>(
    null,
  );

  const systemCash = report.closing.cash;
  const countedNum = counted.trim() === '' ? null : Number(counted.replace(/[^\d-]/g, ''));
  const diff = countedNum == null ? 0 : countedNum - systemCash;
  const hasWarnings = report.warnings.length > 0;

  const closeMut = useMutation({
    mutationFn: () =>
      api.financeReport.close({
        from,
        to,
        register: 'reception',
        cash_counted_uzs: countedNum,
        move_cash_to_safe: moveCash,
        settle_noncash: settleNoncash,
        notes: notes.trim() || undefined,
        force,
      }),
    onSuccess: (r) => {
      setResult(r);
      setStep(2);
      toast.success('Davr yopildi');
      onClosed();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function reset() {
    setStep(1);
    setResult(null);
    setCounted('');
    setNotes('');
    setForce(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <CalendarCheck className="mr-1.5 h-3.5 w-3.5" />
          {disabled ? 'Davr yopilgan' : 'Oy yopish'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle>
                Oy yopish — {from} → {to}
              </DialogTitle>
              <DialogDescription>
                Kassa sanaladi, farq ochiq yoziladi, naqd seyfga o‘tadi va davr qulflanadi.
              </DialogDescription>
            </DialogHeader>

            {hasWarnings && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                <div className="mb-1 flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" /> Svertka mos kelmadi
                </div>
                Hisobotda farq bor. Yopishdan oldin uni tekshirish tavsiya etiladi — yopilgandan
                keyin bu davrga orqaga yozuv kiritib bo‘lmaydi.
              </div>
            )}

            {/* 1-qadam: naqdni sanash */}
            <div className="space-y-3 rounded-lg border p-3">
              <div className="text-sm font-semibold">1. Kassadagi naqdni sanang</div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Tizim bo‘yicha kassada:</span>
                <span className="font-bold tabular-nums">{fmt(systemCash)} so‘m</span>
              </div>
              <label className="text-muted-foreground flex flex-col gap-1 text-xs">
                Qo‘lda sanaldi (bo‘sh qoldirsangiz svertka qilinmaydi)
                <Input
                  inputMode="numeric"
                  placeholder={String(systemCash)}
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                />
              </label>
              {countedNum != null && (
                <div
                  className={
                    'rounded-md border p-2.5 text-xs ' +
                    (diff === 0
                      ? 'border-emerald-400 text-emerald-700 dark:text-emerald-400'
                      : 'border-destructive text-destructive')
                  }
                >
                  {diff === 0 ? (
                    <>✓ Farq yo‘q — kassa tizim bilan mos.</>
                  ) : (
                    <>
                      Farq:{' '}
                      <b>
                        {diff > 0 ? '+' : ''}
                        {fmt(diff)}
                      </b>{' '}
                      so‘m ({diff > 0 ? 'ortiqcha' : 'kam'}). Yopishda ochiq tuzatuv yozuvi
                      yaratiladi — hech narsa yashirilmaydi.
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 2-qadam: pul harakati */}
            <div className="space-y-2.5 rounded-lg border p-3">
              <div className="text-sm font-semibold">2. Pulni joyiga qo‘yish</div>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={moveCash}
                  onChange={(e) => setMoveCash(e.target.checked)}
                />
                <span>
                  <b>Kassadagi naqdni to‘liq seyfga o‘tkazish</b>
                  <span className="text-muted-foreground block text-xs">
                    Inkasatsiya yoziladi, kassa nolga tushadi. Pul JISMONAN seyfga qo‘yilganiga
                    ishonch hosil qiling.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={settleNoncash}
                  onChange={(e) => setSettleNoncash(e.target.checked)}
                />
                <span>
                  Bankka o‘tmagan naqdsiz pulni ham bankka olish
                  <span className="text-muted-foreground block text-xs">
                    Hozir yo‘lda: <b>{fmt(report.closing.pending)}</b> so‘m
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                />
                <span className="text-muted-foreground text-xs">
                  Ochiq smena bo‘lsa ham majburan yopish (tavsiya etilmaydi)
                </span>
              </label>
              <Textarea
                rows={2}
                placeholder="Izoh (ixtiyoriy) — masalan: 10-sana yopilishi, kassir topshirdi"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="bg-muted/40 rounded-md p-3 text-xs">
              <div className="mb-1 font-semibold">Yopilgandan keyin:</div>
              <ul className="text-muted-foreground list-disc space-y-0.5 pl-4">
                <li>
                  Bu davrga <b>orqaga sana bilan</b> rasxot/yozuv kiritib bo‘lmaydi.
                </li>
                <li>Hisobot snapshot qilib saqlanadi — keyin ma’lumot o‘zgarsa ham o‘zgarmaydi.</li>
                <li>Bugungi kun ochiq qoladi — kunlik ish to‘xtamaydi.</li>
              </ul>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Bekor
              </Button>
              <Button onClick={() => closeMut.mutate()} disabled={closeMut.isPending}>
                <Lock className="mr-1.5 h-4 w-4" />
                {closeMut.isPending ? 'Yopilmoqda…' : 'Davrni yopish'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Davr yopildi
              </DialogTitle>
              <DialogDescription>
                {result?.period.from} → {result?.period.to}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5 text-sm">
              {(result?.steps ?? []).map((s) => (
                <div key={s} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{s}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md border p-2.5">
                <div className="text-muted-foreground text-[11px] uppercase">
                  Kassa — yopishdan oldin
                </div>
                <div className="font-bold tabular-nums">
                  {fmt(result?.before.closing.cash ?? 0)}
                </div>
              </div>
              {/* JONLI raqam (davr qoldig'i emas): davr o'tgan sana bilan
                  yopilsa inkasatsiya bugungi kunga tushadi va davr qoldig'i
                  o'zgarmaydi — "kassa nolga tushdi" deb eski raqamni
                  ko'rsatmaslik uchun kassa kartasidagi jonli qiymat olinadi. */}
              <div className="rounded-md border p-2.5">
                <div className="text-muted-foreground text-[11px] uppercase">Kassa — hozir</div>
                <div className="font-bold tabular-nums">{fmt(result?.live.cash ?? 0)}</div>
              </div>
              <div className="rounded-md border p-2.5">
                <div className="text-muted-foreground flex items-center gap-1 text-[11px] uppercase">
                  <Vault className="h-3 w-3" /> Seyf — hozir
                </div>
                <div className="font-bold tabular-nums">{fmt(result?.live.safe ?? 0)}</div>
              </div>
              <div className="rounded-md border p-2.5">
                <div className="text-muted-foreground text-[11px] uppercase">Seyfga o‘tkazildi</div>
                <div className="font-bold tabular-nums">{fmt(result?.moved_to_safe_uzs ?? 0)}</div>
              </div>
            </div>

            {(result?.cash_diff_uzs ?? 0) !== 0 && (
              <Badge variant="secondary" className="w-fit">
                Kassa farqi yozildi: {fmt(result?.cash_diff_uzs ?? 0)} so‘m
              </Badge>
            )}

            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Yopish</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
