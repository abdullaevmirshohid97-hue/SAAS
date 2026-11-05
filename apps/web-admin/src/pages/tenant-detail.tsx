import { useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn } from '@clary/ui-web';
import {
  ArrowLeft,
  BarChart3,
  CalendarClock,
  CreditCard,
  FileSignature,
  FileText,
  Loader2,
  LogIn,
  MonitorSmartphone,
  Plug,
  Send,
  Settings2,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Star,
  Users,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { fmtDate, planLabel, relDays, statusMeta } from '@/lib/clinic-status';
import { TenantDevices } from '@/components/tenant/tenant-devices';
import { TenantEntitlements } from '@/components/tenant/tenant-entitlements';
import { TenantRoles } from '@/components/tenant/tenant-roles';
import { ClinicPharmacyTab } from './clinic-pharmacy';
import { ClinicAiReceptionTab } from './clinic-ai-reception';
import {
  BranchesTab,
  DmedTab,
  EditTab,
  EntNotice,
  InsuranceTab,
  MessageTab,
  RemindersTab,
} from './clinic-manage';

// =============================================================================
// Klinika kartasi — bitta sahifa (avval "Batafsil" va "Boshqarish" ikki
// sahifaga bo'lingan edi). Tab URL'da (?tab=modules) — havola bilan ochiladi.
// "Modullar va tarif" — klinika qaysi bo'limlarni ko'rishini shu yerda sozlaysiz.
// =============================================================================

const PLANS = ['demo', '25pro', '50pro', '120pro'] as const;

type Tab =
  | 'overview'
  | 'modules'
  | 'staff'
  | 'devices'
  | 'billing'
  | 'integrations'
  | 'contact'
  | 'settings';

const TABS: { key: Tab; label: string; icon: typeof BarChart3 }[] = [
  { key: 'overview', label: 'Umumiy', icon: BarChart3 },
  { key: 'modules', label: 'Modullar va tarif', icon: Sparkles },
  { key: 'staff', label: 'Xodimlar va rollar', icon: Users },
  { key: 'devices', label: 'Qurilmalar', icon: MonitorSmartphone },
  { key: 'billing', label: 'Obuna', icon: CreditCard },
  { key: 'integrations', label: 'Integratsiyalar', icon: Plug },
  { key: 'contact', label: 'Xabar va eslatma', icon: Send },
  { key: 'settings', label: 'Sozlamalar', icon: Settings2 },
];

// Eski havolalar (?tab=tariff va h.k.) yangi tablarga
const LEGACY_TAB: Record<string, Tab> = {
  tariff: 'modules',
  roles: 'staff',
  subscriptions: 'billing',
  actions: 'billing',
  finance: 'billing',
  'web-profile': 'settings',
  manage: 'integrations',
};

type Integration = 'pharmacy' | 'ai' | 'dmed' | 'insurance' | 'branches';
const INTEGRATIONS: { key: Integration; label: string }[] = [
  { key: 'pharmacy', label: 'Dorixona' },
  { key: 'ai', label: 'AI qabulxona va ATS' },
  { key: 'dmed', label: 'DMED' },
  { key: 'insurance', label: 'Sug‘urta' },
  { key: 'branches', label: 'Filiallar' },
];

interface TenantDetail {
  clinic: {
    id: string;
    name: string;
    slug: string;
    city: string | null;
    current_plan: string | null;
    is_suspended: boolean;
    is_active: boolean;
    created_at: string;
    logo_url: string | null;
    billing_code: string | null;
    subscription_status: string | null;
    trial_ends_at: string | null;
    subscription_ends_at: string | null;
    grace_ends_at: string | null;
  };
  profiles: Array<{
    id: string;
    full_name: string;
    email: string;
    role: string;
    is_active: boolean;
    last_sign_in_at: string | null;
  }>;
  subscriptions: Array<{
    id: string;
    status: string;
    plan: string;
    started_at: string;
    ends_at: string | null;
  }>;
  revenue_30d: number;
  web_profile: { is_published: boolean; tagline: string | null; updated_at: string } | null;
  rating: { average_rating: number | null; review_count: number } | null;
  stats: { appointments_total: number; bookings_total: number; staff_count: number };
}

const ROLE_LABEL: Record<string, string> = {
  clinic_owner: 'Rahbar',
  clinic_admin: 'Administrator',
  doctor: 'Shifokor',
  receptionist: 'Qabulxona',
  cashier: 'Kassir',
  pharmacist: 'Farmatsevt',
  lab_technician: 'Laborant',
  radiologist: 'Radiolog',
  nurse: 'Hamshira',
  staff: 'Xodim',
};

export function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') ?? 'overview';
  const tab: Tab = (LEGACY_TAB[raw] ?? raw) as Tab;
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === 'overview') next.delete('tab');
    else next.set('tab', t);
    setParams(next, { replace: true });
  };

  const { data, isLoading, refetch } = useQuery<TenantDetail>({
    queryKey: ['tenant-detail', id],
    queryFn: () => api.get(`/api/v1/admin/tenants/${id}/detail`),
    enabled: !!id,
  });

  const done = (msg: string) => () => {
    toast.success(msg);
    void refetch();
    void qc.invalidateQueries({ queryKey: ['tenants'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
  };

  const suspendMut = useMutation({
    mutationFn: (reason: string) => api.post(`/api/v1/admin/tenants/${id}/suspend`, { reason }),
    onSuccess: done("Klinika to'xtatildi"),
    onError: (e: Error) => toast.error(e.message),
  });
  const unsuspendMut = useMutation({
    mutationFn: () => api.post(`/api/v1/admin/tenants/${id}/unsuspend`, {}),
    onSuccess: done('Klinika yoqildi'),
    onError: (e: Error) => toast.error(e.message),
  });
  const planMut = useMutation({
    mutationFn: (plan: string) => api.post(`/api/v1/admin/tenants/${id}/change-plan`, { plan }),
    onSuccess: done("Tarif o'zgartirildi"),
    onError: (e: Error) => toast.error(e.message),
  });
  const activateMut = useMutation({
    mutationFn: (months: number) =>
      api.post(`/api/v1/admin/tenants/${id}/activate-subscription`, { months }),
    onSuccess: done('Obuna uzaytirildi'),
    onError: (e: Error) => toast.error(e.message),
  });
  const impersonateMut = useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason: string }) => {
      const r = await api.admin.impersonate(userId, reason);
      return { action_link: (r as { action_link?: string }).action_link };
    },
    onSuccess: (r: { action_link?: string }) => {
      toast.success('Kirish havolasi yaratildi — yangi oynada ochiladi');
      if (r.action_link) window.open(r.action_link, '_blank', 'noopener,noreferrer');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const askSuspend = () => {
    const r = prompt("To'xtatish sababi (klinika xodimlari ilovaga kira olmaydi):");
    if (r) suspendMut.mutate(r);
  };
  const askImpersonate = (p: { id: string; email: string }) => {
    const reason = prompt(`${p.email} sifatida kirish sababi (kamida 10 belgi):`);
    if (reason && reason.length >= 10) impersonateMut.mutate({ userId: p.id, reason });
    else if (reason !== null) toast.error("Sabab kamida 10 belgi bo'lishi kerak");
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (!data || !id) {
    return <p className="text-muted-foreground py-12 text-center">Klinika topilmadi</p>;
  }

  const { clinic, profiles, subscriptions, revenue_30d, web_profile, rating, stats } = data;
  const st = statusMeta(clinic.subscription_status, clinic.is_suspended);
  const untilDate =
    clinic.subscription_status === 'trialing'
      ? clinic.trial_ends_at
      : clinic.subscription_status === 'past_due'
        ? (clinic.grace_ends_at ?? clinic.subscription_ends_at)
        : clinic.subscription_ends_at;
  const managed = { id: clinic.id, name: clinic.name, current_plan: clinic.current_plan };

  return (
    <div className="space-y-5">
      {/* Sarlavha */}
      <div className="flex flex-wrap items-start gap-3">
        <Link to="/tenants">
          <Button variant="ghost" size="icon" className="h-9 w-9" title="Klinikalar ro‘yxati">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{clinic.name}</h1>
            <Badge variant={st.tone} title={st.hint}>
              {st.label}
            </Badge>
            <Badge variant="outline">{planLabel(clinic.current_plan)}</Badge>
          </div>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {clinic.slug} · {clinic.city ?? 'shahar ko‘rsatilmagan'} · ro‘yxatdan o‘tgan{' '}
            {fmtDate(clinic.created_at)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link to={`/billing-docs?tab=invoices&clinic=${clinic.id}&new=1`}>
            <Button variant="outline" size="sm">
              <FileText className="mr-1.5 h-3.5 w-3.5" /> Invoys
            </Button>
          </Link>
          <Link to={`/billing-docs?tab=contracts&clinic=${clinic.id}&new=1`}>
            <Button variant="outline" size="sm">
              <FileSignature className="mr-1.5 h-3.5 w-3.5" /> Shartnoma
            </Button>
          </Link>
          {clinic.is_suspended ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => unsuspendMut.mutate()}
              disabled={unsuspendMut.isPending}
            >
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Yoqish
            </Button>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              disabled={suspendMut.isPending}
              onClick={askSuspend}
            >
              <ShieldOff className="mr-1.5 h-3.5 w-3.5" /> To'xtatish
            </Button>
          )}
        </div>
      </div>

      {/* Tablar */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              tab === key
                ? 'border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Umumiy ───────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <InfoCard label="Obuna">
              <Badge variant={st.tone}>{st.label}</Badge>
              {untilDate && (
                <div className="text-muted-foreground mt-1.5 text-xs">
                  {fmtDate(untilDate)} · {relDays(untilDate)}
                </div>
              )}
            </InfoCard>
            <InfoCard label="Tarif">
              <div className="text-lg font-semibold">{planLabel(clinic.current_plan)}</div>
              <button
                type="button"
                onClick={() => setTab('modules')}
                className="text-primary mt-0.5 text-xs hover:underline"
              >
                Modullarni sozlash →
              </button>
            </InfoCard>
            <InfoCard label="Klinika tushumi (30 kun)">
              <div className="text-lg font-semibold">
                {(revenue_30d / 1_000_000).toFixed(1)} mln so‘m
              </div>
            </InfoCard>
            <InfoCard label="Reyting">
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                <span className="text-lg font-semibold">
                  {rating?.average_rating?.toFixed(1) ?? '—'}
                </span>
                <span className="text-muted-foreground text-xs">
                  ({rating?.review_count ?? 0} sharh)
                </span>
              </div>
            </InfoCard>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <InfoCard label="Xodimlar">
              <div className="text-2xl font-bold">{stats.staff_count}</div>
            </InfoCard>
            <InfoCard label="Jami qabullar">
              <div className="text-2xl font-bold">{stats.appointments_total.toLocaleString()}</div>
            </InfoCard>
            <InfoCard label="Onlayn bronlar">
              <div className="text-2xl font-bold">{stats.bookings_total.toLocaleString()}</div>
            </InfoCard>
          </div>

          <ExtendCard
            billingCode={clinic.billing_code}
            pending={activateMut.isPending}
            onExtend={(m) => activateMut.mutate(m)}
          />
        </div>
      )}

      {/* ── Modullar va tarif — klinika nimalarni ko'radi ─────────────────── */}
      {tab === 'modules' && (
        <div className="space-y-3">
          <p className="text-muted-foreground rounded-lg border bg-sky-500/5 p-3 text-sm">
            Klinika ilovasida qaysi bo‘limlar ko‘rinishini shu yerda belgilaysiz: tarifdagi
            sozlamani qoldiring yoki shu klinika uchun alohida <b>yoqing / o‘chiring</b>.
            O‘chirilgan modul klinika menyusidan yo‘qoladi va API ham yopiladi. Saqlangach darhol
            amal qiladi.
          </p>
          <TenantEntitlements clinicId={id} />
        </div>
      )}

      {/* ── Xodimlar va rollar ───────────────────────────────────────────── */}
      {tab === 'staff' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-muted-foreground border-b text-left text-xs uppercase">
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
                      <tr key={p.id} className="hover:bg-muted/20 border-b last:border-b-0">
                        <td className="px-4 py-3 font-medium">{p.full_name}</td>
                        <td className="text-muted-foreground px-4 py-3">{p.email}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline">{ROLE_LABEL[p.role] ?? p.role}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {p.is_active ? (
                            <Badge variant="success">Faol</Badge>
                          ) : (
                            <Badge variant="outline">Nofaol</Badge>
                          )}
                        </td>
                        <td className="text-muted-foreground px-4 py-3 text-xs">
                          {p.last_sign_in_at
                            ? formatDistanceToNow(new Date(p.last_sign_in_at), {
                                addSuffix: true,
                              })
                            : 'hech kirmagan'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1"
                            title="Shu xodim sifatida kirish (yordam berish uchun)"
                            disabled={impersonateMut.isPending}
                            onClick={() => askImpersonate(p)}
                          >
                            <LogIn className="h-3.5 w-3.5" /> Kirish
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {profiles.length === 0 && (
                  <div className="text-muted-foreground py-8 text-center text-sm">
                    Xodimlar topilmadi
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          <div>
            <h2 className="mb-2 text-base font-semibold">Rollar</h2>
            <TenantRoles clinicId={id} />
          </div>
        </div>
      )}

      {tab === 'devices' && <TenantDevices clinicId={id} />}

      {/* ── Obuna ────────────────────────────────────────────────────────── */}
      {tab === 'billing' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Obuna holati</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-6 text-sm">
                <Field label="To'lov kodi">
                  <span className="font-mono text-base font-bold">
                    {clinic.billing_code ?? '—'}
                  </span>
                </Field>
                <Field label="Holat">
                  <Badge variant={st.tone}>{st.label}</Badge>
                </Field>
                {clinic.trial_ends_at && (
                  <Field label="Sinov tugaydi">{fmtDate(clinic.trial_ends_at)}</Field>
                )}
                {clinic.subscription_ends_at && (
                  <Field label="Obuna tugaydi">{fmtDate(clinic.subscription_ends_at)}</Field>
                )}
                {clinic.grace_ends_at && (
                  <Field label="Imtiyozli muddat tugaydi">
                    <span className="text-amber-600">{fmtDate(clinic.grace_ends_at)}</span>
                  </Field>
                )}
              </div>
            </CardContent>
          </Card>

          <ExtendCard
            billingCode={clinic.billing_code}
            pending={activateMut.isPending}
            onExtend={(m) => activateMut.mutate(m)}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tarif</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {PLANS.map((p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant={clinic.current_plan === p ? 'default' : 'outline'}
                    onClick={() => planMut.mutate(p)}
                    disabled={planMut.isPending || clinic.current_plan === p}
                  >
                    {planLabel(p)}
                  </Button>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">
                Tarif almashsa modullar yangi tarif bo‘yicha ochiladi/yopiladi; shu klinika uchun
                alohida sozlamalar (“Modullar va tarif”) saqlanib qoladi.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Obunalar tarixi</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-muted-foreground border-b text-left text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3">Tarif</th>
                      <th className="px-4 py-3">Holat</th>
                      <th className="px-4 py-3">Boshlangan</th>
                      <th className="px-4 py-3">Tugaydi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((s) => {
                      const sm = statusMeta(s.status);
                      return (
                        <tr key={s.id} className="border-b last:border-b-0">
                          <td className="px-4 py-3 font-medium">{planLabel(s.plan)}</td>
                          <td className="px-4 py-3">
                            <Badge variant={sm.tone}>{sm.label}</Badge>
                          </td>
                          <td className="text-muted-foreground px-4 py-3 text-xs">
                            {fmtDate(s.started_at)}
                          </td>
                          <td className="text-muted-foreground px-4 py-3 text-xs">
                            {fmtDate(s.ends_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {subscriptions.length === 0 && (
                  <div className="text-muted-foreground py-8 text-center text-sm">
                    Obunalar tarixi yo‘q
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'integrations' && (
        <IntegrationsTab clinicId={id} isEnterprise={clinic.current_plan === '120pro'} />
      )}

      {/* ── Xabar va eslatma ─────────────────────────────────────────────── */}
      {tab === 'contact' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Klinikaga xabar</CardTitle>
            </CardHeader>
            <CardContent>
              <MessageTab clinic={managed} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock className="h-4 w-4" /> Eslatmalar (o‘zingiz uchun)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RemindersTab clinicId={id} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Sozlamalar ───────────────────────────────────────────────────── */}
      {tab === 'settings' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Klinika ma'lumotlari</CardTitle>
            </CardHeader>
            <CardContent>
              <EditTab clinic={managed} />
            </CardContent>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Web profil (klinika sahifasi)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {web_profile ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span>Holat</span>
                      {web_profile.is_published ? (
                        <Badge variant="success">Nashr etilgan</Badge>
                      ) : (
                        <Badge variant="outline">Nashr etilmagan</Badge>
                      )}
                    </div>
                    {web_profile.tagline && (
                      <p className="text-muted-foreground">{web_profile.tagline}</p>
                    )}
                    <p className="text-muted-foreground text-xs">
                      Yangilangan:{' '}
                      {formatDistanceToNow(new Date(web_profile.updated_at), { addSuffix: true })}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        api
                          .post(`/api/v1/admin/moderation/web-profiles/${id}`, {
                            action: web_profile.is_published ? 'unpublish' : 'publish',
                          })
                          .then(() => {
                            toast.success('Yangilandi');
                            void refetch();
                          })
                          .catch((e: Error) => toast.error(e.message))
                      }
                    >
                      {web_profile.is_published ? 'Yashirish' : 'Nashr etish'}
                    </Button>
                  </>
                ) : (
                  <p className="text-muted-foreground">Web profil yaratilmagan</p>
                )}
              </CardContent>
            </Card>
            <Card className="border-red-200/60">
              <CardHeader>
                <CardTitle className="text-base text-red-600">Klinikani to'xtatish</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-3 text-sm">
                <p className="text-muted-foreground">
                  {clinic.is_suspended
                    ? 'Klinika to‘xtatilgan — xodimlar kira olmaydi.'
                    : 'Barcha xodimlar bloklanadi, ma’lumotlar saqlanadi.'}
                </p>
                {clinic.is_suspended ? (
                  <Button variant="outline" size="sm" onClick={() => unsuspendMut.mutate()}>
                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Yoqish
                  </Button>
                ) : (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={suspendMut.isPending}
                    onClick={askSuspend}
                  >
                    <ShieldOff className="mr-1.5 h-3.5 w-3.5" /> To'xtatish
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-muted-foreground mb-1.5 text-xs uppercase tracking-wide">{label}</p>
        {children}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-0.5 font-medium">{children}</div>
    </div>
  );
}

function ExtendCard({
  billingCode,
  pending,
  onExtend,
}: {
  billingCode: string | null;
  pending: boolean;
  onExtend: (months: number) => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-[220px] flex-1">
          <div className="font-medium">Obunani uzaytirish</div>
          <div className="text-muted-foreground text-xs">
            To‘lov tasdiqlangach bosing. Chegirma: 3 oy −5%, 6 oy −10%, 12 oy −20%.
            {billingCode && (
              <>
                {' '}
                To‘lov kodi: <b className="font-mono">{billingCode}</b>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { m: 1, d: '' },
            { m: 3, d: '−5%' },
            { m: 6, d: '−10%' },
            { m: 12, d: '−20%' },
          ].map(({ m, d }) => (
            <Button
              key={m}
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Obunani ${m} oyga uzaytirasizmi?`)) onExtend(m);
              }}
            >
              +{m} oy{d && <span className="ml-1 text-emerald-600">{d}</span>}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function IntegrationsTab({ clinicId, isEnterprise }: { clinicId: string; isEnterprise: boolean }) {
  const [sub, setSub] = useState<Integration>('pharmacy');
  return (
    <div className="space-y-3">
      <div className="bg-muted/40 inline-flex flex-wrap gap-0.5 rounded-lg p-1">
        {INTEGRATIONS.map((i) => (
          <button
            key={i.key}
            type="button"
            onClick={() => setSub(i.key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              sub === i.key
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {i.label}
          </button>
        ))}
      </div>
      <div className="bg-card rounded-xl border p-4">
        {sub === 'pharmacy' && <ClinicPharmacyTab clinicId={clinicId} />}
        {sub === 'ai' && <ClinicAiReceptionTab clinicId={clinicId} />}
        {sub === 'dmed' && <DmedTab clinicId={clinicId} />}
        {sub === 'insurance' &&
          (isEnterprise ? <InsuranceTab clinicId={clinicId} /> : <EntNotice />)}
        {sub === 'branches' && <BranchesTab clinicId={clinicId} />}
      </div>
    </div>
  );
}
