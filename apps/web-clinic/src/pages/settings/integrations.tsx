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
  kind: 'payment' | 'sms' | 'email' | 'ai';
  name: string;
  label: string;
  fields: string[];
  hint?: string;
  mockOnly?: boolean;
}

const PROVIDERS: ProviderDef[] = [
  { kind: 'payment', name: 'click', label: 'Click.uz', fields: ['service_id', 'secret_key', 'merchant_id', 'merchant_user_id'] },
  { kind: 'payment', name: 'payme', label: 'Payme.uz', fields: ['merchant_id', 'key'] },
  { kind: 'payment', name: 'uzum',  label: 'Uzum Bank', fields: ['api_key', 'terminal_id'], hint: 'Tez kunda — adapter hozircha real to‘lovni qo‘llab-quvvatlamaydi.', mockOnly: true },
  { kind: 'payment', name: 'mbank', label: 'MBANK',     fields: ['merchant_id', 'terminal_id', 'secret_key', 'mode'], hint: "Hozircha faqat mock rejim. `mode` = mock qoldiring.", mockOnly: true },
  { kind: 'sms',     name: 'eskiz', label: 'Eskiz SMS', fields: ['email', 'password'] },
  { kind: 'sms',     name: 'playmobile', label: 'Playmobile', fields: ['login', 'password'] },
  { kind: 'email',   name: 'resend', label: 'Resend', fields: ['api_key'] },
  {
    kind: 'ai',
    name: 'anthropic',
    label: 'Anthropic AI',
    fields: ['api_key'],
    hint: 'Dashboard AI tavsiya va ICD-10 avtomatik kodlash uchun. console.anthropic.com → API Keys → sk-ant-... boshlanadigan kalitni nusxalang.',
  },
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

      {/* Telegram bot — mijozlarga tahlil/eslatma xabarlari uchun */}
      <TelegramBotCard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Telegram bot — har klinika o'z botini @BotFather'dan ro'yxatdan o'tkazadi.
// Bot orqali bemorlarga lab natija, eslatma va boshqa xabarlar yuboriladi.
// ---------------------------------------------------------------------------
function TelegramBotCard() {
  const qc = useQueryClient();
  const { data: bot } = useQuery({
    queryKey: ['telegram-bot'],
    queryFn: () => api.telegram.getBot(),
  });

  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');

  const registerMut = useMutation({
    mutationFn: () =>
      api.telegram.registerBot({ bot_token: token.trim(), bot_username: username.trim() }),
    onSuccess: () => {
      toast.success('Telegram bot ulandi');
      setToken('');
      setUsername('');
      qc.invalidateQueries({ queryKey: ['telegram-bot'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unregisterMut = useMutation({
    mutationFn: () => api.telegram.unregisterBot(),
    onSuccess: () => {
      toast.success('Telegram bot o‘chirildi');
      qc.invalidateQueries({ queryKey: ['telegram-bot'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>Telegram bot</span>
          {bot ? (
            <Badge variant="success">Ulangan</Badge>
          ) : (
            <Badge variant="outline">Ulanmagan</Badge>
          )}
        </CardTitle>
        <p className="pt-1 text-xs text-muted-foreground">
          Bemorlarga tahlil natijalari va eslatmalar Telegram orqali yuboriladi.
          Bot @BotFather&apos;dan olinadi.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {bot ? (
          <>
            <div className="text-sm">
              Ulangan bot:{' '}
              <span className="font-mono font-semibold">
                @{(bot as { bot_username: string }).bot_username}
              </span>
            </div>
            <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
              Bemor botga ulanish uchun unga{' '}
              <code className="rounded bg-background px-1">/start +998901234567</code>{' '}
              shaklida o&apos;z telefon raqamini yuboradi (klinikada ro&apos;yxatdan
              o&apos;tgan raqam).
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => unregisterMut.mutate()}
              disabled={unregisterMut.isPending}
            >
              Botni o&apos;chirish
            </Button>
          </>
        ) : (
          <div className="max-w-md space-y-3">
            <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
              1. Telegram&apos;da{' '}
              <span className="font-mono">@BotFather</span>&apos;ga{' '}
              <code className="rounded bg-background px-1">/newbot</code> yuboring.
              <br />
              2. Bot nomi va username&apos;ni tanlang (username{' '}
              <span className="font-mono">_bot</span> bilan tugashi kerak).
              <br />
              3. BotFather bergan tokenni va username&apos;ni quyiga kiriting.
            </div>
            <div>
              <label className="text-sm">Bot token</label>
              <Input
                type="password"
                placeholder="123456789:ABCdef..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm">Bot username</label>
              <Input
                placeholder="myclinic_bot"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              onClick={() => registerMut.mutate()}
              disabled={registerMut.isPending || !token.trim() || !username.trim()}
            >
              {registerMut.isPending ? 'Ulanmoqda…' : 'Botni ulash'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
