import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarRange,
  Check,
  CheckCheck,
  ChevronRight,
  FileText,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@clary/ui-web';
import {
  FINANCE_SECTIONS,
  type FinanceDrillSection,
  type FinanceMethodClass,
  type FinanceReport,
  type FinanceReportLine,
  type FinanceSection,
} from '@clary/api-client';

import { api } from '@/lib/api';
import { MonthCloseDialog } from './month-close-dialog';

// =============================================================================
// MOLIYAVIY HISOBOT QURUVCHI
// =============================================================================
// Bank ko'chirmasi mantig'i: BOSHLANG'ICH QOLDIQ + AYLANMA = YAKUNIY QOLDIQ.
// Har bir summa bosiladi — ortidagi hujjatlar ochiladi (chuqur izlanish).
// Hisobot, PDF va Telegram xabari BITTA server javobidan yasaladi, shuning
// uchun uchalasi hech qachon turli raqam ko'rsatmaydi.
// =============================================================================

const fmt = (v: number) => Number(v ?? 0).toLocaleString('uz-UZ');
const fmtSigned = (v: number) => `${v > 0 ? '+' : ''}${fmt(v)}`;

const SECTION_META: Array<{ id: FinanceSection; label: string; hint: string }> = [
  { id: 'cash', label: 'Naqd savdo', hint: 'Kassaga naqd tushgan to‘lovlar' },
  { id: 'card', label: 'Plastik savdo', hint: 'Karta / Humo / Uzcard' },
  { id: 'transfer', label: 'O‘tkazma savdo', hint: 'Bank o‘tkazmasi' },
  { id: 'other', label: 'Boshqa naqdsiz', hint: 'Click, Payme, Uzum, Kaspi…' },
  { id: 'refunds', label: 'Vozvratlar', hint: 'Qaytarilgan pul' },
  { id: 'debt', label: 'Qarzga berilgan', hint: 'Xizmat berildi, pul kelmadi' },
  { id: 'expenses', label: 'Rasxotlar', hint: 'Barcha xarajatlar' },
  { id: 'payroll', label: 'Maoshlar', hint: 'To‘langan maoshlar' },
  { id: 'transfers', label: 'Ichki ko‘chirmalar', hint: 'Inkasatsiya, bank, seyf' },
  { id: 'pharmacy', label: 'Dorixona', hint: 'Savdo va ustama' },
  { id: 'commission', label: 'Shifokor komissiyasi', hint: 'Hisoblangan (accrual)' },
];

const GROUP_META: Array<{
  id: FinanceReportLine['group'];
  title: string;
  note: string;
  tone: string;
}> = [
  { id: 'income', title: 'TUSHUM', note: 'Klinikaga kelgan pul', tone: 'text-emerald-600' },
  { id: 'outflow', title: 'CHIQIM', note: 'Klinikadan chiqqan pul', tone: 'text-rose-600' },
  {
    id: 'transfer',
    title: 'ICHKI KO‘CHIRMA',
    note: 'Pul o‘z hisoblarimiz orasida ko‘chdi — daromad ham, rasxot ham EMAS',
    tone: 'text-sky-600',
  },
  { id: 'info', title: 'MA’LUMOT', note: 'Yakunga kirmaydi', tone: 'text-muted-foreground' },
];

const ACCOUNTS: Array<{ key: 'cash' | 'safe' | 'pending' | 'bank' | 'total'; label: string }> = [
  { key: 'cash', label: 'Kassa (naqd)' },
  { key: 'safe', label: 'Seyf' },
  { key: 'pending', label: 'Yo‘ldagi pul (terminal)' },
  { key: 'bank', label: 'Bank hisobi' },
  { key: 'total', label: 'JAMI PUL' },
];

// --- Sana yordamchilari ------------------------------------------------------
const iso = (d: Date) => {
  const t = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return t.toISOString().slice(0, 10);
};
const startOfWeek = (d: Date) => {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // dushanba = 0
  x.setDate(x.getDate() - dow);
  return x;
};

type PresetId =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'prev_month'
  | 'year'
  | 'cycle'
  | 'custom';

/**
 * "Yopish davri" — klinika oyni kalendar bo'yicha emas, masalan har oyning
 * 10-sanasida yopadi. Unda davr = o'tgan oyning 11-sanasidan shu oyning
 * 10-sanasigacha. Aynan shu holat mavjud tizimda umuman qo'llab-quvvatlanmagan
 * edi va hisobot qilishning iloji yo'q edi.
 */
function cycleRange(closingDay: number, ref = new Date()): { from: string; to: string } {
  const d = Math.min(28, Math.max(1, closingDay));
  const y = ref.getFullYear();
  const m = ref.getMonth();
  // Agar bugun yopish kunidan oldin bo'lsa — hali oldingi sikl davom etyapti.
  const endMonth = ref.getDate() > d ? m : m - 1;
  const to = new Date(y, endMonth, d);
  const from = new Date(y, endMonth - 1, d + 1);
  return { from: iso(from), to: iso(to) };
}

function rangeFor(preset: PresetId, closingDay: number): { from: string; to: string } | null {
  const now = new Date();
  switch (preset) {
    case 'today':
      return { from: iso(now), to: iso(now) };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: iso(y), to: iso(y) };
    }
    case 'week':
      return { from: iso(startOfWeek(now)), to: iso(now) };
    case 'month':
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
    case 'prev_month':
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case 'year':
      return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
    case 'cycle':
      return cycleRange(closingDay, now);
    default:
      return null;
  }
}

export function FinanceReportPanel() {
  const qc = useQueryClient();

  // --- Davr -----------------------------------------------------------------
  const [closingDay, setClosingDay] = useState(() =>
    Number(localStorage.getItem('clary.closingDay') ?? 10),
  );
  const [preset, setPreset] = useState<PresetId>('cycle');
  const initial = cycleRange(Number(localStorage.getItem('clary.closingDay') ?? 10));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  useEffect(() => {
    localStorage.setItem('clary.closingDay', String(closingDay));
  }, [closingDay]);

  function applyPreset(p: PresetId) {
    setPreset(p);
    const r = rangeFor(p, closingDay);
    if (r) {
      setFrom(r.from);
      setTo(r.to);
    }
  }

  // --- Bo'limlar (galochkalar) ---------------------------------------------
  const [sections, setSections] = useState<FinanceSection[]>([...FINANCE_SECTIONS]);
  const allChecked = sections.length === FINANCE_SECTIONS.length;
  const toggle = (s: FinanceSection) =>
    setSections((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  // --- So'rov ---------------------------------------------------------------
  const enabled = !!from && !!to && from <= to && sections.length > 0;
  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['finance-report', from, to, sections.join(',')],
    queryFn: () => api.financeReport.build({ from, to, sections }),
    enabled,
    // Moliyaviy hisobot — eskirgan raqam ko'rsatilmasin.
    staleTime: 0,
  });
  const rep = data as FinanceReport | undefined;

  const { data: closings } = useQuery({
    queryKey: ['finance-closings'],
    queryFn: () => api.financeReport.closings('reception'),
  });

  // --- Chuqur izlanish ------------------------------------------------------
  const [drill, setDrill] = useState<{
    line: FinanceReportLine;
    section: FinanceDrillSection;
    cls: FinanceMethodClass | 'all';
  } | null>(null);

  const [exporting, setExporting] = useState(false);
  async function downloadPdf() {
    if (!rep) return;
    setExporting(true);
    try {
      const blob = await api.financeReport.pdf({ from, to, sections });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `moliyaviy-hisobot-${from}_${to}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message || 'PDF yaratilmadi');
    } finally {
      setExporting(false);
    }
  }

  function exportCsv() {
    if (!rep) return;
    const rows: string[][] = [['Bo‘lim', 'Modda', 'Soni', 'Summa (so‘m)']];
    for (const g of GROUP_META) {
      for (const l of rep.lines.filter((x) => x.group === g.id)) {
        rows.push([g.title, l.label, String(l.count ?? ''), String(l.amount_uzs)]);
      }
    }
    rows.push([], ['QOLDIQLAR', 'Hisob', 'Davr boshi', 'Davr oxiri']);
    for (const a of ACCOUNTS)
      rows.push(['', a.label, String(rep.opening[a.key]), String(rep.closing[a.key])]);
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `moliyaviy-hisobot-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const alreadyClosed = rep?.closed ?? null;
  const hasWarnings = (rep?.warnings.length ?? 0) > 0;

  return (
    <div className="space-y-5">
      {/* ============ 1. DAVR ============ */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <CalendarRange className="h-3.5 w-3.5" /> Davr
              </div>
              <div className="bg-muted/30 inline-flex flex-wrap rounded-md border p-0.5">
                {(
                  [
                    ['cycle', `Yopish davri (${closingDay + 1}→${closingDay})`],
                    ['today', 'Bugun'],
                    ['yesterday', 'Kecha'],
                    ['week', 'Hafta'],
                    ['month', 'Shu oy'],
                    ['prev_month', 'O‘tgan oy'],
                    ['year', 'Yil'],
                    ['custom', 'Oraliq'],
                  ] as Array<[PresetId, string]>
                ).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => applyPreset(id)}
                    className={
                      'rounded px-2.5 py-1.5 text-xs font-medium transition ' +
                      (preset === id ? 'bg-background shadow-elevation-1' : 'text-muted-foreground')
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <label className="text-muted-foreground flex flex-col gap-1 text-xs font-medium">
              Boshlanish
              <Input
                type="date"
                className="h-9 w-[152px]"
                value={from}
                max={to}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPreset('custom');
                }}
              />
            </label>
            <label className="text-muted-foreground flex flex-col gap-1 text-xs font-medium">
              Tugash
              <Input
                type="date"
                className="h-9 w-[152px]"
                value={to}
                min={from}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPreset('custom');
                }}
              />
            </label>
            <label className="text-muted-foreground flex flex-col gap-1 text-xs font-medium">
              Oy yopish kuni
              <Input
                type="number"
                min={1}
                max={28}
                className="h-9 w-[86px]"
                value={closingDay}
                onChange={(e) => setClosingDay(Number(e.target.value) || 1)}
              />
            </label>
            <Button variant="outline" onClick={() => refetch()} disabled={!enabled || isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Yangilash
            </Button>
          </div>

          {/* ============ 2. GALOCHKALAR ============ */}
          <div className="space-y-2 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs font-medium">
                Hisobotga nima kirsin:
              </span>
              <Button
                size="sm"
                variant={allChecked ? 'default' : 'outline'}
                className="h-7 text-xs"
                onClick={() => setSections(allChecked ? [] : [...FINANCE_SECTIONS])}
              >
                <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
                {allChecked ? 'Hammasi tanlandi' : 'Hammasi'}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SECTION_META.map((s) => {
                const on = sections.includes(s.id);
                return (
                  <button
                    key={s.id}
                    title={s.hint}
                    onClick={() => toggle(s.id)}
                    className={
                      'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition ' +
                      (on
                        ? 'border-primary/40 bg-primary/10 text-foreground font-medium'
                        : 'text-muted-foreground hover:bg-muted/50')
                    }
                  >
                    <span
                      className={
                        'flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border ' +
                        (on
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'border-muted-foreground/40')
                      }
                    >
                      {on && <Check className="h-2.5 w-2.5" strokeWidth={4} />}
                    </span>
                    {s.label}
                  </button>
                );
              })}
            </div>
            {sections.length === 0 && (
              <p className="text-destructive text-xs">Kamida bitta bo‘lim tanlang.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {isError && (
        <Card className="border-destructive/40">
          <CardContent className="text-destructive p-4 text-sm">
            Xatolik: {(error as Error)?.message ?? 'noma’lum'}
          </CardContent>
        </Card>
      )}

      {isFetching && !rep && (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Hisobot yig‘ilmoqda…
        </div>
      )}

      {rep && (
        <>
          {/* ============ 3. SVERTKA NAZORATI ============ */}
          {/* Bank hujjatida bu "control total" deyiladi: mos kelmasa hisobot
              qabul qilinmaydi. Bitta xato millionlab zarar bermasligi uchun
              buni YASHIRMAYMIZ — eng tepada ko'rsatamiz. */}
          <Card
            className={
              hasWarnings
                ? 'border-amber-400 bg-amber-50/40 dark:bg-amber-950/10'
                : 'border-emerald-500/40'
            }
          >
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {hasWarnings ? (
                  <>
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-amber-700 dark:text-amber-400">
                      Svertka MOS KELMADI — hisobotni tasdiqlashdan oldin tekshiring
                    </span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    <span className="text-emerald-700 dark:text-emerald-400">
                      Svertka to‘g‘ri: boshlang‘ich qoldiq + aylanma = yakuniy qoldiq
                    </span>
                  </>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left">
                      <th className="py-1.5 pr-3">Hisob</th>
                      <th className="py-1.5 pr-3 text-right">Davr boshi</th>
                      <th className="py-1.5 pr-3 text-right">Kirim</th>
                      <th className="py-1.5 pr-3 text-right">Chiqim</th>
                      <th className="py-1.5 pr-3 text-right">Hisoblangan</th>
                      <th className="py-1.5 pr-3 text-right">Haqiqiy</th>
                      <th className="py-1.5 text-right">Farq</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rep.checks.map((c) => (
                      <tr key={c.account} className="border-border/50 border-b last:border-0">
                        <td className="py-1.5 pr-3 font-medium">
                          {c.ok ? '✓' : '✗'} {c.account}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(c.opening)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-emerald-600">
                          {fmt(c.inflow)}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-rose-600">
                          {fmt(c.outflow)}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {fmt(c.computed_closing)}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-medium tabular-nums">
                          {fmt(c.actual_closing)}
                        </td>
                        <td
                          className={
                            'py-1.5 text-right font-medium tabular-nums ' +
                            (c.ok ? 'text-muted-foreground' : 'text-destructive')
                          }
                        >
                          {c.ok ? '0' : fmtSigned(c.diff)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rep.warnings.map((w) => (
                <p key={w} className="text-xs text-amber-700 dark:text-amber-400">
                  {w}
                </p>
              ))}
            </CardContent>
          </Card>

          {/* ============ 4. QOLDIQLAR ============ */}
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  Hisob qoldiqlari — {rep.period.from} → {rep.period.to} ({rep.period.days} kun)
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={exportCsv}>
                    CSV
                  </Button>
                  <Button size="sm" variant="outline" onClick={downloadPdf} disabled={exporting}>
                    <FileText className="mr-1.5 h-3.5 w-3.5" />
                    {exporting ? 'Yasalmoqda…' : 'PDF'}
                  </Button>
                  <MonthCloseDialog
                    from={from}
                    to={to}
                    report={rep}
                    disabled={!!alreadyClosed}
                    onClosed={() => {
                      qc.invalidateQueries({ queryKey: ['finance-report'] });
                      qc.invalidateQueries({ queryKey: ['finance-closings'] });
                      qc.invalidateQueries({ queryKey: ['cashier'] });
                    }}
                  />
                </div>
              </div>

              {alreadyClosed && (
                <div className="mb-3 flex items-center gap-2 rounded-md border border-slate-300 bg-slate-50 p-2.5 text-xs dark:border-slate-700 dark:bg-slate-900/40">
                  <Lock className="h-3.5 w-3.5" />
                  Bu davr yopilgan: {new Date(alreadyClosed.closed_at).toLocaleString('uz-UZ')} —
                  raqamlar snapshot sifatida saqlangan.
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {ACCOUNTS.map((a) => {
                  const o = rep.opening[a.key];
                  const c = rep.closing[a.key];
                  const d = c - o;
                  return (
                    <div
                      key={a.key}
                      className={
                        'rounded-lg border p-3 ' +
                        (a.key === 'total' ? 'bg-muted/40 border-primary/30' : '')
                      }
                    >
                      <div className="text-muted-foreground text-[11px] font-medium uppercase">
                        {a.label}
                      </div>
                      <div className="mt-1 text-lg font-bold tabular-nums">{fmt(c)}</div>
                      <div className="text-muted-foreground mt-0.5 text-[11px] tabular-nums">
                        boshi {fmt(o)} ·{' '}
                        <span className={d > 0 ? 'text-emerald-600' : d < 0 ? 'text-rose-600' : ''}>
                          {fmtSigned(d)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* ============ 5. AYLANMA — guruhlar bo'yicha ============ */}
          {GROUP_META.map((g) => {
            const rows = rep.lines.filter((l) => l.group === g.id);
            if (rows.length === 0) return null;
            const subtotal = rows.reduce((s, l) => s + l.amount_uzs, 0);
            return (
              <Card key={g.id}>
                <CardContent className="p-4">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span className={`text-sm font-bold ${g.tone}`}>{g.title}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{g.note}</span>
                    </div>
                    {g.id !== 'info' && (
                      <span className="text-sm font-bold tabular-nums">
                        {fmtSigned(subtotal)} so‘m
                      </span>
                    )}
                  </div>
                  {/* Ustunlar: MODDA · SONI · SUMMA.
                      "Soni" alohida ustun — u summani tekshirishning eng tez
                      usuli va PDF bilan bir xil bo'lishi shart. Qiymat yo'q
                      bo'lsa "—" (nol EMAS: "0 ta amaldan 12 mln so'm" degan
                      yolg'on yozuvni oldini oladi). */}
                  <div className="text-muted-foreground grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b pb-1 text-[10px] font-medium uppercase tracking-wider">
                    <span>Modda</span>
                    <span className="w-16 text-right">Soni</span>
                    <span className="w-32 text-right">Summa</span>
                  </div>
                  <div className="divide-border/60 divide-y">
                    {rows.map((l) => (
                      <button
                        key={l.key}
                        disabled={!l.drill}
                        onClick={() =>
                          l.drill &&
                          setDrill({
                            line: l,
                            section: l.drill.section,
                            cls: l.drill.method_class,
                          })
                        }
                        className={
                          'grid w-full grid-cols-[1fr_auto_auto] items-center gap-x-4 py-2 text-left text-sm ' +
                          (l.drill ? 'hover:bg-muted/40 -mx-2 rounded px-2' : 'cursor-default')
                        }
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{l.label}</span>
                          {l.drill && (
                            <ChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                          )}
                        </span>
                        <span
                          className={
                            'w-16 text-right tabular-nums ' +
                            (l.count == null ? 'text-muted-foreground' : '')
                          }
                        >
                          {l.count == null ? '—' : l.count}
                        </span>
                        <span className="w-32 text-right font-medium tabular-nums">
                          {fmt(l.amount_uzs)}
                        </span>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* ============ 5b. MAOSH — KIM QANCHA OLDI ============ */}
          {/* Umumiy "Maosh to'lovlari" qatori savolga javob bermaydi: egasiga
              aynan "falon shifokor shu davrda qancha oldi" kerak. Jadval
              yig'indisi umumiy maosh summasiga teng bo'lishi shart — mos
              kelmasa yuqoridagi ogohlantirishlar bo'limida ko'rinadi. */}
          {rep.payroll_by_person.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="text-sm font-bold">MAOSH — KIM QANCHA OLDI</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {rep.period.from} → {rep.period.to} · {rep.payroll_by_person.length} xodim
                    </span>
                  </div>
                  <span className="text-sm font-bold tabular-nums">
                    {fmt(rep.payroll_by_person.reduce((s, p) => s + p.net_uzs, 0))} so‘m
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="text-muted-foreground border-b text-left text-[10px] uppercase tracking-wider">
                        <th className="py-1.5 pr-3">Xodim</th>
                        <th className="py-1.5 pr-3 text-right">To‘lov</th>
                        <th className="py-1.5 pr-3 text-right">Naqd</th>
                        <th className="py-1.5 pr-3 text-right">Seyfdan</th>
                        <th className="py-1.5 pr-3 text-right">Naqdsiz</th>
                        <th className="py-1.5 pr-3 text-right">Jami</th>
                        <th className="py-1.5 text-right">Oxirgi to‘lov</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rep.payroll_by_person.map((p) => (
                        <tr
                          key={p.person_id ?? p.person_name}
                          className="border-border/50 border-b last:border-0"
                        >
                          <td className="py-1.5 pr-3 font-medium">{p.person_name}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{p.payouts_count}</td>
                          <td className="text-muted-foreground py-1.5 pr-3 text-right tabular-nums">
                            {p.cash_uzs === 0 ? '—' : fmt(p.cash_uzs)}
                          </td>
                          <td className="text-muted-foreground py-1.5 pr-3 text-right tabular-nums">
                            {p.safe_uzs === 0 ? '—' : fmt(p.safe_uzs)}
                          </td>
                          <td className="text-muted-foreground py-1.5 pr-3 text-right tabular-nums">
                            {p.noncash_uzs === 0 ? '—' : fmt(p.noncash_uzs)}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">
                            {fmt(p.net_uzs)}
                          </td>
                          <td className="text-muted-foreground py-1.5 text-right text-xs">
                            {p.last_paid_at
                              ? new Date(p.last_paid_at).toLocaleDateString('uz-UZ')
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ============ 6. YAKUN ============ */}
          <Card className="border-primary/30">
            <CardContent className="p-4">
              <div className="mb-3 text-sm font-bold">YAKUN</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Kpi label="Sof tushum (vozvratdan keyin)" v={rep.totals.gross_revenue_uzs} />
                <Kpi label="Rasxot" v={-rep.totals.total_expense_uzs} />
                <Kpi label="Maosh to‘lovi" v={-rep.totals.total_payroll_uzs} />
                <Kpi label="Operatsion natija" v={rep.totals.operating_net_uzs} strong />
                <Kpi
                  label="Foyda (komissiya+dorixona bilan)"
                  v={rep.totals.accrual_profit_uzs}
                  strong
                />
                <Kpi label="Pul o‘sishi (4 hisob jami)" v={rep.totals.money_delta_uzs} strong />
              </div>
              {rep.totals.debt_issued_uzs > 0 && (
                <p className="text-muted-foreground mt-3 text-xs">
                  Davr ichida <b>{fmt(rep.totals.debt_issued_uzs)}</b> so‘mlik xizmat qarzga
                  berilgan — bu pul hali kelmagan, yakunga kirmaydi.
                </p>
              )}
              {sections.length < FINANCE_SECTIONS.length && (
                <p className="text-muted-foreground mt-2 text-xs">
                  Eslatma: yuqoridagi yakun <b>butun davr</b> bo‘yicha hisoblanadi — galochkalar
                  faqat ko‘rinadigan moddalarni tanlaydi, yakunni o‘zgartirmaydi.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ============ 7. YOPILGAN DAVRLAR ============ */}
          <ClosedPeriods
            rows={closings ?? []}
            onChanged={() => {
              qc.invalidateQueries({ queryKey: ['finance-closings'] });
              qc.invalidateQueries({ queryKey: ['finance-report'] });
            }}
          />
        </>
      )}

      {/* ============ CHUQUR IZLANISH ============ */}
      <DrillSheet
        open={!!drill}
        onClose={() => setDrill(null)}
        from={from}
        to={to}
        line={drill?.line ?? null}
        section={drill?.section ?? 'all'}
        cls={drill?.cls ?? 'all'}
      />
    </div>
  );
}

function Kpi({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-muted-foreground text-[11px] font-medium uppercase">{label}</div>
      <div
        className={
          'mt-1 tabular-nums ' +
          (strong ? 'text-xl font-bold' : 'text-lg font-semibold') +
          (v > 0
            ? 'text-emerald-700 dark:text-emerald-400'
            : v < 0
              ? 'text-rose-700 dark:text-rose-400'
              : '')
        }
      >
        {fmt(v)} so‘m
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Chuqur izlanish — summaning ortidagi HUJJATLAR
// -----------------------------------------------------------------------------
function DrillSheet({
  open,
  onClose,
  from,
  to,
  line,
  section,
  cls,
}: {
  open: boolean;
  onClose: () => void;
  from: string;
  to: string;
  line: FinanceReportLine | null;
  section: FinanceDrillSection;
  cls: FinanceMethodClass | 'all';
}) {
  const { data, isFetching } = useQuery({
    queryKey: ['finance-drill', from, to, section, cls],
    queryFn: () => api.financeReport.drill({ from, to, section, method_class: cls, limit: 1000 }),
    enabled: open,
  });

  const rows = data?.rows ?? [];
  // Ro'yxat hisobotdagi qatorga MOS KELISHI shart — summa ham, soni ham.
  // Mos kelmasa jimgina o'tkazib yubormaymiz: aynan shu solishtiruv "raqam
  // to'g'rimi?" degan savolga javob beradi.
  const mismatch = useMemo(() => {
    if (!line || !data) return null;
    const sumDiff = data.sum_uzs - Math.abs(line.amount_uzs);
    const countDiff = line.count == null ? 0 : data.count - line.count;
    return sumDiff !== 0 || countDiff !== 0 ? { sumDiff, countDiff } : null;
  }, [line, data]);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{line?.label ?? 'Hujjatlar'}</SheetTitle>
          <SheetDescription>
            {from} → {to} · <b>{data?.count ?? 0}</b> ta yozuv · jami{' '}
            <b>{fmt(data?.sum_uzs ?? 0)}</b> so‘m
            {line?.count != null && ` · hisobotda: ${line.count} ta`}
          </SheetDescription>
        </SheetHeader>

        {data?.truncated && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
            ⚠ Ro‘yxat 1000 qator bilan cheklandi — yig‘indi to‘liq emas. Davrni qisqartiring.
          </div>
        )}
        {mismatch != null && !data?.truncated && (
          <div className="text-destructive mt-3 space-y-1 rounded-md border p-2.5 text-xs">
            {mismatch.sumDiff !== 0 && (
              <div>
                ⚠ Ro‘yxat yig‘indisi hisobotdagi summadan {fmtSigned(mismatch.sumDiff)} so‘mga farq
                qiladi.
              </div>
            )}
            {mismatch.countDiff !== 0 && (
              <div>
                ⚠ Yozuvlar soni hisobotdagidan {fmtSigned(mismatch.countDiff)} ta farq qiladi.
              </div>
            )}
          </div>
        )}

        {isFetching ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground py-16 text-center text-sm">
            Bu davr uchun yozuv yo‘q.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-2 pr-3">Sana / vaqt</th>
                  <th className="py-2 pr-3">Kim / nima</th>
                  <th className="py-2 pr-3">Izoh</th>
                  <th className="py-2 pr-3">Usul</th>
                  <th className="py-2 pr-3">Manba</th>
                  <th className="py-2 pr-3 text-right">Summa</th>
                  <th className="py-2">Qayd etdi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.doc_type}-${r.doc_id}-${r.occurred_at}`}
                    className="border-border/50 border-b"
                  >
                    <td className="text-muted-foreground whitespace-nowrap py-1.5 pr-3">
                      {new Date(r.occurred_at).toLocaleString('uz-UZ', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-1.5 pr-3 font-medium">{r.party}</td>
                    <td className="text-muted-foreground max-w-[220px] truncate py-1.5 pr-3">
                      {r.description}
                    </td>
                    <td className="py-1.5 pr-3">{r.method}</td>
                    <td className="text-muted-foreground py-1.5 pr-3">
                      {r.source === 'safe' ? 'Seyf' : r.source === 'bank' ? 'Bank' : 'Kassa'}
                    </td>
                    <td
                      className={
                        'py-1.5 pr-3 text-right font-medium tabular-nums ' +
                        (r.direction === 'out' ? 'text-rose-600' : 'text-emerald-600')
                      }
                    >
                      {r.direction === 'out' ? '−' : '+'}
                      {fmt(r.amount_uzs)}
                    </td>
                    <td className="text-muted-foreground py-1.5">{r.who}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// -----------------------------------------------------------------------------
// Yopilgan davrlar
// -----------------------------------------------------------------------------
function ClosedPeriods({
  rows,
  onChanged,
}: {
  rows: Array<{
    id: string;
    period_from: string;
    period_to: string;
    status: 'closed' | 'reopened';
    cash_system_uzs: number;
    cash_counted_uzs: number | null;
    cash_diff_uzs: number;
    moved_to_safe_uzs: number;
    closed_at: string;
    closed_by: string | null;
  }>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (rows.length === 0) return null;

  async function reopen(id: string) {
    const reason = window.prompt('Davrni qayta ochish sababi (majburiy):');
    if (!reason || reason.trim().length < 3) return;
    setBusy(id);
    try {
      const r = await api.financeReport.reopen(id, reason.trim());
      toast.success(r.note);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 text-sm font-semibold">Yopilgan davrlar</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-xs">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="py-1.5 pr-3">Davr</th>
                <th className="py-1.5 pr-3">Holat</th>
                <th className="py-1.5 pr-3 text-right">Tizim naqdi</th>
                <th className="py-1.5 pr-3 text-right">Sanaldi</th>
                <th className="py-1.5 pr-3 text-right">Farq</th>
                <th className="py-1.5 pr-3 text-right">Seyfga o‘tdi</th>
                <th className="py-1.5 pr-3">Kim / qachon</th>
                <th className="py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-border/50 border-b last:border-0">
                  <td className="whitespace-nowrap py-1.5 pr-3 font-medium">
                    {r.period_from} → {r.period_to}
                  </td>
                  <td className="py-1.5 pr-3">
                    {r.status === 'closed' ? (
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <Lock className="h-3 w-3" /> Yopiq
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <Unlock className="h-3 w-3" /> Ochilgan
                      </Badge>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(r.cash_system_uzs)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {r.cash_counted_uzs == null ? '—' : fmt(r.cash_counted_uzs)}
                  </td>
                  <td
                    className={
                      'py-1.5 pr-3 text-right tabular-nums ' +
                      (r.cash_diff_uzs !== 0
                        ? 'text-destructive font-medium'
                        : 'text-muted-foreground')
                    }
                  >
                    {r.cash_diff_uzs === 0 ? '0' : fmtSigned(r.cash_diff_uzs)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {fmt(r.moved_to_safe_uzs)}
                  </td>
                  <td className="text-muted-foreground py-1.5 pr-3">
                    {r.closed_by ?? '—'} · {new Date(r.closed_at).toLocaleDateString('uz-UZ')}
                  </td>
                  <td className="py-1.5 text-right">
                    {r.status === 'closed' && (
                      <button
                        disabled={busy === r.id}
                        onClick={() => reopen(r.id)}
                        className="text-muted-foreground inline-flex items-center gap-1 hover:underline"
                      >
                        <Unlock className="h-3 w-3" /> ochish
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
