import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  KeyRound,
  Lock,
  LogOut,
  ShieldCheck,
  User2,
  Loader2,
  FileBarChart,
  Printer,
  History,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  StatCard,
  EmptyState,
  cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import {
  printShiftReport as printShiftReportNew,
  type ShiftReportData,
} from '@/lib/shift-report';
import { DenominationCounter } from '@/components/reception/denomination-counter';

const fmtUzs = (n: number) => new Intl.NumberFormat('uz-UZ').format(Number(n ?? 0)) + ' so‘m';
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('uz-UZ', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

interface Operator {
  id: string;
  full_name: string;
  role: string;
  color?: string | null;
}

interface Schedule {
  id: string;
  name_i18n: Record<string, string>;
  start_time: string;
  end_time: string;
  operators?: Array<{ operator: Operator }>;
}

function pickName(i18n: Record<string, string> | undefined, locale = 'uz-Latn'): string {
  if (!i18n) return '';
  return i18n[locale] ?? i18n['uz-Latn'] ?? i18n.ru ?? Object.values(i18n)[0] ?? '';
}

function formatTime(t: string): string {
  return t.slice(0, 5);
}

function currency(n: number): string {
  return new Intl.NumberFormat('uz-UZ').format(n) + ' so\u2018m';
}

function elapsed(fromIso: string): string {
  const ms = Date.now() - new Date(fromIso).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}s ${m}d`;
}

export function ShiftBar() {
  const qc = useQueryClient();
  const { data: active, isLoading } = useQuery({
    queryKey: ['shifts', 'active'],
    queryFn: () => api.shifts.active(),
    refetchInterval: 30_000,
  });

  // Faol smena kassasi (jonli tushum) — backend kpis().today endi faqat
  // faol smena tranzaksiyalarini sanaydi, smena yopiq bo'lsa 0 qaytaradi.
  const { data: kpis } = useQuery({
    queryKey: ['cashier', 'kpis'],
    queryFn: () => api.cashier.kpis(),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const [openDialog, setOpenDialog] = useState<'open' | 'close' | null>(null);
  const [reportShiftId, setReportShiftId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const isOpen = Boolean(active && (active as { id?: string }).id);

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-card/80 px-4 py-2.5 shadow-elevation-1 backdrop-blur',
        isOpen ? 'border-success/40 bg-success/5' : 'border-warning/40 bg-warning/5',
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-background shadow-inset-border">
        {isOpen ? <ShieldCheck className="h-4 w-4 text-success" /> : <Lock className="h-4 w-4 text-warning" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">
            {isLoading ? 'Yuklanmoqda…' : isOpen ? 'Smena ochiq' : 'Smena yopiq'}
          </span>
          {isOpen && (active as { operator?: Operator })?.operator?.full_name && (
            <Badge variant="secondary" className="gap-1">
              <User2 className="h-3 w-3" />
              {(active as { operator?: Operator }).operator!.full_name}
            </Badge>
          )}
        </div>
        {isOpen && (
          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {elapsed((active as { opened_at: string }).opened_at)}
            </span>
            <span>
              Kassa: {currency((kpis as { today?: number } | undefined)?.today ?? 0)}
            </span>
            {(active as unknown as { opening_cash_uzs?: number }).opening_cash_uzs ? (
              <span className="opacity-70">
                (boshl.: {currency((active as unknown as { opening_cash_uzs: number }).opening_cash_uzs)})
              </span>
            ) : null}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)} className="gap-1.5">
          <History className="h-3.5 w-3.5" /> Smenalar tarixi
        </Button>
        {isOpen ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReportShiftId((active as { id: string }).id)}
              className="gap-1.5"
              title="Smenani yopmasdan joriy holat hisoboti"
            >
              <FileBarChart className="h-3.5 w-3.5" /> X-hisobot
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setOpenDialog('close')} className="gap-1.5">
              <LogOut className="h-3.5 w-3.5" /> Smenani yopish
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => setOpenDialog('open')} className="gap-1.5">
            <KeyRound className="h-3.5 w-3.5" /> Smenani ochish
          </Button>
        )}
      </div>

      {openDialog === 'open' && (
        <OpenShiftDialog
          onClose={() => setOpenDialog(null)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['shifts'] });
            qc.invalidateQueries({ queryKey: ['cashier'] });
            qc.invalidateQueries({ queryKey: ['journal-feed'] });
            setOpenDialog(null);
          }}
        />
      )}
      {openDialog === 'close' && isOpen && (
        <CloseShiftDialog
          shiftId={(active as { id: string }).id}
          openingCash={(active as unknown as { opening_cash_uzs?: number }).opening_cash_uzs ?? 0}
          onClose={() => setOpenDialog(null)}
          onSuccess={(closedId) => {
            qc.invalidateQueries({ queryKey: ['shifts'] });
            qc.invalidateQueries({ queryKey: ['cashier'] });
            qc.invalidateQueries({ queryKey: ['journal-feed'] });
            setOpenDialog(null);
            // Yopilgandan keyin batafsil hisobotni ko'rsatamiz
            setReportShiftId(closedId);
          }}
        />
      )}
      {reportShiftId && (
        <ShiftReportDialog shiftId={reportShiftId} onClose={() => setReportShiftId(null)} />
      )}
      {historyOpen && (
        <ShiftHistoryDialog
          onClose={() => setHistoryOpen(false)}
          onOpenReport={(id) => {
            setHistoryOpen(false);
            setReportShiftId(id);
          }}
        />
      )}
    </div>
  );
}

function OpenShiftDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { data: schedules } = useQuery({
    queryKey: ['shift-schedules', 'for-date'],
    queryFn: () => api.shiftSchedules.forDate(),
  });
  const { data: operators } = useQuery({
    queryKey: ['shift-operators'],
    queryFn: () => api.shiftOperators.list(),
  });
  const [scheduleId, setScheduleId] = useState<string>('');
  const [operatorId, setOperatorId] = useState<string>('');
  const [pin, setPin] = useState('');
  const [openingCash, setOpeningCash] = useState<string>('0');

  const filteredOperators = useMemo(() => {
    if (!schedules || !scheduleId || !operators) return (operators as Operator[] | undefined) ?? [];
    const sched = (schedules as Schedule[]).find((s) => s.id === scheduleId);
    const assignedIds = new Set((sched?.operators ?? []).map((o) => o.operator.id));
    return (operators as Operator[]).filter((o) => assignedIds.has(o.id));
  }, [schedules, scheduleId, operators]);

  useEffect(() => {
    if (!scheduleId && schedules && (schedules as Schedule[]).length > 0) {
      const first = (schedules as Schedule[])[0];
      if (first) setScheduleId(first.id);
    }
  }, [schedules, scheduleId]);

  useEffect(() => {
    if (!operatorId && filteredOperators.length > 0) {
      const first = filteredOperators[0];
      if (first) setOperatorId(first.id);
    }
  }, [filteredOperators, operatorId]);

  const openMut = useMutation({
    mutationFn: () =>
      api.shifts.open({
        operator_id: operatorId,
        schedule_id: scheduleId || undefined,
        pin,
        opening_cash_uzs: Number.parseInt(openingCash || '0', 10) || 0,
        opened_via: 'pos',
      }),
    onSuccess: () => {
      toast.success('Smena ochildi');
      onSuccess();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Smenani ochish</DialogTitle>
          <DialogDescription>Smenani tanlang, navbatchi operatorni tanlang va PIN-kodingizni kiriting.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Smena jadvali</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {((schedules as Schedule[] | undefined) ?? []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setScheduleId(s.id);
                    setOperatorId('');
                  }}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left text-sm transition',
                    scheduleId === s.id ? 'border-primary bg-primary/10' : 'hover:bg-accent',
                  )}
                >
                  <div className="font-medium">{pickName(s.name_i18n)}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatTime(s.start_time)} – {formatTime(s.end_time)}
                  </div>
                </button>
              ))}
              {!schedules || (schedules as Schedule[]).length === 0 ? (
                <div className="col-span-2 rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                  Bugun uchun jadval konfiguratsiya qilinmagan. Sozlamalar &rarr; Smena jadvallari.
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Navbatchi</label>
            <div className="grid grid-cols-2 gap-2">
              {filteredOperators.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setOperatorId(o.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition',
                    operatorId === o.id ? 'border-primary bg-primary/10' : 'hover:bg-accent',
                  )}
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                    style={{ backgroundColor: o.color ?? 'hsl(var(--primary) / 0.15)', color: o.color ? '#fff' : 'hsl(var(--primary))' }}
                  >
                    {o.full_name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{o.full_name}</div>
                    <div className="text-[11px] text-muted-foreground">{o.role}</div>
                  </div>
                </button>
              ))}
              {filteredOperators.length === 0 && (
                <div className="col-span-2 rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                  Jadvalga navbatchilar biriktirilmagan.
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">PIN kod</label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={8}
                placeholder="\u2022\u2022\u2022\u2022"
                className="text-center font-mono tracking-[0.3em]"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Ochilish kassasi (so&lsquo;m)</label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button
            onClick={() => openMut.mutate()}
            disabled={!operatorId || pin.length < 4 || openMut.isPending}
            className="gap-1.5"
          >
            {openMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Smenani ochish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseShiftDialog({
  shiftId,
  openingCash,
  onClose,
  onSuccess,
}: {
  shiftId: string;
  openingCash: number;
  onClose: () => void;
  onSuccess: (closedShiftId: string) => void;
}) {
  // Kutilgan kassa qoldigi backend'dan keladi — kassir orientir oladi.
  // Avval bu yo'q edi va 4 ta smena 0 deb yopilgan (17 mln so'm yo'qolgan).
  const { data: expected, isLoading: expectedLoading } = useQuery({
    queryKey: ['shift-expected-cash', shiftId],
    queryFn: () => api.shifts.expectedCash(shiftId),
  });

  const [actualCash, setActualCash] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState<'simple' | 'denominations'>('simple');
  const [denomTotal, setDenomTotal] = useState(0);

  // Expected yuklangan zahoti default'ga qo'yamiz (kassir kerakli pulni ko'rib turibdi)
  useEffect(() => {
    if (expected && actualCash === '') {
      setActualCash(String(expected.expected_cash_uzs));
    }
  }, [expected, actualCash]);

  const expectedAmount = expected?.expected_cash_uzs ?? openingCash;
  // actualAmount qatiy >= 0 bo'lishi shart (backend nonnegative talab qiladi).
  // Manfiy son yoki NaN bo'lsa 0 ga aylanadi.
  const rawActual = mode === 'denominations'
    ? denomTotal
    : Number.parseInt(actualCash || '0', 10);
  const actualAmount = Math.max(0, Number.isFinite(rawActual) ? rawActual : 0);
  const diff = actualAmount - expectedAmount;
  const diffLabel = diff === 0 ? 'mos' : diff > 0 ? `+${diff.toLocaleString('uz-UZ')} ortiq` : `${diff.toLocaleString('uz-UZ')} kam`;
  const diffColor =
    diff === 0 ? 'text-emerald-700' : diff > 0 ? 'text-amber-700' : 'text-rose-700';

  const closeMut = useMutation({
    mutationFn: () =>
      api.shifts.close(shiftId, {
        actual_cash_uzs: actualAmount,
        closing_notes: notes || undefined,
      }),
    onSuccess: () => {
      toast.success('Smena yopildi');
      onSuccess(shiftId);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Smenani yopish</DialogTitle>
          <DialogDescription>
            Kutilgan summa hisobotdan, sizdagi naqd haqiqiy kassada bor pul.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Kutilgan summa — backend'dan keladi */}
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Kutilgan kassa qoldigi
            </div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums">
              {expectedLoading ? '...' : `${expectedAmount.toLocaleString('uz-UZ')} so'm`}
            </div>
            {expected && (
              <div className="mt-1 text-[10px] text-muted-foreground">
                Boshlang'ich {expected.opening_cash_uzs.toLocaleString('uz-UZ')} + Naqd kirim{' '}
                {expected.cash_in_uzs.toLocaleString('uz-UZ')}
              </div>
            )}
          </div>

          {/* Mode toggle */}
          <div className="flex gap-1 rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setMode('simple')}
              className={cn(
                'flex-1 rounded px-3 py-1 text-xs font-medium transition',
                mode === 'simple' ? 'bg-accent' : 'hover:bg-accent/50',
              )}
            >
              Oddiy kiritish
            </button>
            <button
              type="button"
              onClick={() => setMode('denominations')}
              className={cn(
                'flex-1 rounded px-3 py-1 text-xs font-medium transition',
                mode === 'denominations' ? 'bg-accent' : 'hover:bg-accent/50',
              )}
            >
              Kupura bo'yicha sanash
            </button>
          </div>

          {mode === 'simple' ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Sizdagi naqd pul (so'm)
              </label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={actualCash}
                onChange={(e) => setActualCash(e.target.value)}
                className="text-lg font-mono"
              />
            </div>
          ) : (
            <DenominationCounter onChange={setDenomTotal} />
          )}

          {/* Farq */}
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div className="text-xs text-muted-foreground">Farq</div>
            <div className={cn('font-mono text-sm font-semibold', diffColor)}>{diffLabel}</div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Izoh (ixtiyoriy)</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={diff < 0 ? 'Yetishmagan pul sababi…' : 'Masalan: kichik chegirma'}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button
            variant={diff === 0 ? 'default' : 'destructive'}
            onClick={() => closeMut.mutate()}
            disabled={closeMut.isPending || expectedLoading}
            className="gap-1.5"
          >
            {closeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            Yopish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Smena hisoboti — amallar, xodimlar, maosh, sof foyda. Chop etish mumkin.
// =============================================================================
const ROLE_LABEL: Record<string, string> = {
  doctor: 'Shifokor',
  nurse: 'Hamshira',
  reception: 'Qabulxona',
  cashier: 'Kassir',
  lab: 'Laborant',
};

type ShiftReport = Awaited<ReturnType<typeof api.shifts.report>>;

// Hisobotni alohida oynada chop etadi — Radix Dialog portal/transform bilan
// to'qnashmaslik uchun toza HTML quriladi. Bo'sh sahifa muammosini hal qiladi.
function printShiftReport(data: ShiftReport) {
  const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;

  const txRows = data.transactions
    .map(
      (t) => `<tr${t.is_void ? ' style="opacity:.5;text-decoration:line-through"' : ''}>
        <td>${esc(fmtDateTime(t.occurred_at))}</td>
        <td>${esc(t.patient_name ?? '—')}</td>
        <td>${esc(t.service_name ?? '—')}</td>
        <td>${esc(t.doctor_name ?? '—')}</td>
        <td>${esc(t.cashier_name ?? '—')}</td>
        <td>${esc(t.payment_method)}</td>
        <td style="text-align:right">${t.kind === 'refund' ? '−' : ''}${esc(fmtUzs(t.amount_uzs))}</td>
      </tr>`,
    )
    .join('');

  const expRows = data.expenses
    .map(
      (e) => `<tr>
        <td>${esc(e.category)}</td>
        <td>${esc(e.description ?? '—')}</td>
        <td>${esc(e.recorder_name ?? '—')}</td>
        <td style="text-align:right">−${esc(fmtUzs(e.amount_uzs))}</td>
      </tr>`,
    )
    .join('');

  // Navbatchi kassir — hisobotda Kassir rolida birinchi ko'rsatiladi.
  const operatorRow = data.operator_name
    ? `<li><b>${esc(data.operator_name)}</b> — Kassir (navbatchi)</li>`
    : '';
  const staffRows =
    operatorRow +
    data.staff
      .map(
        (s) =>
          `<li>${esc(s.name)} — ${esc(ROLE_LABEL[s.role] ?? s.role)} · ${s.appointments} qabul · ${s.queue} navbat</li>`,
      )
      .join('');

  const salaryRows = data.salary_payouts
    .map((p) => `<li>${esc(p.doctor_name)}: −${esc(fmtUzs(p.net_uzs))}</li>`)
    .join('');

  win.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>Smena hisoboti</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:24px}
      h1{font-size:18px;margin:0 0 4px}
      h2{font-size:13px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
      .meta{color:#555;margin-bottom:12px}
      .kpi{display:flex;gap:24px;margin:12px 0}
      .kpi div{font-size:13px}
      .kpi b{display:block;font-size:16px}
      table{width:100%;border-collapse:collapse;margin-top:4px}
      th,td{border:1px solid #ddd;padding:4px 8px;text-align:left}
      th{background:#f3f4f6}
      ul{margin:4px 0;padding-left:20px}
    </style></head><body>
    <h1>Smena hisoboti</h1>
    <div class="meta">${esc(data.operator_name ?? 'Operator')} · ${esc(fmtDateTime(data.opened_at))} — ${
      data.closed_at ? esc(fmtDateTime(data.closed_at)) : 'ochiq'
    }</div>
    <div class="kpi">
      <div>Umumiy tushum<b>${esc(fmtUzs(data.totals.revenue))}</b></div>
      <div>Umumiy rasxot<b>${esc(fmtUzs(data.totals.total_expense))}</b></div>
      <div>Sof foyda<b>${esc(fmtUzs(data.totals.net_profit))}</b></div>
    </div>
    <h2>To'lovlar va amallar (${data.transactions.length})</h2>
    ${
      data.transactions.length
        ? `<table><thead><tr><th>Vaqt</th><th>Bemor</th><th>Xizmat</th><th>Shifokor</th><th>Kassir</th><th>To'lov</th><th>Summa</th></tr></thead><tbody>${txRows}</tbody></table>`
        : '<p>To‘lov yo‘q</p>'
    }
    ${
      data.expenses.length
        ? `<h2>Rasxotlar (${data.expenses.length})</h2><table><thead><tr><th>Toifa</th><th>Izoh</th><th>Xodim</th><th>Summa</th></tr></thead><tbody>${expRows}</tbody></table>`
        : ''
    }
    <h2>Ishlagan xodimlar (${data.staff.length + (data.operator_name ? 1 : 0)})</h2>
    ${staffRows ? `<ul>${staffRows}</ul>` : '<p>Xodim aniqlanmadi</p>'}
    ${
      salaryRows
        ? `<h2>Berilgan maosh</h2><ul>${salaryRows}</ul>`
        : ''
    }
  </body></html>`);
  win.document.close();
  win.focus();
  // Kontent yuklangach chop etish oynasini ochamiz
  win.setTimeout(() => win.print(), 300);
}

// =============================================================================
// Smenalar tarixi — sanadan-sanagacha yopilgan/ochiq smenalar ro'yxati.
// Har bir qatordan smena hisobotini ochish mumkin.
// =============================================================================
const SHIFT_STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  open: { label: 'Ochiq', tone: 'bg-emerald-100 text-emerald-700' },
  closed: { label: 'Yopilgan', tone: 'bg-slate-100 text-slate-700' },
  reconciled: { label: 'Tasdiqlangan', tone: 'bg-sky-100 text-sky-700' },
};

const todayStr = () => new Date().toISOString().slice(0, 10);

function ShiftHistoryDialog({
  onClose,
  onOpenReport,
}: {
  onClose: () => void;
  onOpenReport: (shiftId: string) => void;
}) {
  // Default — joriy oy boshidan bugungacha.
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(todayStr());

  const { data: shifts, isLoading } = useQuery({
    queryKey: ['shifts', 'history', from, to],
    queryFn: () =>
      api.shifts.list({
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
      }),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Smenalar tarixi</DialogTitle>
          <DialogDescription>
            Sana oralig‘ini tanlang va smena hisobotini ko‘ring.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Sanadan</label>
            <Input
              type="date"
              className="h-9 w-[160px]"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Sanagacha</label>
            <Input
              type="date"
              className="h-9 w-[160px]"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
          </div>
        ) : !shifts || shifts.length === 0 ? (
          <EmptyState
            title="Smena topilmadi"
            description="Tanlangan sana oralig‘ida smena yo‘q"
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Ochilish</th>
                  <th className="px-3 py-2 text-left font-medium">Yopilish</th>
                  <th className="px-3 py-2 text-left font-medium">Operator</th>
                  <th className="px-3 py-2 text-left font-medium">Holat</th>
                  <th className="px-3 py-2 text-right font-medium">Naqd farqi</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {shifts.map((s) => {
                  const st = SHIFT_STATUS_LABEL[s.status] ?? {
                    label: s.status,
                    tone: 'bg-slate-100 text-slate-700',
                  };
                  const diff = s.cash_diff_uzs ?? 0;
                  return (
                    <tr key={s.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {fmtDateTime(s.opened_at)}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                        {s.closed_at ? fmtDateTime(s.closed_at) : '—'}
                      </td>
                      <td className="px-3 py-2">{s.operator?.full_name ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[11px] font-medium',
                            st.tone,
                          )}
                        >
                          {st.label}
                        </span>
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right font-mono',
                          diff < 0 ? 'text-rose-600' : diff > 0 ? 'text-amber-600' : 'text-muted-foreground',
                        )}
                      >
                        {s.closed_at ? `${diff > 0 ? '+' : ''}${fmtUzs(diff)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onOpenReport(s.id)}
                          className="gap-1.5"
                        >
                          <FileBarChart className="h-3.5 w-3.5" /> Hisobot
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose}>Yopish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShiftReportDialog({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['shift-report', shiftId],
    queryFn: () => api.shifts.report(shiftId),
  });

  // Klinika ma'lumoti (chop etish uchun)
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      api.get<{ clinic?: { name?: string; address?: string; phone?: string } }>(
        '/api/v1/auth/me',
      ),
    staleTime: 5 * 60_000,
  });
  const clinic = (me.data as { clinic?: { name?: string; address?: string; phone?: string } } | undefined)?.clinic;

  // Cash breakdown alohida endpoint
  const { data: breakdown } = useQuery({
    queryKey: ['shift-breakdown', shiftId],
    queryFn: () => api.cashier.shiftBreakdown(shiftId),
  });

  const handlePrint = (format: 'a4' | '80mm' | '58mm') => {
    if (!data) return;
    const reportData: ShiftReportData = {
      clinic_name: clinic?.name ?? 'Klinika',
      clinic_address: clinic?.address,
      clinic_phone: clinic?.phone,
      operator_name: data.operator_name,
      opened_at: data.opened_at,
      closed_at: data.closed_at,
      totals: data.totals,
      cash_breakdown: breakdown as Record<string, { in: number; out: number; net: number }> | undefined,
      transactions: data.transactions.map((t) => ({
        occurred_at: t.occurred_at,
        patient_name: t.patient_name,
        service_name: t.service_name,
        doctor_name: t.doctor_name,
        cashier_name: t.cashier_name,
        payment_method: t.payment_method,
        amount_uzs: t.amount_uzs,
        kind: t.kind,
        is_void: t.is_void,
      })),
      expenses: data.expenses,
      staff: data.staff,
      salary_payouts: data.salary_payouts,
    };
    printShiftReportNew(reportData, format);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {data && !data.closed_at
              ? 'X-hisobot (oraliq — smena ochiq)'
              : 'Z-hisobot (smena yopildi)'}
          </DialogTitle>
          <DialogDescription>
            {data
              ? `${data.operator_name ?? 'Operator'} · ${fmtDateTime(data.opened_at)} — ${
                  data.closed_at ? fmtDateTime(data.closed_at) : 'hozirgacha'
                }`
              : 'Yuklanmoqda…'}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Hisobot yuklanmoqda…
          </div>
        ) : (
          <div id="shift-report-print" className="space-y-5">
            {/* Yakuniy KPI */}
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Umumiy tushum" value={fmtUzs(data.totals.revenue)} tone="success" />
              <StatCard label="Umumiy rasxot" value={fmtUzs(data.totals.total_expense)} tone="warning" />
              <StatCard
                label="Sof foyda"
                value={fmtUzs(data.totals.net_profit)}
                tone={data.totals.net_profit >= 0 ? 'success' : 'danger'}
              />
            </div>

            {/* Amallar / to'lovlar */}
            <section>
              <h3 className="mb-1.5 text-sm font-semibold">
                To‘lovlar va amallar ({data.transactions.length})
              </h3>
              {data.transactions.length === 0 ? (
                <EmptyState title="To‘lov yo‘q" description="Smenada to‘lov amali bo‘lmagan" />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Vaqt</th>
                        <th className="px-3 py-2 text-left font-medium">Bemor</th>
                        <th className="px-3 py-2 text-left font-medium">Xizmat</th>
                        <th className="px-3 py-2 text-left font-medium">Shifokor</th>
                        <th className="px-3 py-2 text-left font-medium">Kassir</th>
                        <th className="px-3 py-2 text-left font-medium">To‘lov</th>
                        <th className="px-3 py-2 text-right font-medium">Summa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.transactions.map((t) => (
                        <tr
                          key={t.id}
                          className={cn('hover:bg-muted/30', t.is_void && 'opacity-50 line-through')}
                        >
                          <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                            {fmtDateTime(t.occurred_at)}
                          </td>
                          <td className="px-3 py-2">{t.patient_name ?? '—'}</td>
                          <td className="px-3 py-2">{t.service_name ?? '—'}</td>
                          <td className="px-3 py-2 text-xs">{t.doctor_name ?? '—'}</td>
                          <td className="px-3 py-2 text-xs">{t.cashier_name ?? '—'}</td>
                          <td className="px-3 py-2 text-xs">{t.payment_method}</td>
                          <td
                            className={cn(
                              'px-3 py-2 text-right font-mono font-semibold',
                              t.kind === 'refund' ? 'text-amber-600' : 'text-emerald-700',
                            )}
                          >
                            {t.kind === 'refund' ? '−' : ''}
                            {fmtUzs(t.amount_uzs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Dorixona savdolari */}
            {data.pharmacy_sales.length > 0 && (
              <section>
                <h3 className="mb-1.5 text-sm font-semibold">
                  Dorixona savdolari ({data.pharmacy_sales.length})
                </h3>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Vaqt</th>
                        <th className="px-3 py-2 text-left font-medium">Mijoz</th>
                        <th className="px-3 py-2 text-right font-medium">To‘langan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.pharmacy_sales.map((p) => (
                        <tr
                          key={p.id}
                          className={cn('hover:bg-muted/30', p.is_void && 'opacity-50 line-through')}
                        >
                          <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                            {fmtDateTime(p.occurred_at)}
                          </td>
                          <td className="px-3 py-2">{p.patient_name}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-700">
                            {fmtUzs(p.paid_uzs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Rasxotlar */}
            {data.expenses.length > 0 && (
              <section>
                <h3 className="mb-1.5 text-sm font-semibold">Rasxotlar ({data.expenses.length})</h3>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Toifa</th>
                        <th className="px-3 py-2 text-left font-medium">Izoh</th>
                        <th className="px-3 py-2 text-left font-medium">Xodim</th>
                        <th className="px-3 py-2 text-right font-medium">Summa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.expenses.map((e) => (
                        <tr key={e.id} className="hover:bg-muted/30">
                          <td className="px-3 py-2">{e.category}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {e.description ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-xs">{e.recorder_name ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-rose-600">
                            −{fmtUzs(e.amount_uzs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Ishlagan xodimlar — navbatchi kassir birinchi (Kassir rolida) */}
            <section>
              <h3 className="mb-1.5 text-sm font-semibold">
                Ishlagan xodimlar ({data.staff.length + (data.operator_name ? 1 : 0)})
              </h3>
              {data.staff.length === 0 && !data.operator_name ? (
                <EmptyState
                  title="Xodim aniqlanmadi"
                  description="Smena vaqtida qabul yoki navbat amali bo‘lmagan"
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.operator_name && (
                    <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                      <div className="font-medium">{data.operator_name}</div>
                      <div className="text-[11px] text-primary">Kassir (navbatchi)</div>
                    </div>
                  )}
                  {data.staff.map((s) => (
                    <div key={s.name} className="rounded-lg border bg-card px-3 py-2 text-sm">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {ROLE_LABEL[s.role] ?? s.role} · {s.appointments} qabul · {s.queue} navbat
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Maosh — to'lovlar */}
            {(data.salary_payouts.length > 0 || data.shift_commissions.length > 0) && (
              <section>
                <h3 className="mb-1.5 text-sm font-semibold">Maosh</h3>
                {data.salary_payouts.length > 0 && (
                  <div className="mb-2">
                    <div className="mb-1 text-xs text-muted-foreground">
                      Smena davomida berilgan maosh:
                    </div>
                    <div className="space-y-1">
                      {data.salary_payouts.map((p) => (
                        <div
                          key={p.id}
                          className="flex justify-between rounded border bg-card px-3 py-1.5 text-sm"
                        >
                          <span>{p.doctor_name}</span>
                          <span className="font-mono font-semibold text-rose-600">
                            −{fmtUzs(p.net_uzs)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {data.shift_commissions.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">
                      Smenada to‘plangan komissiya (hali to‘lanmagan):
                    </div>
                    <div className="space-y-1">
                      {data.shift_commissions.map((c) => (
                        <div
                          key={c.doctor_name}
                          className="flex justify-between rounded border bg-card px-3 py-1.5 text-sm"
                        >
                          <span>{c.doctor_name}</span>
                          <span className="font-mono font-semibold">{fmtUzs(c.amount_uzs)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        <DialogFooter className="flex-wrap gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              onClick={() => handlePrint('a4')}
              disabled={!data}
              className="gap-1.5"
              title="A4 hujjat — PDF yuklab olish"
            >
              <Printer className="h-4 w-4" /> A4 PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => handlePrint('80mm')}
              disabled={!data}
              className="gap-1.5"
              title="Termal chek printer 80mm"
            >
              <Printer className="h-4 w-4" /> 80mm
            </Button>
            <Button
              variant="outline"
              onClick={() => handlePrint('58mm')}
              disabled={!data}
              className="gap-1.5"
              title="Kichik chek printer 58mm"
            >
              <Printer className="h-4 w-4" /> 58mm
            </Button>
          </div>
          <Button onClick={onClose}>Yopish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
