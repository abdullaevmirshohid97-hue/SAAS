import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScanBarcode, Search } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
} from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { useScanner } from '@/lib/scanner/use-scanner';
import { fmt } from './shared';

type RxItem = {
  id: string;
  medication_id: string | null;
  medication_name_snapshot: string;
  dosage: string | null;
  route: string | null;
  quantity: number;
  dispensed_qty: number;
  unit_price_snapshot: number | null;
};
type Rx = {
  id: string;
  rx_number: string | null;
  status: string;
  diagnosis_text: string | null;
  instructions: string | null;
  valid_until: string | null;
  created_at: string;
  patient: { id: string; full_name: string; phone: string | null; pinfl: string | null } | null;
  doctor: { id: string; full_name: string } | null;
  items: RxItem[];
};

const statusLabel = (s: string) =>
  ({
    issued: 'Yangi',
    partially_dispensed: 'Qisman',
    dispensed: 'Berildi',
    canceled: 'Bekor',
    expired: "Muddati o'tgan",
  })[s] ?? s;

function RxDispenseDialog({
  rx,
  onClose,
  onDone,
}: {
  rx: Rx;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const remaining = rx.items.filter((it) => it.quantity > it.dispensed_qty && it.medication_id);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(remaining.map((it) => it.id)),
  );
  const [payment, setPayment] = useState<'cash' | 'card' | 'transfer'>('cash');
  const { data: catalog } = useQuery({
    queryKey: ['pharmacy', 'pos-catalog'],
    queryFn: () => api.pharmacy.posCatalog(),
    staleTime: 30_000,
  });
  const medInfo = useMemo(
    () => new Map((catalog?.items ?? []).map((m) => [m.medication_id, m])),
    [catalog],
  );

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selItems = remaining.filter((it) => selected.has(it.id));

  // Retsept miqdori DONADA. Donalab sotish yoqilmagan qadoqli dori — qadoqqa
  // aylantiramiz (bo'linmasa — xato), aks holda dona sifatida.
  const plan = selItems.map((it) => {
    const qty = it.quantity - it.dispensed_qty;
    const m = it.medication_id ? medInfo.get(it.medication_id) : undefined;
    const pack = Math.max(1, m?.pack_qty ?? 1);
    if (pack > 1 && !m?.sell_by_unit) {
      if (qty % pack === 0) {
        return {
          it,
          unit_kind: 'pack' as const,
          quantity: qty / pack,
          price: m?.pack_price_uzs ?? (m?.price_uzs ?? 0) * pack,
          error: null,
        };
      }
      return {
        it,
        unit_kind: 'pack' as const,
        quantity: 0,
        price: 0,
        error: `${it.medication_name_snapshot}: ${qty} dona qadoqqa bo'linmaydi (donalab sotish yoqilmagan)`,
      };
    }
    return {
      it,
      unit_kind: 'unit' as const,
      quantity: qty,
      price: m?.price_uzs ?? it.unit_price_snapshot ?? 0,
      error: null,
    };
  });
  const planError = plan.find((p) => p.error)?.error ?? null;
  const total = plan.reduce((s, p) => s + p.price * p.quantity, 0);

  const mut = useMutation({
    mutationFn: () => {
      if (!plan.length) throw new Error('Hech bir dori tanlanmadi');
      if (planError) throw new Error(planError);
      return api.pharmacy.createSale({
        prescription_id: rx.id,
        patient_id: rx.patient?.id,
        items: plan.map((p) => ({
          medication_id: p.it.medication_id ?? '',
          quantity: p.quantity,
          unit_kind: p.unit_kind,
        })),
        payment_method: payment,
        payments: [{ method: payment, amount_uzs: total }],
        idempotency_key: crypto.randomUUID?.() ?? undefined,
      });
    },
    onSuccess: () => {
      toast.success('Dorilar berildi');
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Retsept bo'yicha berish — {rx.rx_number ?? rx.id.slice(0, 8)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="bg-muted/30 space-y-0.5 rounded-md border px-3 py-2 text-sm">
            <div className="flex gap-2">
              <span className="text-muted-foreground w-20">Bemor</span>
              <span className="font-medium">{rx.patient?.full_name ?? '—'}</span>
            </div>
            {rx.patient?.phone && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20">Telefon</span>
                <span>{rx.patient.phone}</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-muted-foreground w-20">Shifokor</span>
              <span>{rx.doctor?.full_name ?? '—'}</span>
            </div>
            {rx.diagnosis_text && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20">Tashxis</span>
                <span>{rx.diagnosis_text}</span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Dorilar</span>
              <div className="flex gap-2 text-xs">
                <button
                  className="text-primary hover:underline"
                  onClick={() => setSelected(new Set(remaining.map((i) => i.id)))}
                >
                  Hammasini tanlash
                </button>
                <button
                  className="text-muted-foreground hover:underline"
                  onClick={() => setSelected(new Set())}
                >
                  Tozalash
                </button>
              </div>
            </div>
            {remaining.length === 0 && (
              <p className="text-muted-foreground text-sm">Barcha dorilar allaqachon berilgan.</p>
            )}
            {remaining.map((it) => {
              const qty = it.quantity - it.dispensed_qty;
              const chk = selected.has(it.id);
              return (
                <label
                  key={it.id}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition-colors ${chk ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={chk}
                    onChange={() => toggle(it.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {it.medication_name_snapshot}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {it.dosage && `${it.dosage} · `}
                      {it.route && `${it.route} · `}
                      miqdor: {qty} dona
                      {it.dispensed_qty > 0 && (
                        <span className="ml-1 text-amber-600">
                          (avval {it.dispensed_qty} berilgan)
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {planError && (
            <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{planError}</div>
          )}

          {selItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm font-medium">
                <span>Jami summa</span>
                <span className="text-lg font-semibold">{fmt(total)} so'm</span>
              </div>
              <div className="flex gap-2">
                {(['cash', 'card', 'transfer'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPayment(m)}
                    className={`flex-1 rounded-md border py-1.5 text-xs font-medium ${payment === m ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                  >
                    {m === 'cash' ? 'Naqd' : m === 'card' ? 'Karta' : "O'tkazma"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button
            disabled={!selItems.length || !!planError || mut.isPending}
            onClick={() => mut.mutate()}
          >
            Berish ({selItems.length} ta dori)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PrescriptionsTab() {
  const qc = useQueryClient();
  const [scanInput, setScanInput] = useState('');
  const [scannedRx, setScannedRx] = useState<Rx | null>(null);
  const [dispenseRx, setDispenseRx] = useState<Rx | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy', 'prescriptions', 'pending'],
    queryFn: () => api.pharmacy.prescriptionsPending(),
  });
  const pending = (data as Rx[]) ?? [];

  const scanMut = useMutation({
    mutationFn: (v: string) => api.pharmacy.prescriptionById(v.trim()),
    onSuccess: (rx) => {
      setScannedRx(rx as Rx);
      setScanInput('');
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setScanInput('');
    },
  });

  const handleScan = (v: string) => {
    // Retsept QR'ida URL bo'lishi mumkin — oxirgi bo'lak Rx raqami/ID
    const raw = v.trim();
    const code = /^https?:\/\//i.test(raw)
      ? (raw.split(/[/?#]/).filter(Boolean).pop() ?? raw)
      : raw;
    if (code) scanMut.mutate(code);
  };

  // Skaner — kursor qayerda bo'lsa ham retseptni ochadi
  useScanner((e) => handleScan(e.raw), { enabled: !dispenseRx });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanBarcode className="h-4 w-4" /> Retseptni skanerlang
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleScan(scanInput);
              }}
              placeholder="QR/shtrix-kodni skanerlang yoki Rx raqamini yozing…"
              className="font-mono"
            />
            <Button
              disabled={!scanInput.trim() || scanMut.isPending}
              onClick={() => handleScan(scanInput)}
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-muted-foreground mt-1.5 text-xs">
            Skaner istalgan joyda ishlaydi — maydonga bosish shart emas.
          </p>
        </CardContent>
      </Card>

      {scannedRx && (
        <Card className="border-primary">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-primary text-base">
                Topildi: {scannedRx.rx_number ?? scannedRx.id.slice(0, 8)}
              </CardTitle>
              <button
                className="text-muted-foreground hover:text-foreground text-lg"
                onClick={() => setScannedRx(null)}
              >
                ×
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="bg-muted/30 space-y-0.5 rounded-md px-3 py-2 text-sm">
              <div>
                <span className="text-muted-foreground">Bemor: </span>
                <span className="font-medium">{scannedRx.patient?.full_name ?? '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Shifokor: </span>
                {scannedRx.doctor?.full_name ?? '—'}
              </div>
              {scannedRx.valid_until && (
                <div>
                  <span className="text-muted-foreground">Muddati: </span>
                  {scannedRx.valid_until}
                </div>
              )}
            </div>
            <div className="space-y-1">
              {scannedRx.items.map((it) => {
                const rem = it.quantity - it.dispensed_qty;
                return (
                  <div
                    key={it.id}
                    className={`flex items-center justify-between rounded border px-2 py-1.5 text-sm ${rem === 0 ? 'opacity-50' : ''}`}
                  >
                    <span className="font-medium">{it.medication_name_snapshot}</span>
                    <span className="text-muted-foreground text-xs">
                      {it.dosage} · {rem}/{it.quantity} dona{rem === 0 ? ' ✓' : ''}
                    </span>
                  </div>
                );
              })}
            </div>
            <Button
              className="w-full"
              onClick={() => {
                setDispenseRx(scannedRx);
                setScannedRx(null);
              }}
              disabled={
                scannedRx.items.every((it) => it.quantity <= it.dispensed_qty) ||
                scannedRx.status === 'dispensed'
              }
            >
              Berish
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Kutilayotgan retseptlar ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-muted-foreground p-4 text-sm">Yuklanmoqda…</div>
          ) : pending.length === 0 ? (
            <div className="p-4">
              <EmptyState title="Hozircha retsept yo'q" />
            </div>
          ) : (
            <div className="divide-y">
              {pending.map((rx) => (
                <div key={rx.id} className="flex items-start justify-between gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {rx.rx_number ?? rx.id.slice(0, 8)} · {rx.patient?.full_name ?? 'Mijoz'}
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      {rx.doctor?.full_name ?? '—'} ·{' '}
                      {new Date(rx.created_at).toLocaleString('uz-UZ')}
                    </div>
                    <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-2 text-xs">
                      {(rx.items ?? []).map((it, ix) => (
                        <span
                          key={ix}
                          className={
                            it.quantity <= it.dispensed_qty ? 'line-through opacity-50' : ''
                          }
                        >
                          {it.medication_name_snapshot} ({it.dispensed_qty}/{it.quantity})
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                    <Badge
                      variant={rx.status === 'partially_dispensed' ? 'warning' : 'secondary'}
                      className="text-[10px]"
                    >
                      {statusLabel(rx.status)}
                    </Badge>
                    <Button
                      size="sm"
                      onClick={() => setDispenseRx(rx)}
                      disabled={rx.status === 'dispensed'}
                    >
                      Berish
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {dispenseRx && (
        <RxDispenseDialog
          rx={dispenseRx}
          onClose={() => setDispenseRx(null)}
          onDone={() => {
            setDispenseRx(null);
            qc.invalidateQueries({ queryKey: ['pharmacy', 'prescriptions', 'pending'] });
          }}
        />
      )}
    </div>
  );
}
