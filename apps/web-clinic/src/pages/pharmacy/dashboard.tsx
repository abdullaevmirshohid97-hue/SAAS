import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  DollarSign,
  Download,
  PackagePlus,
  QrCode,
  Receipt,
  RefreshCw,
  Wallet,
} from 'lucide-react';
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
  StatCard,
} from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { usePharmacy } from './context';
import { LineField, QrLabelModal, StockText, fmt, pharmRange } from './shared';

export function DashboardTab() {
  const qc = useQueryClient();
  const ph = usePharmacy();
  const [qrMed, setQrMed] = useState<{
    name: string;
    barcode: string;
    price_uzs: number;
    strength?: string;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [supplierPay, setSupplierPay] = useState<{
    supplier_id: string;
    name: string;
    debt_uzs: number;
  } | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy', 'dashboard'],
    queryFn: () => api.pharmacy.dashboard(),
  });
  const { data: fin } = useQuery({
    queryKey: ['pharmacy', 'finance'],
    queryFn: () => api.pharmacy.finance(),
  });
  const { data: report } = useQuery({
    queryKey: ['pharmacy', 'dash-doctors'],
    queryFn: () => api.pharmacy.salesReport(pharmRange('month')),
  });
  const topDoctors = (report?.by_doctor ?? []).slice(0, 5);

  // Ombor eksporti — to'liq ro'yxat (ilgari qidiruv endpointi ishlatilgani
  // uchun faqat 40 ta dori eksport bo'lardi).
  const handleExportInventory = async () => {
    setExporting(true);
    try {
      const meds = await api.pharmacy.listMedicationsFull();
      const { exportMedications } = await import('@/lib/xlsx');
      await exportMedications(
        (meds ?? []).map((m) => ({
          name: m.name,
          strength: m.strength,
          unit: m.unit_name ?? (m.pack_qty > 1 ? `qadoq=${m.pack_qty}` : null),
          price_uzs: m.pack_qty > 1 ? (m.pack_price_uzs ?? m.price_uzs * m.pack_qty) : m.price_uzs,
          stock: m.qty_in_stock,
          barcode: m.barcode,
          batch_no: null,
          expiry_date: m.earliest_expiry,
        })),
        `dorilar-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success("Ombor Excel'ga eksport qilindi");
    } catch (err) {
      toast.error(`Eksport xatosi: ${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const totals = data?.totals;

  const reconcileMut = useMutation({
    mutationFn: () => api.pharmacy.reconcileStock(),
    onSuccess: (r) => {
      toast.success(`Zaxira yarashtirildi (${r.updated} dori)`);
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-2">
        {ph.isAdmin && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (
                window.confirm(
                  "Zaxirani yarashtirish: har bir dori stoki partiyalar yig'indisiga tenglashtiriladi. Davom etamizmi?",
                )
              ) {
                reconcileMut.mutate();
              }
            }}
            disabled={reconcileMut.isPending}
            title="medications.stock ni partiyalar yig'indisiga tenglaydi"
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            {reconcileMut.isPending ? 'Yarashtirilmoqda…' : 'Zaxirani yarashtirish'}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleExportInventory()}
          disabled={exporting}
        >
          <Download className="mr-1 h-4 w-4" />
          {exporting ? 'Eksport qilinmoqda...' : "Excel'ga eksport"}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Jami stok"
          value={isLoading ? '…' : fmt(totals?.qty_in_stock ?? 0)}
          icon={<Boxes className="h-4 w-4" />}
          hint="dona"
        />
        {ph.canSeeCost && (
          <StatCard
            label="Stok qiymati"
            value={isLoading ? '…' : fmt(totals?.stock_value_uzs ?? 0)}
            icon={<DollarSign className="h-4 w-4" />}
            hint="UZS (tannarx)"
            tone="info"
          />
        )}
        <StatCard
          label="Bugungi savdo"
          value={isLoading ? '…' : fmt(totals?.today_revenue_uzs ?? 0)}
          icon={<Receipt className="h-4 w-4" />}
          hint="UZS"
          tone="success"
        />
        <StatCard
          label="Bugungi qarz"
          value={isLoading ? '…' : fmt(totals?.today_debt_uzs ?? 0)}
          icon={<Wallet className="h-4 w-4" />}
          hint="UZS"
          tone={(totals?.today_debt_uzs ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Kam qolgan"
          value={isLoading ? '…' : String(totals?.low_stock_count ?? 0)}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={(totals?.low_stock_count ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Muddati yaqin"
          value={isLoading ? '…' : String(totals?.expiring_count ?? 0)}
          icon={<CalendarClock className="h-4 w-4" />}
          tone={(totals?.expiring_count ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Muddati o'tgan"
          value={isLoading ? '…' : String(totals?.expired_count ?? 0)}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={(totals?.expired_count ?? 0) > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Oylik daromad"
          value={fmt(fin?.month_revenue ?? 0)}
          icon={<Receipt className="h-4 w-4" />}
          hint="so'm"
          tone="success"
        />
        {ph.canSeeCost && fin?.month_profit != null && (
          <StatCard
            label="Oylik foyda"
            value={fmt(fin.month_profit)}
            icon={<DollarSign className="h-4 w-4" />}
            hint="so'm"
            tone="info"
          />
        )}
        <StatCard
          label="Oylik kirim (prixot)"
          value={fmt(fin?.month_purchases ?? 0)}
          icon={<PackagePlus className="h-4 w-4" />}
          hint="so'm"
        />
        <StatCard
          label="Yetkazuvchiga qarz"
          value={fmt(fin?.supplier_debt_total ?? 0)}
          icon={<Wallet className="h-4 w-4" />}
          hint="so'm"
          tone={(fin?.supplier_debt_total ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Mijoz qarzi (bizga)"
          value={fmt(fin?.customer_debt_total ?? 0)}
          icon={<Wallet className="h-4 w-4" />}
          hint="so'm"
          tone={(fin?.customer_debt_total ?? 0) > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Yetkazuvchi qarzlari</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(fin?.supplier_debts ?? []).length === 0 ? (
              <div className="text-muted-foreground p-4 text-sm">Qarz yo'q</div>
            ) : (
              <div className="divide-y">
                {(fin?.supplier_debts ?? []).map((s) => (
                  <div
                    key={s.supplier_id}
                    className="flex items-center justify-between gap-2 px-4 py-2"
                  >
                    <span className="min-w-0 truncate text-sm">{s.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-amber-700">
                        {fmt(s.debt_uzs)}
                      </span>
                      {ph.isAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => setSupplierPay(s)}
                        >
                          To'lash
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Mijoz qarzlari (bizga)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(fin?.customer_debts ?? []).length === 0 ? (
              <div className="text-muted-foreground p-4 text-sm">Qarz yo'q</div>
            ) : (
              <div className="divide-y">
                {(fin?.customer_debts ?? []).map((c) => (
                  <div
                    key={c.pharmacy_clinic_id}
                    className="flex items-center justify-between gap-2 px-4 py-2"
                  >
                    <span className="min-w-0 truncate text-sm">{c.name}</span>
                    <span className="text-sm font-semibold text-amber-700">{fmt(c.debt_uzs)}</span>
                  </div>
                ))}
                <div className="text-muted-foreground px-4 py-2 text-[11px]">
                  To'lash: "Mijoz klinikalar" bo'limida
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Shifokor aylanmasi (oy)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {topDoctors.length === 0 ? (
              <div className="text-muted-foreground p-4 text-sm">Ma'lumot yo'q</div>
            ) : (
              <div className="divide-y">
                {topDoctors.map((d) => (
                  <div
                    key={d.doctor_id ?? 'none'}
                    className="flex items-center justify-between gap-2 px-4 py-2"
                  >
                    <span className="min-w-0 truncate text-sm">{d.doctor_name}</span>
                    <span className="text-sm font-semibold">{fmt(d.revenue)} so'm</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kam qolgan dorilar</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(data?.low_stock ?? []).length === 0 ? (
              <div className="p-6">
                <EmptyState title="Hammasi yetarli" description="Kam qolgan dorilar yo'q" />
              </div>
            ) : (
              <div className="divide-y">
                {(data?.low_stock ?? []).map((row) => (
                  <div
                    key={row.medication_id}
                    className="flex items-center justify-between px-4 py-2.5"
                  >
                    <span className="font-medium">{row.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="warning">
                        <StockText
                          qty={row.qty_in_stock}
                          med={{ pack_qty: row.pack_qty, unit_name: row.unit_name }}
                        />
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        min: {row.reorder_level ?? 10}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="QR yorliq"
                        onClick={() =>
                          setQrMed({ name: row.name, barcode: row.medication_id, price_uzs: 0 })
                        }
                      >
                        <QrCode className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Muddati yaqin partiyalar (90 kun)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(data?.expiring ?? []).length === 0 ? (
              <div className="p-6">
                <EmptyState title="Muddati yaqin yo'q" />
              </div>
            ) : (
              <div className="divide-y">
                {(data?.expiring ?? []).map((row) => (
                  <div key={row.id} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <div className="font-medium">{row.medication?.name ?? '—'}</div>
                      <div className="text-muted-foreground text-xs">
                        {row.batch_no ? `Partiya: ${row.batch_no}` : 'Partiya: —'} ·{' '}
                        {row.qty_remaining} dona
                      </div>
                    </div>
                    <Badge variant="destructive">{row.expiry_date ?? '—'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <QrLabelModal open={!!qrMed} med={qrMed} onClose={() => setQrMed(null)} />
      {supplierPay && (
        <SupplierPayDialog supplier={supplierPay} onClose={() => setSupplierPay(null)} />
      )}
    </div>
  );
}

function SupplierPayDialog({
  supplier,
  onClose,
}: {
  supplier: { supplier_id: string; name: string; debt_uzs: number };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(String(supplier.debt_uzs));
  const [method, setMethod] = useState('cash');
  const mut = useMutation({
    mutationFn: () =>
      api.pharmacy.paySupplier({
        supplier_id: supplier.supplier_id,
        amount_uzs: Number(amount) || 0,
        payment_method: method,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      toast.success("Yetkazuvchiga to'lov qabul qilindi");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{supplier.name} — to'lov</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Joriy qarz: <b>{fmt(supplier.debt_uzs)}</b> so'm
          </div>
          <LineField label="To'lov summasi (so'm)">
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </LineField>
          <LineField label="To'lov turi">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="bg-background h-9 w-full rounded-md border px-3 text-sm"
            >
              <option value="cash">Naqd (kassadan)</option>
              <option value="transfer">O'tkazma</option>
              <option value="click">Click/Karta</option>
            </select>
          </LineField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button
            disabled={!amount || Number(amount) <= 0 || mut.isPending}
            onClick={() => mut.mutate()}
          >
            To'lash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
