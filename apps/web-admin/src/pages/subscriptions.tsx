import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Check,
  Clock,
  Crown,
  DollarSign,
  Download,
  Pause,
  Search,
  Send,
  TrendingUp,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  StatCard,
  Textarea,
  cn,
} from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';

type Clinic = {
  id: string;
  name: string;
  slug: string;
  current_plan: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  subscription_ends_at: string | null;
  is_suspended: boolean;
  created_at: string;
};

type Overview = {
  totals: {
    clinics: number;
    active_paying: number;
    trial_active: number;
    trial_expiring_soon: number;
    suspended: number;
    mrr_uzs: number;
    arr_uzs: number;
  };
  by_status: Record<string, number>;
  by_plan: Record<string, number>;
  clinics: Clinic[];
};

const STATUS_META: Record<
  string,
  { label: string; tone: string }
> = {
  active:    { label: 'Faol',      tone: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  trialing:  { label: 'Sinov',     tone: 'bg-sky-100 text-sky-700 border-sky-200' },
  past_due:  { label: 'Qarzdor',   tone: 'bg-amber-100 text-amber-700 border-amber-200' },
  unpaid:    { label: 'To\'lanmadi', tone: 'bg-rose-100 text-rose-700 border-rose-200' },
  canceled:  { label: 'Bekor',     tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  unknown:   { label: 'Noma\'lum', tone: 'bg-slate-100 text-slate-600' },
};

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

const PLAN_LABELS: Record<string, string> = {
  demo: 'Demo',
  '25pro': 'Base',
  '50pro': 'Pro',
  '120pro': 'Enterprise',
};

export function SubscriptionsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [trialNotifyOpen, setTrialNotifyOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin', 'subscriptions'],
    queryFn: () => api.get<Overview>('/api/v1/admin/subscriptions/overview'),
    refetchInterval: 60_000,
  });

  // 7 kun ichida sinovi tugaydigan klinikalar — eslatma broadcast nishoni.
  const expiringClinics = useMemo(() => {
    const now = Date.now();
    return (data?.clinics ?? []).filter((c) => {
      if (!c.trial_ends_at) return false;
      const t = new Date(c.trial_ends_at).getTime();
      return t > now && t - now < 7 * 86_400_000;
    });
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.clinics;
    if (statusFilter) list = list.filter((c) => (c.subscription_status ?? 'unknown') === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q) ||
          (c.current_plan ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [data, search, statusFilter]);

  const t = data?.totals;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-sky-50 via-background to-emerald-50 p-6 dark:from-sky-950/30 dark:to-emerald-950/30">
        <div className="absolute -right-12 -top-12 h-56 w-56 rounded-full bg-gradient-to-br from-sky-400/15 to-emerald-400/15 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-sky-600" />
              <h1 className="text-2xl font-semibold tracking-tight">Obunalar va daromad</h1>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Klinikalar obunasi, MRR/ARR ko'rsatkichlari va sinov muddati tugash xavfi.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {expiringClinics.length > 0 && (
              <button
                onClick={() => setTrialNotifyOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                <Send className="h-3.5 w-3.5" /> Eslatma yuborish ({expiringClinics.length})
              </button>
            )}
            <button
              onClick={() =>
                downloadCsv(
                  `obunalar-${new Date().toISOString().slice(0, 10)}.csv`,
                  filtered,
                  [
                    { key: 'name', label: 'Klinika' },
                    { key: 'slug', label: 'Slug' },
                    { key: 'current_plan', label: 'Tarif' },
                    { key: 'subscription_status', label: 'Holat' },
                    { key: 'trial_ends_at', label: 'Sinov tugashi' },
                    { key: 'subscription_ends_at', label: 'Obuna tugashi' },
                    { key: 'created_at', label: 'Yaratilgan' },
                  ],
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <Activity className="h-3.5 w-3.5" /> Yangilash
            </button>
          </div>
        </div>
      </div>

      {/* Top KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Jami klinikalar"
          value={isLoading ? '…' : String(t?.clinics ?? 0)}
          icon={<Building2 className="h-4 w-4" />}
        />
        <StatCard
          label="Faol obunachi"
          value={isLoading ? '…' : String(t?.active_paying ?? 0)}
          icon={<Check className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Sinov rejimida"
          value={isLoading ? '…' : String(t?.trial_active ?? 0)}
          icon={<Clock className="h-4 w-4" />}
          tone="info"
        />
        <StatCard
          label="7 kun ichida tugaydi"
          value={isLoading ? '…' : String(t?.trial_expiring_soon ?? 0)}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={(t?.trial_expiring_soon ?? 0) > 0 ? 'warning' : undefined}
        />
        <StatCard
          label="MRR"
          value={isLoading ? '…' : `${fmt(t?.mrr_uzs ?? 0)} so'm`}
          icon={<DollarSign className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="ARR (proj.)"
          value={isLoading ? '…' : `${fmt(t?.arr_uzs ?? 0)} so'm`}
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>

      {/* Status + plan breakdown */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Status taqsimoti</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data?.by_status ?? {}).map(([status, count]) => {
                const meta = STATUS_META[status] ?? STATUS_META.unknown!;
                const isActive = statusFilter === status;
                return (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(isActive ? null : status)}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                      meta.tone,
                      isActive && 'ring-2 ring-offset-1 ring-sky-400',
                    )}
                  >
                    <span>{meta.label}</span>
                    <span className="rounded bg-white/50 px-1.5 py-0.5 text-xs">{count}</span>
                  </button>
                );
              })}
              {statusFilter && (
                <button
                  onClick={() => setStatusFilter(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Filterni tozalash
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Reja taqsimoti</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(data?.by_plan ?? {})
                .sort(([, a], [, b]) => b - a)
                .map(([plan, count]) => {
                  const max = Math.max(...Object.values(data?.by_plan ?? { x: 1 }));
                  const pct = (count / max) * 100;
                  return (
                    <div key={plan}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium capitalize">{plan}</span>
                        <span className="text-muted-foreground">{count}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              {Object.keys(data?.by_plan ?? {}).length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Reja ma'lumotlari yo'q
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search + table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="text-base">
            Klinikalar ({filtered.length}{statusFilter ? ` / ${data?.clinics.length ?? 0}` : ''})
          </CardTitle>
          <div className="relative w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Klinika qidirish..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Klinika</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Reja</th>
                  <th className="px-4 py-2 text-left font-medium">Sinov tugaydi</th>
                  <th className="px-4 py-2 text-left font-medium">Yaratilgan</th>
                  <th className="px-4 py-2 text-right font-medium">Amal</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-muted/50" />
                      </td>
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                      Klinikalar topilmadi
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => {
                    const meta = STATUS_META[c.subscription_status ?? 'unknown'] ?? STATUS_META.unknown!;
                    const trialEnd = c.trial_ends_at ? new Date(c.trial_ends_at) : null;
                    const isExpiringSoon =
                      trialEnd && trialEnd.getTime() - Date.now() < 7 * 86_400_000 && trialEnd > new Date();
                    return (
                      <tr key={c.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                              {c.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-medium">{c.name}</div>
                              <div className="truncate text-xs text-muted-foreground">{c.slug}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium',
                              meta.tone,
                            )}
                          >
                            {meta.label}
                            {c.is_suspended && (
                              <Pause className="ml-0.5 h-3 w-3" aria-label="Suspended" />
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {c.current_plan ? (
                            <Badge variant="outline">
                              {PLAN_LABELS[c.current_plan] ?? c.current_plan}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {trialEnd ? (
                            <span className={isExpiringSoon ? 'font-medium text-amber-600' : 'text-muted-foreground'}>
                              {trialEnd.toLocaleDateString('uz-UZ')}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(c.created_at).toLocaleDateString('uz-UZ')}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/tenants/${c.id}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            Tafsilot <ArrowUpRight className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {trialNotifyOpen && (
        <TrialNotifyDialog clinics={expiringClinics} onClose={() => setTrialNotifyOpen(false)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TrialNotifyDialog — sinovi 7 kun ichida tugaydigan klinikalarga bir bosishda
// "obunani uzaytiring" eslatmasi (mavjud /admin/broadcast, target: specific).
// ---------------------------------------------------------------------------
function TrialNotifyDialog({ clinics, onClose }: { clinics: Clinic[]; onClose: () => void }) {
  const [subject, setSubject] = useState('Sinov muddatingiz tugayapti');
  const [body, setBody] = useState(
    "Hurmatli mijoz! Clary'dagi sinov muddatingiz tez orada yakunlanadi. " +
      "Ish uzilmasligi uchun Sozlamalar > Obuna bo'limidan tarifni faollashtiring. " +
      "Savollar bo'lsa biz bilan bog'laning — yordam beramiz.",
  );
  const [channel, setChannel] = useState<'in_app' | 'email'>('in_app');

  const sendMut = useMutation({
    mutationFn: () =>
      api.post<{ broadcast_id: string; target_count: number }>('/api/v1/admin/broadcast', {
        target: 'specific',
        clinic_ids: clinics.map((c) => c.id),
        subject,
        body,
        channel,
      }),
    onSuccess: (d) => {
      toast.success(`Eslatma yuborildi — ${d.target_count} klinika`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sinov tugashi haqida eslatma</DialogTitle>
          <DialogDescription>
            {clinics.length} ta klinikaga yuboriladi: {clinics.slice(0, 3).map((c) => c.name).join(', ')}
            {clinics.length > 3 ? ` va yana ${clinics.length - 3} ta` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Mavzu</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Xabar</Label>
            <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Kanal</Label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as typeof channel)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="in_app">Ilova ichida (push)</option>
              <option value="email">Email</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Bekor</Button>
          <Button
            disabled={!subject.trim() || !body.trim() || sendMut.isPending}
            onClick={() => sendMut.mutate()}
          >
            <Send className="mr-1.5 h-4 w-4" />
            {sendMut.isPending ? 'Yuborilmoqda…' : 'Yuborish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
