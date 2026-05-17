import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Beaker,
  FlaskConical,
  Loader2,
  TestTube,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardContent, EmptyState, Input, cn } from '@clary/ui-web';

import { api } from '@/lib/api';

// =============================================================================
// Lab Workstation — laborant uchun split-panel natija kiritish oynasi.
// /lab kanban ish oqimini boshqaradi; bu sahifa esa natija kiritishga
// optimallashtirilgan: CHAP navbat · MARKAZ natija entry · O'NG alert+namuna.
// Barcha ma'lumot mavjud api.lab.* metodlaridan — yangi backend yo'q.
// =============================================================================

const URGENCY_LABEL: Record<string, string> = {
  routine: 'Oddiy',
  urgent: 'Shoshilinch',
  stat: 'CITO',
};

// CITO eng tepada — priority engine
const URGENCY_RANK: Record<string, number> = { stat: 0, urgent: 1, routine: 2 };

type WsOrder = {
  id: string;
  status: string;
  urgency: string;
  created_at: string;
  patient?: { full_name?: string } | null;
  items?: Array<{ id: string; status: string }>;
};

export function LabWorkstationPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Faol buyurtmalar — natija kiritish kerak bo'lganlar
  const { data: kanban, isLoading } = useQuery({
    queryKey: ['lab-kanban', today],
    queryFn: () => api.lab.kanban(today),
    refetchInterval: 8_000,
  });

  // running + collected — laborant ishlaydigan navbat, CITO tepada
  const queue = useMemo<WsOrder[]>(() => {
    const by = (kanban?.by_status ?? {}) as Record<string, WsOrder[]>;
    const rows = [...(by['collected'] ?? []), ...(by['running'] ?? [])];
    return rows.sort((a, b) => {
      const ru = (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9);
      if (ru !== 0) return ru;
      return a.created_at.localeCompare(b.created_at);
    });
  }, [kanban]);

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <FlaskConical className="h-6 w-6" /> Laboratoriya ish stoli
          </h1>
          <p className="text-sm text-muted-foreground">
            Natija kiritish — CITO buyurtmalar eng tepada
          </p>
        </div>
        <Badge variant="secondary">{queue.length} ta faol</Badge>
      </header>

      <div className="grid grid-cols-12 gap-3">
        {/* CHAP — navbat */}
        <div className="col-span-12 lg:col-span-3">
          <Card>
            <CardContent className="p-2">
              {isLoading ? (
                <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
                </div>
              ) : queue.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">
                  Faol buyurtma yo‘q
                </div>
              ) : (
                <div className="space-y-1.5">
                  {queue.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setSelectedId(o.id)}
                      className={cn(
                        'w-full rounded-md border p-2 text-left transition',
                        selectedId === o.id
                          ? 'border-primary bg-primary/5'
                          : 'hover:border-primary/40',
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="flex items-center gap-1 truncate text-sm font-medium">
                          <UserRound className="h-3 w-3 shrink-0" />
                          {o.patient?.full_name ?? 'Bemor'}
                        </span>
                        {o.urgency !== 'routine' && (
                          <Badge
                            variant={o.urgency === 'stat' ? 'destructive' : 'warning'}
                          >
                            {URGENCY_LABEL[o.urgency]}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {o.items?.length ?? 0} ta analiz · {o.status}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* MARKAZ + O'NG */}
        {selectedId ? (
          <WorkstationOrder
            key={selectedId}
            orderId={selectedId}
            onCleared={() => setSelectedId(null)}
          />
        ) : (
          <div className="col-span-12 lg:col-span-9">
            <EmptyState
              title="Buyurtma tanlanmagan"
              description="Chapdagi navbatdan buyurtma tanlang."
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── MARKAZ (natija entry) + O'NG (alert + namuna) ──────────────────────────
type ResultFlag = 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high';

const FLAG_META: Record<ResultFlag, { label: string; cls: string }> = {
  normal: { label: 'Normal', cls: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  low: { label: 'Past', cls: 'border-amber-400 bg-amber-50 text-amber-700' },
  high: { label: 'Yuqori', cls: 'border-amber-400 bg-amber-50 text-amber-700' },
  critical_low: { label: 'KRITIK PAST', cls: 'border-red-500 bg-red-50 text-red-700' },
  critical_high: { label: 'KRITIK YUQORI', cls: 'border-red-500 bg-red-50 text-red-700' },
};

function clientDetectFlag(raw: string, refRange: string): ResultFlag | null {
  const numeric = Number(raw);
  if (!raw.trim() || !Number.isFinite(numeric) || !refRange) return null;
  const m = refRange.match(/(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const low = Number(m[1]);
  const high = Number(m[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) return null;
  const span = high - low;
  if (numeric < low) return numeric < low - span * 0.5 ? 'critical_low' : 'low';
  if (numeric > high) return numeric > high + span * 0.5 ? 'critical_high' : 'high';
  return 'normal';
}

type OrderItem = {
  id: string;
  name_snapshot: string;
  status: string;
  test?: {
    unit?: string | null;
    reference_range_male?: string | null;
  } | null;
  results?: Array<{
    id: string;
    value: string;
    flag?: string | null;
    is_abnormal?: boolean;
  }>;
};

function WorkstationOrder({
  orderId,
  onCleared,
}: {
  orderId: string;
  onCleared: () => void;
}) {
  const qc = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ['lab-order', orderId],
    queryFn: () => api.lab.get(orderId),
  });
  const order = data as
    | {
        id: string;
        status: string;
        patient?: { full_name?: string } | null;
        items?: OrderItem[];
      }
    | undefined;

  const refresh = () => {
    refetch();
    qc.invalidateQueries({ queryKey: ['lab-kanban'] });
  };

  // O'NG panel — kritik natijalar (alert)
  const criticalResults = useMemo(() => {
    const out: Array<{ name: string; value: string; flag: ResultFlag }> = [];
    for (const it of order?.items ?? []) {
      for (const r of it.results ?? []) {
        if (r.flag === 'critical_low' || r.flag === 'critical_high') {
          out.push({ name: it.name_snapshot, value: r.value, flag: r.flag });
        }
      }
    }
    return out;
  }, [order]);

  if (!order) {
    return (
      <div className="col-span-12 lg:col-span-9 flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
      </div>
    );
  }

  return (
    <>
      {/* MARKAZ — natija kiritish */}
      <div className="col-span-12 lg:col-span-6">
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">
                {order.patient?.full_name ?? 'Bemor'}
              </div>
              <Badge variant="secondary">{order.status}</Badge>
            </div>
            <div className="divide-y rounded-md border">
              {(order.items ?? []).map((it) => (
                <WsItemRow key={it.id} item={it} onRecorded={refresh} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* O'NG — alert + namuna */}
      <div className="col-span-12 lg:col-span-3 space-y-3">
        {criticalResults.length > 0 && (
          <Card className="border-red-300">
            <CardContent className="p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-red-700">
                <AlertTriangle className="h-4 w-4" /> Kritik natijalar
              </div>
              <div className="space-y-1">
                {criticalResults.map((c, i) => (
                  <div
                    key={i}
                    className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700"
                  >
                    <span className="font-medium">{c.name}:</span>{' '}
                    <span className="font-mono">{c.value}</span> ·{' '}
                    {FLAG_META[c.flag].label}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        <WsSamplePanel orderId={orderId} />
        <Button variant="outline" size="sm" className="w-full" onClick={onCleared}>
          Yopish
        </Button>
      </div>
    </>
  );
}

// ── Natija qatori — smart entry ────────────────────────────────────────────
function WsItemRow({
  item,
  onRecorded,
}: {
  item: OrderItem;
  onRecorded: () => void;
}) {
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState(item.test?.unit ?? '');
  const [refRange, setRefRange] = useState(item.test?.reference_range_male ?? '');

  const done = item.results?.some((r) => r.flag != null || r.value);
  const liveFlag = clientDetectFlag(value, refRange);

  const mut = useMutation({
    mutationFn: () =>
      api.lab.recordResult({
        order_item_id: item.id,
        value,
        unit: unit || undefined,
        reference_range: refRange || undefined,
        is_abnormal: liveFlag ? liveFlag !== 'normal' : false,
        is_final: true,
      }),
    onSuccess: () => {
      toast.success(`${item.name_snapshot} — natija saqlandi`);
      setValue('');
      onRecorded();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const latest = item.results?.[0];

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Beaker className="h-3.5 w-3.5 text-muted-foreground" />
          {item.name_snapshot}
        </span>
        {done && latest ? (
          <span className="flex items-center gap-1.5 text-xs">
            <span className="font-mono">{latest.value}</span>
            {latest.flag && latest.flag in FLAG_META && (
              <span
                className={
                  'rounded border px-1.5 text-[10px] font-medium ' +
                  FLAG_META[latest.flag as ResultFlag].cls
                }
              >
                {FLAG_META[latest.flag as ResultFlag].label}
              </span>
            )}
          </span>
        ) : (
          <Badge variant="secondary">{item.status}</Badge>
        )}
      </div>

      {!done && (
        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-[1fr_auto_1fr_auto]">
          <Input
            className="h-8"
            placeholder="Qiymat"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            // Enter bosilganda saqlash — klaviatura optimallashtirilgan oqim
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value && !mut.isPending) mut.mutate();
            }}
          />
          <Input
            className="h-8 w-20"
            placeholder="Birlik"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
          <Input
            className="h-8"
            placeholder="Norm oraliq"
            value={refRange}
            onChange={(e) => setRefRange(e.target.value)}
          />
          {liveFlag ? (
            <span
              className={
                'flex h-8 items-center justify-center rounded-md border px-2 text-[11px] font-medium ' +
                FLAG_META[liveFlag].cls
              }
            >
              {FLAG_META[liveFlag].label}
            </span>
          ) : (
            <Button
              size="sm"
              className="h-8"
              onClick={() => mut.mutate()}
              disabled={!value || mut.isPending}
            >
              Saqlash
            </Button>
          )}
          {liveFlag && (
            <Button
              size="sm"
              className="h-8 sm:col-span-4"
              onClick={() => mut.mutate()}
              disabled={!value || mut.isPending}
            >
              {mut.isPending ? 'Saqlanmoqda…' : 'Natijani saqlash (Enter)'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── O'NG — namuna paneli (qisqartirilgan) ──────────────────────────────────
const SAMPLE_STATUS_LABEL: Record<string, string> = {
  pending: 'Kutilmoqda',
  collected: 'Yig‘ildi',
  received: 'Qabul qilindi',
  rejected: 'Rad etildi',
};

function WsSamplePanel({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const { data: samples } = useQuery({
    queryKey: ['lab-samples', orderId],
    queryFn: () => api.lab.orderSamples(orderId),
  });

  const createMut = useMutation({
    mutationFn: () => api.lab.createSample({ order_id: orderId, sample_type: 'blood' }),
    onSuccess: () => {
      toast.success('Probirka yaratildi');
      qc.invalidateQueries({ queryKey: ['lab-samples', orderId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <TestTube className="h-3.5 w-3.5" /> Namunalar
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
          >
            + Probirka
          </Button>
        </div>
        {(samples ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Probirka yo‘q</p>
        ) : (
          <div className="space-y-1">
            {(samples ?? []).map((s) => (
              <div key={s.id} className="rounded border bg-card px-2 py-1">
                <div className="font-mono text-xs font-bold tracking-wider">
                  {s.tube_id}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {SAMPLE_STATUS_LABEL[s.status] ?? s.status}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
