import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  PackageCheck, AlertTriangle, Check, X, PackagePlus, FileDown,
  ClipboardList, Receipt, Settings as SettingsIcon, GitCompare, Plus,
} from 'lucide-react';

import {
  PageHeader, Card, CardContent, Badge, Button, Input,
  Tabs, TabsList, TabsTrigger, TabsContent, EmptyState,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { downloadA4Pdf, escapeHtml } from '@/lib/report-export';

// =============================================================================
// Procurement — PO workflow + v2: requisition, 3-way match, auto-reorder, PO PDF.
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Qoralama', cls: 'bg-slate-500/15 text-slate-600' },
  approved: { label: 'Tasdiqlangan', cls: 'bg-blue-500/15 text-blue-600' },
  partial: { label: 'Qisman qabul', cls: 'bg-amber-500/15 text-amber-700' },
  received: { label: 'Qabul qilingan', cls: 'bg-emerald-500/15 text-emerald-600' },
  cancelled: { label: 'Bekor', cls: 'bg-rose-500/15 text-rose-600' },
  requested: { label: 'So‘ralgan', cls: 'bg-slate-500/15 text-slate-600' },
  rejected: { label: 'Rad etilgan', cls: 'bg-rose-500/15 text-rose-600' },
  converted: { label: 'PO yaratildi', cls: 'bg-emerald-500/15 text-emerald-600' },
  pending: { label: 'Kutilmoqda', cls: 'bg-slate-500/15 text-slate-600' },
  matched: { label: 'Mos', cls: 'bg-emerald-500/15 text-emerald-600' },
  disputed: { label: 'Nizoli', cls: 'bg-rose-500/15 text-rose-600' },
  paid: { label: 'To‘langan', cls: 'bg-emerald-500/15 text-emerald-600' },
};
const StatusBadge = ({ s }: { s: string }) => {
  const st = STATUS[s] ?? { label: s, cls: '' };
  return <Badge className={`text-[10px] ${st.cls}`} variant="secondary">{st.label}</Badge>;
};

type PO = Awaited<ReturnType<typeof api.procurement.orders>>[number];

// PO -> A4 PDF (supplierga yuborish uchun)
async function downloadPoPdf(poId: string) {
  const o = await api.procurement.getOrder(poId);
  const total = o.items.reduce((s, it) => s + it.qty_ordered * it.unit_cost_uzs, 0);
  const rows = o.items
    .map((it, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(it.name_snapshot)}</td>` +
      `<td class="r">${it.qty_ordered}</td><td class="r">${fmt(it.unit_cost_uzs)}</td>` +
      `<td class="r">${fmt(it.qty_ordered * it.unit_cost_uzs)}</td></tr>`)
    .join('');
  const sup = o.supplier;
  const supHtml = sup
    ? `<div style="font-size:12px;margin-bottom:12px"><b>Yetkazib beruvchi:</b> ${escapeHtml(sup.name)}` +
      `${sup.phone ? ' · Tel: ' + escapeHtml(sup.phone) : ''}${sup.tax_id ? ' · STIR: ' + escapeHtml(sup.tax_id) : ''}` +
      `${sup.address ? '<br/>Manzil: ' + escapeHtml(sup.address) : ''}</div>`
    : '';
  const html =
    `<div class="doc-title">Xarid buyurtmasi — ${escapeHtml(o.po_no)}</div>` +
    `<div class="doc-meta">Sana: ${o.ordered_at ?? ''}${o.expected_at ? ' · Kutilmoqda: ' + o.expected_at : ''} · Holat: ${escapeHtml(o.status)}</div>` +
    supHtml +
    `<table><thead><tr><th>#</th><th>Nomi</th><th class="r">Soni</th><th class="r">Tannarx</th><th class="r">Jami</th></tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `<tfoot><tr><td colspan="4" class="r">Jami</td><td class="r">${fmt(total)} so'm</td></tr></tfoot></table>` +
    `${o.notes ? `<div style="font-size:11px;margin-top:10px;color:#555">Izoh: ${escapeHtml(o.notes)}</div>` : ''}` +
    `<div class="doc-footer">Clary — ${new Date().toLocaleDateString('uz-UZ')}</div>`;
  await downloadA4Pdf(html, `${o.po_no}.pdf`);
}

export function ProcurementPage() {
  const qc = useQueryClient();
  const { data: orders } = useQuery({ queryKey: ['po-orders'], queryFn: () => api.procurement.orders() });
  const { data: reorder } = useQuery({ queryKey: ['po-reorder'], queryFn: () => api.procurement.reorderSuggestions() });
  const [receivePo, setReceivePo] = useState<PO | null>(null);
  const [matchPoId, setMatchPoId] = useState<string | null>(null);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['po-orders'] });
    qc.invalidateQueries({ queryKey: ['po-reorder'] });
  };

  const approveMut = useMutation({ mutationFn: (id: string) => api.procurement.approve(id), onSuccess: () => { toast.success('Tasdiqlandi'); invalidate(); }, onError: (e: Error) => toast.error(e.message) });
  const cancelMut = useMutation({ mutationFn: (id: string) => api.procurement.cancel(id), onSuccess: () => { toast.success('Bekor qilindi'); invalidate(); } });

  return (
    <div className="space-y-5">
      <PageHeader title="Xaridlar (Procurement)" description="Talab → tasdiq → buyurtma → qabul → invoice. Auto-reorder + 3-way match." />

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">🛒 Buyurtmalar</TabsTrigger>
          <TabsTrigger value="requisitions"><ClipboardList className="mr-1 h-3.5 w-3.5" /> Talablar</TabsTrigger>
          <TabsTrigger value="invoices"><Receipt className="mr-1 h-3.5 w-3.5" /> Invoyslar</TabsTrigger>
          <TabsTrigger value="reorder">⚠️ Auto-reorder{(reorder?.length ?? 0) > 0 ? ` (${reorder?.length})` : ''}</TabsTrigger>
          <TabsTrigger value="settings"><SettingsIcon className="mr-1 h-3.5 w-3.5" /> Sozlama</TabsTrigger>
        </TabsList>

        {/* ── Buyurtmalar ── */}
        <TabsContent value="orders">
          {(orders ?? []).length === 0 ? (
            <EmptyState title="Buyurtma yo'q" description="Talab tasdiqlang yoki auto-reorder'dan yarating." />
          ) : (
            <div className="space-y-2">
              {orders?.map((po) => (
                <Card key={po.id}>
                  <CardContent className="p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{po.po_no}</span>
                        <StatusBadge s={po.status} />
                        <span className="text-sm text-muted-foreground">{po.supplier?.name ?? 'Supplier yo\'q'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{fmt(po.subtotal_uzs)} so'm</span>
                        <Button size="sm" variant="ghost" title="PDF" onClick={() => downloadPoPdf(po.id).catch((e) => toast.error(String(e)))}><FileDown className="h-3.5 w-3.5" /></Button>
                        {po.status !== 'draft' && po.status !== 'cancelled' && (
                          <Button size="sm" variant="ghost" title="3-way match" onClick={() => setMatchPoId(po.id)}><GitCompare className="h-3.5 w-3.5" /></Button>
                        )}
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
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Talablar (requisition) ── */}
        <TabsContent value="requisitions"><RequisitionsTab /></TabsContent>

        {/* ── Invoyslar ── */}
        <TabsContent value="invoices"><InvoicesTab orders={orders ?? []} /></TabsContent>

        {/* ── Auto-reorder ── */}
        <TabsContent value="reorder">
          <ReorderTab suggestions={reorder ?? []} onCreated={invalidate} />
        </TabsContent>

        {/* ── Sozlama ── */}
        <TabsContent value="settings"><SettingsTab /></TabsContent>
      </Tabs>

      {receivePo && <ReceiveDialog po={receivePo} onClose={() => setReceivePo(null)} onDone={() => { setReceivePo(null); invalidate(); }} />}
      {matchPoId && <MatchDialog poId={matchPoId} onClose={() => setMatchPoId(null)} />}
    </div>
  );
}

// ── Talablar tab ────────────────────────────────────────────────────────────
function RequisitionsTab() {
  const qc = useQueryClient();
  const { data: reqs } = useQuery({ queryKey: ['po-reqs'], queryFn: () => api.procurement.requisitions() });
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [lines, setLines] = useState<Array<{ name_snapshot: string; qty: number }>>([]);
  const [note, setNote] = useState('');
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['po-reqs'] }); qc.invalidateQueries({ queryKey: ['po-orders'] }); };

  const createMut = useMutation({
    mutationFn: () => api.procurement.createRequisition({ note: note || undefined, items: lines }),
    onSuccess: (r) => { toast.success(`Talab yaratildi: ${r.req_no}`); setLines([]); setNote(''); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const approveMut = useMutation({ mutationFn: (id: string) => api.procurement.approveRequisition(id), onSuccess: (r) => { toast.success(`PO yaratildi: ${r.po_no}`); invalidate(); }, onError: (e: Error) => toast.error(e.message) });
  const rejectMut = useMutation({ mutationFn: (id: string) => api.procurement.rejectRequisition(id), onSuccess: () => { toast.success('Rad etildi'); invalidate(); } });

  const addLine = () => {
    const q = Number(qty);
    if (!name.trim() || !(q > 0)) return;
    setLines((p) => [...p, { name_snapshot: name.trim(), qty: q }]);
    setName(''); setQty('');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="text-sm font-medium">Yangi talab (requisition)</div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">Mahsulot nomi
              <Input className="h-9 w-56" value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan: Paratsetamol" />
            </label>
            <label className="flex flex-col gap-1 text-xs">Soni
              <Input className="h-9 w-24" value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
            <Button variant="outline" size="sm" onClick={addLine}><Plus className="mr-1 h-3.5 w-3.5" /> Qator</Button>
          </div>
          {lines.length > 0 && (
            <div className="space-y-1 rounded-md border p-2 text-sm">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span>{l.name_snapshot} — {l.qty}</span>
                  <Button size="sm" variant="ghost" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}><X className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </div>
          )}
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Izoh (ixtiyoriy)" className="h-9" />
          <Button disabled={lines.length === 0 || createMut.isPending} onClick={() => createMut.mutate()}>
            <ClipboardList className="mr-2 h-4 w-4" /> Talab yuborish
          </Button>
        </CardContent>
      </Card>

      {(reqs ?? []).length === 0 ? (
        <EmptyState title="Talab yo'q" description="Yuqorida yangi talab yarating." />
      ) : (
        <div className="space-y-2">
          {reqs?.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{r.req_no}</span>
                    <StatusBadge s={r.status} />
                  </div>
                  {r.status === 'requested' && (
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => approveMut.mutate(r.id)}><Check className="mr-1 h-3.5 w-3.5" /> Tasdiq → PO</Button>
                      <Button size="sm" variant="ghost" onClick={() => rejectMut.mutate(r.id)}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </div>
                <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {r.items.map((it) => <div key={it.id}>{it.name_snapshot} — {it.qty}</div>)}
                  {r.note && <div className="italic">Izoh: {r.note}</div>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Invoyslar tab ────────────────────────────────────────────────────────────
function InvoicesTab({ orders }: { orders: PO[] }) {
  const qc = useQueryClient();
  const { data: invoices } = useQuery({ queryKey: ['po-invoices'], queryFn: () => api.procurement.invoices() });
  const [invNo, setInvNo] = useState('');
  const [amount, setAmount] = useState('');
  const [poId, setPoId] = useState('');

  const createMut = useMutation({
    mutationFn: () => api.procurement.createInvoice({
      invoice_no: invNo.trim(), amount_uzs: Number(amount || 0), po_id: poId || undefined,
    }),
    onSuccess: () => { toast.success('Invoys saqlandi'); setInvNo(''); setAmount(''); setPoId(''); qc.invalidateQueries({ queryKey: ['po-invoices'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="text-sm font-medium">Yetkazib beruvchi invoysi (3-way match uchun)</div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">Invoys №
              <Input className="h-9 w-40" value={invNo} onChange={(e) => setInvNo(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs">Summa (so'm)
              <Input className="h-9 w-36" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs">Buyurtma (PO)
              <select value={poId} onChange={(e) => setPoId(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="">— bog'lanmagan —</option>
                {orders.map((po) => <option key={po.id} value={po.id}>{po.po_no}</option>)}
              </select>
            </label>
            <Button disabled={!invNo.trim() || createMut.isPending} onClick={() => createMut.mutate()}>
              <Plus className="mr-1 h-4 w-4" /> Saqlash
            </Button>
          </div>
        </CardContent>
      </Card>

      {(invoices ?? []).length === 0 ? (
        <EmptyState title="Invoys yo'q" description="Buyurtma qabulidan keyin invoysni kiriting." />
      ) : (
        <div className="space-y-2">
          {invoices?.map((inv) => (
            <Card key={inv.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold">{inv.invoice_no}</span>
                  <StatusBadge s={inv.status} />
                  <span className="text-muted-foreground">{inv.supplier?.name ?? ''}{inv.po ? ` · ${inv.po.po_no}` : ''}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">{inv.invoice_date}</span>
                  <span className="font-semibold">{fmt(inv.amount_uzs)} so'm</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 3-way match dialog ───────────────────────────────────────────────────────
function MatchDialog({ poId, onClose }: { poId: string; onClose: () => void }) {
  const { data: m, isLoading } = useQuery({ queryKey: ['po-match', poId], queryFn: () => api.procurement.match(poId) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>3-way match — {m?.po_no ?? ''}</DialogTitle>
          <DialogDescription>Buyurtma (PO) ↔ qabul (GRN) ↔ invoys nomuvofiqligi.</DialogDescription>
        </DialogHeader>
        {isLoading || !m ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : (
          <div className="space-y-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1">Mahsulot</th><th className="text-right">Buyurtma</th><th className="text-right">Qabul</th><th className="text-right">Farq</th>
                </tr>
              </thead>
              <tbody>
                {m.lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1">{l.name}</td>
                    <td className="text-right">{l.qty_ordered}</td>
                    <td className="text-right">{l.qty_received}</td>
                    <td className={`text-right font-medium ${l.qty_variance < 0 ? 'text-amber-600' : l.qty_variance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{l.qty_variance > 0 ? '+' : ''}{l.qty_variance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Buyurtma</div><div className="font-semibold">{fmt(m.totals.ordered_uzs)}</div></div>
              <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Qabul</div><div className="font-semibold">{fmt(m.totals.received_uzs)}</div></div>
              <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Invoys</div><div className="font-semibold">{fmt(m.totals.invoiced_uzs)}</div></div>
            </div>
            <div className={`rounded-md p-2 text-sm ${m.invoice_vs_received_uzs === 0 ? 'bg-emerald-500/10 text-emerald-700' : 'bg-rose-500/10 text-rose-700'}`}>
              {m.invoice_vs_received_uzs === 0
                ? '✓ Invoys qabulga teng — mos.'
                : `⚠ Invoys − qabul = ${fmt(m.invoice_vs_received_uzs)} so'm (nizoli)`}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Sozlama tab (auto-reorder) ───────────────────────────────────────────────
function SettingsTab() {
  const qc = useQueryClient();
  const { data: s } = useQuery({ queryKey: ['po-settings'], queryFn: () => api.procurement.settings() });
  const mut = useMutation({
    mutationFn: (body: { auto_reorder_enabled?: boolean; reorder_hour?: number }) => api.procurement.updateSettings(body),
    onSuccess: () => { toast.success('Saqlandi'); qc.invalidateQueries({ queryKey: ['po-settings'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="text-sm font-medium">Avtomatik buyurtma (auto-reorder)</div>
        <p className="text-xs text-muted-foreground">Yoqilsa, har kuni ertalab zaxirasi reorder darajasidan past dorilar uchun avtomatik <b>qoralama PO</b> yaratiladi (oxirgi yetkazib beruvchi bo'yicha). Ochiq buyurtmadagi dorilar takrorlanmaydi.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!s?.auto_reorder_enabled} onChange={(e) => mut.mutate({ auto_reorder_enabled: e.target.checked })} />
          Avto-reorder yoqilgan
        </label>
        <label className="flex items-center gap-2 text-xs">Soat (0–23)
          <Input className="h-8 w-20" defaultValue={String(s?.reorder_hour ?? 6)} onBlur={(e) => { const h = Number(e.target.value); if (h >= 0 && h <= 23) mut.mutate({ reorder_hour: h }); }} />
        </label>
      </CardContent>
    </Card>
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
