import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clary/ui-web';
import { unitLabel, type UnitKind } from '@clary/utils';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { PAY_LABEL } from '@/lib/pharmacy/print';
import { usePharmacy } from './context';
import { SummaryCard, fmt, pharmRange, type PharmPeriod } from './shared';

export function SalesTab() {
  const navigate = useNavigate();
  const ph = usePharmacy();
  const [period, setPeriod] = useState<PharmPeriod>(ph.mode === 'workspace' ? 'today' : 'month');
  const [clinicId, setClinicId] = useState('');
  const range = useMemo(() => pharmRange(period), [period]);

  const { data: clinics } = useQuery({
    queryKey: ['pharmacy', 'clinics'],
    queryFn: () => api.pharmacy.listClinics(),
  });
  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy', 'sales-report', period, clinicId],
    queryFn: () =>
      api.pharmacy.salesReport({
        from: range.from,
        to: range.to,
        pharmacy_clinic_id: clinicId || undefined,
      }),
  });
  const totals = data?.totals;
  const byDoctor = data?.by_doctor ?? [];
  const sales = data?.sales ?? [];

  const PERIODS: Array<{ id: PharmPeriod; label: string }> = [
    { id: 'today', label: 'Bugun' },
    { id: 'week', label: 'Hafta' },
    { id: 'month', label: 'Oy' },
    { id: 'year', label: 'Yil' },
    { id: 'all', label: 'Hammasi' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-muted/30 inline-flex rounded-lg border p-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={
                'rounded-md px-3 py-1 text-sm font-medium transition ' +
                (period === p.id
                  ? 'bg-background shadow-elevation-1'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        <Select value={clinicId || 'all'} onValueChange={(v) => setClinicId(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Barcha mijozlar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Barcha mijozlar</SelectItem>
            {(clinics ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Daromad" value={`${fmt(totals?.revenue ?? 0)} so'm`} tone="primary" />
        {totals?.profit != null && ph.canSeeCost ? (
          <SummaryCard label="Foyda" value={`${fmt(totals.profit)} so'm`} tone="success" />
        ) : (
          <SummaryCard
            label="O'rtacha chek"
            value={`${fmt(totals?.sales_count ? Math.round((totals?.revenue ?? 0) / totals.sales_count) : 0)} so'm`}
          />
        )}
        <SummaryCard label="Sotilgan dori" value={`${fmt(totals?.qty ?? 0)} dona`} />
        <SummaryCard label="Sotuvlar" value={`${fmt(totals?.sales_count ?? 0)} ta`} />
      </div>

      {byDoctor.some((d) => d.doctor_id) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Shifokorlar bo'yicha</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left">Shifokor</th>
                    <th className="px-3 py-2 text-right">Sotuvlar</th>
                    <th className="px-3 py-2 text-right">Dori (dona)</th>
                    <th className="px-3 py-2 text-right">Daromad</th>
                    {ph.canSeeCost && <th className="px-3 py-2 text-right">Foyda</th>}
                    <th className="px-3 py-2 text-right">Doktor ulushi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {byDoctor.map((d) => (
                    <tr key={d.doctor_id ?? 'none'}>
                      <td className="px-3 py-2 font-medium">{d.doctor_name}</td>
                      <td className="px-3 py-2 text-right">{d.sales_count}</td>
                      <td className="px-3 py-2 text-right">{fmt(d.qty)}</td>
                      <td className="px-3 py-2 text-right">{fmt(d.revenue)}</td>
                      {ph.canSeeCost && (
                        <td className="px-3 py-2 text-right text-emerald-600">{fmt(d.profit)}</td>
                      )}
                      <td className="px-3 py-2 text-right">{fmt(d.doctor_share)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sotuvlar ({sales.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-muted-foreground p-6 text-sm">Yuklanmoqda…</div>
          ) : sales.length === 0 ? (
            <div className="p-6">
              <EmptyState title="Savdolar yo'q" />
            </div>
          ) : (
            <div className="divide-y">
              {sales.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => navigate(ph.salePath(s.id))}
                  className="hover:bg-muted/40 grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left transition"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {s.clinic_name ?? 'Oddiy xaridor'}
                      {s.doctor_name ? ` · ${s.doctor_name}` : ''}
                      {' · '}
                      {s.items_count} qator ({fmt(s.qty)} dona)
                    </div>
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                      <span>{new Date(s.created_at).toLocaleString('uz-UZ')}</span>
                      <span>· {PAY_LABEL[s.payment_method] ?? s.payment_method}</span>
                      {s.operator_name && <span>· {s.operator_name}</span>}
                      {s.register_no && <span>· Kassa {s.register_no}</span>}
                      {s.fiscal_status === 'sent' && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                          fiskal
                        </Badge>
                      )}
                      {s.fiscal_status === 'failed' && (
                        <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                          fiskal xato
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-right">
                    <div>
                      <div className="font-semibold">{fmt(s.total_uzs)} so'm</div>
                      {s.debt_uzs > 0 && (
                        <div className="text-xs text-amber-600">Qarz: {fmt(s.debt_uzs)}</div>
                      )}
                    </div>
                    <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Qisman qaytarish — sotilgan birlikda (qadoq/dona) kiritiladi, partiyalarga
// avtomatik taqsimlanadi (bir qadoq ikki partiyadan yechilgan bo'lishi mumkin).
// ---------------------------------------------------------------------------
type SaleItemRow = {
  id: string;
  medication_id: string;
  name_snapshot: string;
  quantity: number;
  returned_qty: number;
  subtotal_uzs: number;
  unit_kind: string | null;
  unit_factor: number | null;
};

export function ReturnDialog({
  saleId,
  onClose,
  onDone,
}: {
  saleId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: sale, isLoading } = useQuery({
    queryKey: ['pharmacy', 'sale', saleId],
    queryFn: () => api.pharmacy.getSale(saleId),
  });
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');

  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        name: string;
        kind: UnitKind;
        factor: number;
        rows: SaleItemRow[];
        remainingBase: number;
        perBase: number;
      }
    >();
    for (const it of (sale?.items ?? []) as SaleItemRow[]) {
      const kind = (it.unit_kind ?? 'unit') as UnitKind;
      const factor = Math.max(1, it.unit_factor ?? 1);
      const key = `${it.medication_id}:${kind}`;
      const g = map.get(key) ?? {
        key,
        name: it.name_snapshot,
        kind,
        factor,
        rows: [],
        remainingBase: 0,
        perBase: 0,
      };
      g.rows.push(it);
      g.remainingBase += it.quantity - it.returned_qty;
      map.set(key, g);
    }
    for (const g of map.values()) {
      const totalBase = g.rows.reduce((a, r) => a + r.quantity, 0);
      const totalSum = g.rows.reduce((a, r) => a + r.subtotal_uzs, 0);
      g.perBase = totalBase > 0 ? totalSum / totalBase : 0;
    }
    return [...map.values()];
  }, [sale]);

  const refundTotal = groups.reduce(
    (a, g) => a + Math.round((qtys[g.key] ?? 0) * g.factor * g.perBase),
    0,
  );
  const anyQty = Object.values(qtys).some((v) => v > 0);

  const mut = useMutation({
    mutationFn: () => {
      // Sotilgan birlikdan → donaga, keyin qatorlarga (oxirgisidan) taqsimlash
      const items: Array<{ sale_item_id: string; qty: number }> = [];
      for (const g of groups) {
        let need = Math.round((qtys[g.key] ?? 0) * g.factor);
        for (const r of [...g.rows].reverse()) {
          if (need <= 0) break;
          const free = r.quantity - r.returned_qty;
          const take = Math.min(free, need);
          if (take > 0) items.push({ sale_item_id: r.id, qty: take });
          need -= take;
        }
      }
      return api.pharmacy.returnSaleItems(saleId, { items, reason: reason || undefined });
    },
    onSuccess: (r) => {
      toast.success(
        `Qaytarildi (zaxira tiklandi)${r.cash_back_uzs ? ` · kassadan ${fmt(r.cash_back_uzs)} so'm` : ''}`,
      );
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Qisman qaytarish</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="text-muted-foreground py-6 text-center text-sm">Yuklanmoqda…</div>
        ) : (
          <div className="space-y-3">
            <div className="divide-y rounded-md border">
              {groups.map((g) => {
                const remaining = Math.floor(g.remainingBase / g.factor);
                const label = g.kind === 'unit' && g.factor === 1 ? 'dona' : unitLabel(g.kind);
                return (
                  <div key={g.key} className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{g.name}</div>
                      <div className="text-muted-foreground text-xs">
                        Qaytarish mumkin: {remaining} {label}
                      </div>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={remaining}
                      value={qtys[g.key] ?? 0}
                      disabled={remaining <= 0}
                      onChange={(e) =>
                        setQtys((p) => ({
                          ...p,
                          [g.key]: Math.max(
                            0,
                            Math.min(remaining, Math.floor(Number(e.target.value) || 0)),
                          ),
                        }))
                      }
                      className="w-20 text-right"
                    />
                  </div>
                );
              })}
            </div>
            <Input
              placeholder="Sabab (ixtiyoriy)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="bg-muted/40 flex items-center justify-between rounded-md px-3 py-2 text-sm">
              <span className="text-muted-foreground">Qaytariladigan summa</span>
              <span className="font-semibold">{fmt(refundTotal)} so'm</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Bekor
              </Button>
              <Button onClick={() => mut.mutate()} disabled={!anyQty || mut.isPending}>
                {mut.isPending ? 'Qaytarilmoqda…' : 'Qaytarish'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
