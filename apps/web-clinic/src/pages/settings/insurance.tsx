import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, ShieldCheck } from 'lucide-react';

import {
  Button, Card, CardContent, Badge, Input, EmptyState,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@clary/ui-web';

import { api } from '@/lib/api';

// =============================================================================
// Sug'urta shartnomalari (per-clinic, Layer 2). /settings/insurance.
// Markaziy direktoriyadan provider tanlab, copay% + qoplanadigan kategoriyalar.
// =============================================================================

type Contract = Awaited<ReturnType<typeof api.insurance.contracts>>[number];

function catName(n: unknown): string {
  if (n && typeof n === 'object') {
    const r = n as Record<string, string>;
    return r['uz-Latn'] ?? r.uz ?? r.ru ?? r.en ?? Object.values(r)[0] ?? '—';
  }
  return String(n ?? '—');
}

export function SettingsInsurancePage() {
  const { data: contracts } = useQuery({ queryKey: ['ins-contracts'], queryFn: () => api.insurance.contracts() });
  const [edit, setEdit] = useState<Contract | 'new' | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Sug'urta shartnomalari</h2>
          <p className="text-sm text-muted-foreground">Markaziy direktoriyadan provider tanlab, copay% va qoplanadigan xizmat kategoriyalarini belgilang.</p>
        </div>
        <Button onClick={() => setEdit('new')}><Plus className="mr-1.5 h-4 w-4" /> Yangi shartnoma</Button>
      </div>

      {(contracts ?? []).length === 0 ? (
        <EmptyState title="Shartnoma yo'q" description="«Yangi shartnoma» bilan sug'urta kompaniyasini bog'lang." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {contracts?.map((c) => (
            <Card key={c.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-blue-600" />
                    <span className="font-medium">{c.name}</span>
                    {c.provider && <Badge variant="secondary" className="text-[10px]">{c.provider.name}</Badge>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEdit(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  Copay: <b>{c.copay_percent}%</b> · Komissiya: {c.commission_percent}%
                  {c.max_benefit_uzs ? <> · Limit: {Number(c.max_benefit_uzs).toLocaleString('uz-UZ')} so'm</> : null}
                  <br />
                  Qoplanadi: {(c.covered_category_ids?.length ?? 0) === 0 ? 'barcha xizmatlar' : `${c.covered_category_ids.length} kategoriya`}
                  {c.contract_no ? ` · №${c.contract_no}` : ''}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {edit && <ContractDialog contract={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ContractDialog({ contract, onClose }: { contract: Contract | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: providers } = useQuery({ queryKey: ['ins-providers'], queryFn: () => api.insurance.providers() });
  const { data: cats } = useQuery({
    queryKey: ['catalog', 'service-categories'],
    queryFn: () => api.catalog.list('service-categories', { page: 1, pageSize: 200 }),
  });
  const categories = useMemo(
    () => (((cats as { items?: Array<{ id: string; name_i18n: unknown }> } | undefined)?.items) ?? []),
    [cats],
  );

  const [name, setName] = useState(contract?.name ?? '');
  const [providerId, setProviderId] = useState(contract?.provider_id ?? '');
  const [contractNo, setContractNo] = useState(contract?.contract_no ?? '');
  const [copay, setCopay] = useState(String(contract?.copay_percent ?? 0));
  const [commission, setCommission] = useState(String(contract?.commission_percent ?? 0));
  const [maxBenefit, setMaxBenefit] = useState(contract?.max_benefit_uzs == null ? '' : String(contract.max_benefit_uzs));
  const [start, setStart] = useState(contract?.contract_start ?? '');
  const [end, setEnd] = useState(contract?.contract_end ?? '');
  const [covered, setCovered] = useState<string[]>(contract?.covered_category_ids ?? []);

  const toggleCat = (id: string) =>
    setCovered((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const mut = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        provider_id: providerId || undefined,
        contract_no: contractNo || undefined,
        copay_percent: Number(copay) || 0,
        commission_percent: Number(commission) || 0,
        covered_category_ids: covered,
        contract_start: start || undefined,
        contract_end: end || undefined,
        max_benefit_uzs: maxBenefit ? Number(maxBenefit) : undefined,
      };
      if (contract) await api.insurance.updateContract(contract.id, body);
      else await api.insurance.createContract(body);
    },
    onSuccess: () => { toast.success('Saqlandi'); qc.invalidateQueries({ queryKey: ['ins-contracts'] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{contract ? 'Shartnomani tahrirlash' : 'Yangi sug\'urta shartnomasi'}</DialogTitle>
          <DialogDescription>Provider, copay% va qoplanadigan kategoriyalar. Kategoriya tanlanmasa — barcha xizmatlar qoplanadi.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          <label className="flex flex-col gap-1 text-xs">Nomi (klinikada ko'rinadi)
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Apex — Standart paket" />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-xs">Provider (direktoriya)
              <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="">— tanlang —</option>
                {providers?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="flex w-32 flex-col gap-1 text-xs">Shartnoma №
              <Input value={contractNo} onChange={(e) => setContractNo(e.target.value)} />
            </label>
          </div>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-xs">Copay (bemor %, 0–100)
              <Input value={copay} onChange={(e) => setCopay(e.target.value)} />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs">Komissiya (%)
              <Input value={commission} onChange={(e) => setCommission(e.target.value)} />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs">Max limit (so'm)
              <Input value={maxBenefit} onChange={(e) => setMaxBenefit(e.target.value)} placeholder="ixtiyoriy" />
            </label>
          </div>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-xs">Boshlanish
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs">Tugash
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-medium">Qoplanadigan kategoriyalar <span className="text-muted-foreground">(bo'sh = barchasi)</span></div>
            <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2">
              {categories.map((cat) => (
                <label key={cat.id} className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={covered.includes(cat.id)} onChange={() => toggleCat(cat.id)} />
                  {catName(cat.name_i18n)}
                </label>
              ))}
              {categories.length === 0 && <span className="text-xs text-muted-foreground">Kategoriya yo'q</span>}
            </div>
          </div>
          <Button className="w-full" disabled={!name.trim() || mut.isPending} onClick={() => mut.mutate()}>Saqlash</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
