import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShoppingCart, PackageCheck, AlertTriangle, Check, X, PackagePlus } from 'lucide-react';

import {
  PageHeader, Card, CardContent, Badge, Button, Input,
  Tabs, TabsList, TabsTrigger, TabsContent, EmptyState,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@clary/ui-web';

import { api } from '@/lib/api';

// =============================================================================
// Procurement — Purchase Order workflow + auto-reorder. /procurement.
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Qoralama', cls: 'bg-slate-500/15 text-slate-600' },
  approved: { label: 'Tasdiqlangan', cls: 'bg-blue-500/15 text-blue-600' },
  partial: { label: 'Qisman qabul', cls: 'bg-amber-500/15 text-amber-700' },
  received: { label: 'Qabul qilingan', cls: 'bg-emerald-500/15 text-emerald-600' },
  cancelled: { label: 'Bekor', cls: 'bg-rose-500/15 text-rose-600' },
};

type PO = Awaited<ReturnType<typeof api.procurement.orders>>[number];

export function ProcurementPage() {
  const qc = useQueryClient();
  const { data: orders } = useQuery({ queryKey: ['po-orders'], queryFn: () => api.procurement.orders() });
  const { data: reorder } = useQuery({ queryKey: ['po-reorder'], queryFn: () => api.procurement.reorderSuggestions() });
  const [receivePo, setReceivePo] = useState<PO | null>(null);
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['po-orders'] }); qc.invalidateQueries({ queryKey: ['po-reorder'] }); };

  const approveMut = useMutation({ mutationFn: (id: string) => api.procurement.approve(id), onSuccess: () => { toast.success('Tasdiqlandi'); invalidate(); }, onError: (e: Error) => toast.error(e.message) });
  const cancelMut = useMutation({ mutationFn: (id: string) => api.procurement.cancel(id), onSuccess: () => { toast.success('Bekor qilindi'); invalidate(); } });

  return (
    <div className="space-y-5">
      <PageHeader title="Xaridlar (Procurement)" description="Purchase Order: talab → tasdiq → qabul. Avto-reorder bilan." />

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">🛒 Buyurtmalar</TabsTrigger>
          <TabsTrigger value="reorder">⚠️ Auto-reorder{(reorder?.length ?? 0) > 0 ? ` (${reorder?.length})` : ''}</TabsTrigger>
        </TabsList>

        {/* ── Buyurtmalar ── */}
        <TabsContent value="orders">
          {(orders ?? []).length === 0 ? (
            <EmptyState title="Buyurtma yo'q" description="Auto-reorder yoki yangi buyurtma yarating." />
          ) : (
            <div className="space-y-2">
              {orders?.map((po) => {
                const st = STATUS[po.status] ?? { label: po.status, cls: '' };
                return (
                  <Card key={po.id}>
                    <CardContent className="p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{po.po_no}</span>
                          <Badge className={`text-[10px] ${st.cls}`} variant="secondary">{st.label}</Badge>
                          <span className="text-sm text-muted-foreground">{po.supplier?.name ?? 'Supplier yo\'q'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{fmt(po.subtotal_uzs)} so'm</span>
                          {po.status === 'draft' && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => approveMut.mutate(po.id)}><Check className="mr-1 h-3.5 w-3.5" /> Tasdiqlash</Button>
                              <Button size="sm" variant="ghost" onClick={() => cancelMut.mutate(po.id)}><X className="h-3.5 w-3.5" /></Button>
                            </>
                          )}
                          {(po.status === 'approved' || po.status === 'partial') && (
                            <Button size="sm" onClick={() => setReceivePo(po)}><PackageCheck className="mr-1 h-3.5 w-3.5" /> Qabul</Button>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                        {po.items.map((it) => (
                          <div key={it.id} className="flex justify-between">
                            <span>{it.name_snapshot}</span>
                            <span>{it.qty_received}/{it.qty_ordered} × {fmt(it.unit_cost_uzs)}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Auto-reorder ── */}
        <TabsContent value="reorder">
          <ReorderTab suggestions={reorder ?? []} onCreated={invalidate} />
        </TabsContent>
      </Tabs>

      {receivePo && <ReceiveDialog po={receivePo} onClose={() => setReceivePo(null)} onDone={() => { setReceivePo(null); invalidate(); }} />}
    </div>
  );
}

// ── Auto-reorder: low-stock → bir klik PO ──────────────────────────────────
function ReorderTab({ suggestions, onCreated }: { suggestions: Array<{ medication_id: string; name: string; qty_in_stock: number; reorder_level: number; suggested_qty: number }>; onCreated: () => void }) {
  const [rows, setRows] = useState<Record<string, { sel: boolean; qty: string; cost: string }>>({});
  const get = (id: string, def: number) => rows[id] ?? { sel: false, qty: String(def), cost: '' };

  const createMut = useMutation({
    mutationFn: () => {
      const items = suggestions
        .filter((s) => rows[s.medication_id]?.sel)
        .map((s) => ({
          medication_id: s.medication_id, name_snapshot: s.name,
          qty_ordered: Number(rows[s.medication_id]?.qty || s.suggested_qty),
          unit_cost_uzs: Number(rows[s.medication_id]?.cost || 0),
        }));
      if (items.length === 0) throw new Error('Hech narsa tanlanmadi');
      return api.procurement.createOrder({ items });
    },
    onSuccess: (r) => { toast.success(`Buyurtma yaratildi: ${r.po_no}`); setRows({}); onCreated(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (suggestions.length === 0) return <EmptyState title="Zaxira yetarli" description="Reorder darajasidan past dori yo'q." />;
  const anySel = Object.values(rows).some((r) => r.sel);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-amber-700"><AlertTriangle className="h-4 w-4" /> Reorder darajasidan past {suggestions.length} ta dori</div>
        <div className="space-y-2">
          {suggestions.map((s) => {
            const r = get(s.medication_id, s.suggested_qty);
            return (
              <div key={s.medication_id} className="flex flex-wrap items-center gap-3 rounded-md border p-2.5">
                <input type="checkbox" checked={r.sel} onChange={(e) => setRows((p) => ({ ...p, [s.medication_id]: { ...get(s.medication_id, s.suggested_qty), sel: e.target.checked } }))} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">Zaxira: {s.qty_in_stock} · Reorder: {s.reorder_level}</div>
                </div>
                <label className="flex items-center gap-1 text-xs">Soni
                  <Input className="h-8 w-20" value={r.qty} onChange={(e) => setRows((p) => ({ ...p, [s.medication_id]: { ...get(s.medication_id, s.suggested_qty), qty: e.target.value } }))} />
                </label>
                <label className="flex items-center gap-1 text-xs">Tannarx
                  <Input className="h-8 w-28" placeholder="so'm" value={r.cost} onChange={(e) => setRows((p) => ({ ...p, [s.medication_id]: { ...get(s.medication_id, s.suggested_qty), cost: e.target.value } }))} />
                </label>
              </div>
            );
          })}
        </div>
        <Button className="mt-3" disabled={!anySel || createMut.isPending} onClick={() => createMut.mutate()}>
          <PackagePlus className="mr-2 h-4 w-4" /> Buyurtma yaratish
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Qabul (GRN) dialogi ────────────────────────────────────────────────────
function ReceiveDialog({ po, onClose, onDone }: { po: PO; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(po.items.map((it) => [it.id, String(Math.max(0, it.qty_ordered - it.qty_received))])),
  );
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState('cash');

  const mut = useMutation({
    mutationFn: () => {
      const items = po.items
        .filter((it) => it.medication_id && Number(qty[it.id] || 0) > 0)
        .map((it) => ({ medication_id: it.medication_id as string, quantity: Number(qty[it.id]), unit_cost_uzs: it.unit_cost_uzs }));
      if (items.length === 0) throw new Error('Qabul miqdori kiritilmadi');
      return api.procurement.receive(po.id, { items, paid_uzs: paid ? Number(paid) : undefined, payment_method: method });
    },
    onSuccess: () => { toast.success('Qabul qilindi'); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Qabul — {po.po_no}</DialogTitle>
          <DialogDescription>Qabul qilingan miqdorni kiriting. Zaxiraga kiritiladi va GL'ga post qilinadi.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {po.items.map((it) => (
            <div key={it.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{it.name_snapshot} <span className="text-xs text-muted-foreground">({it.qty_received}/{it.qty_ordered})</span></span>
              <Input className="h-8 w-24" value={qty[it.id] ?? ''} onChange={(e) => setQty((p) => ({ ...p, [it.id]: e.target.value }))} />
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-3 border-t pt-3">
          <label className="flex flex-col gap-1 text-xs">To'langan summa
            <Input className="h-9 w-36" placeholder="so'm (ixtiyoriy)" value={paid} onChange={(e) => setPaid(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">Usul
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="cash">Naqd</option><option value="card">Plastik</option><option value="transfer">O'tkazma</option>
            </select>
          </label>
          <Button className="ml-auto" disabled={mut.isPending} onClick={() => mut.mutate()}>Qabul qilish</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
