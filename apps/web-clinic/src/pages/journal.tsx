import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  Coins,
  Download,
  Edit3,
  FileText,
  Lock,
  MessageSquarePlus,
  PiggyBank,
  Receipt,
  RefreshCw,
  Search,
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

type FeedEntry = {
  id: string;
  source: 'transaction' | 'pharmacy_sale' | 'inpatient_stay' | 'appointment' | 'expense';
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
};

type SourceFilter = 'all' | 'transactions' | 'pharmacy' | 'inpatient' | 'appointments' | 'expenses';
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

function rangeFor(preset: Preset): { from: string; to: string } {
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
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

const SOURCE_META: Record<
  FeedEntry['source'],
  { label: string; icon: React.ElementType; tone: string }
> = {
  transaction: { label: 'Kassa', icon: Wallet, tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  pharmacy_sale: { label: 'Dorixona', icon: Receipt, tone: 'bg-violet-50 text-violet-700 border-violet-200' },
  inpatient_stay: { label: 'Statsionar', icon: Stethoscope, tone: 'bg-sky-50 text-sky-700 border-sky-200' },
  appointment: { label: 'Qabul', icon: User, tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  expense: { label: 'Rasxot', icon: ArrowDownRight, tone: 'bg-rose-50 text-rose-700 border-rose-200' },
};

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
  const [preset, setPreset] = useState<Preset>('today');
  const [source, setSource] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');
  const [pinModal, setPinModal] = useState<{
    onSuccess: (pin: string) => void;
  } | null>(null);
  const [noteModal, setNoteModal] = useState<FeedEntry | null>(null);
  const [confirmVoid, setConfirmVoid] = useState<FeedEntry | null>(null);

  const { from, to } = useMemo(() => rangeFor(preset), [preset]);

  const { data: feed, isLoading, refetch } = useQuery({
    queryKey: ['journal-feed', { from, to, source, search }],
    queryFn: () => api.journal.feed({ from, to, source, search: search || undefined, limit: 300 }),
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
      ['Sana/Vaqt', 'Manba', 'Bemor', 'Telefon', 'Kasallik/izoh', 'Shifokor', 'Summa', 'Holat', 'To\'lov usuli', 'Izoh'],
      ...feed.map((r) => [
        fmtDateTime(r.occurred_at),
        SOURCE_META[r.source].label,
        r.patient_name ?? '',
        r.patient_phone ?? '',
        r.diagnosis ?? r.description ?? '',
        r.doctor_name ?? '',
        String(r.amount_uzs),
        STATUS_META[r.status].label,
        r.payment_method ?? '',
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

      {/* Footer summary moved to TOP for at-a-glance KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
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
          </div>

          <Select value={source} onValueChange={(v: SourceFilter) => setSource(v)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barcha bo'limlar</SelectItem>
              <SelectItem value="transactions">Kassa</SelectItem>
              <SelectItem value="pharmacy">Dorixona</SelectItem>
              <SelectItem value="inpatient">Statsionar</SelectItem>
              <SelectItem value="appointments">Qabulxona</SelectItem>
              <SelectItem value="expenses">Rasxotlar</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Bemor ismi, tel, kasallik, shifokor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Feed table */}
      {isLoading ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-muted/40" />
            ))}
          </CardContent>
        </Card>
      ) : (feed ?? []).length === 0 ? (
        <EmptyState
          icon={<Activity className="h-10 w-10" />}
          title="Yozuvlar topilmadi"
          description="Filtr yoki sanani o'zgartirib ko'ring"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Sana/Vaqt</th>
                  <th className="px-3 py-2.5 text-left font-medium">Bemor</th>
                  <th className="px-3 py-2.5 text-left font-medium">Telefon</th>
                  <th className="px-3 py-2.5 text-left font-medium">Kasallik/Izoh</th>
                  <th className="px-3 py-2.5 text-left font-medium">Shifokor</th>
                  <th className="px-3 py-2.5 text-right font-medium">Summa</th>
                  <th className="px-3 py-2.5 text-left font-medium">Holat</th>
                  <th className="px-3 py-2.5 text-right font-medium">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(feed as FeedEntry[]).map((r) => {
                  const SrcIcon = SOURCE_META[r.source].icon;
                  return (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2.5 align-top">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'inline-flex h-6 w-6 items-center justify-center rounded-full border',
                              SOURCE_META[r.source].tone,
                            )}
                            title={SOURCE_META[r.source].label}
                          >
                            <SrcIcon className="h-3 w-3" />
                          </span>
                          <div className="min-w-0">
                            <div className="font-mono text-[11px] text-muted-foreground">
                              {fmtDateTime(r.occurred_at)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {SOURCE_META[r.source].label}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-medium">{r.patient_name ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-mono text-xs">{r.patient_phone ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="max-w-[260px] truncate">{r.diagnosis ?? r.description ?? '—'}</div>
                        {r.note && (
                          <div className="mt-1 line-clamp-2 max-w-[260px] rounded bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
                            <FileText className="mr-1 inline h-3 w-3" />
                            {r.note}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="text-xs">{r.doctor_name ?? '—'}</div>
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
                        {r.payment_method && (
                          <div className="text-[10px] text-muted-foreground">{r.payment_method}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <span
                          className={cn(
                            'inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium',
                            STATUS_META[r.status].tone,
                          )}
                        >
                          {STATUS_META[r.status].label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right align-top">
                        <div className="inline-flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title="Izoh qo'shish"
                            onClick={() => setNoteModal(r)}
                          >
                            <MessageSquarePlus className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-blue-600 hover:bg-blue-50"
                            title="Tahrirlash (PIN)"
                            onClick={() => requirePin(() => setNoteModal(r))}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50"
                            title="O'chirish (PIN)"
                            onClick={() => setConfirmVoid(r)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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

      {/* Bottom recap with details */}
      <Card>
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

      {noteModal && (
        <NoteModal entry={noteModal} onClose={() => setNoteModal(null)} />
      )}

      {confirmVoid && (
        <VoidModal
          entry={confirmVoid}
          onClose={() => setConfirmVoid(null)}
          onDone={() => {
            setConfirmVoid(null);
            qc.invalidateQueries({ queryKey: ['journal-feed'] });
          }}
        />
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
            Izohlar — {entry.patient_name ?? SOURCE_META[entry.source].label}
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
                {SOURCE_META[entry.source].label} • {entry.patient_name ?? '—'} •{' '}
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
