import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Beaker,
  ChevronRight,
  FileText,
  FlaskConical,
  Loader2,
  Plus,
  Send,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
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
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { PatientPicker } from '@/components/reception/patient-picker';

type LabOrder = {
  id: string;
  status:
    | 'pending'
    | 'collected'
    | 'running'
    | 'completed'
    | 'reported'
    | 'delivered'
    | 'canceled';
  urgency: 'routine' | 'urgent' | 'stat';
  total_uzs: number;
  created_at: string;
  patient?: { id: string; full_name: string; phone?: string | null } | null;
  items?: Array<{
    id: string;
    name_snapshot: string;
    status: string;
    results?: Array<{ id: string; value: string; is_final: boolean; is_abnormal: boolean }>;
  }>;
};

type LabKanban = { date: string; by_status: Record<string, LabOrder[]> };

const COLUMNS: Array<{ id: LabOrder['status']; label: string; color: string }> = [
  { id: 'pending', label: 'Kutilmoqda', color: 'bg-slate-500' },
  { id: 'collected', label: 'Qabul qilindi', color: 'bg-sky-500' },
  { id: 'running', label: 'Jarayonda', color: 'bg-amber-500' },
  { id: 'completed', label: 'Tugallangan', color: 'bg-violet-500' },
  { id: 'reported', label: 'Yuborildi', color: 'bg-emerald-500' },
  { id: 'delivered', label: 'Topshirildi', color: 'bg-zinc-500' },
];

const URGENCY: Record<LabOrder['urgency'], string> = {
  routine: 'Oddiy',
  urgent: 'Shoshilinch',
  stat: 'CITO',
};

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

export function LabPage() {
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [newOpen, setNewOpen] = useState(false);
  const [drawer, setDrawer] = useState<LabOrder | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['lab-kanban', date],
    queryFn: () => api.lab.kanban(date),
    refetchInterval: 8_000,
  });
  const kanban = data as LabKanban | undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Laboratoriya</h1>
          <p className="text-sm text-muted-foreground">
            Tahlillar jarayoni — qabul, tayyorlash, natija yuborish
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-40"
          />
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Yangi tahlil
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-6">
          {COLUMNS.map((col) => {
            const rows = (kanban?.by_status[col.id] ?? []) as LabOrder[];
            return (
              <Card key={col.id} className="flex flex-col">
                <CardHeader className="py-3">
                  <CardTitle className="flex items-center justify-between text-xs font-medium uppercase tracking-wide">
                    <span className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${col.color}`} />
                      {col.label}
                    </span>
                    <span className="text-muted-foreground">{rows.length}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex min-h-[200px] flex-col gap-2 p-2">
                  {rows.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                      —
                    </div>
                  ) : (
                    rows.map((row) => (
                      <button
                        key={row.id}
                        onClick={() => setDrawer(row)}
                        className="rounded-md border bg-card p-2 text-left shadow-elevation-1 transition hover:shadow-elevation-2"
                      >
                        <div className="flex items-center gap-1.5 text-xs font-medium">
                          <UserRound className="h-3 w-3" />
                          <span className="truncate">{row.patient?.full_name ?? 'Mijoz'}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {row.items?.length ?? 0} ta tahlil · {fmt(row.total_uzs)} UZS
                        </div>
                        <div className="mt-1.5 flex items-center justify-between">
                          <Badge
                            variant={
                              row.urgency === 'stat'
                                ? 'destructive'
                                : row.urgency === 'urgent'
                                ? 'warning'
                                : 'secondary'
                            }
                          >
                            {URGENCY[row.urgency]}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(row.created_at).toLocaleTimeString('uz-UZ', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <NewOrderDialog open={newOpen} onOpenChange={setNewOpen} />
      {drawer && <OrderDrawer orderId={drawer.id} onClose={() => setDrawer(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New order dialog
// ---------------------------------------------------------------------------
function NewOrderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientLabel, setPatientLabel] = useState('');
  const [urgency, setUrgency] = useState<'routine' | 'urgent' | 'stat'>('routine');
  const [notes, setNotes] = useState('');
  const [testSearch, setTestSearch] = useState('');
  const [selectedTests, setSelectedTests] = useState<Array<{ id: string; name: string; price: number }>>([]);
  const [notifySms, setNotifySms] = useState(true);

  const { data: labTests } = useQuery({
    queryKey: ['catalog', 'lab-tests'],
    queryFn: () =>
      api.get<
        Array<{
          id: string;
          name_i18n: Record<string, string>;
          price_uzs: number;
        }>
      >('/api/v1/catalog/lab-tests'),
    enabled: open,
  });

  const filtered = useMemo(() => {
    const list = labTests ?? [];
    if (!testSearch.trim()) return list.slice(0, 30);
    const q = testSearch.trim().toLowerCase();
    return list
      .filter((t) =>
        Object.values(t.name_i18n ?? {})
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 30);
  }, [labTests, testSearch]);

  const total = selectedTests.reduce((s, t) => s + t.price, 0);

  const mut = useMutation({
    mutationFn: () => {
      if (!patientId) throw new Error('Mijoz tanlang');
      if (selectedTests.length === 0) throw new Error('Kamida bitta tahlil tanlang');
      return api.lab.create({
        patient_id: patientId,
        test_ids: selectedTests.map((t) => t.id),
        urgency,
        clinical_notes: notes || undefined,
        notify_sms: notifySms,
      });
    },
    onSuccess: () => {
      toast.success(
        `Tahlil buyurtmasi yaratildi${notifySms ? ' • SMS yuboriladi' : ''}`,
      );
      qc.invalidateQueries({ queryKey: ['lab-kanban'] });
      setPatientId(null);
      setPatientLabel('');
      setSelectedTests([]);
      setNotes('');
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast.error(e.message ?? 'Xatolik: buyurtma yaratilmadi');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Yangi tahlil buyurtma</DialogTitle>
          <DialogDescription>Mijoz, tahlil va favqulodlik darajasini tanlang.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Mijoz</label>
              <PatientPicker
                value={patientId}
                label={patientLabel}
                onChange={(id, label) => {
                  setPatientId(id);
                  setPatientLabel(label);
                }}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">Favqulodlik</label>
              <div className="flex gap-1.5">
                {(['routine', 'urgent', 'stat'] as const).map((u) => (
                  <Button
                    key={u}
                    type="button"
                    size="sm"
                    variant={urgency === u ? 'default' : 'outline'}
                    onClick={() => setUrgency(u)}
                  >
                    {URGENCY[u]}
                  </Button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={notifySms}
                onChange={(e) => setNotifySms(e.target.checked)}
              />
              Natija tayyor bo‘lganda mijozga SMS yuborilsin
            </label>

            <div>
              <label className="mb-1 block text-xs font-medium">Klinik izoh</label>
              <Input
                placeholder="Izoh (shart emas)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium">Tahlillar</label>
            <Input
              placeholder="Tahlil qidirish…"
              value={testSearch}
              onChange={(e) => setTestSearch(e.target.value)}
            />
            <div className="max-h-48 overflow-y-auto divide-y rounded border">
              {filtered.map((t) => {
                const name = t.name_i18n['uz-Latn'] ?? t.name_i18n['uz'] ?? t.name_i18n['en'] ?? 'Test';
                const picked = selectedTests.some((x) => x.id === t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      setSelectedTests((prev) =>
                        picked
                          ? prev.filter((x) => x.id !== t.id)
                          : [...prev, { id: t.id, name, price: Number(t.price_uzs) }],
                      )
                    }
                    className={
                      'flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ' +
                      (picked ? 'bg-primary/10' : 'hover:bg-muted/40')
                    }
                  >
                    <span className="truncate">{name}</span>
                    <span className="text-xs text-muted-foreground">{fmt(Number(t.price_uzs))}</span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground">Topilmadi</div>
              )}
            </div>

            {selectedTests.length > 0 && (
              <div className="rounded border p-2">
                <div className="mb-1 text-xs text-muted-foreground">Tanlangan:</div>
                <div className="flex flex-wrap gap-1">
                  {selectedTests.map((t) => (
                    <Badge key={t.id} variant="secondary" className="flex items-center gap-1">
                      {t.name}
                      <X
                        className="h-3 w-3 cursor-pointer"
                        onClick={() =>
                          setSelectedTests((prev) => prev.filter((x) => x.id !== t.id))
                        }
                      />
                    </Badge>
                  ))}
                </div>
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">Jami</span>
                  <span className="font-semibold">{fmt(total)} UZS</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Bekor
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'Yuborilmoqda…' : 'Buyurtmani ochish'}
          </Button>
        </DialogFooter>
        {mut.isError && (
          <p className="text-xs text-destructive">{(mut.error as Error).message}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Order drawer with state transitions + result entry
// ---------------------------------------------------------------------------
function OrderDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ['lab-order', orderId],
    queryFn: () => api.lab.get(orderId),
  });
  const order = data as
    | (LabOrder & {
        clinical_notes?: string;
        items?: Array<{
          id: string;
          name_snapshot: string;
          status: string;
          test?: {
            name_i18n: Record<string, string>;
            unit?: string | null;
            reference_range_male?: string | null;
            reference_range_female?: string | null;
          } | null;
          results?: Array<{
            id: string;
            value: string;
            unit?: string;
            is_abnormal?: boolean;
            is_final?: boolean;
            interpretation?: string;
          }>;
        }>;
      })
    | undefined;

  const transition = useMutation({
    mutationFn: async (action: 'collect' | 'start' | 'complete' | 'report' | 'deliver' | 'cancel') => {
      if (action === 'cancel') await api.lab.cancel(orderId);
      else if (action === 'collect') await api.lab.collect(orderId);
      else if (action === 'start') await api.lab.start(orderId);
      else if (action === 'complete') await api.lab.complete(orderId);
      else if (action === 'report') await api.lab.report(orderId);
      else if (action === 'deliver') await api.lab.deliver(orderId);
      return action;
    },
    onSuccess: (action) => {
      const labels: Record<string, string> = {
        collect: 'Namuna qabul qilindi',
        start: 'Jarayon boshlandi',
        complete: 'Tugallandi',
        report: 'SMS yuborildi',
        deliver: 'Mijozga topshirildi',
        cancel: 'Bekor qilindi',
      };
      toast.success(labels[action] ?? 'Yangilandi');
      refetch();
      qc.invalidateQueries({ queryKey: ['lab-kanban'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const nextActions: Record<LabOrder['status'], Array<{ id: Parameters<typeof transition.mutate>[0]; label: string; primary?: boolean }>> = {
    pending: [{ id: 'collect', label: 'Namuna olindi', primary: true }, { id: 'cancel', label: 'Bekor' }],
    collected: [{ id: 'start', label: 'Jarayonga olish', primary: true }],
    running: [{ id: 'complete', label: 'Tugallash', primary: true }],
    completed: [{ id: 'report', label: 'Yuborish (SMS)', primary: true }],
    reported: [{ id: 'deliver', label: 'Topshirildi', primary: true }],
    delivered: [],
    canceled: [],
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            Laboratoriya buyurtma
          </DialogTitle>
          <DialogDescription>
            {order?.patient?.full_name} · {order?.items?.length ?? 0} ta tahlil
          </DialogDescription>
        </DialogHeader>

        {!order ? (
          <div className="p-6 text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{order.status}</Badge>
              <Badge
                variant={
                  order.urgency === 'stat'
                    ? 'destructive'
                    : order.urgency === 'urgent'
                    ? 'warning'
                    : 'outline'
                }
              >
                {URGENCY[order.urgency]}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Jami: {fmt(order.total_uzs)} UZS
              </span>
            </div>

            <div className="divide-y rounded-md border">
              {(order.items ?? []).map((it) => (
                <OrderItemRow
                  key={it.id}
                  item={it}
                  orderStatus={order.status}
                  onRecorded={() => {
                    refetch();
                    qc.invalidateQueries({ queryKey: ['lab-kanban'] });
                  }}
                />
              ))}
            </div>

            {(order.clinical_notes ?? '') && (
              <div className="rounded-md bg-muted/40 p-3 text-sm">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" /> Klinik izoh
                </div>
                <p className="mt-1">{order.clinical_notes}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {(nextActions[order.status] ?? []).map((a) => (
                <Button
                  key={a.id}
                  size="sm"
                  variant={a.primary ? 'default' : 'outline'}
                  onClick={() => transition.mutate(a.id)}
                  disabled={transition.isPending}
                >
                  {a.primary && a.id === 'report' && <Send className="mr-1 h-3 w-3" />}
                  {a.label}
                  {a.primary && <ChevronRight className="ml-1 h-3 w-3" />}
                </Button>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Yopish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderItemRow({
  item,
  orderStatus,
  onRecorded,
}: {
  item: {
    id: string;
    name_snapshot: string;
    status: string;
    test?: {
      unit?: string | null;
      reference_range_male?: string | null;
      reference_range_female?: string | null;
    } | null;
    results?: Array<{ id: string; value: string; is_final?: boolean; is_abnormal?: boolean }>;
  };
  orderStatus: string;
  onRecorded: () => void;
}) {
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState(item.test?.unit ?? '');
  const [refRange, setRefRange] = useState(item.test?.reference_range_male ?? '');
  const [isAbnormal, setIsAbnormal] = useState(false);
  const [attachment, setAttachment] = useState('');
  const [expanded, setExpanded] = useState(false);

  const canRecord = ['running', 'completed'].includes(orderStatus) && !item.results?.some((r) => r.is_final);

  const mut = useMutation({
    mutationFn: () =>
      api.lab.recordResult({
        order_item_id: item.id,
        value,
        unit: unit || undefined,
        reference_range: refRange || undefined,
        is_abnormal: isAbnormal,
        is_final: true,
        attachment_url: attachment || undefined,
      }),
    onSuccess: () => {
      toast.success('Natija saqlandi');
      onRecorded();
      setExpanded(false);
      setValue('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const latest = item.results?.[0];

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium">
            <Beaker className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate">{item.name_snapshot}</span>
          </div>
          {latest ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-xs">
              <span className="font-mono">{latest.value}</span>
              {latest.is_abnormal && <Badge variant="destructive">Norma tashqari</Badge>}
            </div>
          ) : (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {item.test?.reference_range_male ? `Norm: ${item.test.reference_range_male}` : '—'}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={item.status === 'completed' ? 'success' : 'secondary'}>
            {item.status}
          </Badge>
          {canRecord && (
            <Button size="sm" variant="outline" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Yopish' : 'Natija'}
            </Button>
          )}
        </div>
      </div>

      {expanded && canRecord && (
        <div className="mt-2 grid gap-2 rounded-md border bg-muted/30 p-2 md:grid-cols-[1fr_1fr_1fr_auto]">
          <Input
            placeholder="Natija qiymati"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Input placeholder="O'lchov birligi" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <Input
            placeholder="Normal oraliq"
            value={refRange}
            onChange={(e) => setRefRange(e.target.value)}
          />
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={isAbnormal}
              onChange={(e) => setIsAbnormal(e.target.checked)}
            />
            Abnormal
          </label>
          <Input
            className="md:col-span-4"
            placeholder="PDF/rasm URL (ixtiyoriy)"
            value={attachment}
            onChange={(e) => setAttachment(e.target.value)}
          />
          <div className="md:col-span-4 flex justify-end">
            <Button size="sm" onClick={() => mut.mutate()} disabled={!value || mut.isPending}>
              {mut.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
