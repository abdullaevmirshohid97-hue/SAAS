import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Card, CardHeader, CardTitle, CardContent, Badge } from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';

interface Secret {
  id: string;
  provider_kind: string;
  provider_name: string;
  label: string;
  is_primary: boolean;
  last_test_succeeded?: boolean;
}

interface ProviderDef {
  kind: 'payment' | 'sms' | 'email';
  name: string;
  label: string;
  fields: string[];
  hint?: string;
  mockOnly?: boolean;
}

const PROVIDERS: ProviderDef[] = [
  { kind: 'payment', name: 'click', label: 'Click.uz', fields: ['service_id', 'secret_key', 'merchant_id', 'merchant_user_id'] },
  { kind: 'payment', name: 'payme', label: 'Payme.uz', fields: ['merchant_id', 'key'] },
  { kind: 'payment', name: 'uzum',  label: 'Uzum Bank', fields: ['api_key', 'terminal_id'] },
  { kind: 'payment', name: 'mbank', label: 'MBANK',     fields: ['merchant_id', 'terminal_id', 'secret_key', 'mode'], hint: "Hozircha faqat mock rejim. `mode` = mock qoldiring.", mockOnly: true },
  { kind: 'payment', name: 'stripe',label: 'Stripe',    fields: ['secret_key'] },
  { kind: 'sms',     name: 'eskiz', label: 'Eskiz SMS', fields: ['email', 'password'] },
  { kind: 'sms',     name: 'playmobile', label: 'Playmobile', fields: ['login', 'password'] },
  { kind: 'email',   name: 'resend', label: 'Resend', fields: ['api_key'] },
];

export function SettingsIntegrationsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['vault'], queryFn: () => api.vault.list() });
  const secrets = (data ?? []) as Secret[];

  const [selected, setSelected] = useState<ProviderDef | null>(null);
  const [creds, setCreds] = useState<Record<string, string>>({});

  const addMut = useMutation({
    mutationFn: () => api.vault.create({
      provider_kind: selected?.kind,
      provider_name: selected?.name,
      label: `${selected?.label} (primary)`,
      is_primary: true,
      secret_value: JSON.stringify(creds),
    }),
    onSuccess: () => { toast.success('Qo’shildi'); setSelected(null); setCreds({}); qc.invalidateQueries({ queryKey: ['vault'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => api.vault.test(id),
    onSuccess: (r) => { toast[(r as { success: boolean }).success ? 'success' : 'error']((r as { success: boolean }).success ? 'Ulanish OK' : 'Xato'); },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Integratsiyalar (BYO API kalitlar)</h2>
      <p className="text-sm text-muted-foreground">Har bir klinika o’z to’lov va SMS provayderlariga ulanadi. Kalitlar shifrlangan holda Supabase Vault’da saqlanadi.</p>

      <div className="grid gap-3 md:grid-cols-2">
        {PROVIDERS.map((p) => {
          const existing = secrets.find((s) => s.provider_name === p.name && s.provider_kind === p.kind);
          return (
            <Card key={`${p.kind}-${p.name}`}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    {p.label}
                    {p.mockOnly && <Badge variant="outline">Sandbox</Badge>}
                  </span>
                  {existing ? (
                    <Badge variant={existing.last_test_succeeded ? 'success' : 'secondary'}>
                      {existing.last_test_succeeded ? 'Ulangan' : 'Ulanmagan'}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Ulanmagan</Badge>
                  )}
                </CardTitle>
                {p.hint && <p className="pt-1 text-xs text-muted-foreground">{p.hint}</p>}
              </CardHeader>
              <CardContent className="flex gap-2">
                {existing ? (
                  <Button variant="outline" size="sm" onClick={() => testMut.mutate(existing.id)}>Ulanishni sinab ko’rish</Button>
                ) : (
                  <Button size="sm" onClick={() => { setSelected(p); setCreds(p.mockOnly ? { mode: 'mock' } : {}); }}>Ulash</Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {selected && (
        <Card>
          <CardHeader><CardTitle>{selected.label} ulash</CardTitle></CardHeader>
          <CardContent className="space-y-3 max-w-md">
            {selected.fields.map((f) => (
              <div key={f}>
                <label className="text-sm capitalize">{f.replace(/_/g, ' ')}</label>
                <Input value={creds[f] ?? ''} onChange={(e) => setCreds({ ...creds, [f]: e.target.value })} type={f.includes('secret') || f.includes('password') || f.includes('key') ? 'password' : 'text'} />
              </div>
            ))}
            <div className="flex gap-2">
              <Button onClick={() => addMut.mutate()} disabled={addMut.isPending}>Saqlash va sinash</Button>
              <Button variant="ghost" onClick={() => setSelected(null)}>Bekor qilish</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
