import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@clary/ui-web';
import {
  LogIn,
  ShieldOff,
  ShieldCheck,
  ArrowLeft,
  Loader2,
  Star,
  Globe,
  Flag,
  Users,
  CreditCard,
  BarChart3,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

import { api } from '@/lib/api';

const KNOWN_FEATURES = [
  { key: 'online_queue',       label: 'Online navbat' },
  { key: 'home_nurse',         label: 'Uy hamshirasi' },
  { key: 'web_profile',        label: 'Web profil' },
  { key: 'reviews',            label: 'Izohlar' },
  { key: 'lab_integration',    label: 'Lab integratsiya' },
  { key: 'ai_assistant',       label: 'AI yordamchi' },
  { key: 'payroll',            label: 'Ish haqi' },
  { key: 'advanced_analytics', label: 'Kengaytirilgan analitika' },
];

const PLANS = ['demo', 'starter', 'pro', 'enterprise'];

type Tab = 'overview' | 'staff' | 'subscriptions' | 'finance' | 'web-profile' | 'feature-flags' | 'actions';

interface TenantDetail {
  clinic: {
    id: string; name: string; slug: string; city: string | null; current_plan: string | null;
    is_suspended: boolean; is_active: boolean; created_at: string; logo_url: string | null;
  };
  profiles: Array<{ id: string; full_name: string; email: string; role: string; is_active: boolean; last_sign_in_at: string | null }>;
  subscriptions: Array<{ id: string; status: string; plan: string; started_at: string; ends_at: string | null }>;
  revenue_30d: number;
  web_profile: { is_published: boolean; tagline: string | null; updated_at: string } | null;
  feature_flags: Array<{ feature: string; enabled: boolean; reason: string | null; enabled_at: string | null }>;
  rating: { average_rating: number | null; review_count: number } | null;
  stats: { appointments_total: number; bookings_total: number; staff_count: number };
}

export function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');

  const { data, isLoading, refetch } = useQuery<TenantDetail>({
    queryKey: ['tenant-detail', id],
    queryFn: () => api.get(`/api/v1/admin/tenants/${id}/detail`),
    enabled: !!id,
  });

  const suspendMut = useMutation({
    mutationFn: (reason: string) => api.post(`/api/v1/admin/tenants/${id}/suspend`, { reason }),
    onSuccess: () => { toast.success('Klinika to\'xtatildi'); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const unsuspendMut = useMutation({
    mutationFn: () => api.post(`/api/v1/admin/tenants/${id}/unsuspend`, {}),
    onSuccess: () => { toast.success('Klinika yoqildi'); refetch(); },
  });

  const planMut = useMutation({
    mutationFn: (plan: string) => api.post(`/api/v1/admin/tenants/${id}/change-plan`, { plan }),
    onSuccess: () => { toast.success('Tarif o\'zgartirildi'); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const flagMut = useMutation({
    mutationFn: ({ feature, enabled }: { feature: string; enabled: boolean }) =>
      api.post('/api/v1/admin/extras/feature-flags', {
        clinic_id: id, feature, enabled, reason: `Admin toggled ${enabled ? 'on' : 'off'}`,
      }),
    onSuccess: () => { toast.success('Flag yangilandi'); refetch(); },
  });

  const impersonateMut = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      api.admin.impersonate(userId, reason),
    onSuccess: (r: { action_link?: string }) => {
      toast.success('Impersonation sessiyasi yaratildi');
      if (r.action_link) window.open(r.action_link, '_blank', 'noopener,noreferrer');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const TABS: { key: Tab; label: string; icon: typeof BarChart3 }[] = [
    { key: 'overview',      label: 'Umumiy',       icon: BarChart3 },
    { key: 'staff',         label: 'Xodimlar',     icon: Users },
    { key: 'subscriptions', label: 'Obuna',        icon: CreditCard },
    { key: 'web-profile',   label: 'Web profil',   icon: Globe },
    { key: 'feature-flags', label: 'Feature flags', icon: Flag },
    { key: 'actions',       label: 'Amallar',      icon: ShieldOff },
  ];

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-center text-muted-foreground py-12">Klinika topilmadi</p>;
  }

  const { clinic, profiles, subscriptions, revenue_30d, web_profile, feature_flags, rating, stats } = data;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/tenants">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold truncate">{clinic.name}</h1>
          <p className="text-sm text-muted-foreground">{clinic.slug} · {clinic.city ?? '—'}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {clinic.is_suspended ? (
            <Button variant="outline" size="sm" onClick={() => unsuspendMut.mutate()} disabled={unsuspendMut.isPending}>
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Yoqish
            </Button>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              disabled={suspendMut.isPending}
              onClick={() => {
                const r = prompt('To\'xtatish sababi:');
                if (r) suspendMut.mutate(r);
              }}
            >
              <ShieldOff className="mr-1.5 h-3.5 w-3.5" /> To'xtatish
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 overflow-x-auto rounded-xl bg-muted/40 p-1 no-scrollbar">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              tab === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground uppercase mb-1">Holat</p>
                {clinic.is_suspended ? <Badge variant="destructive">To'xtatilgan</Badge> : <Badge variant="success">Faol</Badge>}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground uppercase mb-1">Tarif</p>
                <Badge variant="outline" className="capitalize">{clinic.current_plan ?? '—'}</Badge>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground uppercase mb-1">Daromad (30 kun)</p>
                <p className="text-xl font-bold">{(revenue_30d / 1_000_000).toFixed(1)}M UZS</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground uppercase mb-1">Reyting</p>
                <div className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  <span className="text-xl font-bold">{rating?.average_rating?.toFixed(1) ?? '—'}</span>
                  <span className="text-xs text-muted-foreground">({rating?.review_count ?? 0})</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-3xl font-bold">{stats.appointments_total.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">Jami qabullar</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-3xl font-bold">{stats.bookings_total.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">Online bronlar</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-3xl font-bold">{stats.staff_count}</p>
                <p className="text-xs text-muted-foreground mt-1">Xodimlar</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground uppercase mb-2">Ro'yxatdan o'tgan</p>
              <p className="text-sm">{new Date(clinic.created_at).toLocaleDateString('uz-Latn')}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Staff */}
      {tab === 'staff' && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Ism</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Rol</th>
                    <th className="px-4 py-3">Holat</th>
                    <th className="px-4 py-3">So'nggi kirish</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr key={p.id} className="border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium">{p.full_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{p.email}</td>
                      <td className="px-4 py-3"><Badge variant="outline">{p.role}</Badge></td>
                      <td className="px-4 py-3">
                        {p.is_active ? <Badge variant="success">Faol</Badge> : <Badge variant="outline">Nofaol</Badge>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {p.last_sign_in_at ? formatDistanceToNow(new Date(p.last_sign_in_at), { addSuffix: true }) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={impersonateMut.isPending}
                          onClick={() => {
                            const reason = prompt(`${p.email} sifatida kirish sababi (>=10 belgi):`);
                            if (reason && reason.length >= 10) impersonateMut.mutate({ userId: p.id, reason });
                            else if (reason !== null) toast.error('Sabab kamida 10 belgi bo\'lishi kerak');
                          }}
                        >
                          <LogIn className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {profiles.length === 0 && (
                <div className="py-8 text-center text-muted-foreground text-sm">Xodimlar topilmadi</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Subscriptions */}
      {tab === 'subscriptions' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Plan</th>
                      <th className="px-4 py-3">Holat</th>
                      <th className="px-4 py-3">Boshlangan</th>
                      <th className="px-4 py-3">Tugaydi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((s) => (
                      <tr key={s.id} className="border-b last:border-b-0 hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium capitalize">{s.plan}</td>
                        <td className="px-4 py-3">
                          <Badge variant={s.status === 'active' ? 'success' : 'outline'}>{s.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {new Date(s.started_at).toLocaleDateString('uz-Latn')}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {s.ends_at ? new Date(s.ends_at).toLocaleDateString('uz-Latn') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {subscriptions.length === 0 && (
                  <div className="py-8 text-center text-muted-foreground text-sm">Obunalar topilmadi</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Web profile */}
      {tab === 'web-profile' && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            {web_profile ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="font-medium">Holat</p>
                  {web_profile.is_published
                    ? <Badge variant="success">Nashr etilgan</Badge>
                    : <Badge variant="outline">Nashr etilmagan</Badge>}
                </div>
                {web_profile.tagline && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Tagline</p>
                    <p className="text-sm">{web_profile.tagline}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Oxirgi yangilanish</p>
                  <p className="text-sm">{formatDistanceToNow(new Date(web_profile.updated_at), { addSuffix: true })}</p>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => api.post(`/api/v1/admin/moderation/web-profiles/${id}`, { action: web_profile.is_published ? 'unpublish' : 'publish' })
                      .then(() => { toast.success('Yangilandi'); refetch(); })
                      .catch((e: Error) => toast.error(e.message))}
                  >
                    {web_profile.is_published ? 'Yashirish' : 'Nashr etish'}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-6 text-center">Web profil yaratilmagan</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Feature flags */}
      {tab === 'feature-flags' && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {KNOWN_FEATURES.map((feat) => {
                const flag = feature_flags.find((f) => f.feature === feat.key);
                const enabled = flag?.enabled ?? false;
                return (
                  <button
                    key={feat.key}
                    onClick={() => flagMut.mutate({ feature: feat.key, enabled: !enabled })}
                    disabled={flagMut.isPending}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs transition-all ${
                      enabled
                        ? 'border-emerald-300 bg-emerald-50/50 text-emerald-700'
                        : 'border-border hover:bg-muted/40 text-muted-foreground'
                    }`}
                  >
                    <span className="font-medium">{feat.label}</span>
                    {enabled
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      : <XCircle className="h-4 w-4 text-muted-foreground/40 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      {tab === 'actions' && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Tarif o'zgartirish</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-2 flex-wrap">
                {PLANS.map((p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant={clinic.current_plan === p ? 'default' : 'outline'}
                    onClick={() => planMut.mutate(p)}
                    disabled={planMut.isPending || clinic.current_plan === p}
                    className="capitalize"
                  >
                    {p}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-red-200/50">
            <CardHeader><CardTitle className="text-sm text-red-600">Xavfli amallar</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {clinic.is_suspended ? (
                <div className="flex items-center justify-between rounded-xl border p-3">
                  <div>
                    <p className="text-sm font-medium">Klinikani yoqish</p>
                    <p className="text-xs text-muted-foreground">To'xtatilgan klinikani qayta faollashtirish</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => unsuspendMut.mutate()}>
                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Yoqish
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-xl border border-red-200/50 p-3">
                  <div>
                    <p className="text-sm font-medium">Klinikani to'xtatish</p>
                    <p className="text-xs text-muted-foreground">Barcha foydalanuvchilar bloklanadi</p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={suspendMut.isPending}
                    onClick={() => {
                      const r = prompt('To\'xtatish sababi:');
                      if (r) suspendMut.mutate(r);
                    }}
                  >
                    <ShieldOff className="mr-1.5 h-3.5 w-3.5" /> To'xtatish
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
