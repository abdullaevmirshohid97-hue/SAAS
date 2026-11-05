import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, cn } from '@clary/ui-web';
import { CheckCircle2, Info, Loader2, Search, Send } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { PLAN_LABELS } from '@/lib/clinic-status';

// =============================================================================
// Xabar tarqatish — klinikalarga e'lon. Yetkazish: klinika ilovasida har bir
// xodimga oyna bo'lib chiqadi va "Tanishdim" bosguncha turadi
// (clinic_announcements). Avval xabar hech qayerga yetkazilmas edi.
// =============================================================================

type Target = 'all_clinics' | 'by_plan' | 'by_city' | 'specific';

const PLANS = ['demo', '25pro', '50pro', '120pro'];

interface BroadcastResult {
  broadcast_id: string | null;
  target_count: number;
  status: string;
}

export function BroadcastPage() {
  const [target, setTarget] = useState<Target>('all_clinics');
  const [plan, setPlan] = useState('');
  const [city, setCity] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [result, setResult] = useState<BroadcastResult | null>(null);

  const clinicsQ = useQuery({
    queryKey: ['tenants', { q: '', includeDeleted: false }],
    queryFn: () => api.admin.listTenants({}),
    enabled: target === 'specific',
  });
  const clinics = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (clinicsQ.data ?? []).filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q),
    );
  }, [clinicsQ.data, search]);

  const sendMut = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { target, subject, body, channel: 'in_app' };
      if (target === 'by_plan') payload.plan = plan;
      if (target === 'by_city') payload.city = city;
      if (target === 'specific') payload.clinic_ids = [...picked];
      return api.post<BroadcastResult>('/api/v1/admin/broadcast', payload);
    },
    onSuccess: (r: BroadcastResult) => {
      setResult(r);
      toast.success(`${r.target_count} ta klinikaga yetkazildi`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const targetLabel =
    target === 'all_clinics'
      ? 'Barcha faol klinikalar'
      : target === 'by_plan'
        ? `Tarif: ${plan ? (PLAN_LABELS[plan] ?? plan) : '—'}`
        : target === 'by_city'
          ? `Shahar: ${city || '—'}`
          : `${picked.size} ta tanlangan klinika`;

  const canSend =
    subject.trim() &&
    body.trim() &&
    (target === 'all_clinics' ||
      (target === 'by_plan' && plan) ||
      (target === 'by_city' && city.trim()) ||
      (target === 'specific' && picked.size > 0));

  if (result) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Xabar tarqatish</h1>
        <Card className="border-emerald-200 bg-emerald-50/30 dark:bg-emerald-950/10">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <CheckCircle2 className="h-14 w-14 text-emerald-500" />
            <div>
              <p className="text-lg font-semibold text-emerald-700">Xabar yetkazildi</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {result.target_count} ta klinika xodimlari ilovaga kirganda ko‘radi
              </p>
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
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Xabar tarqatish</h1>
        <p className="text-muted-foreground text-sm">
          Klinikalarga e'lon — yangilik, texnik ishlar, to‘lov eslatmasi
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Kimga</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    { v: 'all_clinics', label: 'Barcha klinikalar' },
                    { v: 'by_plan', label: "Tarif bo'yicha" },
                    { v: 'by_city', label: "Shahar bo'yicha" },
                    { v: 'specific', label: 'Tanlangan' },
                  ] as { v: Target; label: string }[]
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setTarget(o.v)}
                    className={cn(
                      'rounded-xl border p-3 text-center text-xs font-medium transition-colors',
                      target === o.v
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'hover:bg-muted/40',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              {target === 'by_plan' && (
                <div className="bg-muted/40 flex flex-wrap gap-1 rounded-xl p-1">
                  {PLANS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPlan(plan === p ? '' : p)}
                      className={cn(
                        'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                        plan === p
                          ? 'bg-background text-primary shadow-sm'
                          : 'text-muted-foreground',
                      )}
                    >
                      {PLAN_LABELS[p] ?? p}
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
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="text-muted-foreground absolute left-2.5 top-2.5 h-4 w-4" />
                    <Input
                      className="pl-8"
                      placeholder="Klinika nomi…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-64 divide-y overflow-y-auto rounded-xl border">
                    {clinicsQ.isLoading && (
                      <div className="text-muted-foreground p-3 text-sm">Yuklanmoqda…</div>
                    )}
                    {clinics.map((c) => (
                      <label
                        key={c.id}
                        className="hover:bg-muted/40 flex cursor-pointer items-center gap-2 px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={picked.has(c.id)}
                          onChange={() => {
                            const next = new Set(picked);
                            if (next.has(c.id)) next.delete(c.id);
                            else next.add(c.id);
                            setPicked(next);
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {PLAN_LABELS[c.current_plan] ?? c.current_plan}
                        </span>
                      </label>
                    ))}
                  </div>
                  {picked.size > 0 && (
                    <button
                      type="button"
                      className="text-muted-foreground text-xs hover:underline"
                      onClick={() => setPicked(new Set())}
                    >
                      Tanlovni tozalash ({picked.size})
                    </button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Xabar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">Sarlavha *</label>
                <Input
                  placeholder="Masalan: Yangi imkoniyat — Agentlar moduli"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={200}
                />
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">Matn *</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  placeholder="Xabar matni…"
                  className="bg-background focus:ring-primary w-full resize-none rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2"
                />
                <p className="text-muted-foreground mt-1 text-right text-xs">{body.length} belgi</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="flex gap-2 p-4 text-sm">
              <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-muted-foreground">
                Xabar klinika ilovasida har bir xodimga <b>oyna bo‘lib</b> chiqadi va u{' '}
                <b>“Tanishdim”</b> bosguncha turadi. Bitta klinikaga Telegram yoki email orqali
                yozish uchun — klinika kartasi → “Xabar va eslatma”.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Yuborish</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="bg-muted/30 space-y-1.5 rounded-xl p-3 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Kimga:</span>
                  <span className="text-right font-medium">{targetLabel}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Sarlavha:</span>
                  <span className="max-w-[160px] truncate font-medium">{subject || '—'}</span>
                </div>
              </div>
              <Button
                className="w-full"
                disabled={!canSend || sendMut.isPending}
                onClick={() => {
                  if (window.confirm(`${targetLabel} — xabarni yuborasizmi?`)) sendMut.mutate();
                }}
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
