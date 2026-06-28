import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building, Plus, Calculator, QrCode } from 'lucide-react';

import {
  PageHeader, Card, CardContent, Badge, Button, Input, EmptyState,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@clary/ui-web';

import { api } from '@/lib/api';

// =============================================================================
// QISM 2 / E2 — Asosiy vositalar (fixed assets) registri + amortizatsiya.
// =============================================================================
const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const CAT: Record<string, string> = { equipment: 'Uskuna', computer: 'Kompyuter', furniture: 'Mebel', vehicle: 'Transport', building: 'Bino', other: 'Boshqa' };
const ST: Record<string, { label: string; cls: string }> = {
  active: { label: 'Faol', cls: 'bg-emerald-500/15 text-emerald-600' },
  fully_depreciated: { label: 'To‘liq amortizatsiya', cls: 'bg-slate-500/15 text-slate-600' },
  disposed: { label: 'Chiqarilgan', cls: 'bg-rose-500/15 text-rose-600' },
};

export function FixedAssetsPage() {
  const qc = useQueryClient();
  const { data: assets } = useQuery({ queryKey: ['fixed-assets'], queryFn: () => api.fixedAssets.list() });
  const [addOpen, setAddOpen] = useState(false);

  const depMut = useMutation({
    mutationFn: () => api.fixedAssets.runDepreciation(),
    onSuccess: (r) => { toast.success(`Amortizatsiya: ${r.posted} ta vosita hisoblandi`); qc.invalidateQueries({ queryKey: ['fixed-assets'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalCost = (assets ?? []).reduce((s, a) => s + a.cost_uzs, 0);
  const totalNbv = (assets ?? []).reduce((s, a) => s + a.net_book_value_uzs, 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Asosiy vositalar" description="MRT/KT/UZI/kompyuter… registri + amortizatsiya (Dr 5300 / Cr 1590)." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-4 text-sm">
          <span>Jami xarid: <b>{fmt(totalCost)}</b></span>
          <span>Qoldiq qiymat (NBV): <b className="text-emerald-600">{fmt(totalNbv)}</b></span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => depMut.mutate()} disabled={depMut.isPending}><Calculator className="mr-1.5 h-4 w-4" /> Amortizatsiya hisoblash</Button>
          <Button onClick={() => setAddOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Yangi vosita</Button>
        </div>
      </div>

      {(assets ?? []).length === 0 ? (
        <EmptyState title="Vosita yo'q" description="«Yangi vosita» bilan asosiy vosita qo'shing." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-3">Nomi</th><th>Turi</th>
                  <th className="text-right">Xarid</th><th className="text-right">Amortizatsiya</th>
                  <th className="text-right">Qoldiq (NBV)</th><th>Holat</th><th className="p-3">QR</th>
                </tr>
              </thead>
              <tbody>
                {assets?.map((a) => {
                  const st = ST[a.status] ?? { label: a.status, cls: '' };
                  return (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="p-3 font-medium">{a.name}{a.location ? <span className="ml-1 text-xs text-muted-foreground">· {a.location}</span> : null}</td>
                      <td className="text-xs text-muted-foreground">{CAT[a.category] ?? a.category}</td>
                      <td className="text-right tabular-nums">{fmt(a.cost_uzs)}</td>
                      <td className="text-right tabular-nums text-rose-600">{fmt(a.accumulated_depreciation_uzs)}</td>
                      <td className="text-right font-semibold tabular-nums">{fmt(a.net_book_value_uzs)}</td>
                      <td><Badge variant="secondary" className={`text-[10px] ${st.cls}`}>{st.label}</Badge></td>
                      <td className="p-3"><span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground"><QrCode className="h-3.5 w-3.5" />{a.qr_code}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {addOpen && <AddAssetDialog onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ['fixed-assets'] }); }} />}
    </div>
  );
}

function AddAssetDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('equipment');
  const [cost, setCost] = useState('');
  const [residual, setResidual] = useState('0');
  const [life, setLife] = useState('60');
  const [location, setLocation] = useState('');
  const [capitalize, setCapitalize] = useState(false);

  const mut = useMutation({
    mutationFn: () => api.fixedAssets.create({
      name: name.trim(), category, cost_uzs: Number(cost || 0),
      residual_uzs: Number(residual || 0), useful_life_months: Number(life || 60),
      location: location || undefined, capitalize,
    }),
    onSuccess: () => { toast.success('Vosita qo\'shildi'); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const monthly = Number(cost || 0) > 0 && Number(life || 0) > 0
    ? Math.round((Number(cost) - Number(residual || 0)) / Number(life)) : 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Yangi asosiy vosita</DialogTitle>
          <DialogDescription>Amortizatsiya straight-line: (xarid − qoldiq) / muddat.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-xs">Nomi
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="MRT Siemens" />
          </label>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs">Turi
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="equipment">Uskuna</option><option value="computer">Kompyuter</option><option value="furniture">Mebel</option>
                <option value="vehicle">Transport</option><option value="building">Bino</option><option value="other">Boshqa</option>
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs">Joylashuv
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="2-qavat" />
            </label>
          </div>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs">Xarid narxi (UZS)
              <Input value={cost} onChange={(e) => setCost(e.target.value)} />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs">Qoldiq qiymat
              <Input value={residual} onChange={(e) => setResidual(e.target.value)} />
            </label>
            <label className="flex w-24 flex-col gap-1 text-xs">Muddat (oy)
              <Input value={life} onChange={(e) => setLife(e.target.value)} />
            </label>
          </div>
          {monthly > 0 && <div className="rounded-md bg-muted/40 p-2 text-xs">Oylik amortizatsiya ≈ <b>{fmt(monthly)}</b> so'm</div>}
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={capitalize} onChange={(e) => setCapitalize(e.target.checked)} />
            Kapitalizatsiya (Dr 1500 / Cr kassa) — agar xarid avval xarajatga yozilmagan bo'lsa
          </label>
          <Button className="w-full" disabled={!name.trim() || !(Number(cost) > 0) || mut.isPending} onClick={() => mut.mutate()}>Saqlash</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
