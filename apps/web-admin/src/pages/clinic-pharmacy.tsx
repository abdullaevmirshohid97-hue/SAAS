import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarPlus,
  Copy,
  KeyRound,
  Laptop,
  Pause,
  Pill,
  Play,
  Save,
  Users,
  XCircle,
} from 'lucide-react';
import { Badge, Button, Input, Label, Textarea } from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';

// =============================================================================
// Super admin → klinika → "Dorixona": alohida dorixona modulini biriktirish.
// Klinika tanlanadi → dorixona Gmail'i + muddat → faollashadi. Tarif
// 300 000 so'm/oy (o'zgartirish mumkin), 3 qurilma. Klinika obunasi va klinika
// ichidagi dorixona tabiga TA'SIR QILMAYDI.
// =============================================================================

const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('uz-UZ');
const MONTHS = [
  { m: 1, d: 0 },
  { m: 3, d: 5 },
  { m: 6, d: 10 },
  { m: 12, d: 20 },
];
const ACTION_LABEL: Record<string, string> = {
  attach: 'Biriktirildi',
  extend: 'Uzaytirildi',
  suspend: "To'xtatildi",
  resume: 'Davom ettirildi',
  cancel: 'Bekor qilindi',
  update: "O'zgartirildi",
  device_revoke: 'Qurilma uzildi',
  device_restore: 'Qurilma tiklandi',
  reset_pin: 'Admin PIN tiklandi',
};

function amountFor(price: number, months: number) {
  const d = MONTHS.find((x) => x.m === months)?.d ?? 0;
  return Math.round(price * months * (1 - d / 100));
}

export function ClinicPharmacyTab({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'tenant-pharmacy', clinicId],
    queryFn: () => api.admin.tenantPharmacy(clinicId),
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'tenant-pharmacy', clinicId] });
    void qc.invalidateQueries({ queryKey: ['admin', 'pharmacy-subscriptions'] });
  };

  if (q.isLoading) return <div className="text-muted-foreground text-sm">Yuklanmoqda…</div>;
  if (q.isError || !q.data) {
    return (
      <div className="text-sm text-rose-600">
        Xato: {(q.error as Error)?.message ?? "ma'lumot yo'q"}
      </div>
    );
  }
  const { subscription: sub, devices, operators, events, defaults } = q.data;

  return (
    <div className="space-y-5">
      {!sub || sub.status === 'canceled' ? (
        <AttachForm clinicId={clinicId} defaults={defaults} onDone={invalidate} reattach={!!sub} />
      ) : (
        <SubscriptionCard clinicId={clinicId} sub={sub} onDone={invalidate} />
      )}

      {sub && (
        <>
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Laptop className="h-4 w-4" /> Qurilmalar (
              {devices.filter((d) => !d.is_revoked).length}/{sub.max_devices})
            </h3>
            <DevicesTable clinicId={clinicId} devices={devices} onDone={invalidate} />
          </section>
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Users className="h-4 w-4" /> Operatorlar (PIN)
            </h3>
            {operators.length === 0 ? (
              <div className="text-muted-foreground text-xs">
                Hali operator yo'q — birinchi kirishda admin PIN yaratiladi.
              </div>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {operators.map((o) => (
                    <tr key={o.id} className={o.is_active ? '' : 'opacity-50'}>
                      <td className="py-1.5">{o.full_name}</td>
                      <td className="py-1.5">
                        <Badge variant={o.role === 'admin' ? 'success' : 'outline'}>
                          {o.role === 'admin' ? 'Admin' : 'Kassir'}
                        </Badge>
                      </td>
                      <td className="py-1.5 text-xs">
                        {o.register_no ? `Kassa ${o.register_no}` : '—'}
                      </td>
                      <td className="py-1.5 text-xs">
                        {o.pin_locked_until && new Date(o.pin_locked_until) > new Date() ? (
                          <span className="text-rose-600">PIN qulflangan</span>
                        ) : o.is_active ? (
                          'faol'
                        ) : (
                          "o'chirilgan"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <ResetAdminPin clinicId={clinicId} onDone={invalidate} />
          </section>
        </>
      )}

      {events.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Tarix</h3>
          <div className="max-h-64 overflow-y-auto rounded border">
            <table className="w-full text-xs">
              <tbody className="divide-y">
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {new Date(e.created_at).toLocaleString('uz-UZ')}
                    </td>
                    <td className="px-2 py-1.5 font-medium">
                      {ACTION_LABEL[e.action] ?? e.action}
                    </td>
                    <td className="px-2 py-1.5">
                      {e.months ? `${e.months} oy` : ''}
                      {e.amount_uzs ? ` · ${fmt(e.amount_uzs)} so'm` : ''}
                      {e.discount_pct ? ` (−${e.discount_pct}%)` : ''}
                    </td>
                    <td className="text-muted-foreground px-2 py-1.5">
                      {e.ends_at_after
                        ? `→ ${new Date(e.ends_at_after).toLocaleDateString('uz-UZ')}`
                        : ''}
                      {e.notes ? ` · ${e.notes}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function AttachForm({
  clinicId,
  defaults,
  reattach,
  onDone,
}: {
  clinicId: string;
  defaults: { price_uzs: number; max_devices: number };
  reattach: boolean;
  onDone: () => void;
}) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [months, setMonths] = useState(1);
  const [price, setPrice] = useState(String(defaults.price_uzs));
  const [maxDevices, setMaxDevices] = useState(String(defaults.max_devices));
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<{
    account_email: string;
    ends_at: string;
    magic_link: string | null;
  } | null>(null);
  const priceN = Math.max(0, Math.round(Number(price) || 0));
  const mut = useMutation({
    mutationFn: () =>
      api.admin.attachPharmacy(clinicId, {
        email: email.trim(),
        full_name: fullName.trim() || undefined,
        password: password || undefined,
        months,
        price_uzs: priceN,
        max_devices: Math.max(1, Number(maxDevices) || defaults.max_devices),
        notes: notes.trim() || undefined,
      }),
    onSuccess: (r) => {
      setResult(r);
      toast.success('Dorixona biriktirildi');
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (result) {
    return (
      <div className="space-y-3 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
        <div className="font-semibold">Dorixona faollashtirildi ✓</div>
        <div>
          Akkaunt: <b>{result.account_email}</b> · muddat:{' '}
          {new Date(result.ends_at).toLocaleDateString('uz-UZ')}
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-xs">
          <li>
            Dorixonachi app.clary.uz → "Dorixona" ni tanlaydi → shu Gmail bilan kiradi (Google yoki
            parol).
          </li>
          <li>Birinchi kompyuterni "Admin kompyuter" deb ulaydi va admin PIN yaratadi.</li>
          <li>
            Sozlamalar → Operatorlar: Kassa 1, Kassa 2 uchun PIN beradi; boshqa kompyuterlarni
            ulaydi.
          </li>
        </ol>
        {result.magic_link && (
          <div className="space-y-1">
            <div className="text-xs">
              Bir martalik kirish havolasi (parolsiz, 1 marta ishlaydi):
            </div>
            <div className="flex gap-1">
              <Input readOnly value={result.magic_link} className="h-8 text-xs" />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(result.magic_link!)
                    .then(() => toast.success('Nusxalandi'))
                    .catch(() => toast.error('Nusxalab bo‘lmadi'));
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Pill className="h-5 w-5 text-emerald-600" />
        <h3 className="font-semibold">
          {reattach ? 'Dorixonani qayta biriktirish' : 'Alohida dorixona biriktirish'}
        </h3>
      </div>
      <p className="text-muted-foreground text-xs">
        Dorixona alohida Gmail akkaunt bilan ishlaydi (klinika xodimining akkaunti emas — kassir
        klinika ma'lumotlarini ko'rmaydi). Klinikaning dori ombori, firmalari va sotuvlari umumiy.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Dorixona Gmail *</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="dorixona.nomi@gmail.com"
          />
        </div>
        <div className="space-y-1">
          <Label>Mas'ul (F.I.O.)</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Parol (ixtiyoriy, 8+ belgi)</Label>
          <Input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Google bilan kirsa — shart emas"
          />
        </div>
        <div className="space-y-1">
          <Label>Qurilmalar soni</Label>
          <Input
            inputMode="numeric"
            value={maxDevices}
            onChange={(e) => setMaxDevices(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Oylik narx (so'm)</Label>
          <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Muddat</Label>
          <div className="flex gap-1">
            {MONTHS.map((x) => (
              <button
                key={x.m}
                type="button"
                onClick={() => setMonths(x.m)}
                className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${months === x.m ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
              >
                {x.m} oy{x.d ? ` −${x.d}%` : ''}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <Label>Izoh</Label>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="bg-muted/40 flex items-center justify-between rounded-md px-3 py-2 text-sm">
        <span>To'lov summasi</span>
        <b>{fmt(amountFor(priceN, months))} so'm</b>
      </div>
      <Button
        disabled={!email.trim() || mut.isPending || (!!password && password.length < 8)}
        onClick={() => mut.mutate()}
      >
        <Pill className="mr-1 h-4 w-4" /> Biriktirish va faollashtirish
      </Button>
    </div>
  );
}

function SubscriptionCard({
  clinicId,
  sub,
  onDone,
}: {
  clinicId: string;
  sub: NonNullable<Awaited<ReturnType<typeof api.admin.tenantPharmacy>>['subscription']>;
  onDone: () => void;
}) {
  const [months, setMonths] = useState(1);
  const [notes, setNotes] = useState('');
  const [price, setPrice] = useState(String(sub.price_uzs));
  const [maxDevices, setMaxDevices] = useState(String(sub.max_devices));
  const [subNotes, setSubNotes] = useState(sub.notes ?? '');
  const extend = useMutation({
    mutationFn: () =>
      api.admin.extendPharmacy(clinicId, { months, notes: notes.trim() || undefined }),
    onSuccess: (r) => {
      toast.success(`Uzaytirildi: ${new Date(r.ends_at).toLocaleDateString('uz-UZ')} gacha`);
      setNotes('');
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const action = useMutation({
    mutationFn: (a: 'suspend' | 'resume' | 'cancel') =>
      a === 'suspend'
        ? api.admin.suspendPharmacy(clinicId)
        : a === 'resume'
          ? api.admin.resumePharmacy(clinicId)
          : api.admin.cancelPharmacy(clinicId),
    onSuccess: () => {
      toast.success('Bajarildi');
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: () =>
      api.admin.updatePharmacy(clinicId, {
        price_uzs: Math.max(0, Math.round(Number(price) || 0)),
        max_devices: Math.max(1, Number(maxDevices) || 1),
        notes: subNotes.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Saqlandi');
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusBadge = sub.active ? (
    <Badge variant="success">Faol</Badge>
  ) : sub.status === 'suspended' ? (
    <Badge variant="warning">To'xtatilgan</Badge>
  ) : (
    <Badge variant="outline">Muddati tugagan</Badge>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill className="h-5 w-5 text-emerald-600" />
        <h3 className="font-semibold">Alohida dorixona</h3>
        {statusBadge}
        <span className="text-muted-foreground ml-auto text-xs">{sub.account_email}</span>
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-md border p-2">
          <div className="text-muted-foreground text-[11px]">Tugash sanasi</div>
          <div className="font-semibold">{new Date(sub.ends_at).toLocaleDateString('uz-UZ')}</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-muted-foreground text-[11px]">Qolgan kun</div>
          <div className={`font-semibold ${sub.days_left <= 5 ? 'text-amber-600' : ''}`}>
            {sub.days_left}
          </div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-muted-foreground text-[11px]">Oylik narx</div>
          <div className="font-semibold">{fmt(sub.price_uzs)}</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-muted-foreground text-[11px]">Qurilmalar limiti</div>
          <div className="font-semibold">{sub.max_devices}</div>
        </div>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <CalendarPlus className="h-4 w-4" /> Uzaytirish
        </div>
        <div className="flex flex-wrap gap-1">
          {MONTHS.map((x) => (
            <button
              key={x.m}
              type="button"
              onClick={() => setMonths(x.m)}
              className={`rounded-md border px-3 py-1.5 text-xs ${months === x.m ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
            >
              {x.m} oy{x.d ? ` −${x.d}%` : ''}
            </button>
          ))}
        </div>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Izoh (to'lov ma'lumoti)"
        />
        <div className="flex items-center justify-between text-sm">
          <span>
            Summa: <b>{fmt(amountFor(sub.price_uzs, months))} so'm</b>
          </span>
          <Button size="sm" disabled={extend.isPending} onClick={() => extend.mutate()}>
            Uzaytirish
          </Button>
        </div>
      </div>

      <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Oylik narx</Label>
          <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Qurilmalar limiti</Label>
          <Input
            inputMode="numeric"
            value={maxDevices}
            onChange={(e) => setMaxDevices(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Izoh</Label>
          <Input value={subNotes} onChange={(e) => setSubNotes(e.target.value)} />
        </div>
        <div className="sm:col-span-3">
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() => update.mutate()}
          >
            <Save className="mr-1 h-3.5 w-3.5" /> Saqlash
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {sub.status === 'active' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={action.isPending}
            onClick={() => action.mutate('suspend')}
          >
            <Pause className="mr-1 h-3.5 w-3.5" /> To'xtatish
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={action.isPending}
            onClick={() => action.mutate('resume')}
          >
            <Play className="mr-1 h-3.5 w-3.5" /> Davom ettirish
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-rose-600"
          disabled={action.isPending}
          onClick={() => {
            if (
              window.confirm(
                "Dorixona obunasi bekor qilinsinmi? (ma'lumotlar saqlanadi, kirish yopiladi)",
              )
            ) {
              action.mutate('cancel');
            }
          }}
        >
          <XCircle className="mr-1 h-3.5 w-3.5" /> Bekor qilish
        </Button>
      </div>
    </div>
  );
}

function DevicesTable({
  clinicId,
  devices,
  onDone,
}: {
  clinicId: string;
  devices: Awaited<ReturnType<typeof api.admin.tenantPharmacy>>['devices'];
  onDone: () => void;
}) {
  const mut = useMutation({
    mutationFn: (d: { id: string; is_revoked: boolean }) =>
      d.is_revoked
        ? api.admin.restorePharmacyDevice(clinicId, d.id)
        : api.admin.revokePharmacyDevice(clinicId, d.id),
    onSuccess: () => onDone(),
    onError: (e: Error) => toast.error(e.message),
  });
  if (devices.length === 0) {
    return <div className="text-muted-foreground text-xs">Hali kompyuter ulanmagan.</div>;
  }
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y">
        {devices.map((d) => (
          <tr key={d.id} className={d.is_revoked ? 'opacity-50' : ''}>
            <td className="py-1.5">{d.name}</td>
            <td className="py-1.5 text-xs">{d.register_no ? `Kassa ${d.register_no}` : 'admin'}</td>
            <td className="py-1.5 text-xs">{new Date(d.last_seen_at).toLocaleString('uz-UZ')}</td>
            <td className="py-1.5 text-right">
              <Button
                size="sm"
                variant="ghost"
                disabled={mut.isPending}
                onClick={() => mut.mutate(d)}
              >
                {d.is_revoked ? 'Tiklash' : 'Uzish'}
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResetAdminPin({ clinicId, onDone }: { clinicId: string; onDone: () => void }) {
  const [pin, setPin] = useState('');
  const mut = useMutation({
    mutationFn: () => api.admin.resetPharmacyAdminPin(clinicId, pin),
    onSuccess: () => {
      toast.success('Admin PIN yangilandi');
      setPin('');
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex items-end gap-2 pt-1">
      <div className="space-y-1">
        <Label className="text-xs">Admin PIN unutilgan bo'lsa — yangi PIN</Label>
        <Input
          className="h-8 w-40"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="4–6 raqam"
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={!/^\d{4,6}$/.test(pin) || mut.isPending}
        onClick={() => mut.mutate()}
      >
        <KeyRound className="mr-1 h-3.5 w-3.5" /> Tiklash
      </Button>
    </div>
  );
}
