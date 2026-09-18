import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Download,
  Loader2,
  Lock,
  Send,
  Vault,
} from 'lucide-react';
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
// KASSA OYINI YOPISH — bank kassiri kun yopish tartibi bilan bir xil ketma-ketlik
// =============================================================================
// ⚠️ NOM: loyihada IKKITA "oy yopish" bor va ular boshqa-boshqa narsa:
//   /month-closing  = BUXGALTERIYA davri (GL, amortizatsiya, soliq)
//   shu oyna        = KASSA yopish (naqd → seyf, period_closings)
// Shuning uchun tugmada ataylab "Kassa oyini yopish" deb yozilgan.
//
// NEGA SHUNCHAKI "tugma bosdim → pul seyfga o'tdi" EMAS:
// inkasatsiya JISMONIY hodisa. Tizim "seyfga o'tdi" desa-yu, pul aslida
// kassada qolsa — kitob yolg'on gapiradi va bu aynan "bitta xato millionlab
// zarar" holati. Shuning uchun yopish to'rt qadam:
//
//   1) NAQDNI SANASH    — tizim nechta deydi, qo'lda nechta chiqdi;
//   2) FARQNI YOZISH    — ortiqcha/kam ochiq tuzatuv yozuvi bilan yopiladi
//                         (bankda "izlishek/nedostacha" — yashirilmaydi);
//   3) PULNI JOYLASH    — naqd seyfga; naqdsiz pul HAR USUL o'z manziliga
//                         (plastik → bank A, Click → bank B, Payme → seyf);
//   4) TASDIQ           — nima bo'lishi ro'yxati, keyin davr qulflanadi.
//
// Qayta ochish PULNI QAYTARMAYDI — pul seyfda qoladi (jismoniy holat o'zgarmaydi).
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

/** Usul nomlari — serverdagi METHOD_LABEL bilan bir xil bo'lishi kerak. */
const METHOD_LABEL: Record<string, string> = {
  card: 'Plastik',
  humo: 'Humo',
  uzcard: 'UzCard',
  transfer: "O'tkazma",
  mbank: 'MBank',
  click: 'Click',
  payme: 'Payme',
  uzum: 'Uzum',
  kaspi: 'Kaspi',
  stripe: 'Stripe',
  insurance: "Sug'urta",
  aralash: 'Aralash (usuli yozilmagan)',
};

const methodLabel = (m: string) => METHOD_LABEL[m] ?? m;

/** Bitta usul uchun yo'nalish tanlovi. */
type RouteMode = 'bank' | 'safe' | 'other' | 'skip';
type Route = { mode: RouteMode; bankAccountId: string; category: string };

const DEFAULT_ROUTE: Route = { mode: 'bank', bankAccountId: '', category: '' };

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
  const [force, setForce] = useState(false);
  const [notes, setNotes] = useState('');
  const [routes, setRoutes] = useState<Record<string, Route>>({});
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.financeReport.close>> | null>(
    null,
  );

  const systemCash = report.closing.cash;
  const countedNum = counted.trim() === '' ? null : Number(counted.replace(/[^\d-]/g, ''));
  const diff = countedNum == null ? 0 : countedNum - systemCash;
  const hasWarnings = report.warnings.length > 0;

  // Naqdsiz qoldiq — ANIQ usul kesimida (Click va Payme alohida qatorlar).
  const { data: methodRows } = useQuery({
    queryKey: ['noncash-pending-by-method'],
    queryFn: () => api.cashier.noncashPendingByMethod('reception'),
    enabled: open,
    staleTime: 0,
  });
  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.bank.accounts(),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  // Faqat puli borlari ko'rsatiladi — nol qatorlar ekranni to'ldirmasin.
  const pendingRows = useMemo(
    () => (methodRows ?? []).filter((r) => r.pending_uzs > 0),
    [methodRows],
  );

  const routeOf = (m: string): Route => routes[m] ?? DEFAULT_ROUTE;
  const setRoute = (m: string, patch: Partial<Route>) =>
    setRoutes((prev) => ({ ...prev, [m]: { ...(prev[m] ?? DEFAULT_ROUTE), ...patch } }));

  const settlePlan = useMemo(
    () =>
      pendingRows
        .filter((r) => routeOf(r.method).mode !== 'skip')
        .map((r) => {
          const rt = routeOf(r.method);
          return {
            method: r.method,
            amount_uzs: r.pending_uzs,
            // "Boshqa kategoriya" ham bank tomonida qoladi — yo'nalish emas,
            // yorliq. Aks holda pul balansdan yo'qolardi (migratsiya izohi).
            destination: (rt.mode === 'safe' ? 'safe' : 'bank') as 'bank' | 'safe',
            bank_account_id: rt.mode === 'bank' && rt.bankAccountId ? rt.bankAccountId : null,
            category: rt.mode === 'other' && rt.category.trim() ? rt.category.trim() : null,
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingRows, routes],
  );

  const plannedTotal = settlePlan.reduce((a, r) => a + r.amount_uzs, 0);

  // "Boshqa" tanlangan-u yorliq yozilmagan bo'lsa — yopishga yo'l qo'ymaymiz,
  // aks holda kategoriyasiz yozuv qolib, keyin "bu qaysi pul edi?" deb qolinadi.
  const badOther = pendingRows.some((r) => {
    const rt = routeOf(r.method);
    return rt.mode === 'other' && !rt.category.trim();
  });

  const closeMut = useMutation({
    mutationFn: () =>
      api.financeReport.close({
        from,
        to,
        register: 'reception',
        cash_counted_uzs: countedNum,
        move_cash_to_safe: moveCash,
        settle_noncash: false,
        settle_plan: settlePlan.length > 0 ? settlePlan : undefined,
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

  const sendMut = useMutation({
    mutationFn: () => api.telegramReports.sendFinance({ from, to }),
    onSuccess: (r) => toast.success(`Telegramga yuborildi (${r.sent} ta chat)`),
    onError: (e: Error) => toast.error(e.message),
  });

  const [downloading, setDownloading] = useState(false);
  async function downloadPdf() {
    setDownloading(true);
    try {
      const blob = await api.financeReport.pdf({ from, to });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `oy-yopish-${from}_${to}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message || 'PDF yaratilmadi');
    } finally {
      setDownloading(false);
    }
  }

  function reset() {
    setStep(1);
    setResult(null);
    setCounted('');
    setNotes('');
    setForce(false);
    setRoutes({});
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
          {disabled ? 'Davr yopilgan' : 'Kassa oyini yopish'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle>
                Kassa oyini yopish — {from} → {to}
              </DialogTitle>
              <DialogDescription>
                Kassa sanaladi, farq ochiq yoziladi, pul joyiga qo‘yiladi va davr qulflanadi.
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

            {/* 2-qadam: naqd pul */}
            <div className="space-y-2.5 rounded-lg border p-3">
              <div className="text-sm font-semibold">2. Naqd pul</div>
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
            </div>

            {/* 3-qadam: naqdsiz pul — har usul o'z manziliga */}
            <div className="space-y-2.5 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">3. Naqdsiz pul</div>
                <span className="text-muted-foreground text-xs tabular-nums">
                  Jami: {fmt(report.closing.pending)} so‘m
                </span>
              </div>

              {pendingRows.length === 0 ? (
                <p className="text-muted-foreground text-xs">Bankka o‘tmagan naqdsiz pul yo‘q.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Hammasiga bir xil:</span>
                    <button
                      type="button"
                      className="hover:bg-muted rounded-full border px-2.5 py-1"
                      onClick={() =>
                        setRoutes(
                          Object.fromEntries(
                            pendingRows.map((r) => [r.method, { ...DEFAULT_ROUTE, mode: 'bank' }]),
                          ),
                        )
                      }
                    >
                      🏦 Bankka
                    </button>
                    <button
                      type="button"
                      className="hover:bg-muted rounded-full border px-2.5 py-1"
                      onClick={() =>
                        setRoutes(
                          Object.fromEntries(
                            pendingRows.map((r) => [
                              r.method,
                              { ...DEFAULT_ROUTE, mode: 'safe' as RouteMode },
                            ]),
                          ),
                        )
                      }
                    >
                      🗄 Seyfga
                    </button>
                    <button
                      type="button"
                      className="hover:bg-muted rounded-full border px-2.5 py-1"
                      onClick={() =>
                        setRoutes(
                          Object.fromEntries(
                            pendingRows.map((r) => [
                              r.method,
                              { ...DEFAULT_ROUTE, mode: 'skip' as RouteMode },
                            ]),
                          ),
                        )
                      }
                    >
                      ⏭ Tegmaymiz
                    </button>
                  </div>

                  {pendingRows.map((r) => {
                    const rt = routeOf(r.method);
                    return (
                      <div key={r.method} className="space-y-1.5 rounded-md border p-2.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{methodLabel(r.method)}</span>
                          <span className="font-bold tabular-nums">{fmt(r.pending_uzs)} so‘m</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                            value={rt.mode}
                            onChange={(e) =>
                              setRoute(r.method, { mode: e.target.value as RouteMode })
                            }
                          >
                            <option value="bank">🏦 Bank hisobi</option>
                            <option value="safe">🗄 Seyfga (naqd yechildi)</option>
                            <option value="other">📁 Boshqa kategoriya</option>
                            <option value="skip">⏭ Tegmaymiz</option>
                          </select>

                          {rt.mode === 'bank' && (
                            <select
                              className="border-input bg-background h-8 min-w-0 flex-1 rounded-md border px-2 text-xs"
                              value={rt.bankAccountId}
                              onChange={(e) =>
                                setRoute(r.method, { bankAccountId: e.target.value })
                              }
                            >
                              <option value="">Hisob ko‘rsatilmagan</option>
                              {(bankAccounts ?? []).map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                  {a.bank_name ? ` — ${a.bank_name}` : ''}
                                </option>
                              ))}
                            </select>
                          )}

                          {rt.mode === 'other' && (
                            <Input
                              className="h-8 min-w-0 flex-1 text-xs"
                              placeholder="Kategoriya nomi (masalan: Egasining hisobi)"
                              value={rt.category}
                              onChange={(e) => setRoute(r.method, { category: e.target.value })}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {badOther && (
                    <p className="text-destructive text-xs">
                      “Boshqa kategoriya” tanlangan qatorga nom yozing.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* 4-qadam: tasdiq */}
            <div className="space-y-2.5 rounded-lg border p-3">
              <div className="text-sm font-semibold">4. Tasdiqlash</div>
              <ul className="space-y-1 text-xs">
                {moveCash && systemCash > 0 && (
                  <li>
                    • <b>{fmt(systemCash)}</b> so‘m kassadan <b>seyfga</b>
                  </li>
                )}
                {countedNum != null && diff !== 0 && (
                  <li>
                    • kassa farqi <b>{fmt(diff)}</b> so‘m — tuzatuv yozuvi
                  </li>
                )}
                {settlePlan.map((r) => (
                  <li key={r.method}>
                    • <b>{fmt(r.amount_uzs)}</b> so‘m — {methodLabel(r.method)} →{' '}
                    {r.destination === 'safe'
                      ? 'seyfga'
                      : routeOf(r.method).mode === 'other'
                        ? routeOf(r.method).category
                        : ((bankAccounts ?? []).find((a) => a.id === r.bank_account_id)?.name ??
                          'bank')}
                  </li>
                ))}
                {plannedTotal === 0 && pendingRows.length > 0 && (
                  <li className="text-muted-foreground">• naqdsiz pulga tegilmaydi</li>
                )}
                <li className="text-muted-foreground">
                  • davr qulflanadi — bu davrga <b>orqaga sana bilan</b> yozuv kiritib bo‘lmaydi
                </li>
                <li className="text-muted-foreground">
                  • bugungi kun ochiq qoladi — kunlik ish to‘xtamaydi
                </li>
              </ul>

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

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Bekor
              </Button>
              <Button onClick={() => closeMut.mutate()} disabled={closeMut.isPending || badOther}>
                {closeMut.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Lock className="mr-1.5 h-4 w-4" />
                )}
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

            {result?.posted_outside_period && (
              <div className="rounded-md border border-sky-300 bg-sky-50 p-2.5 text-xs text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300">
                Pul harakati <b>bugungi</b> sana bilan yozildi (davr oldinroq tugagan), shuning
                uchun yopilgan davr hisobotidagi qoldiq o‘zgarmadi — jonli kassa esa o‘zgardi.
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={downloadPdf} disabled={downloading}>
                {downloading ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-1.5 h-4 w-4" />
                )}
                PDF
              </Button>
              <Button
                variant="outline"
                onClick={() => sendMut.mutate()}
                disabled={sendMut.isPending}
              >
                {sendMut.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-4 w-4" />
                )}
                Telegramga
              </Button>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Yopish</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
