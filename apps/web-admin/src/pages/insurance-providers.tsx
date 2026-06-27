import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input, Label } from '@clary/ui-web';
import { Save, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

type Provider = Awaited<ReturnType<typeof api.admin.listInsuranceProviders>>[number];

export function InsuranceProvidersPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin', 'insurance-providers'], queryFn: () => api.admin.listInsuranceProviders() });
  const providers = data ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'insurance-providers'] });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Sug'urta kompaniyalari (direktoriya)</h1>
        <p className="text-sm text-muted-foreground">
          Markaziy ro'yxat — barcha klinikalar shu yerdan tanlab shartnoma bog'laydi. Integratsiya bir marta.
        </p>
      </div>

      <NewProviderForm onCreated={invalidate} />

      <div className="grid gap-3 md:grid-cols-2">
        {providers.map((p) => <ProviderCard key={p.id} provider={p} onSaved={invalidate} />)}
      </div>
    </div>
  );
}

function NewProviderForm({ onCreated }: { onCreated: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('dms');
  const mut = useMutation({
    mutationFn: () => api.admin.createInsuranceProvider({ code: code.trim(), name: name.trim(), type }),
    onSuccess: () => { toast.success('Qo\'shildi'); setCode(''); setName(''); onCreated(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-2 p-4">
        <div className="space-y-1.5">
          <Label>Kod</Label>
          <Input className="w-32" value={code} onChange={(e) => setCode(e.target.value)} placeholder="apex" />
        </div>
        <div className="space-y-1.5 flex-1 min-w-[180px]">
          <Label>Nomi</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Apex Insurance" />
        </div>
        <div className="space-y-1.5">
          <Label>Turi</Label>
          <select value={type} onChange={(e) => setType(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="dms">DMS</option><option value="oms">OMS</option><option value="other">Boshqa</option>
          </select>
        </div>
        <Button className="gap-1.5" disabled={!code.trim() || !name.trim() || mut.isPending} onClick={() => mut.mutate()}>
          <Plus className="h-4 w-4" /> Qo'shish
        </Button>
      </CardContent>
    </Card>
  );
}

function ProviderCard({ provider, onSaved }: { provider: Provider; onSaved: () => void }) {
  const [name, setName] = useState(provider.name);
  const [legalName, setLegalName] = useState(provider.legal_name ?? '');
  const [type, setType] = useState(provider.type);
  const [phone, setPhone] = useState(provider.phone ?? '');
  const [email, setEmail] = useState(provider.email ?? '');
  const [website, setWebsite] = useState(provider.website ?? '');
  const [isActive, setIsActive] = useState(provider.is_active);
  const [sortOrder, setSortOrder] = useState(String(provider.sort_order));

  useEffect(() => {
    setName(provider.name); setLegalName(provider.legal_name ?? ''); setType(provider.type);
    setPhone(provider.phone ?? ''); setEmail(provider.email ?? ''); setWebsite(provider.website ?? '');
    setIsActive(provider.is_active); setSortOrder(String(provider.sort_order));
  }, [provider]);

  const saveMut = useMutation({
    mutationFn: () => api.admin.updateInsuranceProvider(provider.id, {
      name, legal_name: legalName || null, type, phone: phone || null, email: email || null,
      website: website || null, is_active: isActive, sort_order: Number(sortOrder) || 0,
    }),
    onSuccess: () => { toast.success('Saqlandi'); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{provider.code}</Badge>
            {isActive ? <Badge variant="success">Faol</Badge> : <Badge variant="destructive">Nofaol</Badge>}
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Faol
          </label>
        </div>

        <div className="space-y-1.5"><Label>Nomi</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Yuridik nomi</Label><Input value={legalName} onChange={(e) => setLegalName(e.target.value)} /></div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Turi</Label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="dms">DMS</option><option value="oms">OMS</option><option value="other">Boshqa</option>
            </select>
          </div>
          <div className="space-y-1.5"><Label>Tartib</Label><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Telefon</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label>Veb-sayt</Label><Input value={website} onChange={(e) => setWebsite(e.target.value)} /></div>

        <Button className="w-full gap-1.5" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          <Save className="h-4 w-4" /> Saqlash
        </Button>
      </CardContent>
    </Card>
  );
}
