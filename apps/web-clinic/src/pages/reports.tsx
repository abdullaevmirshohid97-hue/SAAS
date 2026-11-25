import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Download, FileBarChart2, FileSpreadsheet, Send, Star, StarOff } from 'lucide-react';
import { toast } from 'sonner';
import type { FinanceRegister, FinanceReport, FinanceSection } from '@clary/api-client';
import { Button, Card, CardContent, Input } from '@clary/ui-web';

import { api } from '@/lib/api';
import { cycleRange, prevCycleRange } from '@/lib/finance-periods';
import { useClosingDay } from '@/hooks/use-closing-day';

// =============================================================================
// HISOBOTLAR — rahbar uchun "1 tugma" katalogi (A2)
// =============================================================================
// Har kartochka — tayyor hisobot: davr tanlanadi, bir bosishda PDF (A4), Excel
// (CSV) yoki Telegram'ga (ega chatlariga) ketadi. Hammasi oylik moliyaviy
// hisobot dvigatelidan (finance-report) — raqamlar Pul markazi bilan bir xil.
// "Sevimlilar" — tez-tez olinadigan hisobotlar shu qurilmada yuqorida turadi.
// =============================================================================

type PeriodKey = 'today' | 'yesterday' | 'week' | 'cycle' | 'prev_cycle' | 'custom';
const PERIODS: Array<{ k: PeriodKey; label: string }> = [
  { k: 'today', label: 'Bugun' },
  { k: 'yesterday', label: 'Kecha' },
  { k: 'week', label: '7 kun' },
  { k: 'cycle', label: 'Moliyaviy oy' },
  { k: 'prev_cycle', label: "O'tgan moliyaviy oy" },
  { k: 'custom', label: 'Boshqa' },
];

type ReportDef = {
  id: string;
  title: string;
  desc: string;
  register: FinanceRegister;
  sections?: FinanceSection[];
};

const REPORTS: ReportDef[] = [
  {
    id: 'daily-cash',
    title: 'Kassa hisoboti',
    desc: 'Naqd, plastik, o‘tkazma, vozvrat, rasxot va inkasatsiya — kun yoki davr bo‘yicha.',
    register: 'reception',
    sections: ['cash', 'card', 'transfer', 'other', 'refunds', 'expenses', 'transfers'],
  },
  {
    id: 'full',
    title: 'Moliyaviy hisobot (svertka)',
    desc: 'Boshlang‘ich qoldiq + aylanma = yakuniy qoldiq. Hamma bo‘limlar.',
    register: 'reception',
  },
  {
    id: 'debt',
    title: 'Bemor qarzlari',
    desc: 'Qarzga berilgan, undirilgan va davr oxiridagi qarz.',
    register: 'reception',
    sections: ['debt'],
  },
  {
    id: 'expenses',
    title: 'Rasxotlar',
    desc: 'Davrdagi barcha rasxotlar (kassa, seyf, naqdsiz).',
    register: 'reception',
    sections: ['expenses'],
  },
  {
    id: 'payroll',
    title: 'Maosh vedomosti',
    desc: 'Kim qancha oldi — xodim kesimida.',
    register: 'reception',
    sections: ['payroll'],
  },
  {
    id: 'commission',
    title: 'Shifokorlar ulushi',
    desc: 'Davrda hisoblangan shifokor ulushi.',
    register: 'reception',
    sections: ['commission'],
  },
  {
    id: 'pharmacy',
    title: 'Dorixona',
    desc: 'Dorixona savdosi va ustamasi (foyda).',
    register: 'reception',
    sections: ['pharmacy'],
  },
  {
    id: 'inpatient',
    title: 'Statsionar kassasi',
    desc: 'Statsionar registri: tushum, rasxot, qoldiqlar.',
    register: 'inpatient',
  },
];

const FAV_KEY = 'clary.reports.favorites';
function readFavs(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function iso(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
}

/** Hisobot qatorlari → CSV (Excel'da ochiladi; BOM bilan, kirill buzilmaydi). */
function reportToCsv(r: FinanceReport, title: string): string {
  const rows: string[][] = [
    [title],
    [`Davr: ${r.period.from} — ${r.period.to}`],
    [],
    ["Ko'rsatkich", 'Soni', 'Summa (UZS)'],
    ...r.lines.map((l) => [l.label, l.count == null ? '' : String(l.count), String(l.amount_uzs)]),
  ];
  return rows
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportsPage() {
  const closingDay = useClosingDay();
  const [period, setPeriod] = useState<PeriodKey>('cycle');
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const [favs, setFavs] = useState<string[]>(readFavs);
  const [busy, setBusy] = useState<string | null>(null);

  const range = useMemo(() => {
    const now = new Date();
    if (period === 'today') return { from: iso(now), to: iso(now) };
    if (period === 'yesterday') {
      const y = new Date(now.getTime() - 86_400_000);
      return { from: iso(y), to: iso(y) };
    }
    if (period === 'week') {
      return { from: iso(new Date(now.getTime() - 6 * 86_400_000)), to: iso(now) };
    }
    if (period === 'cycle') return cycleRange(closingDay);
    if (period === 'prev_cycle') return prevCycleRange(closingDay);
    return cFrom && cTo ? { from: cFrom, to: cTo } : null;
  }, [period, closingDay, cFrom, cTo]);

  const tg = useQuery({
    queryKey: ['telegram-reports-status'],
    queryFn: () => api.telegramReports.status(),
    staleTime: 5 * 60_000,
  });

  const run = useMutation({
    mutationFn: async ({ def, kind }: { def: ReportDef; kind: 'pdf' | 'csv' | 'tg' }) => {
      if (!range) throw new Error('Davrni tanlang');
      const body = {
        from: range.from,
        to: range.to,
        register: def.register,
        sections: def.sections,
      };
      if (kind === 'pdf') {
        const blob = await api.financeReport.pdf(body);
        download(`${def.id}-${range.from}_${range.to}.pdf`, blob);
      } else if (kind === 'csv') {
        const r = await api.financeReport.build(body);
        download(
          `${def.id}-${range.from}_${range.to}.csv`,
          new Blob(['﻿' + reportToCsv(r, def.title)], { type: 'text/csv;charset=utf-8' }),
        );
      } else {
        const r = await api.telegramReports.sendFinance(body);
        if (!r.sent) throw new Error('Telegram: ega chati topilmadi');
      }
      return kind;
    },
    onMutate: ({ def, kind }) => setBusy(`${def.id}:${kind}`),
    onSettled: () => setBusy(null),
    onSuccess: (kind) => toast.success(kind === 'tg' ? 'Telegramga yuborildi' : 'Yuklab olindi'),
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleFav = (id: string) => {
    const next = favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id];
    setFavs(next);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const sorted = [...REPORTS].sort(
    (a, b) => Number(favs.includes(b.id)) - Number(favs.includes(a.id)),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <FileBarChart2 className="text-primary h-6 w-6" /> Hisobotlar
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Davrni tanlang — har hisobot bir bosishda PDF, Excel yoki Telegram.{' '}
            <Link to="/money" className="text-primary hover:underline">
              Pul markazi →
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PERIODS.map((p) => (
            <Button
              key={p.k}
              size="sm"
              variant={period === p.k ? 'default' : 'outline'}
              onClick={() => setPeriod(p.k)}
            >
              {p.label}
            </Button>
          ))}
          {period === 'custom' && (
            <>
              <Input
                type="date"
                value={cFrom}
                onChange={(e) => setCFrom(e.target.value)}
                className="h-8 w-36"
              />
              <Input
                type="date"
                value={cTo}
                onChange={(e) => setCTo(e.target.value)}
                className="h-8 w-36"
              />
            </>
          )}
        </div>
      </div>
      {range && (
        <p className="text-muted-foreground -mt-2 text-xs">
          Davr: {range.from} — {range.to}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((def) => {
          const fav = favs.includes(def.id);
          const isBusy = (k: string) => busy === `${def.id}:${k}`;
          return (
            <Card key={def.id} className={fav ? 'border-primary/40' : ''}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{def.title}</div>
                    <div className="text-muted-foreground text-xs">{def.desc}</div>
                  </div>
                  <button
                    type="button"
                    title={fav ? 'Sevimlilardan olib tashlash' : 'Sevimlilarga'}
                    onClick={() => toggleFav(def.id)}
                    className="text-muted-foreground hover:text-primary"
                  >
                    {fav ? (
                      <Star className="h-4 w-4 fill-current" />
                    ) : (
                      <StarOff className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    disabled={!range || run.isPending}
                    onClick={() => run.mutate({ def, kind: 'pdf' })}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    {isBusy('pdf') ? '…' : 'PDF'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!range || run.isPending}
                    onClick={() => run.mutate({ def, kind: 'csv' })}
                  >
                    <FileSpreadsheet className="mr-1 h-3.5 w-3.5" />
                    {isBusy('csv') ? '…' : 'Excel'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!range || run.isPending || tg.data?.connected === false}
                    title={
                      tg.data?.connected === false ? 'Telegram hisobot boti ulanmagan' : undefined
                    }
                    onClick={() => run.mutate({ def, kind: 'tg' })}
                  >
                    <Send className="mr-1 h-3.5 w-3.5" />
                    {isBusy('tg') ? '…' : 'Telegram'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-muted-foreground text-xs">
        Batafsil (chuqur izlanish, oyni yopish) —{' '}
        <Link to="/analytics/builder" className="text-primary hover:underline">
          Hisobot quruvchi
        </Link>
        . Avtomatik jadval (har kuni / har oy Telegramga) — o‘sha sahifadagi "Jadval" bo‘limi.
      </p>
    </div>
  );
}
