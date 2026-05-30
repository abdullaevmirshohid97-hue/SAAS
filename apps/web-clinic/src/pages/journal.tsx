import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BedDouble,
  CalendarRange,
  Coins,
  Download,
  Plus,
  Edit3,
  Eye,
  FileText,
  Lock,
  LogOut,
  MessageSquarePlus,
  PiggyBank,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  Stethoscope,
  Trash2,
  TrendingUp,
  User,
  Wallet,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatCard,
  cn,
} from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { ServicePanel, LedgerPanel } from './inpatient';

type FeedEntry = {
  id: string;
  source:
    | 'transaction'
    | 'pharmacy_sale'
    | 'inpatient_stay'
    | 'inpatient_ledger'
    | 'inpatient_discharge'
    | 'inpatient_transfer'
    | 'inpatient_assignment'
    | 'inpatient_doctor_change'
    | 'inpatient_meal_period'
    | 'appointment'
    | 'expense'
    | 'shift_opened'
    | 'shift_closed';
  ref_id: string;
  occurred_at: string;
  patient_id: string | null;
  patient_name: string | null;
  patient_phone: string | null;
  doctor_name: string | null;
  diagnosis: string | null;
  amount_uzs: number;
  status: 'paid' | 'debt' | 'refund' | 'expense' | 'pending' | 'partial';
  payment_method: string | null;
  description: string | null;
  note: string | null;
  cashier_name: string | null;
  is_void: boolean;
  department?: string | null;
  items?: Array<{ name: string; quantity: number; amount_uzs: number }>;
};

type SourceFilter =
  | 'all'
  | 'transactions'
  | 'pharmacy'
  | 'inpatient'
  | 'ledger'
  | 'appointments'
  | 'expenses'
  | 'shifts';
type Preset = 'today' | 'week' | 'month' | 'custom';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

function rangeFor(
  preset: Preset,
  custom?: { from: string; to: string },
): { from: string; to: string } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  if (preset === 'today') start.setHours(0, 0, 0, 0);
  else if (preset === 'week') {
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else if (preset === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (preset === 'custom') {
    // custom.from/to — YYYY-MM-DD <input type="date"> qiymatlari.
    const cs = custom?.from ? new Date(`${custom.from}T00:00:00`) : start;
    cs.setHours(0, 0, 0, 0);
    const ce = custom?.to ? new Date(`${custom.to}T23:59:59`) : end;
    ce.setHours(23, 59, 59, 999);
    return { from: cs.toISOString(), to: ce.toISOString() };
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

// Bugungi sana — YYYY-MM-DD (custom date input default qiymati).
const todayStr = () => new Date().toISOString().slice(0, 10);

// Iconlar uchun string -> komponent xaritasi. Backend icon_key (lucide kebab-case)
// qaytaradi, biz uni component'ga aylantiramiz. Topilmasa FileText.
const ICON_MAP: Record<string, React.ElementType> = {
  wallet: Wallet,
  receipt: Receipt,
  stethoscope: Stethoscope,
  user: User,
  'arrow-down': ArrowDownRight,
  'arrow-up': ArrowUpRight,
  'arrow-right-left': ArrowDownRight, // ko'chirish — gorizontal o'q
  'shield-check': ShieldCheck,
  'log-out': LogOut,
  'log-in': ArrowUpRight, // statsionar chiqarish
  'file-text': FileText,
};

type LayoutRow = {
  source_key: string;
  display_label_i18n: Record<string, string>;
  color_tone: string;
  icon_key: string;
  sort_order: number;
  is_visible: boolean;
};

// Effektiv layoutdan source meta'ni tuzish (label, icon, rang).
// Fallback hardcoded — backend yangi source qaytarsa yoki layout query
// hali yuklanmagan bo'lsa buzilmasin.
const FALLBACK_META = {
  label: 'Boshqa',
  icon: FileText,
  tone: 'bg-slate-50 text-slate-700 border-slate-200',
};

// Module-level cache — JournalPage'da useQuery natijasi bilan to'ldiriladi.
// Boshqa renderda sourceMeta() shu cache'dan o'qiydi.
let SOURCE_META_CACHE = new Map<string, { label: string; icon: React.ElementType; tone: string }>();

function rebuildSourceMeta(layout: LayoutRow[] | undefined) {
  const map = new Map<string, { label: string; icon: React.ElementType; tone: string }>();
  for (const row of layout ?? []) {
    const Icon = ICON_MAP[row.icon_key] ?? FileText;
    const c = row.color_tone;
    // Tailwind dynamic class — bg-{tone}-50, text-{tone}-700, border-{tone}-200
    // tailwind.config safelist'iga qo'shilishi kerak yangi ranglar uchun.
    const tone = `bg-${c}-50 text-${c}-700 border-${c}-200`;
    map.set(row.source_key, {
      label: row.display_label_i18n['uz-Latn'] ?? row.source_key,
      icon: Icon,
      tone,
    });
  }
  SOURCE_META_CACHE = map;
}

const sourceMeta = (s: FeedEntry['source']) => SOURCE_META_CACHE.get(s) ?? FALLBACK_META;

const STATUS_META: Record<FeedEntry['status'], { label: string; tone: string }> = {
  paid: { label: 'To\'langan', tone: 'bg-emerald-100 text-emerald-700' },
  debt: { label: 'Qarzdor', tone: 'bg-rose-100 text-rose-700' },
  refund: { label: 'Qaytarilgan', tone: 'bg-amber-100 text-amber-700' },
  expense: { label: 'Rasxot', tone: 'bg-slate-100 text-slate-700' },
  pending: { label: 'Kutmoqda', tone: 'bg-blue-100 text-blue-700' },
  partial: { label: 'Qisman', tone: 'bg-orange-100 text-orange-700' },
};

// =============================================================================
// PIN session — kept in sessionStorage so a single unlock covers all
// edit/delete actions in the same browser tab.
// =============================================================================
const PIN_KEY = 'journal_pin_unlocked_until';
const PIN_TTL_MS = 5 * 60_000; // 5 daqiqa

function isPinUnlocked() {
  const v = sessionStorage.getItem(PIN_KEY);
  return v ? Number(v) > Date.now() : false;
}
function unlockPin() {
  sessionStorage.setItem(PIN_KEY, String(Date.now() + PIN_TTL_MS));
}
function lockPin() {
  sessionStorage.removeItem(PIN_KEY);
}

// =============================================================================
// Page
// =============================================================================
export function JournalPage() {
  const qc = useQueryClient();
  // 'finance' — kassa/dorixona/statsionar pul oqimi (mavjud).
  // 'activity' — barcha jarayonlar (lab, shifokor, qabul, hamshira) faoliyat jurnali.
  const [view, setView] = useState<'finance' | 'activity'>('finance');
  const [preset, setPreset] = useState<Preset>('today');
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo] = useState(todayStr());
  const [source, setSource] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');
  const [amountFilter, setAmountFilter] = useState<string>('');
  const [pinModal, setPinModal] = useState<{
    onSuccess: (pin: string) => void;
  } | null>(null);
  const [noteModal, setNoteModal] = useState<FeedEntry | null>(null);
  const [detailModal, setDetailModal] = useState<FeedEntry | null>(null);
  const [confirmVoid, setConfirmVoid] = useState<FeedEntry | null>(null);

  const { from, to } = useMemo(
    () => rangeFor(preset, { from: customFrom, to: customTo }),
    [preset, customFrom, customTo],
  );

  // Effektiv jurnal layout — manbalar nomi/ranglarini moslashtiradi.
  // Birinchi yuklanishda fallback'lar ko'rinadi, query kelganda meta cache yangilanadi.
  const { data: layoutData } = useQuery({
    queryKey: ['journal-layout'],
    queryFn: () => api.journal.layout(),
    staleTime: 60_000,
  });
  useEffect(() => {
    if (layoutData) rebuildSourceMeta(layoutData as LayoutRow[]);
  }, [layoutData]);

  const amountNum = useMemo(() => {
    const n = Number(amountFilter.replace(/[^\d]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [amountFilter]);

  const { data: feed, isLoading, refetch } = useQuery({
    queryKey: ['journal-feed', { from, to, source, search, amount: amountNum }],
    queryFn: () =>
      api.journal.feed({
        from,
        to,
        source,
        search: search || undefined,
        amount: amountNum,
        // Bekor qilingan amallar ham doim ko'rinadi (ustiga chiziq chizilib).
        include_void: true,
        limit: 300,
      }),
    refetchInterval: 60_000,
  });

  const { data: summary } = useQuery({
    queryKey: ['journal-summary', { from, to }],
    queryFn: () => api.journal.summary({ from, to }),
    refetchInterval: 60_000,
  });

  // Realtime invalidation — any new transaction/sale/admission auto-refreshes
  useEffect(() => {
    const ch = supabase
      .channel('journal-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () =>
        qc.invalidateQueries({ queryKey: ['journal-feed'] }),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pharmacy_sales' }, () =>
        qc.invalidateQueries({ queryKey: ['journal-feed'] }),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () =>
        qc.invalidateQueries({ queryKey: ['journal-feed'] }),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inpatient_stays' }, () =>
        qc.invalidateQueries({ queryKey: ['journal-feed'] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const requirePin = (action: (pin: string) => void) => {
    if (isPinUnlocked()) {
      // we still need the actual PIN for void operations; the API verifies it server-side.
      // For notes (edit/delete), we just gate UX — backend permits regular auth.
      action('');
      return;
    }
    setPinModal({ onSuccess: action });
  };

  const exportCsv = () => {
    if (!feed) return;
    const rows = [
      [
        'Sana/Vaqt', 'Bo\'lim', 'Bemor', 'Telefon', 'Kasallik/izoh', 'Xizmat turi', 'Shifokor',
        'Kassir', 'To\'lov usuli', 'Summa', 'Holat', 'Bekor qilingan', 'Izoh',
      ],
      ...feed.map((r) => [
        fmtDateTime(r.occurred_at),
        sourceMeta(r.source).label,
        r.patient_name ?? '',
        r.patient_phone ?? '',
        r.diagnosis ?? r.description ?? '',
        (r.items ?? []).map((i) => `${i.name} ×${i.quantity}`).join('; '),
        r.doctor_name ?? '',
        r.cashier_name ?? '',
        r.payment_method ?? '',
        String(r.amount_uzs),
        STATUS_META[r.status].label,
        r.is_void ? 'Ha' : '',
        r.note ?? '',
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Yagona jurnal</h1>
          <p className="text-sm text-muted-foreground">
            Kassa, dorixona, statsionar va qabulxona — barcha hodisalar real-vaqt
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Yangilash
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-1.5 h-4 w-4" />
            CSV
          </Button>
          {isPinUnlocked() ? (
            <Button variant="ghost" size="sm" onClick={() => { lockPin(); toast.info('PIN qulflandi'); }}>
              <Lock className="mr-1.5 h-4 w-4" />
              Qulflash
            </Button>
          ) : null}
        </div>
      </div>

      {/* Ko'rinish tablari — Moliya / Faoliyat */}
      <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
        {([
          { id: 'finance', label: 'Moliya' },
          { id: 'activity', label: 'Faoliyat' },
        ] as const).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setView(t.id)}
            className={cn(
              'rounded px-4 py-1.5 text-sm font-medium transition',
              view === t.id ? 'bg-background shadow-sm' : 'text-muted-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === 'activity' ? (
        <ActivityJournalView />
      ) : (
      // Moliya — qat'iy balandlikdagi ustun: KPI + filtr tepada qotadi,
      // o'rtada jadval scroll bo'ladi, pastdagi yakuniy hisob qotadi.
      <div className="flex flex-col gap-3" style={{ height: 'calc(100vh - 200px)' }}>
      {/* Moliya KPI kataklari — tepada qotgan (scroll qilmaydi). */}
      <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Tushum"
          value={`${fmt(summary?.revenue ?? 0)} UZS`}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Rasxot"
          value={`${fmt(summary?.expenses ?? 0)} UZS`}
          icon={<ArrowDownRight className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard
          label="Qaytarish"
          value={`${fmt(summary?.refunds ?? 0)} UZS`}
          icon={<ArrowUpRight className="h-4 w-4" />}
          tone="info"
        />
        <StatCard
          label="Sof foyda"
          value={`${fmt(summary?.profit ?? 0)} UZS`}
          icon={<PiggyBank className="h-4 w-4" />}
          tone={(summary?.profit ?? 0) >= 0 ? 'success' : 'danger'}
        />
      </div>

      {/* Filtrlar — tepada qotgan (scroll qilmaydi). */}
      <Card className="shrink-0 shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
            {(['today', 'week', 'month', 'custom'] as Preset[]).map((p) => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={cn(
                  'rounded px-3 py-1.5 text-xs font-medium transition',
                  preset === p ? 'bg-background shadow-sm' : 'text-muted-foreground',
                )}
              >
                {p === 'today'
                  ? 'Bugun'
                  : p === 'week'
                    ? 'Hafta'
                    : p === 'month'
                      ? 'Oy'
                      : "Sana oralig'i"}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <div className="inline-flex items-center gap-1.5">
              <Input
                type="date"
                className="h-8 w-[150px]"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">—</span>
              <Input
                type="date"
                className="h-8 w-[150px]"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          )}

          <Select value={source} onValueChange={(v: SourceFilter) => setSource(v)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barcha bo'limlar</SelectItem>
              <SelectItem value="transactions">Kassa</SelectItem>
              <SelectItem value="pharmacy">Dorixona</SelectItem>
              <SelectItem value="inpatient">Statsionar</SelectItem>
              <SelectItem value="ledger">Statsionar hisob</SelectItem>
              <SelectItem value="appointments">Qabulxona</SelectItem>
              <SelectItem value="expenses">Rasxotlar</SelectItem>
              <SelectItem value="shifts">Smenalar</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Bemor, tel, kasallik, shifokor, izoh..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="relative w-44">
            <Wallet className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              inputMode="numeric"
              className="pl-8 font-mono"
              placeholder="Summa (so'm)"
              value={amountFilter}
              onChange={(e) => {
                // Faqat raqamlar
                const digits = e.target.value.replace(/[^\d]/g, '');
                // Mingliklar bo'yicha vergul (UX)
                setAmountFilter(
                  digits ? Number(digits).toLocaleString('uz-UZ') : '',
                );
              }}
              title="Aniq summa yozing — shu summali tx'lar topiladi"
            />
            {amountFilter && (
              <button
                type="button"
                onClick={() => setAmountFilter('')}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                title="Tozalash"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Feed table — faqat shu qism scroll bo'ladi (flex-1). */}
      {isLoading ? (
        <Card className="flex-1">
          <CardContent className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-muted/40" />
            ))}
          </CardContent>
        </Card>
      ) : (feed ?? []).length === 0 ? (
        <div className="flex-1">
          <EmptyState
            icon={<Activity className="h-10 w-10" />}
            title="Yozuvlar topilmadi"
            description="Filtr yoki sanani o'zgartirib ko'ring"
          />
        </div>
      ) : (
        <Card className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b bg-muted/95 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Sana/Vaqt</th>
                  <th className="px-3 py-2.5 text-left font-medium">Bo'lim</th>
                  <th className="px-3 py-2.5 text-left font-medium">Bemor</th>
                  <th className="px-3 py-2.5 text-left font-medium">Telefon</th>
                  <th className="px-3 py-2.5 text-left font-medium">Kasallik/Izoh</th>
                  <th className="px-3 py-2.5 text-left font-medium">Xizmat turi</th>
                  <th className="px-3 py-2.5 text-left font-medium">Shifokor</th>
                  <th className="px-3 py-2.5 text-left font-medium">Kassir</th>
                  <th className="px-3 py-2.5 text-left font-medium">To'lov</th>
                  <th className="px-3 py-2.5 text-right font-medium">Summa</th>
                  <th className="px-3 py-2.5 text-left font-medium">Holat</th>
                  <th className="px-3 py-2.5 text-right font-medium">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(feed as FeedEntry[]).map((r) => {
                  const SrcIcon = sourceMeta(r.source).icon;
                  return (
                    <tr
                      key={r.id}
                      className={cn(
                        'hover:bg-muted/30',
                        // Bekor qilingan amal — ustiga ingichka chiziq, biroz xira
                        r.is_void && 'text-muted-foreground line-through decoration-1',
                      )}
                    >
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {fmtDateTime(r.occurred_at)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                            sourceMeta(r.source).tone,
                          )}
                        >
                          <SrcIcon className="h-3 w-3" />
                          {sourceMeta(r.source).label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-medium">{r.patient_name ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-mono text-xs">{r.patient_phone ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="max-w-[150px] truncate" title={r.diagnosis ?? r.description ?? ''}>{r.diagnosis ?? r.description ?? '—'}</div>
                        {r.note && (
                          <div className="mt-1 line-clamp-2 max-w-[150px] rounded bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground no-underline" title={r.note}>
                            <FileText className="mr-1 inline h-3 w-3" />
                            {r.note}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        {(() => {
                          const items = r.items ?? [];
                          if (items.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
                          const first = items[0]!.name;
                          const extra = items.length - 1;
                          return (
                            <div
                              className="max-w-[200px] truncate text-xs"
                              title={items.map((i) => `${i.name} ×${i.quantity}`).join('\n')}
                            >
                              {first}
                              {extra > 0 && (
                                <span className="ml-1 text-muted-foreground">+{extra}</span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="text-xs">{r.doctor_name ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="text-xs">{r.cashier_name ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="text-xs">{r.payment_method ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right align-top">
                        <div
                          className={cn(
                            'font-mono font-semibold tabular-nums',
                            r.amount_uzs < 0
                              ? 'text-rose-600'
                              : r.status === 'refund'
                                ? 'text-amber-600'
                                : r.status === 'debt'
                                  ? 'text-rose-600'
                                  : 'text-emerald-700',
                          )}
                        >
                          {r.amount_uzs < 0 ? '−' : ''}
                          {fmt(Math.abs(r.amount_uzs))}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="flex flex-col gap-1">
                          <span
                            className={cn(
                              'inline-flex w-fit items-center rounded px-2 py-0.5 text-[11px] font-medium',
                              STATUS_META[r.status].tone,
                            )}
                          >
                            {STATUS_META[r.status].label}
                          </span>
                          {r.is_void && (
                            <span className="inline-flex w-fit items-center rounded bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700 no-underline">
                              Bekor qilingan
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right align-top">
                        <div className="inline-flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title="Batafsil ko'rish"
                            onClick={() => setDetailModal(r)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Yakuniy hisob — pastda qotgan (scroll qilmaydi). */}
      <Card className="shrink-0">
        <CardContent className="grid grid-cols-2 gap-3 p-4 md:grid-cols-5">
          <Recap label="Yozuvlar" value={String(feed?.length ?? 0)} icon={<Coins className="h-4 w-4" />} />
          <Recap
            label="Davr"
            value={`${new Date(from).toLocaleDateString('uz-UZ')} — ${new Date(to).toLocaleDateString('uz-UZ')}`}
            icon={<CalendarRange className="h-4 w-4" />}
          />
          <Recap
            label="Tushum"
            value={`${fmt(summary?.revenue ?? 0)} UZS`}
            icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}
          />
          <Recap
            label="Dorixona qarzi"
            value={`${fmt(summary?.pharmacy_debt_window ?? 0)} UZS`}
            icon={<AlertCircle className="h-4 w-4 text-rose-600" />}
          />
          <Recap
            label="Sof foyda"
            value={`${fmt(summary?.profit ?? 0)} UZS`}
            icon={<PiggyBank className="h-4 w-4" />}
          />
        </CardContent>
      </Card>

      {/* Modals */}
      <PinModal
        open={!!pinModal}
        onClose={() => setPinModal(null)}
        onVerified={(pin) => {
          unlockPin();
          pinModal?.onSuccess(pin);
          setPinModal(null);
        }}
      />

      {detailModal && (
        <DetailModal entry={detailModal} onClose={() => setDetailModal(null)} />
      )}
      </div>
      )}
    </div>
  );
}

// =============================================================================
// Faoliyat jurnali — activity_journal: barcha jarayonlar (lab, shifokor,
// qabul, statsionar, hamshira). @Audit decorator yozgan yozuvlar.
// =============================================================================

// action prefiksi -> bo'lim yorlig'i va rangi
const ACTIVITY_GROUP: Array<{ prefix: string; label: string; tone: string }> = [
  { prefix: 'lab.', label: 'Laboratoriya', tone: 'bg-violet-50 text-violet-700 border-violet-200' },
  { prefix: 'doctor.', label: 'Shifokor', tone: 'bg-sky-50 text-sky-700 border-sky-200' },
  { prefix: 'diagnostic', label: 'Diagnostika', tone: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  { prefix: 'queue.', label: 'Navbat', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  { prefix: 'appointment', label: 'Qabulxona', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  { prefix: 'reception.', label: 'Qabulxona', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  { prefix: 'patient.', label: 'Bemorlar', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  { prefix: 'inpatient.', label: 'Statsionar', tone: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { prefix: 'care.', label: 'Statsionar', tone: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { prefix: 'nurse', label: 'Hamshira', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  { prefix: 'emergency.', label: 'Shoshilinch', tone: 'bg-red-50 text-red-700 border-red-200' },
  { prefix: 'prescription.', label: 'Retsept', tone: 'bg-teal-50 text-teal-700 border-teal-200' },
  { prefix: 'pharmacy.', label: 'Dorixona', tone: 'bg-violet-50 text-violet-700 border-violet-200' },
  { prefix: 'referral.', label: 'Yo‘naltirish', tone: 'bg-slate-50 text-slate-700 border-slate-200' },
];

function activityGroup(action: string): { label: string; tone: string } {
  const hit = ACTIVITY_GROUP.find((g) => action.startsWith(g.prefix));
  return hit
    ? { label: hit.label, tone: hit.tone }
    : { label: 'Boshqa', tone: 'bg-slate-50 text-slate-700 border-slate-200' };
}

// action kodi -> o'qiy oladigan tavsif
const ACTION_LABEL: Record<string, string> = {
  'lab.ordered': 'Tahlil buyurtma berildi',
  'lab.collected': 'Namuna olindi',
  'lab.running': 'Tahlil jarayonga olindi',
  'lab.completed': 'Tahlil tugallandi',
  'lab.reported': 'Tahlil natijasi yuborildi',
  'lab.delivered': 'Natija topshirildi',
  'lab.canceled': 'Tahlil bekor qilindi',
  'lab.result_recorded': 'Natija kiritildi',
  'lab.result_validated': 'Natija tasdiqlandi',
  'lab.result_rejected': 'Natija rad etildi',
  'lab.sample_created': 'Probirka yaratildi',
  'lab.sample_status': 'Namuna holati o‘zgardi',
  'doctor.vitals_recorded': 'Vital belgilar yozildi',
  'doctor.consultation_saved': 'Konsultatsiya saqlandi',
  'doctor.history_updated': 'Kasallik tarixi yangilandi',
  'doctor.file_added': 'Fayl yuklandi',
  'doctor.file_deleted': 'Fayl o‘chirildi',
  'doctor.template_created': 'Shablon yaratildi',
  'diagnostic.ordered': 'Diagnostika buyurtma berildi',
  'diagnostic.completed': 'Diagnostika tugallandi',
  'queue.joined': 'Navbatga qo‘shildi',
  'queue.called_next': 'Keyingi bemor chaqirildi',
  'queue.called': 'Bemor chaqirildi',
  'queue.accepted': 'Bemor qabul qilindi',
  'queue.completed': 'Qabul yakunlandi',
  'queue.skipped': 'Navbat o‘tkazib yuborildi',
  'appointment.scheduled': 'Qabul belgilandi',
  'appointment.rescheduled': 'Qabul ko‘chirildi',
  'reception.checkout': 'Qabulxona to‘lovi',
  'patient.registered': 'Bemor ro‘yxatga olindi',
  'patient.updated': 'Bemor ma’lumoti yangilandi',
  'patient.deleted': 'Bemor o‘chirildi',
  'inpatient.admitted': 'Statsionarga yotqizildi',
  'inpatient.transferred': 'Boshqa palataga ko‘chirildi',
  'inpatient.discharged': 'Statsionardan chiqarildi',
  'inpatient.vitals_recorded': 'Statsionar vital belgilar',
  'care.scheduled': 'Parvarish rejalashtirildi',
  'care.performed': 'Parvarish bajarildi',
  'care.skipped': 'Parvarish o‘tkazib yuborildi',
  'nurse_task.created': 'Hamshira vazifasi yaratildi',
  'nurse_task.updated': 'Hamshira vazifasi yangilandi',
  'emergency.triggered': 'Shoshilinch chaqiriq',
  'emergency.acknowledged': 'Shoshilinch qabul qilindi',
  'emergency.resolved': 'Shoshilinch hal qilindi',
  'prescription.created': 'Retsept yaratildi',
  'prescription.signed': 'Retsept imzolandi',
  'prescription.canceled': 'Retsept bekor qilindi',
};

function ActivityJournalView() {
  const [actorFilter, setActorFilter] = useState('');

  const { data: rows, isLoading } = useQuery({
    queryKey: ['activity-journal'],
    queryFn: () => api.audit.activity({ limit: 300 }),
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    const list = rows ?? [];
    if (!actorFilter.trim()) return list;
    const q = actorFilter.trim().toLowerCase();
    return list.filter(
      (r) =>
        (r.actor?.full_name ?? '').toLowerCase().includes(q) ||
        r.action.toLowerCase().includes(q),
    );
  }, [rows, actorFilter]);

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Xodim ismi yoki amal bo‘yicha qidirish..."
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            Oxirgi {filtered.length} ta yozuv
          </span>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-muted/40" />
            ))}
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-10 w-10" />}
          title="Faoliyat yozuvlari yo‘q"
          description="Lab, shifokor, qabul va boshqa jarayonlar shu yerda ko‘rinadi"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Sana/Vaqt</th>
                  <th className="px-3 py-2.5 text-left font-medium">Bo‘lim</th>
                  <th className="px-3 py-2.5 text-left font-medium">Amal</th>
                  <th className="px-3 py-2.5 text-left font-medium">Xodim</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => {
                  const g = activityGroup(r.action);
                  return (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {fmtDateTime(r.created_at)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <span
                          className={cn(
                            'inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium',
                            g.tone,
                          )}
                        >
                          {g.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        {ACTION_LABEL[r.action] ?? r.action}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-medium">{r.actor?.full_name ?? '—'}</div>
                        {r.actor?.role && (
                          <div className="text-[10px] text-muted-foreground">
                            {r.actor.role}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Recap({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5">{icon}</div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

// =============================================================================
// PIN modal
// =============================================================================
function PinModal({
  open,
  onClose,
  onVerified,
}: {
  open: boolean;
  onClose: () => void;
  onVerified: (pin: string) => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const verifyMut = useMutation({
    mutationFn: () => api.journal.verifyPin(pin),
    onSuccess: () => onVerified(pin),
    onError: (e: Error) => setError(e.message || 'Noto\'g\'ri PIN'),
  });

  useEffect(() => {
    if (open) {
      setPin('');
      setError('');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            PIN-kod
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Tahrirlash yoki o'chirish uchun 4-8 raqamli PIN kiriting.
          </p>
          <Input
            type="password"
            inputMode="numeric"
            autoFocus
            placeholder="••••"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, '').slice(0, 8));
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && pin.length >= 4 && verifyMut.mutate()}
            className="text-center text-2xl tracking-[0.5em]"
          />
          {error && <div className="text-center text-xs text-rose-600">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <X className="mr-1 h-4 w-4" />
            Bekor
          </Button>
          <Button
            onClick={() => verifyMut.mutate()}
            disabled={pin.length < 4 || verifyMut.isPending}
          >
            Tasdiqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Note modal — list, add, edit, delete
// =============================================================================
function NoteModal({ entry, onClose }: { entry: FeedEntry; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const refType = entry.source;
  const { data: notes } = useQuery({
    queryKey: ['journal-notes', refType, entry.ref_id],
    queryFn: () => api.journal.listNotes(refType, entry.ref_id),
  });

  const createMut = useMutation({
    mutationFn: () => api.journal.createNote({ ref_type: refType, ref_id: entry.ref_id, note: text }),
    onSuccess: () => {
      toast.success('Izoh qo\'shildi');
      setText('');
      qc.invalidateQueries({ queryKey: ['journal-notes', refType, entry.ref_id] });
      qc.invalidateQueries({ queryKey: ['journal-feed'] });
    },
  });

  const updateMut = useMutation({
    mutationFn: (id: string) => api.journal.updateNote(id, text),
    onSuccess: () => {
      toast.success('Yangilandi');
      setText('');
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['journal-notes', refType, entry.ref_id] });
      qc.invalidateQueries({ queryKey: ['journal-feed'] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.journal.deleteNote(id),
    onSuccess: () => {
      toast.success('O\'chirildi');
      qc.invalidateQueries({ queryKey: ['journal-notes', refType, entry.ref_id] });
      qc.invalidateQueries({ queryKey: ['journal-feed'] });
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Izohlar — {entry.patient_name ?? sourceMeta(entry.source).label}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div>
              <span className="text-muted-foreground">Sana:</span> {fmtDateTime(entry.occurred_at)}
            </div>
            {entry.diagnosis && (
              <div>
                <span className="text-muted-foreground">Kasallik:</span> {entry.diagnosis}
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Summa:</span> {fmt(entry.amount_uzs)} UZS
            </div>
          </div>

          <div className="space-y-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder={editingId ? 'Izohni tahrirlash...' : 'Yangi izoh...'}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              {editingId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingId(null);
                    setText('');
                  }}
                >
                  Bekor
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => (editingId ? updateMut.mutate(editingId) : createMut.mutate())}
                disabled={!text.trim() || createMut.isPending || updateMut.isPending}
              >
                {editingId ? 'Saqlash' : 'Qo\'shish'}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-muted-foreground">
              Mavjud izohlar ({(notes ?? []).length})
            </div>
            {(notes ?? []).length === 0 && (
              <div className="py-3 text-center text-xs text-muted-foreground">
                Hali izohlar yo'q
              </div>
            )}
            <ul className="max-h-60 space-y-2 overflow-auto">
              {(notes ?? []).map((n) => (
                <li key={n.id} className="rounded-md border bg-card p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-sm">{n.note}</p>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {n.author?.full_name ?? 'Tizim'} • {fmtDateTime(n.created_at)}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => {
                          setEditingId(n.id);
                          setText(n.note);
                        }}
                      >
                        <Edit3 className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-rose-600"
                        onClick={() => deleteMut.mutate(n.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Detail modal — view rejimi: tranzaksiya batafsil ko'rinishi (bemor,
// shifokor, kassir, smena, bo'lim, xizmatlar ro'yxati, to'lov, holat, izoh).
// Edit rejimi: faqat transaction source uchun, admin/owner xizmatlarni
// qo'shish/o'chirish/narx tahrirlash imkonini beradi. Saqlanganda backend
// transactions.amount_uzs, doctor_commissions va patient_ledger ni sinxronlab
// qo'yadi.
// =============================================================================
function DetailModal({ entry, onClose }: { entry: FeedEntry; onClose: () => void }) {
  const qc = useQueryClient();
  const src = sourceMeta(entry.source);
  const status = STATUS_META[entry.status];
  const items = entry.items ?? [];
  const dept = entry.department ?? src.label;
  const canEdit = entry.source === 'transaction' && !entry.is_void;

  // === Statsionar amallari — bemor faol statsionarda bo'lsa ===
  // Jurnaldagi yozuvni bosganda, agar bemor hozir statsionarda yotgan bo'lsa,
  // shu yerda xizmat qo'shish / hisob (deposit) imkoni chiqadi.
  const [inpView, setInpView] = useState<'none' | 'service' | 'ledger'>('none');
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ clinic?: { name?: string } }>('/api/v1/auth/me'),
  });
  const clinicName = me?.clinic?.name ?? 'Klinika';
  const { data: activeStay } = useQuery({
    queryKey: ['inp-active-stay', entry.patient_id],
    queryFn: () => api.inpatient.activeStay(entry.patient_id!),
    enabled: !!entry.patient_id,
  });
  // Ledger paneli uchun stay batafsil (entries + balans).
  const { data: stayDetail } = useQuery({
    queryKey: ['inpatient-stay', activeStay?.id],
    queryFn: () => api.inpatient.getStay(activeStay!.id),
    enabled: inpView === 'ledger' && !!activeStay?.id,
  });

  const [editMode, setEditMode] = useState(false);
  const [editItems, setEditItems] = useState<Array<{
    service_id: string;
    name: string;
    quantity: number;
    unit_price_uzs: number;
    discount_uzs: number;
  }>>([]);
  const [editNotes, setEditNotes] = useState('');
  const [addServiceId, setAddServiceId] = useState('');

  // Edit rejimida services dropdown uchun.
  // queryKey reception sahifasidagi ['services']'dan farqli bo'lishi shart —
  // reception api.services.list() chaqiradi, biz api.catalog.list() —
  // shape boshqa, cache konflikt reception sahifani buzadi.
  const { data: services } = useQuery({
    queryKey: ['catalog', 'services', 'for-edit'],
    queryFn: () => api.catalog.list('services', { pageSize: 500 }),
    enabled: editMode,
  });
  const svcOptions =
    (((services as { items?: Array<{ id: string; name_i18n: Record<string, string>; price_uzs: number }> })?.items) ?? []);

  const editMut = useMutation({
    mutationFn: () =>
      api.transactions.editItems(entry.ref_id, {
        items: editItems.map((it) => ({
          service_id: it.service_id,
          quantity: it.quantity,
          unit_price_uzs: it.unit_price_uzs,
          discount_uzs: it.discount_uzs,
        })),
        notes: editNotes || undefined,
      }),
    onSuccess: (data) => {
      toast.success(
        `Saqlandi: ${data.old_amount_uzs.toLocaleString('uz-UZ')} → ${data.new_amount_uzs.toLocaleString('uz-UZ')} so'm`,
      );
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'journal' });
      qc.invalidateQueries({ queryKey: ['cashier-kpis'] });
      qc.invalidateQueries({ queryKey: ['payroll'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Delete (butunlay o'chirish) — admin only, ikkita tasdiqlash bilan.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMut = useMutation({
    mutationFn: () => api.transactions.delete(entry.ref_id),
    onSuccess: (data) => {
      toast.success(
        `Tranzaksiya butunlay o'chirildi (${fmt(data.deleted_amount_uzs)} so'm)`,
      );
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'journal' });
      qc.invalidateQueries({ queryKey: ['cashier-kpis'] });
      qc.invalidateQueries({ queryKey: ['payroll'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Edit rejimi yoqilganda joriy items'ni state'ga ko'chirish.
  // Service_id mavjud emas (faqat name). Demak edit rejimida service tanlash
  // uchun foydalanuvchi avval xizmatni qo'shadi yoki narxni o'zgartiradi.
  // Mavjud xizmatlarni service_id'siz saqlaymiz va saqlashda foydalanuvchi
  // ularni o'zi qayta tanlashi kerak. Bu UX yaxshi emas — to'g'riroq backend
  // feed.items ga service_id ham qaytarishi kerak. Kichik fix: hozircha
  // edit rejimi to'liq qayta tarkib qurish sifatida ishlaydi.
  const startEdit = () => {
    setEditItems([]);
    setEditNotes('');
    setEditMode(true);
  };

  const addItem = () => {
    const svc = svcOptions.find((s) => s.id === addServiceId);
    if (!svc) return;
    setEditItems((prev) => [
      ...prev,
      {
        service_id: svc.id,
        name: svc.name_i18n['uz-Latn'] ?? Object.values(svc.name_i18n)[0] ?? 'xizmat',
        quantity: 1,
        unit_price_uzs: Number(svc.price_uzs ?? 0),
        discount_uzs: 0,
      },
    ]);
    setAddServiceId('');
  };

  const updateItem = (i: number, patch: Partial<typeof editItems[number]>) => {
    setEditItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };

  const removeItem = (i: number) => {
    setEditItems((prev) => prev.filter((_, idx) => idx !== i));
  };

  const editTotal = editItems.reduce(
    (sum, it) => sum + it.unit_price_uzs * it.quantity - it.discount_uzs,
    0,
  );

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="col-span-2 font-medium">{value ?? '—'}</div>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                src.tone,
              )}
            >
              {src.label}
            </span>
            <span>Batafsil hisobot</span>
            {entry.is_void && (
              <span className="rounded bg-rose-100 px-2 py-0.5 text-[11px] text-rose-700">
                Bekor qilingan
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Asosiy ma'lumotlar */}
          <div className="space-y-2 rounded-md border p-3">
            <Row label="Sana / Vaqt" value={fmtDateTime(entry.occurred_at)} />
            <Row label="Bo'lim" value={dept} />
            <Row label="Bemor" value={entry.patient_name} />
            <Row label="Telefon" value={entry.patient_phone} />
            <Row label="Shifokor" value={entry.doctor_name} />
            <Row label="Kassir" value={entry.cashier_name} />
            <Row label="To'lov usuli" value={entry.payment_method} />
            <Row
              label="Holat"
              value={
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    status.tone,
                  )}
                >
                  {status.label}
                </span>
              }
            />
            <Row
              label="Summa"
              value={
                <span
                  className={cn(
                    'font-mono tabular-nums',
                    entry.amount_uzs < 0 ? 'text-rose-600' : 'text-emerald-700',
                  )}
                >
                  {entry.amount_uzs < 0 ? '−' : ''}
                  {fmt(Math.abs(entry.amount_uzs))} so'm
                </span>
              }
            />
          </div>

          {/* Xizmatlar */}
          {items.length > 0 && (
            <div className="rounded-md border">
              <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
                Xizmatlar ({items.length})
              </div>
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Nomi</th>
                    <th className="px-3 py-2 text-right font-medium">Soni</th>
                    <th className="px-3 py-2 text-right font-medium">Summa</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">{it.name}</td>
                      <td className="px-3 py-2 text-right font-mono">{it.quantity}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {fmt(it.amount_uzs)} so'm
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tafsilot va izoh */}
          {(entry.description || entry.diagnosis || entry.note) && (
            <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
              {entry.diagnosis && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Kasallik / Diagnoz</div>
                  <div>{entry.diagnosis}</div>
                </div>
              )}
              {entry.description && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Tafsilot</div>
                  <div>{entry.description}</div>
                </div>
              )}
              {entry.note && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Izoh</div>
                  <div className="whitespace-pre-wrap">{entry.note}</div>
                </div>
              )}
            </div>
          )}

          {/* === Statsionar amallari (bemor faol statsionarda bo'lsa) === */}
          {activeStay && !editMode && (
            <div className="rounded-md border border-indigo-200 bg-indigo-50/40 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-indigo-900">
                <BedDouble className="h-4 w-4" />
                Statsionar amallari
                {activeStay.room_label && (
                  <span className="text-xs font-normal text-indigo-700">
                    ({activeStay.room_label})
                  </span>
                )}
                <span
                  className={cn(
                    'ml-auto font-mono text-xs',
                    activeStay.balance < 0 ? 'text-rose-600' : 'text-emerald-700',
                  )}
                >
                  Balans: {fmt(activeStay.balance)} so'm
                </span>
              </div>

              {inpView === 'none' && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setInpView('service')}>
                    <Plus className="h-3.5 w-3.5" />
                    Xizmat qo'shish
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setInpView('ledger')}>
                    <Wallet className="h-3.5 w-3.5" />
                    Hisob (deposit/kredit)
                  </Button>
                </div>
              )}

              {inpView === 'service' && (
                <div className="space-y-2">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setInpView('none')}
                  >
                    ← Orqaga
                  </button>
                  <ServicePanel
                    patientId={activeStay.patient_id}
                    stayId={activeStay.id}
                    clinicName={clinicName}
                    patientName={activeStay.full_name}
                    onDone={() => setInpView('none')}
                  />
                </div>
              )}

              {inpView === 'ledger' && (
                <div className="space-y-2">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setInpView('none')}
                  >
                    ← Orqaga
                  </button>
                  {stayDetail ? (
                    <LedgerPanel
                      patientId={activeStay.patient_id}
                      stayId={activeStay.id}
                      balance={stayDetail.balance}
                      entries={stayDetail.ledger as never}
                    />
                  ) : (
                    <div className="py-4 text-center text-xs text-muted-foreground">
                      Hisob yuklanmoqda…
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Edit rejimi: xizmatlarni qayta qurish */}
          {editMode && (
            <div className="rounded-md border border-amber-300 bg-amber-50/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-amber-900">
                  Xizmatlarni qayta qurish
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>
                  Bekor qilish
                </Button>
              </div>

              <div className="space-y-2">
                {editItems.length === 0 && (
                  <div className="rounded bg-white px-3 py-2 text-xs text-muted-foreground">
                    Hozir xizmatlar bo'sh. Pastdan qo'shing.
                  </div>
                )}
                {editItems.map((it, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 rounded bg-white p-2 text-sm">
                    <div className="col-span-5 truncate">{it.name}</div>
                    <input
                      type="number"
                      min={1}
                      value={it.quantity}
                      onChange={(e) =>
                        updateItem(i, { quantity: Math.max(1, Number(e.target.value) || 1) })
                      }
                      className="col-span-2 rounded border px-2 py-1 text-right text-xs"
                      title="Soni"
                    />
                    <input
                      type="number"
                      min={0}
                      value={it.unit_price_uzs}
                      onChange={(e) =>
                        updateItem(i, { unit_price_uzs: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="col-span-3 rounded border px-2 py-1 text-right text-xs"
                      title="Narx"
                    />
                    <input
                      type="number"
                      min={0}
                      value={it.discount_uzs}
                      onChange={(e) =>
                        updateItem(i, { discount_uzs: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="col-span-1 rounded border px-2 py-1 text-right text-xs"
                      title="Chegirma"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="col-span-1 h-7 w-7 p-0 text-rose-600"
                      onClick={() => removeItem(i)}
                      title="O'chirish"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Yangi xizmat qo'shish */}
              <div className="mt-3 flex gap-2">
                <Select value={addServiceId} onValueChange={setAddServiceId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Xizmatni tanlang..." />
                  </SelectTrigger>
                  <SelectContent>
                    {svcOptions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name_i18n['uz-Latn'] ?? Object.values(s.name_i18n)[0]} —{' '}
                        {fmt(s.price_uzs)} so'm
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={addItem} disabled={!addServiceId} size="sm">
                  Qo'shish
                </Button>
              </div>

              {/* Izoh */}
              <div className="mt-3 space-y-1">
                <div className="text-xs font-medium text-muted-foreground">
                  Tahrir sababi (ixtiyoriy)
                </div>
                <Input
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Nima uchun o'zgartirilyapti..."
                />
              </div>

              {/* Yangi summa */}
              <div className="mt-3 flex items-center justify-between rounded bg-white px-3 py-2">
                <div className="text-xs text-muted-foreground">Yangi jami summa</div>
                <div className="font-mono text-sm font-semibold tabular-nums text-emerald-700">
                  {fmt(editTotal)} so'm
                </div>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Eski: {fmt(entry.amount_uzs)} so'm · Farq:{' '}
                <span className={editTotal - entry.amount_uzs >= 0 ? 'text-rose-600' : 'text-emerald-700'}>
                  {editTotal - entry.amount_uzs >= 0 ? '+' : ''}
                  {fmt(editTotal - entry.amount_uzs)} so'm
                </span>
              </div>
            </div>
          )}

          <div className="text-[10px] font-mono text-muted-foreground">
            ID: {entry.ref_id}
          </div>
        </div>

        {/* Delete tasdiq paneli */}
        {confirmDelete && (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm">
            <div className="font-semibold text-rose-900">
              Tranzaksiyani butunlay o'chirishni tasdiqlaysizmi?
            </div>
            <div className="mt-1 text-xs text-rose-800">
              Bu amal qaytarib bo'lmaydi. Komissiyalar 'reversed' bo'ladi,
              qarz qaytariladi, xizmatlar yo'qoladi.
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => deleteMut.mutate()}
                disabled={deleteMut.isPending}
              >
                Ha, butunlay o'chirish
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>
                Bekor qilish
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          {!editMode && canEdit && !confirmDelete && (
            <>
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                className="gap-1 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Butunlay o'chirish
              </Button>
              <Button variant="outline" onClick={startEdit} className="gap-1">
                <Edit3 className="h-3.5 w-3.5" />
                Tahrirlash
              </Button>
            </>
          )}
          {editMode && (
            <Button
              onClick={() => editMut.mutate()}
              disabled={editItems.length === 0 || editMut.isPending}
              className="gap-1"
            >
              Saqlash ({fmt(editTotal)} so'm)
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Yopish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Void modal — destructive, requires PIN every time (server verifies)
// =============================================================================
function VoidModal({
  entry,
  onClose,
  onDone,
}: {
  entry: FeedEntry;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const voidMut = useMutation({
    mutationFn: () => api.journal.voidEntry({ source: entry.source, ref_id: entry.ref_id, pin }),
    onSuccess: () => {
      toast.success('Yozuv o\'chirildi');
      onDone();
    },
    onError: (e: Error) => setError(e.message || 'Xatolik'),
  });

  const canVoid = entry.source === 'transaction' || entry.source === 'pharmacy_sale' || entry.source === 'expense';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-600">
            <AlertCircle className="h-4 w-4" />
            Yozuvni o'chirish
          </DialogTitle>
        </DialogHeader>
        {!canVoid ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Bu turdagi yozuvni jurnaldan o'chirib bo'lmaydi. Statsionar va qabulxona yozuvlari o'z bo'limidan boshqariladi.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Yopish
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm">
              <div className="font-medium text-rose-700">Diqqat — bu amalni qaytarib bo'lmaydi.</div>
              <div className="mt-1 text-xs text-rose-600">
                {sourceMeta(entry.source).label} • {entry.patient_name ?? '—'} •{' '}
                {fmt(entry.amount_uzs)} UZS
              </div>
            </div>
            <Input
              type="password"
              inputMode="numeric"
              autoFocus
              placeholder="PIN-kod"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, '').slice(0, 8));
                setError('');
              }}
              className="text-center text-xl tracking-[0.4em]"
            />
            {error && <div className="text-center text-xs text-rose-600">{error}</div>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Bekor
              </Button>
              <Button
                variant="destructive"
                onClick={() => voidMut.mutate()}
                disabled={pin.length < 4 || voidMut.isPending}
              >
                O'chirish
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// ReceptionJournal — qabulxona sahifasiga joylash uchun ixcham Moliya jurnali.
// Bugungi (yoki tanlangan) yozuvlar: KPI + filtr + jadval (faqat ko'rish).
// JournalPage helper'larini (sourceMeta, STATUS_META, DetailModal) qayta ishlatadi.
// =============================================================================
export function ReceptionJournal() {
  const qc = useQueryClient();
  const [preset, setPreset] = useState<Preset>('today');
  const [source, setSource] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');
  const [detailModal, setDetailModal] = useState<FeedEntry | null>(null);

  const { from, to } = useMemo(
    () => rangeFor(preset, { from: todayStr(), to: todayStr() }),
    [preset],
  );

  const { data: layoutData } = useQuery({
    queryKey: ['journal-layout'],
    queryFn: () => api.journal.layout(),
    staleTime: 60_000,
  });
  useEffect(() => {
    if (layoutData) rebuildSourceMeta(layoutData as LayoutRow[]);
  }, [layoutData]);

  const { data: feed, isLoading, refetch } = useQuery({
    queryKey: ['journal-feed', { from, to, source, search, embed: true }],
    queryFn: () =>
      api.journal.feed({
        from,
        to,
        source,
        search: search || undefined,
        // Bekor qilingan amallar ham ko'rinadi (chiziq chizilib)
        include_void: true,
        limit: 200,
      }),
    refetchInterval: 60_000,
  });

  const { data: summary } = useQuery({
    queryKey: ['journal-summary', { from, to }],
    queryFn: () => api.journal.summary({ from, to }),
    refetchInterval: 60_000,
  });

  // Realtime — yangi to'lov/savdo kelganda yangilanadi
  useEffect(() => {
    const ch = supabase
      .channel('reception-journal-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () =>
        qc.invalidateQueries({ queryKey: ['journal-feed'] }),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pharmacy_sales' }, () =>
        qc.invalidateQueries({ queryKey: ['journal-feed'] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  return (
    <div className="space-y-3">
      {/* Sarlavha + KPI */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Jurnal</h2>
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
          {(['today', 'week', 'month'] as Preset[]).map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-medium transition',
                preset === p ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
            >
              {p === 'today' ? 'Bugun' : p === 'week' ? 'Hafta' : 'Oy'}
            </button>
          ))}
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Tushum" value={`${fmt(summary?.revenue ?? 0)} UZS`} icon={<TrendingUp className="h-4 w-4" />} tone="success" />
        <StatCard label="Rasxot" value={`${fmt(summary?.expenses ?? 0)} UZS`} icon={<ArrowDownRight className="h-4 w-4" />} tone="warning" />
        <StatCard label="Qaytarish" value={`${fmt(summary?.refunds ?? 0)} UZS`} icon={<ArrowUpRight className="h-4 w-4" />} tone="info" />
        <StatCard label="Sof foyda" value={`${fmt(summary?.profit ?? 0)} UZS`} icon={<PiggyBank className="h-4 w-4" />} tone={(summary?.profit ?? 0) >= 0 ? 'success' : 'danger'} />
      </div>

      {/* Filtr */}
      <Card className="shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <Select value={source} onValueChange={(v: SourceFilter) => setSource(v)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barcha bo'limlar</SelectItem>
              <SelectItem value="transactions">Kassa</SelectItem>
              <SelectItem value="pharmacy">Dorixona</SelectItem>
              <SelectItem value="inpatient">Statsionar</SelectItem>
              <SelectItem value="ledger">Statsionar hisob</SelectItem>
              <SelectItem value="appointments">Qabulxona</SelectItem>
              <SelectItem value="expenses">Rasxotlar</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Bemor, tel, shifokor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Jadval */}
      {isLoading ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-muted/40" />
            ))}
          </CardContent>
        </Card>
      ) : (feed ?? []).length === 0 ? (
        <EmptyState icon={<Activity className="h-10 w-10" />} title="Yozuvlar topilmadi" description="Bugun hali yozuv yo'q" />
      ) : (
        <Card className="overflow-hidden">
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b bg-muted/95 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Sana/Vaqt</th>
                  <th className="px-3 py-2.5 text-left font-medium">Bo'lim</th>
                  <th className="px-3 py-2.5 text-left font-medium">Bemor</th>
                  <th className="px-3 py-2.5 text-left font-medium">Xizmat turi</th>
                  <th className="px-3 py-2.5 text-left font-medium">Shifokor</th>
                  <th className="px-3 py-2.5 text-left font-medium">Kassir</th>
                  <th className="px-3 py-2.5 text-right font-medium">Summa</th>
                  <th className="px-3 py-2.5 text-left font-medium">Holat</th>
                  <th className="px-3 py-2.5 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(feed as FeedEntry[]).map((r) => {
                  const SrcIcon = sourceMeta(r.source).icon;
                  return (
                    <tr key={r.id} className={cn('hover:bg-muted/30', r.is_void && 'text-muted-foreground line-through decoration-1')}>
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-mono text-[11px] text-muted-foreground">{fmtDateTime(r.occurred_at)}</div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', sourceMeta(r.source).tone)}>
                          <SrcIcon className="h-3 w-3" />
                          {sourceMeta(r.source).label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-medium">{r.patient_name ?? '—'}</div>
                        {r.patient_phone && <div className="font-mono text-[11px] text-muted-foreground">{r.patient_phone}</div>}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        {(() => {
                          const items = r.items ?? [];
                          if (items.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
                          const extra = items.length - 1;
                          return (
                            <div className="max-w-[180px] truncate text-xs" title={items.map((i) => `${i.name} ×${i.quantity}`).join('\n')}>
                              {items[0]!.name}
                              {extra > 0 && <span className="ml-1 text-muted-foreground">+{extra}</span>}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2.5 align-top"><div className="text-xs">{r.doctor_name ?? '—'}</div></td>
                      <td className="px-3 py-2.5 align-top"><div className="text-xs">{r.cashier_name ?? '—'}</div></td>
                      <td className="px-3 py-2.5 text-right align-top">
                        <div className={cn('font-mono font-semibold tabular-nums', r.amount_uzs < 0 ? 'text-rose-600' : r.status === 'refund' ? 'text-amber-600' : r.status === 'debt' ? 'text-rose-600' : 'text-emerald-700')}>
                          {r.amount_uzs < 0 ? '−' : ''}{fmt(Math.abs(r.amount_uzs))}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <span className={cn('inline-flex w-fit items-center rounded px-2 py-0.5 text-[11px] font-medium', STATUS_META[r.status].tone)}>
                          {STATUS_META[r.status].label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right align-top">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Batafsil" onClick={() => setDetailModal(r)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {detailModal && <DetailModal entry={detailModal} onClose={() => setDetailModal(null)} />}
    </div>
  );
}
