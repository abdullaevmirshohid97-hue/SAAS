import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownCircle, ArrowUpCircle, Lock, LockOpen, Printer, Wallet } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  cn,
} from '@clary/ui-web';
import type { PharmacyShift, PharmacyShiftTotals } from '@clary/api-client';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { MOVE_LABEL, PAY_LABEL, printShiftReport } from '@/lib/pharmacy/print';
import { usePharmacy } from './context';
import { LineField, SummaryCard, errText, fmt } from './shared';

// =============================================================================
// Dorixona kassasi — smena (X/Z hisobot), kassa harakatlari, smenalar tarixi.
// Har kassa (1, 2, …) alohida smena yuritadi. Alohida "Dorixona" kirishida
// smena majburiy; klinika ichidagi dorixonada — sozlama bo'yicha (standart: yo'q).
// =============================================================================

const toInt = (v: string) => Math.max(0, Math.round(Number(v.replace(/\s+/g, '')) || 0));

/** Smena yopiq bo'lsa POS o'rniga chiqadi. */
export function OpenShiftCard({
  registerNo,
  onOpened,
}: {
  registerNo: number;
  onOpened: () => void;
}) {
  const qc = useQueryClient();
  const [cash, setCash] = useState('');
  const mut = useMutation({
    mutationFn: () =>
      api.pharmacy.shifts.open({ opening_cash_uzs: toInt(cash), register_no: registerNo }),
    onSuccess: () => {
      toast.success(`Kassa ${registerNo}: smena ochildi`);
      qc.invalidateQueries({ queryKey: ['pharmacy', 'shift-current'] });
      qc.invalidateQueries({ queryKey: ['pharmacy', 'shifts'] });
      onOpened();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lock className="h-5 w-5 text-amber-600" /> Kassa {registerNo} — smena yopiq
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Sotuvni boshlash uchun smenani oching. Kassadagi boshlang'ich naqd pulni kiriting
            (bo'lmasa 0).
          </p>
          <LineField label="Boshlang'ich naqd (so'm)">
            <Input
              inputMode="numeric"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              placeholder="0"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !mut.isPending) mut.mutate();
              }}
            />
          </LineField>
          <Button className="w-full" disabled={mut.isPending} onClick={() => mut.mutate()}>
            <LockOpen className="mr-1.5 h-4 w-4" /> Smenani ochish
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function ShiftsTab() {
  const ph = usePharmacy();
  const qc = useQueryClient();
  const [moveOpen, setMoveOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toLocaleDateString('en-CA');
  });
  const [to, setTo] = useState('');

  const currentQ = useQuery({
    queryKey: ['pharmacy', 'shift-current'],
    queryFn: () => api.pharmacy.shifts.current(),
    refetchInterval: 30_000,
  });
  const settingsQ = useQuery({
    queryKey: ['pharmacy', 'shift-settings'],
    queryFn: () => api.pharmacy.shifts.settings(),
    enabled: ph.mode === 'clinic',
  });
  const listQ = useQuery({
    queryKey: ['pharmacy', 'shifts', from, to],
    queryFn: () =>
      api.pharmacy.shifts.list({
        from: from ? new Date(from + 'T00:00:00').toISOString() : undefined,
        to: to ? new Date(to + 'T23:59:59').toISOString() : undefined,
      }),
  });

  const toggleKassa = useMutation({
    mutationFn: (on: boolean) => api.pharmacy.shifts.saveSettings({ kassa_enabled: on }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      toast.success(
        r.kassa_enabled ? 'Dorixona kassasi (smena) yoqildi' : "Dorixona kassasi o'chirildi",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cur = currentQ.data;
  const shift = cur?.shift ?? null;
  const totals = cur?.totals ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Kassa va smenalar</h2>
          <p className="text-muted-foreground text-sm">
            Kassa {cur?.register_no ?? '—'} · X-hisobot, kassa harakatlari, smenani yopish (Z)
          </p>
        </div>
        {ph.mode === 'clinic' && ph.isAdmin && settingsQ.data && (
          <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={settingsQ.data.kassa_enabled}
              disabled={toggleKassa.isPending}
              onChange={(e) => toggleKassa.mutate(e.target.checked)}
            />
            Dorixona kassasi alohida (smena majburiy)
          </label>
        )}
      </div>

      {ph.mode === 'clinic' && settingsQ.data && !settingsQ.data.kassa_enabled && !shift && (
        <div className="bg-muted/40 text-muted-foreground rounded-md px-3 py-2 text-sm">
          Klinika dorixonasida alohida kassa smenasi o'chirilgan — sotuvlar umumiy klinika kassasida
          hisoblanadi. Yoqsangiz, har sotuv dorixona smenasiga yoziladi va Z-hisobot olinadi.
        </div>
      )}

      {currentQ.isLoading ? (
        <div className="text-muted-foreground text-sm">Yuklanmoqda…</div>
      ) : shift && totals ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Badge className="bg-emerald-600">Ochiq</Badge>
              Kassa {shift.register_no} · {new Date(shift.opened_at).toLocaleString('uz-UZ')}
              {shift.opened_by_name && (
                <span className="text-muted-foreground text-sm font-normal">
                  · {shift.opened_by_name}
                </span>
              )}
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  printShiftReport(totals, { ...shift, closed_at: null }, ph.clinicName)
                }
              >
                <Printer className="mr-1 h-4 w-4" /> X-hisobot
              </Button>
              <Button size="sm" variant="outline" onClick={() => setMoveOpen(true)}>
                <Wallet className="mr-1 h-4 w-4" /> Kassa harakati
              </Button>
              <Button
                size="sm"
                className="bg-rose-600 text-white hover:bg-rose-700"
                onClick={() => setCloseOpen(true)}
              >
                <Lock className="mr-1 h-4 w-4" /> Smenani yopish (Z)
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <TotalsGrid totals={totals} />
          </CardContent>
        </Card>
      ) : cur && (cur.required || ph.mode === 'workspace') ? (
        <OpenShiftCard registerNo={cur.register_no} onOpened={() => void currentQ.refetch()} />
      ) : cur && ph.mode === 'clinic' && settingsQ.data?.kassa_enabled ? (
        <OpenShiftCard registerNo={cur.register_no} onOpened={() => void currentQ.refetch()} />
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Smenalar tarixi</CardTitle>
          <div className="flex items-end gap-2">
            <LineField label="Dan">
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8"
              />
            </LineField>
            <LineField label="Gacha">
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8"
              />
            </LineField>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {listQ.isLoading ? (
            <div className="text-muted-foreground p-4 text-sm">Yuklanmoqda…</div>
          ) : (listQ.data ?? []).length === 0 ? (
            <div className="p-6">
              <EmptyState title="Smena yo'q" description="Tanlangan davrda smena ochilmagan" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-muted-foreground text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left">Z №</th>
                    <th className="px-3 py-2 text-left">Kassa</th>
                    <th className="px-3 py-2 text-left">Ochildi</th>
                    <th className="px-3 py-2 text-left">Yopildi</th>
                    <th className="px-3 py-2 text-right">Savdo</th>
                    <th className="px-3 py-2 text-right">Kutilgan naqd</th>
                    <th className="px-3 py-2 text-right">Sanalgan</th>
                    <th className="px-3 py-2 text-right">Farq</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(listQ.data ?? []).map((s) => (
                    <tr
                      key={s.id}
                      className="hover:bg-muted/30 cursor-pointer"
                      onClick={() => setReportId(s.id)}
                    >
                      <td className="px-3 py-2 font-mono">{s.z_no ?? '—'}</td>
                      <td className="px-3 py-2">{s.register_no}</td>
                      <td className="px-3 py-2 text-xs">
                        {new Date(s.opened_at).toLocaleString('uz-UZ')}
                        {s.opened_by_name && (
                          <div className="text-muted-foreground">{s.opened_by_name}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {s.closed_at ? (
                          <>
                            {new Date(s.closed_at).toLocaleString('uz-UZ')}
                            {s.closed_by_name && (
                              <div className="text-muted-foreground">{s.closed_by_name}</div>
                            )}
                          </>
                        ) : (
                          <Badge className="bg-emerald-600">Ochiq</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{fmt(s.totals?.gross_uzs ?? null)}</td>
                      <td className="px-3 py-2 text-right">
                        {s.expected_cash_uzs != null ? fmt(s.expected_cash_uzs) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {s.actual_cash_uzs != null ? fmt(s.actual_cash_uzs) : '—'}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right font-medium',
                          (s.diff_uzs ?? 0) < 0
                            ? 'text-rose-600'
                            : (s.diff_uzs ?? 0) > 0
                              ? 'text-emerald-600'
                              : '',
                        )}
                      >
                        {s.diff_uzs != null ? fmt(s.diff_uzs) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {moveOpen && <MovementDialog onClose={() => setMoveOpen(false)} />}
      {closeOpen && shift && totals && (
        <CloseShiftDialog shift={shift} totals={totals} onClose={() => setCloseOpen(false)} />
      )}
      {reportId && <ShiftReportDialog id={reportId} onClose={() => setReportId(null)} />}
    </div>
  );
}

function TotalsGrid({ totals }: { totals: PharmacyShiftTotals }) {
  const methods = Object.entries(totals.by_method ?? {}).filter(([, v]) => v);
  const moves = Object.entries(totals.movements ?? {}).filter(([k, v]) => v && k !== 'refund');
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <SummaryCard label="Sotuvlar" value={`${totals.sales_count} ta`} />
        <SummaryCard label="Yalpi savdo" value={fmt(totals.gross_uzs)} tone="primary" />
        <SummaryCard
          label="Qaytarishlar"
          value={`${fmt(totals.refunds_uzs)} (${totals.returns_count})`}
        />
        <SummaryCard
          label="Kassada bo'lishi kerak (naqd)"
          value={fmt(totals.expected_cash_uzs)}
          tone="success"
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border p-3 text-sm">
          <div className="mb-1 text-xs font-medium">To'lov usullari</div>
          {methods.length === 0 ? (
            <div className="text-muted-foreground text-xs">—</div>
          ) : (
            methods.map(([m, v]) => (
              <div key={m} className="flex justify-between">
                <span>{PAY_LABEL[m] ?? m}</span>
                <span className="tabular-nums">{fmt(v)}</span>
              </div>
            ))
          )}
          {totals.debt_uzs > 0 && (
            <div className="flex justify-between text-amber-700">
              <span>Qarzga</span>
              <span className="tabular-nums">{fmt(totals.debt_uzs)}</span>
            </div>
          )}
          {totals.discount_uzs > 0 && (
            <div className="text-muted-foreground flex justify-between">
              <span>Chegirma</span>
              <span className="tabular-nums">{fmt(totals.discount_uzs)}</span>
            </div>
          )}
        </div>
        <div className="rounded-md border p-3 text-sm">
          <div className="mb-1 text-xs font-medium">Naqd hisobi</div>
          <div className="flex justify-between">
            <span>Boshlang'ich naqd</span>
            <span className="tabular-nums">{fmt(totals.opening_cash_uzs)}</span>
          </div>
          <div className="flex justify-between">
            <span>Naqd sotuv (qaytimsiz)</span>
            <span className="tabular-nums">{fmt(totals.cash_sales_uzs)}</span>
          </div>
          {moves.map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span>{MOVE_LABEL[k] ?? k}</span>
              <span className="tabular-nums">{fmt(v)}</span>
            </div>
          ))}
          {totals.refunds_uzs > 0 && (
            <div className="flex justify-between">
              <span>Naqd qaytarish</span>
              <span className="tabular-nums">{fmt(totals.movements?.refund ?? 0)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
            <span>Kutilgan naqd</span>
            <span className="tabular-nums">{fmt(totals.expected_cash_uzs)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const MOVE_KINDS: Array<{
  v: 'expense' | 'encashment' | 'cash_in' | 'cash_out';
  l: string;
  in: boolean;
}> = [
  { v: 'expense', l: 'Rasxod (xarajat)', in: false },
  { v: 'encashment', l: 'Inkassatsiya (seyfga/egasiga)', in: false },
  { v: 'cash_out', l: 'Kassadan chiqim', in: false },
  { v: 'cash_in', l: 'Kassaga kirim (mayda pul)', in: true },
];

function MovementDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<(typeof MOVE_KINDS)[number]['v']>('expense');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const mut = useMutation({
    mutationFn: () =>
      api.pharmacy.shifts.addMovement({
        kind,
        amount_uzs: toInt(amount),
        notes: notes || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      toast.success('Yozildi');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const needNote = kind === 'expense' || kind === 'cash_out';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Kassa harakati</DialogTitle>
          <DialogDescription>
            Naqd pul kassaga kirdi yoki chiqdi — smena hisobiga yoziladi.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {MOVE_KINDS.map((k) => (
            <button
              key={k.v}
              type="button"
              onClick={() => setKind(k.v)}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2 py-2 text-left text-xs',
                kind === k.v ? 'border-primary bg-primary/10' : 'hover:bg-muted',
              )}
            >
              {k.in ? (
                <ArrowDownCircle className="h-4 w-4 text-emerald-600" />
              ) : (
                <ArrowUpCircle className="h-4 w-4 text-rose-600" />
              )}
              {k.l}
            </button>
          ))}
        </div>
        <LineField label="Summa (so'm) *">
          <Input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </LineField>
        <LineField label={needNote ? 'Izoh (nima uchun) *' : 'Izoh'}>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </LineField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button
            disabled={toInt(amount) <= 0 || (needNote && !notes.trim()) || mut.isPending}
            onClick={() => mut.mutate()}
          >
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseShiftDialog({
  shift,
  totals,
  onClose,
}: {
  shift: PharmacyShift;
  totals: PharmacyShiftTotals;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const ph = usePharmacy();
  const [actual, setActual] = useState('');
  const [notes, setNotes] = useState('');
  const counted = actual.trim() === '' ? null : toInt(actual);
  const diff = counted == null ? null : counted - totals.expected_cash_uzs;
  const mut = useMutation({
    mutationFn: () =>
      api.pharmacy.shifts.close(shift.id, {
        actual_cash_uzs: counted ?? 0,
        notes: notes || undefined,
      }),
    onSuccess: (z) => {
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      toast.success(`Smena yopildi · Z № ${z.z_no ?? '—'}`);
      try {
        printShiftReport(
          z,
          {
            register_no: shift.register_no,
            opened_at: shift.opened_at,
            closed_at: z.closed_at ?? new Date().toISOString(),
            z_no: z.z_no ?? null,
            opened_by_name: shift.opened_by_name ?? null,
            closed_by_name: ph.operator?.full_name ?? null,
          },
          ph.clinicName,
        );
      } catch (e) {
        toast.error(errText(e));
      }
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Smenani yopish (Z-hisobot)</DialogTitle>
          <DialogDescription>Kassadagi naqd pulni sanab kiriting.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="bg-muted/40 flex justify-between rounded-md px-3 py-2 text-sm">
            <span>Kutilgan naqd</span>
            <b className="tabular-nums">{fmt(totals.expected_cash_uzs)} so'm</b>
          </div>
          <LineField label="Sanalgan naqd (so'm) *">
            <Input
              inputMode="numeric"
              className="h-11 text-xl font-semibold"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              autoFocus
            />
          </LineField>
          {diff != null && (
            <div
              className={cn(
                'flex justify-between rounded-md px-3 py-2 text-sm font-medium',
                diff === 0
                  ? 'bg-emerald-50 text-emerald-700'
                  : diff < 0
                    ? 'bg-rose-50 text-rose-700'
                    : 'bg-amber-50 text-amber-800',
              )}
            >
              <span>{diff === 0 ? 'Kassa to‘g‘ri' : diff < 0 ? 'Kamomad' : 'Ortiqcha'}</span>
              <span className="tabular-nums">{fmt(diff)} so'm</span>
            </div>
          )}
          <LineField label={diff ? 'Izoh (farq sababi)' : 'Izoh'}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </LineField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button
            className="bg-rose-600 text-white hover:bg-rose-700"
            disabled={counted == null || mut.isPending}
            onClick={() => mut.mutate()}
          >
            Yopish va Z chop etish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShiftReportDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const ph = usePharmacy();
  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy', 'shift-report', id],
    queryFn: () => api.pharmacy.shifts.report(id),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {data?.shift.z_no ? `Z-hisobot № ${data.shift.z_no}` : 'Smena hisoboti'} · Kassa{' '}
            {data?.shift.register_no ?? ''}
          </DialogTitle>
          <DialogDescription>
            {data ? new Date(data.shift.opened_at).toLocaleString('uz-UZ') : ''}
            {data?.shift.closed_at
              ? ` — ${new Date(data.shift.closed_at).toLocaleString('uz-UZ')}`
              : ' — ochiq'}
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="text-muted-foreground text-sm">Yuklanmoqda…</div>
        ) : (
          <div className="space-y-3">
            <TotalsGrid totals={data.totals} />
            {data.by_operator.length > 0 && (
              <div className="rounded-md border p-3 text-sm">
                <div className="mb-1 text-xs font-medium">Kassirlar bo'yicha</div>
                {data.by_operator.map((o) => (
                  <div key={o.name} className="flex justify-between">
                    <span>{o.name}</span>
                    <span className="tabular-nums">
                      {o.count} ta · {fmt(o.total_uzs)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-md border">
              <div className="border-b px-3 py-2 text-xs font-medium">Kassa harakatlari</div>
              {data.movements.length === 0 ? (
                <div className="text-muted-foreground p-3 text-xs">Harakat yo'q</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    {data.movements.map((m) => (
                      <tr key={m.id}>
                        <td className="px-3 py-1.5 text-xs">
                          {new Date(m.created_at).toLocaleTimeString('uz-UZ')}
                        </td>
                        <td className="px-3 py-1.5">{MOVE_LABEL[m.kind] ?? m.kind}</td>
                        <td className="px-3 py-1.5 text-xs">{PAY_LABEL[m.method] ?? m.method}</td>
                        <td
                          className={cn(
                            'px-3 py-1.5 text-right tabular-nums',
                            m.amount_uzs < 0 ? 'text-rose-600' : 'text-emerald-700',
                          )}
                        >
                          {fmt(m.amount_uzs)}
                        </td>
                        <td className="text-muted-foreground px-3 py-1.5 text-xs">
                          {[m.operator_name, m.notes].filter(Boolean).join(' · ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {data.shift.notes && (
              <div className="text-muted-foreground text-xs">Izoh: {data.shift.notes}</div>
            )}
          </div>
        )}
        <DialogFooter>
          {data && (
            <Button
              variant="outline"
              onClick={() => printShiftReport(data.totals, data.shift, ph.clinicName)}
            >
              <Printer className="mr-1 h-4 w-4" /> Chop etish
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
