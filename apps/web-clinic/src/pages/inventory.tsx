import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Boxes, PackagePlus, Minus, AlertTriangle, CalendarClock, Plus, X, Pencil,
} from 'lucide-react';

import {
  PageHeader, Card, CardContent, Badge, Button, Input,
  Tabs, TabsList, TabsTrigger, TabsContent, EmptyState,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@clary/ui-web';

import { api } from '@/lib/api';

// =============================================================================
// Pillar 3 — Umumiy inventar (lab reagent / consumable / xo'jalik). FEFO + GL.
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const CAT: Record<string, string> = { reagent: 'Reagent', consumable: 'Sarflanuvchi', household: 'Xo‘jalik', other: 'Boshqa' };

type StockRow = Awaited<ReturnType<typeof api.inventory.stock>>[number];

// expiry rangini aniqlash (muddat yaqinligi)
function expiryCls(d: string | null): string {
  if (!d) return 'text-muted-foreground';
  const days = Math.floor((new Date(d).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'text-rose-600 font-semibold';
  if (days <= 30) return 'text-rose-600';
  if (days <= 90) return 'text-amber-600';
  return 'text-muted-foreground';
}

export function InventoryPage() {
  const { data: stock } = useQuery({ queryKey: ['inv-stock'], queryFn: () => api.inventory.stock() });
  const { data: low } = useQuery({ queryKey: ['inv-low'], queryFn: () => api.inventory.lowStock() });
  const { data: expiring } = useQuery({ queryKey: ['inv-expiring'], queryFn: () => api.inventory.expiring() });
  const [editItem, setEditItem] = useState<StockRow | 'new' | null>(null);
  const [consumeItem, setConsumeItem] = useState<StockRow | null>(null);

  return (
    <div className="space-y-5">
      <PageHeader title="Inventar (umumiy zaxira)" description="Lab reagent · sarflanuvchi · xo'jalik mollari. FEFO + buxgalteriya (GL)." />

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock"><Boxes className="mr-1 h-3.5 w-3.5" /> Zaxira</TabsTrigger>
          <TabsTrigger value="receipt"><PackagePlus className="mr-1 h-3.5 w-3.5" /> Kirim</TabsTrigger>
          <TabsTrigger value="low"><AlertTriangle className="mr-1 h-3.5 w-3.5" /> Kam qolgan{(low?.length ?? 0) > 0 ? ` (${low?.length})` : ''}</TabsTrigger>
          <TabsTrigger value="expiry"><CalendarClock className="mr-1 h-3.5 w-3.5" /> Muddat</TabsTrigger>
        </TabsList>

        {/* ── Zaxira ── */}
        <TabsContent value="stock">
          <div className="mb-3">
            <Button size="sm" onClick={() => setEditItem('new')}><Plus className="mr-1 h-4 w-4" /> Yangi mol</Button>
          </div>
          {(stock ?? []).length === 0 ? (
            <EmptyState title="Mol yo'q" description="«Yangi mol» bilan qo'shing, keyin «Kirim» qiling." />
          ) : (
            <div className="space-y-2">
              {stock?.map((r) => (
                <Card key={r.item_id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{r.name}</span>
                        <Badge variant="secondary" className="text-[10px]">{CAT[r.category] ?? r.category}</Badge>
                        {r.qty_in_stock < r.reorder_level && <Badge className="bg-amber-500/15 text-[10px] text-amber-700" variant="secondary">Kam</Badge>}
                        {r.batches_expiring_soon > 0 && <Badge className="bg-rose-500/15 text-[10px] text-rose-600" variant="secondary">{r.batches_expiring_soon} muddat</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Zaxira: <b>{r.qty_in_stock}</b> {r.unit} · Reorder: {r.reorder_level} · Qiymat: {fmt(r.stock_value_uzs)} so'm
                        {r.earliest_expiry ? <> · Eng erta muddat: <span className={expiryCls(r.earliest_expiry)}>{r.earliest_expiry}</span></> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setConsumeItem(r)} disabled={r.qty_in_stock <= 0}><Minus className="mr-1 h-3.5 w-3.5" /> Sarf</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditItem(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Kirim ── */}
        <TabsContent value="receipt"><ReceiptTab items={stock ?? []} /></TabsContent>

        {/* ── Kam qolgan ── */}
        <TabsContent value="low">
          {(low ?? []).length === 0 ? (
            <EmptyState title="Zaxira yetarli" description="Reorder darajasidan past mol yo'q." />
          ) : (
            <div className="space-y-2">
              {low?.map((r) => (
                <Card key={r.item_id}>
                  <CardContent className="flex items-center justify-between p-3 text-sm">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground">Zaxira: {r.qty_in_stock} · Reorder: {r.reorder_level} · Tavsiya: <b>{r.suggested_qty}</b></span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Muddat ── */}
        <TabsContent value="expiry">
          {(expiring ?? []).length === 0 ? (
            <EmptyState title="Muddat yo'q" description="Muddatli partiya topilmadi." />
          ) : (
            <div className="space-y-2">
              {expiring?.map((b) => (
                <Card key={b.id}>
                  <CardContent className="flex items-center justify-between p-3 text-sm">
                    <span className="font-medium">{b.item?.name ?? '—'} {b.batch_no ? <span className="text-xs text-muted-foreground">({b.batch_no})</span> : null}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-muted-foreground">Qoldiq: {b.qty_remaining}</span>
                      <span className={expiryCls(b.expiry_date)}>{b.expiry_date}</span>
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {editItem && <ItemDialog item={editItem === 'new' ? null : editItem} onClose={() => setEditItem(null)} />}
      {consumeItem && <ConsumeDialog item={consumeItem} onClose={() => setConsumeItem(null)} />}
    </div>
  );
}

// ── Mol yaratish/tahrirlash ──────────────────────────────────────────────────
function ItemDialog({ item, onClose }: { item: StockRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState(item?.category ?? 'consumable');
  const [unit, setUnit] = useState(item?.unit ?? 'dona');
  const [reorder, setReorder] = useState(String(item?.reorder_level ?? 0));
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['inv-stock'] }); qc.invalidateQueries({ queryKey: ['inv-low'] }); };

  const mut = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), category, unit: unit.trim() || 'dona', reorder_level: Number(reorder || 0) };
      if (item) await api.inventory.updateItem(item.item_id, body);
      else await api.inventory.createItem(body);
    },
    onSuccess: () => { toast.success('Saqlandi'); invalidate(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? 'Molni tahrirlash' : 'Yangi mol'}</DialogTitle>
          <DialogDescription>Lab reagent, sarflanuvchi yoki xo'jalik moli.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-xs">Nomi
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan: Shpritz 5ml" />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-xs">Turi
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="reagent">Reagent</option>
                <option value="consumable">Sarflanuvchi</option>
                <option value="household">Xo‘jalik</option>
                <option value="other">Boshqa</option>
              </select>
            </label>
            <label className="flex w-24 flex-col gap-1 text-xs">Birlik
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="dona" />
            </label>
            <label className="flex w-28 flex-col gap-1 text-xs">Reorder
              <Input value={reorder} onChange={(e) => setReorder(e.target.value)} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            {item && (
              <Button variant="ghost" onClick={() => { api.inventory.updateItem(item.item_id, { is_archived: true }).then(() => { toast.success('Arxivlandi'); invalidate(); onClose(); }); }}>Arxivlash</Button>
            )}
            <Button disabled={!name.trim() || mut.isPending} onClick={() => mut.mutate()}>Saqlash</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Sarf (consume) ───────────────────────────────────────────────────────────
function ConsumeDialog({ item, onClose }: { item: StockRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const mut = useMutation({
    mutationFn: () => api.inventory.consume({ item_id: item.item_id, quantity: Number(qty || 0), reason: reason || undefined }),
    onSuccess: () => {
      toast.success('Sarf qilindi');
      qc.invalidateQueries({ queryKey: ['inv-stock'] });
      qc.invalidateQueries({ queryKey: ['inv-low'] });
      qc.invalidateQueries({ queryKey: ['inv-expiring'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Sarf — {item.name}</DialogTitle>
          <DialogDescription>FEFO bo'yicha eng erta muddatli partiyadan yechiladi. Zaxira: {item.qty_in_stock} {item.unit}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-xs">Miqdor ({item.unit})
            <Input value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">Sabab (ixtiyoriy)
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: Lab tahlil" />
          </label>
          <Button className="w-full" disabled={!(Number(qty) > 0) || mut.isPending} onClick={() => mut.mutate()}>Sarf qilish</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Kirim (receipt builder) ──────────────────────────────────────────────────
function ReceiptTab({ items }: { items: StockRow[] }) {
  const qc = useQueryClient();
  const { data: receipts } = useQuery({ queryKey: ['inv-receipts'], queryFn: () => api.inventory.receipts() });
  const [lines, setLines] = useState<Array<{ item_id: string; name: string; quantity: string; unit_cost_uzs: string; batch_no: string; expiry_date: string }>>([]);
  const [itemId, setItemId] = useState('');
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState('cash');

  const total = useMemo(() => lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_cost_uzs || 0), 0), [lines]);

  const addLine = () => {
    const it = items.find((x) => x.item_id === itemId);
    if (!it) return;
    setLines((p) => [...p, { item_id: it.item_id, name: it.name, quantity: '', unit_cost_uzs: '', batch_no: '', expiry_date: '' }]);
    setItemId('');
  };
  const upd = (i: number, k: string, v: string) => setLines((p) => p.map((l, idx) => idx === i ? { ...l, [k]: v } : l));

  const mut = useMutation({
    mutationFn: () => {
      const payloadItems = lines
        .filter((l) => Number(l.quantity) > 0)
        .map((l) => ({
          item_id: l.item_id, quantity: Number(l.quantity), unit_cost_uzs: Number(l.unit_cost_uzs || 0),
          batch_no: l.batch_no || undefined, expiry_date: l.expiry_date || undefined,
        }));
      if (payloadItems.length === 0) throw new Error('Mol qatori kiritilmadi');
      return api.inventory.receipt({ items: payloadItems, paid_uzs: paid ? Number(paid) : undefined, payment_method: method });
    },
    onSuccess: (r) => {
      toast.success(`Kirim qilindi: ${r.receipt_no}`);
      setLines([]); setPaid('');
      qc.invalidateQueries({ queryKey: ['inv-stock'] });
      qc.invalidateQueries({ queryKey: ['inv-low'] });
      qc.invalidateQueries({ queryKey: ['inv-receipts'] });
      qc.invalidateQueries({ queryKey: ['inv-expiring'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="text-sm font-medium">Yangi kirim (prixod)</div>
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs">Mol
              <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="">— tanlang —</option>
                {items.map((it) => <option key={it.item_id} value={it.item_id}>{it.name}</option>)}
              </select>
            </label>
            <Button variant="outline" size="sm" onClick={addLine} disabled={!itemId}><Plus className="mr-1 h-3.5 w-3.5" /> Qator</Button>
          </div>

          {lines.length > 0 && (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                  <div className="min-w-[120px] flex-1 text-sm font-medium">{l.name}</div>
                  <label className="flex flex-col gap-0.5 text-[11px]">Soni
                    <Input className="h-8 w-20" value={l.quantity} onChange={(e) => upd(i, 'quantity', e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-0.5 text-[11px]">Tannarx
                    <Input className="h-8 w-28" value={l.unit_cost_uzs} onChange={(e) => upd(i, 'unit_cost_uzs', e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-0.5 text-[11px]">Partiya №
                    <Input className="h-8 w-24" value={l.batch_no} onChange={(e) => upd(i, 'batch_no', e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-0.5 text-[11px]">Muddat
                    <Input type="date" className="h-8 w-36" value={l.expiry_date} onChange={(e) => upd(i, 'expiry_date', e.target.value)} />
                  </label>
                  <Button size="sm" variant="ghost" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}><X className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
              <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-3">
                <div className="flex items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs">To'langan (so'm)
                    <Input className="h-9 w-32" placeholder="ixtiyoriy" value={paid} onChange={(e) => setPaid(e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">Usul
                    <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                      <option value="cash">Naqd</option><option value="card">Plastik</option><option value="transfer">O'tkazma</option>
                    </select>
                  </label>
                </div>
                <div className="text-sm">Jami: <b>{fmt(total)} so'm</b></div>
              </div>
              <Button disabled={mut.isPending} onClick={() => mut.mutate()}><PackagePlus className="mr-2 h-4 w-4" /> Kirim qilish</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {(receipts ?? []).length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">Oxirgi kirimlar</div>
          {receipts?.map((rc) => (
            <Card key={rc.id}>
              <CardContent className="flex items-center justify-between p-3 text-sm">
                <span className="font-mono">{rc.receipt_no} <span className="text-xs text-muted-foreground">· {rc.supplier?.name ?? ''} · {rc.received_at}</span></span>
                <span><Badge variant="secondary" className="mr-2 text-[10px]">{rc.payment_status}</Badge>{fmt(rc.total_cost_uzs)} so'm</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
