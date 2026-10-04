import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Delete,
  KeyRound,
  Laptop,
  Loader2,
  Lock,
  LogOut,
  Phone,
  Send,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import { Button, Card, CardContent, ClaryLogo, Input, cn } from '@clary/ui-web';
import type { PharmacyWorkspaceStatus } from '@clary/api-client';
import { toast } from 'sonner';

import {
  SUPPORT_PHONE,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_TELEGRAM,
} from '@/components/support-button';
import { api } from '@/lib/api';
import {
  PHARMACY_WS_EVENT,
  clearOperatorSession,
  getDeviceKey,
  getOperatorSession,
  onOperatorSessionChange,
  setOperatorSession,
} from '@/lib/pharmacy/session';
import { useAuth } from '@/providers/auth-provider';
import { SECTION_META, SectionView } from '@/pages/pharmacy';
import {
  PharmacyContext,
  makePharmacyCtx,
  sectionFromSlug,
  usePharmacy,
  type PharmacyCtx,
  type SectionId,
} from '@/pages/pharmacy/context';
import { PharmacySalePage as SaleDetail } from '@/pages/pharmacy/sale-page';

// =============================================================================
// Alohida "Dorixona" kirishi (/dorixona/*)
// =============================================================================
// Bitta Gmail akkaunt → 3 tagacha kompyuter (Admin, Kassa 1, Kassa 2) → har
// kishi o'z PIN kodi bilan. Ketma-ketlik:
//   obuna faolmi → kompyuter ro'yxatdanmi → admin PIN bormi → operator PIN →
//   ish oynasi (klinikadagi dorixona bilan bir xil bo'limlar va dizayn).
// Harakatsizlikda ekran qulflanadi (PIN qayta so'raladi).
// =============================================================================

const IDLE_MS = 15 * 60_000;

type WsStatus = PharmacyWorkspaceStatus;

function useWsStatus() {
  return useQuery({
    queryKey: ['pharmacy-ws', 'status'],
    queryFn: () => api.pharmacyWs.status(),
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function DorixonaApp() {
  const { signOut } = useAuth();
  const qc = useQueryClient();
  const statusQ = useWsStatus();
  const [, force] = useState(0);
  const session = getOperatorSession();

  useEffect(() => onOperatorSessionChange(() => force((n) => n + 1)), []);
  // API xatolari (obuna/qurilma/PIN) → holatni qayta o'qish
  useEffect(() => {
    const h = (e: Event) => {
      const code = (e as CustomEvent).detail as string;
      if (code === 'OPERATOR_PIN_REQUIRED') clearOperatorSession();
      void qc.invalidateQueries({ queryKey: ['pharmacy-ws', 'status'] });
    };
    window.addEventListener(PHARMACY_WS_EVENT, h);
    return () => window.removeEventListener(PHARMACY_WS_EVENT, h);
  }, [qc]);

  const logout = async () => {
    try {
      if (getOperatorSession()) await api.pharmacyWs.logout();
    } catch {
      /* ignore */
    }
    await signOut();
  };

  const st = statusQ.data;
  if (statusQ.isLoading) {
    return (
      <Screen>
        <div className="text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" /> Yuklanmoqda…
        </div>
      </Screen>
    );
  }
  if (statusQ.isError || !st) {
    return (
      <Screen>
        <GateCard
          icon={<AlertTriangle className="h-6 w-6 text-amber-600" />}
          title="Server bilan aloqa yo'q"
        >
          <p className="text-muted-foreground text-sm">
            Internetni tekshiring va qayta urinib ko'ring.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => void statusQ.refetch()}>Qayta urinish</Button>
            <Button variant="ghost" onClick={() => void logout()}>
              Chiqish
            </Button>
          </div>
        </GateCard>
      </Screen>
    );
  }
  if (!st.is_pharmacy_account) return <NotPharmacyAccount onLogout={logout} />;
  if (!st.subscription.active) return <SubscriptionInactive st={st} onLogout={logout} />;
  if (!st.device?.registered) return <RegisterDevice st={st} onLogout={logout} />;
  if (st.device.revoked) {
    return (
      <Screen>
        <GateCard
          icon={<ShieldAlert className="h-6 w-6 text-rose-600" />}
          title="Bu kompyuter uzib qo'yilgan"
        >
          <p className="text-muted-foreground text-sm">
            Dorixona admini "{st.device.name}" kompyuterini o'chirgan. Admin kompyuterida Sozlamalar
            → Qurilmalar bo'limidan tiklash mumkin.
          </p>
          <Button variant="ghost" onClick={() => void logout()}>
            <LogOut className="mr-1 h-4 w-4" /> Chiqish
          </Button>
        </GateCard>
      </Screen>
    );
  }
  if (!st.has_admin) return <AdminSetup st={st} />;
  if (!session || !st.operator) return <PinLogin st={st} onLogout={logout} />;
  return <WorkspaceShell st={st} onLogout={logout} />;
}

// -----------------------------------------------------------------------------
// Umumiy ekran qoliplari
// -----------------------------------------------------------------------------
function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-foreground relative flex min-h-screen items-center justify-center p-4">
      <div className="bg-mesh-gradient pointer-events-none absolute inset-0" />
      <div className="relative w-full max-w-md">{children}</div>
    </div>
  );
}

function GateCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card className="shadow-elevation-3 border-0">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          <ClaryLogo variant="full" size="md" className="rounded-md" />
          <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            Dorixona
          </span>
        </div>
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function SupportBlock() {
  return (
    <div className="bg-muted/40 space-y-1 rounded-md p-3 text-sm">
      <div className="text-muted-foreground text-xs">Faollashtirish uchun bog'laning:</div>
      <a href={`tel:${SUPPORT_PHONE}`} className="flex items-center gap-2 font-mono font-semibold">
        <Phone className="h-4 w-4" /> {SUPPORT_PHONE_DISPLAY}
      </a>
      <a
        href={SUPPORT_TELEGRAM}
        target="_blank"
        rel="noreferrer"
        className="text-primary flex items-center gap-2"
      >
        <Send className="h-4 w-4" /> Telegram: @Clary_uz
      </a>
    </div>
  );
}

function NotPharmacyAccount({ onLogout }: { onLogout: () => Promise<void> }) {
  const navigate = useNavigate();
  return (
    <Screen>
      <GateCard icon={<UserRound className="h-6 w-6 text-sky-600" />} title="Bu klinika akkaunti">
        <p className="text-muted-foreground text-sm">
          Siz klinika akkaunti bilan kirdingiz. Alohida "Dorixona" bo'limi uchun super admin bergan
          dorixona akkaunti (Gmail) bilan kiring. Klinika ichidagi dorixona — klinika menyusidagi
          "Dorixona" bo'limida.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate('/pharmacy')}>Klinika dorixonasiga o'tish</Button>
          <Button variant="ghost" onClick={() => void onLogout()}>
            <LogOut className="mr-1 h-4 w-4" /> Boshqa akkaunt
          </Button>
        </div>
      </GateCard>
    </Screen>
  );
}

function SubscriptionInactive({ st, onLogout }: { st: WsStatus; onLogout: () => Promise<void> }) {
  const s = st.subscription;
  return (
    <Screen>
      <GateCard
        icon={<Lock className="h-6 w-6 text-amber-600" />}
        title="Dorixona obunasi faol emas"
      >
        <p className="text-muted-foreground text-sm">
          {s.exists
            ? s.status === 'suspended'
              ? "Dorixona obunasi vaqtincha to'xtatilgan."
              : s.ends_at
                ? `Obuna muddati ${new Date(s.ends_at).toLocaleDateString('uz-UZ')} da tugagan.`
                : 'Obuna bekor qilingan.'
            : 'Bu klinikaga dorixona moduli hali ulanmagan.'}{' '}
          Ma'lumotlaringiz xavfsiz saqlanadi — obuna tiklangach hammasi joyida bo'ladi.
        </p>
        <p className="text-sm">
          Dorixona tarifi: <b>{Number(s.price_uzs ?? 300000).toLocaleString('uz-UZ')} so'm / oy</b>{' '}
          (klinika obunasidan alohida).
        </p>
        <SupportBlock />
        <Button variant="ghost" onClick={() => void onLogout()}>
          <LogOut className="mr-1 h-4 w-4" /> Chiqish
        </Button>
      </GateCard>
    </Screen>
  );
}

function RegisterDevice({ st, onLogout }: { st: WsStatus; onLogout: () => Promise<void> }) {
  const qc = useQueryClient();
  const used = st.devices_used ?? 0;
  const max = st.subscription.max_devices || 3;
  const [reg, setReg] = useState<string>(used === 0 ? '' : String(Math.min(used, 5)));
  const [name, setName] = useState(used === 0 ? 'Admin kompyuter' : `Kassa ${Math.min(used, 5)}`);
  const mut = useMutation({
    mutationFn: () =>
      api.pharmacyWs.registerDevice({
        device_key: getDeviceKey(),
        name: name.trim(),
        register_no: reg ? Number(reg) : null,
      }),
    onSuccess: () => {
      toast.success('Kompyuter ulandi');
      void qc.invalidateQueries({ queryKey: ['pharmacy-ws'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const full = used >= max;
  return (
    <Screen>
      <GateCard icon={<Laptop className="h-6 w-6 text-sky-600" />} title="Kompyuterni ulash">
        <p className="text-muted-foreground text-sm">
          {st.clinic?.name} dorixonasi · ulangan kompyuterlar: <b>{used}</b> / {max}. Bu kompyuterni
          nomlang va kassaga biriktiring.
        </p>
        {full ? (
          <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            Kompyuterlar limiti to'lgan. Admin kompyuterida Sozlamalar → Qurilmalar bo'limidan
            eskisini uzing yoki super admindan limitni oshirishni so'rang.
          </div>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="text-muted-foreground text-xs">Kompyuter nomi</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground text-xs">Kassa</span>
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={reg}
                onChange={(e) => {
                  setReg(e.target.value);
                  setName(e.target.value ? `Kassa ${e.target.value}` : 'Admin kompyuter');
                }}
              >
                <option value="">Admin kompyuteri (kassasiz)</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    Kassa {n}
                  </option>
                ))}
              </select>
            </label>
            <Button
              className="w-full"
              disabled={!name.trim() || mut.isPending}
              onClick={() => mut.mutate()}
            >
              {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Ulash
            </Button>
          </>
        )}
        <Button variant="ghost" onClick={() => void onLogout()}>
          <LogOut className="mr-1 h-4 w-4" /> Chiqish
        </Button>
      </GateCard>
    </Screen>
  );
}

function AdminSetup({ st }: { st: WsStatus }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const ok = name.trim() && /^\d{4,6}$/.test(pin) && pin === pin2;
  const mut = useMutation({
    mutationFn: () => api.pharmacyWs.setup({ full_name: name.trim(), pin }),
    onSuccess: (r) => {
      setOperatorSession({ token: r.token, expires_at: r.expires_at, operator: r.operator });
      toast.success('Admin PIN yaratildi');
      void qc.invalidateQueries({ queryKey: ['pharmacy-ws'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Screen>
      <GateCard
        icon={<KeyRound className="h-6 w-6 text-emerald-600" />}
        title="Birinchi sozlash: admin PIN"
      >
        <p className="text-muted-foreground text-sm">
          {st.clinic?.name} dorixonasi. Admin (mudir) uchun PIN kod yarating. Keyin Sozlamalar →
          Operatorlar bo'limida kassirlarga alohida PIN berasiz.
        </p>
        <label className="block space-y-1">
          <span className="text-muted-foreground text-xs">Admin F.I.O.</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-muted-foreground text-xs">PIN (4–6 raqam)</span>
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground text-xs">PIN (takror)</span>
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
        </div>
        <Button className="w-full" disabled={!ok || mut.isPending} onClick={() => mut.mutate()}>
          Saqlash va kirish
        </Button>
      </GateCard>
    </Screen>
  );
}

function PinLogin({ st, onLogout }: { st: WsStatus; onLogout: () => Promise<void> }) {
  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: ['pharmacy-ws', 'login-list'],
    queryFn: () => api.pharmacyWs.loginList(),
  });
  const ops = listQ.data ?? [];
  const deviceReg = st.device?.register_no ?? null;
  const [opId, setOpId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Shu kassaga biriktirilgan operator (yoki yagona operator) — oldindan tanlanadi
  useEffect(() => {
    if (opId || ops.length === 0) return;
    const pref =
      ops.find((o) => deviceReg != null && o.register_no === deviceReg) ??
      (ops.length === 1 ? ops[0] : null);
    if (pref) setOpId(pref.id);
  }, [ops, opId, deviceReg]);

  const login = useMutation({
    mutationFn: () => api.pharmacyWs.login({ operator_id: opId!, pin }),
    onSuccess: (r) => {
      setOperatorSession({ token: r.token, expires_at: r.expires_at, operator: r.operator });
      setPin('');
      setError(null);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => {
      setPin('');
      setError(e.message);
      void listQ.refetch();
    },
  });

  const submit = useCallback(() => {
    if (!opId || pin.length < 4 || login.isPending) return;
    login.mutate();
  }, [opId, pin, login]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!opId) return;
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 6 ? p + e.key : p));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') setPin('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opId, submit]);

  const op = ops.find((o) => o.id === opId) ?? null;
  const locked = op?.pin_locked_until && new Date(op.pin_locked_until) > new Date();

  return (
    <Screen>
      <Card className="shadow-elevation-3 border-0">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClaryLogo variant="full" size="md" className="rounded-md" />
              <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                Dorixona
              </span>
            </div>
            <span className="text-muted-foreground text-xs">
              {st.device?.name}
              {deviceReg ? ` · Kassa ${deviceReg}` : ''}
            </span>
          </div>
          <div className="text-center">
            <div className="text-muted-foreground text-xs">{st.clinic?.name}</div>
            <div className="text-lg font-semibold">Kim ishlaydi?</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {ops.map((o) => (
              <button
                key={o.id}
                onClick={() => {
                  setOpId(o.id);
                  setPin('');
                  setError(null);
                }}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  opId === o.id ? 'border-primary bg-primary/10' : 'hover:bg-muted',
                )}
              >
                <div className="truncate font-medium">{o.full_name}</div>
                <div className="text-muted-foreground text-xs">
                  {o.role === 'admin' ? 'Admin' : 'Kassir'}
                  {o.register_no ? ` · Kassa ${o.register_no}` : ''}
                </div>
              </button>
            ))}
            {listQ.isLoading && (
              <div className="text-muted-foreground col-span-2 text-center text-sm">
                Yuklanmoqda…
              </div>
            )}
          </div>
          {op && (
            <div className="space-y-3">
              <div className="flex justify-center gap-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'h-3.5 w-3.5 rounded-full border',
                      i < pin.length
                        ? 'bg-primary border-primary'
                        : i < 4
                          ? 'border-foreground/40'
                          : 'border-dashed',
                    )}
                  />
                ))}
              </div>
              {(error || locked) && (
                <div className="rounded-md bg-rose-50 px-3 py-2 text-center text-sm text-rose-700">
                  {locked
                    ? `PIN vaqtincha qulflangan (${new Date(op.pin_locked_until!).toLocaleTimeString('uz-UZ')} gacha)`
                    : error}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                  <Button
                    key={d}
                    variant="outline"
                    className="h-14 text-xl"
                    onClick={() => setPin((p) => (p.length < 6 ? p + d : p))}
                  >
                    {d}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  className="h-14"
                  onClick={() => setPin((p) => p.slice(0, -1))}
                  aria-label="O'chirish"
                >
                  <Delete className="h-5 w-5" />
                </Button>
                <Button
                  variant="outline"
                  className="h-14 text-xl"
                  onClick={() => setPin((p) => (p.length < 6 ? p + '0' : p))}
                >
                  0
                </Button>
                <Button
                  className="h-14"
                  disabled={pin.length < 4 || login.isPending || !!locked}
                  onClick={submit}
                >
                  {login.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Kirish'}
                </Button>
              </div>
            </div>
          )}
          <button
            className="text-muted-foreground hover:text-foreground mx-auto flex items-center gap-1 text-xs"
            onClick={() => void onLogout()}
          >
            <LogOut className="h-3.5 w-3.5" /> Akkauntdan chiqish ({st.account?.email ?? ''})
          </button>
        </CardContent>
      </Card>
    </Screen>
  );
}

// -----------------------------------------------------------------------------
// Ish oynasi
// -----------------------------------------------------------------------------
const ADMIN_ONLY: SectionId[] = ['dashboard', 'import'];
const RECEIVE_ONLY: SectionId[] = ['receipt', 'receipt-history', 'suppliers'];

function allowed(ctx: PharmacyCtx, id: SectionId): boolean {
  if (ctx.isAdmin) return true;
  if (ADMIN_ONLY.includes(id)) return false;
  if (RECEIVE_ONLY.includes(id)) return ctx.canReceive;
  return true;
}

function WorkspaceShell({ st, onLogout }: { st: WsStatus; onLogout: () => Promise<void> }) {
  const qc = useQueryClient();
  const op = st.operator!;
  const ctx = useMemo(
    () =>
      makePharmacyCtx({
        mode: 'workspace',
        operator: op,
        isAdmin: op.role === 'admin',
        canReceive: op.role === 'admin' || op.can_receive,
        canReturn: op.role === 'admin' || op.can_return,
        canDiscount: op.role === 'admin' || op.can_discount,
        canSeeCost: op.role === 'admin',
        clinicName: st.clinic?.name ?? 'Dorixona',
      }),
    [op, st.clinic?.name],
  );

  const lock = useCallback(async () => {
    try {
      await api.pharmacyWs.logout();
    } catch {
      /* sessiya baribir o'chadi */
    }
    clearOperatorSession();
    void qc.invalidateQueries({ queryKey: ['pharmacy-ws', 'status'] });
  }, [qc]);

  // Harakatsizlikda qulflash
  const last = useRef(Date.now());
  useEffect(() => {
    const bump = () => {
      last.current = Date.now();
    };
    const evs = ['mousedown', 'keydown', 'touchstart', 'wheel'] as const;
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - last.current > IDLE_MS) void lock();
    }, 30_000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, [lock]);

  const reg = op.register_no ?? st.device?.register_no ?? null;
  const days = st.subscription.days_left;
  const sections = SECTION_META.filter((s) => allowed(ctx, s.id));

  return (
    <PharmacyContext.Provider value={ctx}>
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card/80 sticky top-0 z-30 border-b backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 px-4 py-2">
            <div className="flex items-center gap-2">
              <ClaryLogo variant="full" size="sm" className="rounded" />
              <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                Dorixona
              </span>
              <span className="hidden text-sm font-medium md:inline">{st.clinic?.name}</span>
            </div>
            <nav className="flex flex-1 flex-wrap gap-0.5">
              {sections.map((s) => {
                const Icon = s.icon;
                return (
                  <NavLink
                    key={s.id}
                    to={ctx.path(s.id)}
                    className={({ isActive }) =>
                      cn(
                        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition',
                        isActive
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-muted-foreground hover:text-foreground',
                      )
                    }
                  >
                    <Icon className="h-4 w-4" />
                    <span className="hidden xl:inline">
                      {s.id === 'meds' ? 'Ombor' : s.id === 'dashboard' ? 'Hisobot' : s.label}
                    </span>
                  </NavLink>
                );
              })}
            </nav>
            <div className="flex items-center gap-2 text-sm">
              {reg && (
                <span className="bg-muted rounded px-2 py-0.5 text-xs font-semibold">
                  Kassa {reg}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <UserRound className="text-muted-foreground h-4 w-4" />
                {op.full_name}
                <span className="text-muted-foreground text-xs">
                  ({op.role === 'admin' ? 'admin' : 'kassir'})
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => void lock()}
                title="Ekranni qulflash / operator almashtirish"
              >
                <Lock className="mr-1 h-3.5 w-3.5" /> Qulflash
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8"
                title="Akkauntdan chiqish"
                onClick={() => {
                  if (
                    window.confirm(
                      'Dorixona akkauntidan butunlay chiqilsinmi? (keyingi safar Gmail bilan kirasiz)',
                    )
                  ) {
                    void onLogout();
                  }
                }}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {days <= 5 && (
            <div className="border-t border-amber-200 bg-amber-50 px-4 py-1 text-center text-xs text-amber-900">
              Dorixona obunasi {days} kundan keyin tugaydi — uzaytirish uchun{' '}
              {SUPPORT_PHONE_DISPLAY} ga qo'ng'iroq qiling.
            </div>
          )}
        </header>
        <main className="p-3 md:p-4">
          <Outlet />
        </main>
      </div>
    </PharmacyContext.Provider>
  );
}

/** /dorixona va /dorixona/:section */
export function DorixonaSection() {
  const { section } = useParams<{ section?: string }>();
  const ctx = usePharmacy();
  const id = sectionFromSlug('workspace', section);
  const fallback: SectionId = ctx.isAdmin ? 'dashboard' : 'pos';
  if (!section) return <Navigate to={ctx.path(fallback)} replace />;
  if (!id || !allowed(ctx, id)) return <Navigate to={ctx.path(fallback)} replace />;
  return <SectionView id={id} />;
}

/** /dorixona/sotuvlar/:saleId */
export function DorixonaSale() {
  return <SaleDetail />;
}
