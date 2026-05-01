import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@clary/ui-web';
import { Send, Loader2, CheckCircle2, Radio } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

type Target = 'all_clinics' | 'by_plan' | 'by_city' | 'specific';
type Channel = 'in_app' | 'email';

const PLANS = ['demo', 'starter', 'pro', 'enterprise'];

interface BroadcastResult {
  broadcast_id: string;
  target_count: number;
  channel: string;
  status: string;
}

export function BroadcastPage() {
  const [target, setTarget] = useState<Target>('all_clinics');
  const [plan, setPlan] = useState('');
  const [city, setCity] = useState('');
  const [clinicIds, setClinicIds] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [channel, setChannel] = useState<Channel>('in_app');
  const [result, setResult] = useState<BroadcastResult | null>(null);

  const sendMut = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { target, subject, body, channel };
      if (target === 'by_plan') payload.plan = plan;
      if (target === 'by_city') payload.city = city;
      if (target === 'specific') payload.clinic_ids = clinicIds.split(',').map((s) => s.trim()).filter(Boolean);
      return api.post<BroadcastResult>('/api/v1/admin/broadcast', payload);
    },
    onSuccess: (r: BroadcastResult) => {
      setResult(r);
      toast.success(`${r.target_count} ta klinikaga yuborildi (queued)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSend = subject.trim() && body.trim() &&
    (target === 'all_clinics' ||
      (target === 'by_plan' && plan) ||
      (target === 'by_city' && city) ||
      (target === 'specific' && clinicIds.trim()));

  if (result) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Xabar tarqatish</h1>
        </div>
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center gap-4 py-6">
              <CheckCircle2 className="h-14 w-14 text-emerald-500" />
              <div>
                <p className="text-lg font-semibold text-emerald-700">Xabar muvaffaqiyatli navbatga qo'yildi</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {result.target_count} ta klinika · kanal: {result.channel}
                </p>
                <p className="text-xs text-muted-foreground mt-1">ID: {result.broadcast_id}</p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setResult(null);
                  setSubject('');
                  setBody('');
                }}
              >
                Yangi xabar
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Xabar tarqatish</h1>
        <p className="text-sm text-muted-foreground">Klinikalarga e'lon yoki bildirishnoma yuborish</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Maqsad auditoriya</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  { v: 'all_clinics', label: 'Barcha klinikalar' },
                  { v: 'by_plan',     label: 'Tarif bo\'yicha' },
                  { v: 'by_city',     label: 'Shahar bo\'yicha' },
                  { v: 'specific',    label: 'Tanlangan' },
                ] as { v: Target; label: string }[]).map((o) => (
                  <button
                    key={o.v}
                    onClick={() => setTarget(o.v)}
                    className={`rounded-xl border p-3 text-xs font-medium text-center transition-colors ${
                      target === o.v ? 'border-primary bg-primary/5 text-primary' : 'hover:bg-muted/40'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              {target === 'by_plan' && (
                <div className="flex gap-1 rounded-xl bg-muted/40 p-1 flex-wrap">
                  {PLANS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPlan(plan === p ? '' : p)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors capitalize ${
                        plan === p ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}

              {target === 'by_city' && (
                <Input
                  placeholder="Shahar nomi (masalan: Toshkent)"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              )}

              {target === 'specific' && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Klinika UUID lari (vergul bilan ajratilgan)
                  </label>
                  <textarea
                    value={clinicIds}
                    onChange={(e) => setClinicIds(e.target.value)}
                    rows={3}
                    placeholder="uuid1, uuid2, uuid3..."
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Xabar matni</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Mavzu *</label>
                <Input
                  placeholder="Xabar mavzusini kiriting..."
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={200}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Xabar matni *</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  placeholder="Xabar matnini kiriting..."
                  className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary resize-none"
                />
                <p className="text-xs text-muted-foreground text-right mt-1">{body.length} belgi</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Kanal</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {([
                { v: 'in_app', label: 'Ilova ichida', desc: 'Push notification' },
                { v: 'email',  label: 'Email',        desc: 'Elektron pochta' },
              ] as { v: Channel; label: string; desc: string }[]).map((o) => (
                <button
                  key={o.v}
                  onClick={() => setChannel(o.v)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${
                    channel === o.v ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                  }`}
                >
                  <p className="text-sm font-medium">{o.label}</p>
                  <p className="text-xs text-muted-foreground">{o.desc}</p>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Yuborish</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl bg-muted/30 p-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Maqsad:</span>
                  <span className="font-medium">
                    {target === 'all_clinics' ? 'Barcha klinikalar' :
                     target === 'by_plan' ? `Plan: ${plan || '—'}` :
                     target === 'by_city' ? `Shahar: ${city || '—'}` :
                     `${clinicIds.split(',').filter(Boolean).length} ta klinika`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Kanal:</span>
                  <span className="font-medium">{channel === 'in_app' ? 'Ilova' : 'Email'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mavzu:</span>
                  <span className="font-medium truncate max-w-[120px]">{subject || '—'}</span>
                </div>
              </div>

              <Button
                className="w-full"
                disabled={!canSend || sendMut.isPending}
                onClick={() => sendMut.mutate()}
              >
                {sendMut.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Yuborish
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
