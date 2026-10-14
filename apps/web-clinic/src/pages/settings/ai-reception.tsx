import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  PageHeader,
  Textarea,
  cn,
} from '@clary/ui-web';
import type { AiPhoneLine, AiReceptionSettings, AiReceptionSettingsPatch } from '@clary/api-client';
import { Bot, Copy, PhoneForwarded, Plus, Send, Trash2 } from 'lucide-react';

import { api } from '@/lib/api';

// =============================================================================
// AI qabulxona — sozlamalar, telefon liniyalari + pereadresatsiya, Telegram
// havolasi va sinov suhbati.
// =============================================================================

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

/** GSM pereadresatsiya kodlari (3GPP TS 22.030) — barcha mobil operatorlarda. */
function forwardingCodes(target: string, seconds: number) {
  return [
    {
      label: `Javob bermasa (${seconds} soniyadan keyin)`,
      code: `**61*${target}**${seconds}#`,
      hint: 'Asosiy variant: qabulxona ulgurmasa — AI oladi',
    },
    { label: 'Band bo‘lsa', code: `**67*${target}#`, hint: 'Qabulxona boshqa qo‘ng‘iroqda' },
    {
      label: 'O‘chiq / aloqa yo‘q bo‘lsa',
      code: `**62*${target}#`,
      hint: 'Telefon o‘chiq yoki tarmoqsiz',
    },
    {
      label: 'Hammasi (shartsiz)',
      code: `**21*${target}#`,
      hint: 'Kechasi/dam olishda — barcha qo‘ng‘iroq to‘g‘ridan-to‘g‘ri AI’ga',
    },
    { label: 'Shartsizni o‘chirish', code: '##21#', hint: 'Ertalab ish boshlanganda' },
    { label: 'Hamma pereadresatsiyani o‘chirish', code: '##002#', hint: 'To‘liq bekor qilish' },
    { label: 'Holatni tekshirish', code: '*#61#', hint: 'Javob bermasa — yoqilganmi' },
  ];
}

function e164(phone: string | null | undefined): string | null {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (d.length === 9) return `+998${d}`;
  if (d.length === 12 && d.startsWith('998')) return `+${d}`;
  return null;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Nusxa olindi');
  } catch {
    toast.error('Nusxa olinmadi');
  }
}

export function SettingsAiReceptionPage() {
  const qc = useQueryClient();
  const overview = useQuery({
    queryKey: ['ai-reception', 'overview'],
    queryFn: () => api.aiReception.overview(),
  });
  const [form, setForm] = useState<AiReceptionSettingsPatch | null>(null);
  useEffect(() => {
    if (overview.data && !form) {
      const {
        clinic_id: _c,
        ai_allowed: _a,
        monthly_call_limit: _l,
        updated_at: _u,
        ...rest
      } = overview.data.settings;
      setForm(rest);
    }
  }, [overview.data, form]);

  const save = useMutation({
    mutationFn: (patch: AiReceptionSettingsPatch) => api.aiReception.saveSettings(patch),
    onSuccess: () => {
      toast.success('Saqlandi');
      qc.invalidateQueries({ queryKey: ['ai-reception'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (overview.isLoading || (!form && !overview.error)) {
    return <div className="text-muted-foreground text-sm">Yuklanmoqda…</div>;
  }
  if (overview.error || !overview.data || !form) {
    return (
      <Card>
        <CardContent className="text-destructive p-4 text-sm">
          {(overview.error as Error | null)?.message ?? 'Yuklab bo‘lmadi'}
        </CardContent>
      </Card>
    );
  }
  const o = overview.data;
  const set = <K extends keyof AiReceptionSettings>(k: K, v: AiReceptionSettings[K]) =>
    setForm((f) => ({ ...(f ?? {}), [k]: v }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="AI qabulxona"
        description="Klinika raqamiga qo‘ng‘iroq qilganda (qabulxona javob bermasa) AI shifokorlar jadvaliga qarab navbat beradi. Telegram botda ham ishlaydi."
        actions={
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
            Saqlash
          </Button>
        }
      />

      {/* Holat */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Rejim"
          value={MODE_LABEL[o.settings.mode]}
          tone={o.settings.mode === 'off' ? 'muted' : 'ok'}
        />
        <Stat
          label="AI (premium)"
          value={o.ai_effective ? 'Yoqilgan' : 'Yoqilmagan'}
          tone={o.ai_effective ? 'ok' : 'muted'}
        />
        <Stat label="Shu oy qo‘ng‘iroqlar" value={`${o.usage.calls} (AI: ${o.usage.ai_calls})`} />
        <Stat label="Yozilganlar (oy)" value={String(o.usage.booked)} />
        <Stat label="Taxminiy xarajat (oy)" value={`${fmt(o.usage.cost_uzs)} so‘m`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Rejim */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Qo‘ng‘iroqqa javob rejimi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(['off', 'voicemail', 'ai'] as const).map((m) => {
              const disabled = m === 'ai' && !o.ai_effective;
              return (
                <label
                  key={m}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-lg border p-3',
                    form.mode === m && 'border-primary bg-primary/5',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <input
                    type="radio"
                    name="mode"
                    className="accent-primary mt-1"
                    checked={form.mode === m}
                    disabled={disabled}
                    onChange={() => set('mode', m)}
                  />
                  <div>
                    <div className="text-sm font-semibold">{MODE_LABEL[m]}</div>
                    <div className="text-muted-foreground text-xs">{MODE_HINT[m]}</div>
                    {disabled && (
                      <div className="mt-1 text-xs text-amber-600">
                        Premium — yoqish uchun Clary bilan bog‘laning.
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
            <Field label="Ish vaqtidan tashqari (ish vaqti: Sozlamalar → Katalog → Ish vaqti)">
              <select
                className={selectCls}
                value={form.after_hours_mode}
                onChange={(e) => set('after_hours_mode', e.target.value as 'same' | 'voicemail')}
              >
                <option value="same">Xuddi shu rejim (AI kechasi ham yozadi)</option>
                <option value="voicemail">Ovozli xabar qoldirish</option>
              </select>
            </Field>
            <p className="text-muted-foreground text-xs">
              Navbat faqat “Shifokorlar jadvali”da online navbat ochilgan shifokorlarga beriladi.{' '}
              <Link to="/settings/doctor-schedules" className="text-primary underline">
                Jadvalni sozlash →
              </Link>
            </p>
          </CardContent>
        </Card>

        {/* AI yordamchi */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI yordamchi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ismi">
                <Input
                  value={form.assistant_name ?? ''}
                  maxLength={40}
                  onChange={(e) => set('assistant_name', e.target.value)}
                />
              </Field>
              <Field label="Odamga ulash raqami (ixtiyoriy)">
                <Input
                  placeholder="90 123 45 67"
                  value={form.transfer_phone ?? ''}
                  onChange={(e) => set('transfer_phone', e.target.value || null)}
                />
              </Field>
            </div>
            <p className="text-muted-foreground -mt-1 text-[11px]">
              ⚠️ Ulash raqami pereadresatsiya qilinayotgan asosiy raqam bo‘lmasin — javob bo‘lmasa
              yana AI’ga qaytib, aylanib qoladi. Masalan, administratorning shaxsiy raqami.
            </p>
            <Field label="Salomlashuv (bo‘sh qoldirsangiz — standart)">
              <Textarea
                rows={2}
                maxLength={500}
                placeholder={`Assalomu alaykum! ${o.clinic.name} klinikasi, men ${form.assistant_name || 'Malika'}, sun’iy intellekt yordamchisiman. Sizga qanday yordam bera olaman?`}
                value={form.greeting ?? ''}
                onChange={(e) => set('greeting', e.target.value || null)}
              />
            </Field>
            <Check
              label="Salomlashuvdan keyin “Можете говорить по-русски” deyilsin"
              checked={!!form.russian_hint}
              onChange={(v) => set('russian_hint', v)}
            />
            <Field label="Ovozli xabar matni (bo‘sh — standart)">
              <Textarea
                rows={2}
                maxLength={500}
                placeholder="Hozir barcha xodimlarimiz band. Signaldan keyin ismingiz va qaysi shifokorga yozilmoqchi ekaningizni ayting — tez orada o‘zimiz qo‘ng‘iroq qilamiz."
                value={form.voicemail_prompt ?? ''}
                onChange={(e) => set('voicemail_prompt', e.target.value || null)}
              />
            </Field>
            <Field label="AI bilishi kerak bo‘lgan qo‘shimcha ma’lumot">
              <Textarea
                rows={3}
                maxLength={2000}
                placeholder="Mo‘ljal: Chorsu metrosi yonida. Parkovka bor. To‘lov: naqd, karta, Click. Tahlil topshirishdan oldin och qoringa kelish kerak."
                value={form.extra_instructions ?? ''}
                onChange={(e) => set('extra_instructions', e.target.value || null)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Necha kun oldinga yozadi">
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={form.booking_horizon_days ?? 14}
                  onChange={(e) => set('booking_horizon_days', Number(e.target.value) || 14)}
                />
              </Field>
              <Field label="Eng yaqin vaqt (daqiqa keyin)">
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  value={form.min_lead_minutes ?? 60}
                  onChange={(e) => set('min_lead_minutes', Number(e.target.value) || 0)}
                />
              </Field>
              <Field label="Qo‘ng‘iroq chegarasi (soniya)">
                <Input
                  type="number"
                  min={60}
                  max={1200}
                  value={form.max_call_seconds ?? 300}
                  onChange={(e) => set('max_call_seconds', Number(e.target.value) || 300)}
                />
              </Field>
            </div>
            <Check
              label="Yangi bemorlarni ham yozsin (bazada yo‘q bo‘lsa karta ochiladi)"
              checked={!!form.allow_new_patients}
              onChange={(v) => set('allow_new_patients', v)}
            />
            <Check
              label="Qo‘ng‘iroqlarni yozib olish (tinglash uchun)"
              checked={!!form.record_calls}
              onChange={(v) => set('record_calls', v)}
            />
          </CardContent>
        </Card>

        {/* Xabarlar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasdiq, eslatma va xabarlar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Check
              label="Yozilgach bemorga Telegram’da tasdiq (bekor qilish tugmasi bilan)"
              checked={!!form.confirm_telegram}
              onChange={(v) => set('confirm_telegram', v)}
            />
            <Check
              label="Telegram bo‘lmasa — SMS tasdiq (Eskiz, pullik)"
              checked={!!form.confirm_sms}
              onChange={(v) => set('confirm_sms', v)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Check
                label="Qabuldan bir kun oldin eslatma, soat"
                checked={!!form.reminder_enabled}
                onChange={(v) => set('reminder_enabled', v)}
              />
              <Input
                type="number"
                min={6}
                max={21}
                className="h-8 w-20"
                value={form.reminder_hour ?? 18}
                onChange={(e) => set('reminder_hour', Number(e.target.value) || 18)}
              />
              <span className="text-muted-foreground text-xs">
                da (“Kelaman / Bekor qilish” tugmalari)
              </span>
            </div>
            <Check
              label="Eslatma Telegram bo‘lmasa SMS orqali"
              checked={!!form.reminder_sms}
              onChange={(v) => set('reminder_sms', v)}
            />
            <Check
              label="Kelmagan bemorlar (AI/Telegram yozgan) avtomatik “kelmadi” bo‘lsin"
              checked={!!form.mark_no_show}
              onChange={(v) => set('mark_no_show', v)}
            />
            <Check
              label="Har yangi navbat va qayta qo‘ng‘iroq so‘rovi egasining Telegram’iga"
              checked={!!form.notify_owner_telegram}
              onChange={(v) => set('notify_owner_telegram', v)}
            />
            <Check
              label="Telegram botda bemor erkin yozsa / ovozli xabar yuborsa — AI javob bersin (premium)"
              checked={!!form.telegram_ai_chat}
              onChange={(v) => set('telegram_ai_chat', v)}
            />
            <p className="text-muted-foreground text-[11px]">
              SMS uchun Eskiz kabinetida matn shablonini tasdiqlatish kerak (O‘zbekiston talabi).
            </p>
          </CardContent>
        </Card>

        <TelegramCard link={o.telegram_link} bot={o.telegram_bot} />
      </div>

      <LinesCard lines={o.lines} clinicPhone={o.clinic.phone} />
      <SimulatorCard enabled={o.ai_effective} model={o.model} />
    </div>
  );
}

const MODE_LABEL: Record<AiReceptionSettings['mode'], string> = {
  off: 'O‘chiq',
  voicemail: 'Ovozli xabar (bepul)',
  ai: 'AI suhbat — avtomatik navbat',
};
const MODE_HINT: Record<AiReceptionSettings['mode'], string> = {
  off: 'Qo‘ng‘iroqqa javob berilmaydi.',
  voicemail:
    'Bemor ismi va kerakli shifokorni aytib xabar qoldiradi → “Qo‘ng‘iroqlar” bo‘limida yozuv paydo bo‘ladi, qabulxona qayta qo‘ng‘iroq qiladi. AI xarajati yo‘q.',
  ai: 'AI bemor bilan o‘zbek/rus tilida gaplashadi, shifokor jadvalidan bo‘sh vaqt topib yozadi, bekor qiladi, narx aytadi.',
};

const selectCls = 'border-input bg-background h-9 w-full rounded-md border px-2 text-sm';

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'muted' }) {
  return (
    <div className="bg-card rounded-xl border p-3">
      <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 text-sm font-semibold',
          tone === 'ok' && 'text-emerald-600',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-muted-foreground text-xs font-medium">{label}</label>
      {children}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="accent-primary mt-0.5 h-4 w-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function TelegramCard({ link, bot }: { link: string | null; bot: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Telegram orqali navbat (bepul)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {link ? (
          <div className="flex gap-4">
            <QRCodeSVG value={link} size={112} />
            <div className="min-w-0 space-y-2">
              <p className="text-muted-foreground text-xs">
                Bu havola/QR’ni saytingiz, Instagram, eshik va chekka qo‘ying. Bemor bosadi →
                raqamini tasdiqlaydi → mutaxassislik, shifokor, kun va soatni tanlab o‘zi yoziladi.
              </p>
              <div className="flex items-center gap-2">
                <code className="bg-muted truncate rounded px-2 py-1 text-xs">{link}</code>
                <Button size="sm" variant="outline" onClick={() => copy(link)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            {bot
              ? 'Klinika qisqa nomi (slug) topilmadi.'
              : 'Bemor boti sozlanmagan (serverda TELEGRAM_PATIENT_BOT_TOKEN).'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function LinesCard({ lines, clinicPhone }: { lines: AiPhoneLine[]; clinicPhone: string | null }) {
  const qc = useQueryClient();
  const [lineKey, setLineKey] = useState('');
  const [aiNumber, setAiNumber] = useState('');
  const [from, setFrom] = useState(clinicPhone ?? '');
  const [label, setLabel] = useState('');
  const [seconds, setSeconds] = useState(20);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['ai-reception'] });
  const create = useMutation({
    mutationFn: () =>
      api.aiReception.createLine({
        line_key: lineKey.trim(),
        phone_number: aiNumber.trim() || null,
        forwarded_from: from.trim() || null,
        label: label.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Liniya qo‘shildi');
      setLineKey('');
      setAiNumber('');
      setLabel('');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (l: AiPhoneLine) => api.aiReception.updateLine(l.id, { is_active: !l.is_active }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.aiReception.deleteLine(id),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const target = lines.map((l) => e164(l.phone_number)).find(Boolean) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PhoneForwarded className="h-4 w-4" />
          Telefon liniyasi va pereadresatsiya
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-muted-foreground space-y-1 text-xs">
          <p>
            <b>Qanday ishlaydi:</b> bemorlar biladigan <b>hozirgi raqamingiz</b> o‘zgarmaydi. Unga
            “javob bermasa → AI raqamiga o‘tkazish” (pereadresatsiya) qo‘yiladi. Qabulxona 15–20
            soniyada olmasa yoki band bo‘lsa, qo‘ng‘iroq AI liniyasiga o‘tadi.
          </p>
          <p>
            <b>AI liniyasi</b> — Clary serveriga ulangan raqam: GSM-shlyuzdagi SIM karta (liniya
            kaliti
            <code className="mx-1">goip1</code>) yoki operator SIP raqami (kalit — raqamning o‘zi).
            Uni Clary texnik jamoasi beradi.
          </p>
        </div>

        {lines.length > 0 && (
          <div className="divide-y rounded-lg border">
            {lines.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-3 p-2 text-sm">
                <Badge variant={l.is_active ? 'success' : 'outline'}>
                  {l.is_active ? 'Faol' : 'O‘chiq'}
                </Badge>
                <code className="text-xs">{l.line_key}</code>
                <span>AI raqami: {l.phone_number ?? '—'}</span>
                <span className="text-muted-foreground">
                  ← {l.forwarded_from ?? 'asosiy raqam'}
                </span>
                {l.label && <span className="text-muted-foreground">· {l.label}</span>}
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => toggle.mutate(l)}>
                    {l.is_active ? 'O‘chirish' : 'Yoqish'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(l.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-5">
          <Field label="Liniya kaliti *">
            <Input
              placeholder="goip1 yoki 712000000"
              value={lineKey}
              onChange={(e) => setLineKey(e.target.value)}
            />
          </Field>
          <Field label="AI liniya raqami">
            <Input
              placeholder="+998 90 000 00 00"
              value={aiNumber}
              onChange={(e) => setAiNumber(e.target.value)}
            />
          </Field>
          <Field label="Asosiy (pereadresatsiya qilinadigan) raqam">
            <Input value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Izoh">
            <Input
              placeholder="Beeline SIM"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button onClick={() => create.mutate()} disabled={!lineKey.trim() || create.isPending}>
              <Plus className="mr-1 h-4 w-4" />
              Qo‘shish
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-amber-50/40 p-3 dark:bg-amber-500/5">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
            Pereadresatsiyani yoqish (asosiy raqam telefonida teriladi)
            <span className="text-muted-foreground text-xs font-normal">kutish:</span>
            <select
              className="border-input bg-background h-7 rounded border px-1 text-xs"
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
            >
              {[5, 10, 15, 20, 25, 30].map((s) => (
                <option key={s} value={s}>
                  {s} s
                </option>
              ))}
            </select>
          </div>
          {target ? (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {forwardingCodes(target, seconds).map((c) => (
                <div
                  key={c.code}
                  className="bg-background flex items-center gap-2 rounded border px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium">{c.label}</div>
                    <div className="text-muted-foreground text-[11px]">{c.hint}</div>
                  </div>
                  <code className="text-sm font-semibold">{c.code}</code>
                  <Button size="sm" variant="ghost" onClick={() => copy(c.code)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              Kodlar chiqishi uchun liniyaga AI raqamini kiriting.
            </p>
          )}
          <ul className="text-muted-foreground mt-2 list-disc space-y-0.5 pl-5 text-[11px]">
            <li>Kod telefonda terilib, qo‘ng‘iroq tugmasi bosiladi; ekranda “yoqildi” chiqadi.</li>
            <li>
              Shahar raqami (Uztelecom) bo‘lsa — “Переадресация” xizmati operator orqali yoqiladi
              (ofisda yoki 1093). Ofis ATS’i bo‘lsa — ATS sozlamasida.
            </li>
            <li>
              O‘tkazilgan qo‘ng‘iroq daqiqasi odatda <b>asosiy raqam</b> hisobidan yechiladi. AI SIM
              bir operatorda bo‘lsa (masalan, ikkalasi Beeline) — tarif ichidagi bepul daqiqalar
              ishlaydi.
            </li>
            <li>Yoqilgach, boshqa telefondan qo‘ng‘iroq qilib, javob bermay sinab ko‘ring.</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

type ChatLine = { who: 'agent' | 'me'; text: string };

function SimulatorCard({ enabled, model }: { enabled: boolean; model: string }) {
  const [callId, setCallId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [text, setText] = useState('');
  const [phone, setPhone] = useState('');
  const [ended, setEnded] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [lines]);

  const start = useMutation({
    mutationFn: () => api.aiReception.simulateStart({ caller_phone: phone.trim() || null }),
    onSuccess: (r) => {
      setCallId(r.call_id);
      setEnded(false);
      setLines([{ who: 'agent', text: r.greeting }]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const turn = useMutation({
    mutationFn: (t: string) => api.aiReception.simulateTurn({ call_id: callId!, text: t }),
    onSuccess: (r) => {
      setLines((l) => [...l, { who: 'agent', text: r.say }]);
      if (r.end) setEnded(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const send = () => {
    const t = text.trim();
    if (!t || !callId || turn.isPending) return;
    setLines((l) => [...l, { who: 'me', text: t }]);
    setText('');
    turn.mutate(t);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4" />
          Sinov suhbati
          <span className="text-muted-foreground text-xs font-normal">
            (telefonsiz — yozib sinang; navbat bazaga YOZILMAYDI) · model: {model}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!enabled ? (
          <p className="text-muted-foreground text-sm">
            AI premium yoqilgach sinab ko‘rish mumkin.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Qo‘ng‘iroq qiluvchi raqami (ixtiyoriy)">
                <Input
                  placeholder="90 123 45 67"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
              <Button variant="outline" onClick={() => start.mutate()} disabled={start.isPending}>
                {callId ? 'Yangi suhbat' : 'Boshlash'}
              </Button>
            </div>
            {callId && (
              <>
                <div className="bg-muted/30 h-80 space-y-2 overflow-y-auto rounded-lg border p-3">
                  {lines.map((l, i) => (
                    <div
                      key={i}
                      className={cn('flex', l.who === 'me' ? 'justify-end' : 'justify-start')}
                    >
                      <div
                        className={cn(
                          'max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm',
                          l.who === 'me'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background border',
                        )}
                      >
                        {l.text}
                      </div>
                    </div>
                  ))}
                  {turn.isPending && (
                    <div className="text-muted-foreground text-xs">AI yozmoqda…</div>
                  )}
                  {ended && (
                    <div className="text-muted-foreground text-center text-xs">
                      — suhbat tugadi —
                    </div>
                  )}
                  <div ref={bottom} />
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Masalan: Kardiologga yozilmoqchiman, ertaga bo‘ladimi?"
                    value={text}
                    disabled={ended}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && send()}
                  />
                  <Button onClick={send} disabled={!text.trim() || turn.isPending || ended}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
