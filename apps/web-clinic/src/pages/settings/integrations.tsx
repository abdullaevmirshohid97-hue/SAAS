import { useState } from 'react';
import { Link } from 'react-router-dom';
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

      {/* Sug'urta — markaziy direktoriya/API (Clary boshqaradi) + klinika shartnomalari */}
      <InsuranceIntegrationCard />

      {/* Telegram bot — mijozlarga tahlil/eslatma xabarlari uchun */}
      <TelegramBotCard />

      {/* Hisobot bot — klinika egasi uchun smena/kassa/kunlik hisobotlar */}
      <ReportBotCard />

      {/* Umumiy Clary bot — bemorlar @ClaryAppBot orqali kiradi */}
      <PublicBotInfoCard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hisobot bot — klinika EGASI uchun: smena ochilish/yopilish, muhim kassa
// amaliyotlari, kunlik hisobot (23:55) va kunlik backup CSV Telegram'da.
// Token super-admindan olinadi (markaziy botdan ro'yxatdan o'tib tasdiqlangach).
// ---------------------------------------------------------------------------
const REPORT_EVENTS: Array<{ key: 'shift' | 'encash' | 'expense' | 'refund' | 'safe'; label: string }> = [
  { key: 'shift', label: 'Smena ochilish/yopilish' },
  { key: 'encash', label: 'Inkassatsiya' },
  { key: 'expense', label: 'Rasxot' },
  { key: 'refund', label: 'Qaytarish (refund)' },
  { key: 'safe', label: 'Seyf amallari / tuzatishlar' },
];

function ReportBotCard() {
  const qc = useQueryClient();
  const { data: bot } = useQuery({
    queryKey: ['telegram-report-bot'],
    queryFn: () => api.telegramReports.getBot(),
  });
  const { data: chats } = useQuery({
    queryKey: ['telegram-report-chats'],
    queryFn: () => api.telegramReports.listChats(),
    enabled: !!bot,
  });

  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['telegram-report-bot'] });
    qc.invalidateQueries({ queryKey: ['telegram-report-chats'] });
  };

  const registerMut = useMutation({
    mutationFn: () =>
      api.telegramReports.registerBot({ bot_token: token.trim(), bot_username: username.trim() }),
    onSuccess: () => {
      toast.success("Hisobot bot ulandi — endi bog'lanish kodini botga yuboring");
      setToken('');
      setUsername('');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unregisterMut = useMutation({
    mutationFn: () => api.telegramReports.unregisterBot(),
    onSuccess: () => {
      toast.success("Hisobot bot o'chirildi");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bindCodeMut = useMutation({
    mutationFn: () => api.telegramReports.newBindCode(),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeChatMut = useMutation({
    mutationFn: (id: string) => api.telegramReports.removeChat(id),
    onSuccess: () => {
      toast.success('Chat uzildi');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eventsMut = useMutation({
    mutationFn: (patch: Partial<Record<'shift' | 'encash' | 'expense' | 'refund' | 'safe', boolean>>) =>
      api.telegramReports.updateEvents(patch),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const codeValid =
    bot?.bind_code &&
    bot.bind_code_expires_at &&
    new Date(bot.bind_code_expires_at) > new Date();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>📊 Hisobot bot (klinika egasi uchun)</span>
          {bot ? <Badge variant="success">Ulangan</Badge> : <Badge variant="outline">Ulanmagan</Badge>}
        </CardTitle>
        <p className="pt-1 text-xs text-muted-foreground">
          Egaga Telegram orqali: smena yopilish summary, muhim kassa amaliyotlari,
          har kuni 23:55 da kunlik hisobot (kassa/qabul/dorixona) + backup CSV.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {bot ? (
          <>
            <div className="text-sm">
              Ulangan bot:{' '}
              <span className="font-mono font-semibold">@{bot.bot_username}</span>
            </div>

            {/* Bog'lanish kodi */}
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Egani bog&apos;lash — botga quyidagicha yozsin:
              </div>
              {codeValid ? (
                <div className="flex items-center gap-3">
                  <code className="rounded bg-background px-2 py-1 font-mono text-base font-bold">
                    /start {bot.bind_code}
                  </code>
                  <span className="text-xs text-muted-foreground">
                    {new Date(bot.bind_code_expires_at!).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })} gacha amal qiladi
                  </span>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Kod muddati o&apos;tgan yoki ishlatilgan</div>
              )}
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => bindCodeMut.mutate()}
                disabled={bindCodeMut.isPending}
              >
                Yangi kod olish
              </Button>
            </div>

            {/* Bog'langan chatlar */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Bog&apos;langan egalar:</div>
              {(chats ?? []).length === 0 ? (
                <div className="text-xs text-muted-foreground">Hali hech kim bog&apos;lanmagan</div>
              ) : (
                (chats ?? []).map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded border px-2 py-1 text-sm">
                    <span>
                      {c.first_name ?? '—'}
                      {c.username ? <span className="ml-1 text-xs text-muted-foreground">@{c.username}</span> : null}
                    </span>
                    <button
                      className="text-xs text-rose-600 hover:underline"
                      onClick={() => removeChatMut.mutate(c.id)}
                    >
                      uzish
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Hodisa toggle'lari */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Qaysi hodisalar yuborilsin:</div>
              <div className="flex flex-wrap gap-3">
                {REPORT_EVENTS.map((ev) => (
                  <label key={ev.key} className="flex cursor-pointer items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={bot.events?.[ev.key] !== false}
                      onChange={(e) => eventsMut.mutate({ [ev.key]: e.target.checked })}
                    />
                    {ev.label}
                  </label>
                ))}
              </div>
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
            <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
              Token olish: Telegram&apos;da <span className="font-mono">@ClaryHisobotBot</span>ga
              /start yuborib ro&apos;yxatdan o&apos;ting — Clary administratori tasdiqlagach sizga
              klinikangiz uchun bot token beriladi va quyiga kiritasiz.
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
                placeholder="myclinic_hisobot_bot"
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

// ---------------------------------------------------------------------------
// Umumiy Clary bot (faqat axborot — Clary tomonidan boshqariladi)
// ---------------------------------------------------------------------------
function PublicBotInfoCard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>🤖 Clary umumiy bot (bemorlar uchun)</span>
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            Faol
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Bemorlar <code className="rounded bg-muted px-1 font-mono text-xs">@ClaryAppBot</code>
          {' '}orqali kirib, klinikangizni topadilar va o'z akkauntiga login qiladilar. Login
          muvaffaqiyatli bo'lgach, ular bildirishnomalarni Telegram orqali oladilar
          (qabul, to'lov, tahlil natijasi, statsionar holati).
        </p>
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          ⚠ Bu bot Clary tomonidan boshqariladi — siz token kiritmaysiz. Sozlash kod orqali
          amalga oshiriladi (super_admin paneldan).
        </div>
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs">
          <div className="mb-1 font-medium">Bemorlar uchun login akkaunt yaratish:</div>
          <ol className="ml-4 list-decimal space-y-0.5 text-muted-foreground">
            <li>Bemorlar sahifasiga o'ting → bemor kartasini oching</li>
            <li>"Telegram bot kirishi" bo'limidan "Akkaunt yaratish" tugmasini bosing</li>
            <li>Username va parolni bemorga toping (Nusxalash tugmasi yordamida)</li>
            <li>Bemorga <code className="rounded bg-muted px-1">@ClaryAppBot</code> ga kirib, login qilish kerakligini tushuntiring</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sug'urta — API ulanishi MARKAZIY (super-admin direktoriyada). Bu yerda klinika
// faqat o'z shartnomalari va ularning rejimini (manual/API) ko'radi + sozlamaga link.
// ---------------------------------------------------------------------------
function InsuranceIntegrationCard() {
  const { data: contracts } = useQuery({ queryKey: ['ins-contracts-integ'], queryFn: () => api.insurance.contracts() });
  const list = contracts ?? [];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>🛡️ Sug‘urta (insurance)</span>
          <Badge variant="outline">Markaziy</Badge>
        </CardTitle>
        <p className="pt-1 text-xs text-muted-foreground">
          Sug‘urta kompaniyalari direktoriyasi va API ulanishi Clary tomonidan markazda boshqariladi
          (bitta integratsiya barcha klinikalarga). Siz faqat shartnoma — copay% va qoplanadigan
          kategoriyalarni — bog‘laysiz. Hozircha aksariyat kompaniyalar manual rejimda.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {list.length === 0 ? (
          <div className="text-sm text-muted-foreground">Hali sug‘urta shartnomasi bog‘lanmagan.</div>
        ) : (
          list.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded border px-2 py-1.5 text-sm">
              <span>
                {c.name}
                {c.provider ? <span className="ml-1 text-xs text-muted-foreground">· {c.provider.name}</span> : null}
              </span>
              {c.provider?.integration_mode === 'api'
                ? <Badge variant="success">API ulangan</Badge>
                : <Badge variant="secondary">Manual</Badge>}
            </div>
          ))
        )}
        <Link to="/settings/insurance">
          <Button size="sm" variant="outline">Sug‘urta sozlamalari →</Button>
        </Link>
      </CardContent>
    </Card>
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
