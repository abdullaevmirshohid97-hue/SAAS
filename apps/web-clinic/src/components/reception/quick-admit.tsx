import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  cn,
} from '@clary/ui-web';
import { ArrowLeft, BedDouble, Building2, Settings as SettingsIcon, Utensils } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { InpatientAdmitForm } from '@/components/inpatient/admit-form';
import {
  TIER_LABEL,
  freeBedNumbers,
  groupRooms,
  isRoomFree,
  readQuickAdmit,
  tierOrder,
  type QuickAdmitGroup,
  type QuickAdmitRoom,
} from '@/lib/inpatient-quick-admit';

// =============================================================================
// Qabulxona: qizil "Statsionarga qabul" tugmasi (F1)
// =============================================================================
// Statsionar bo'limiga o'tmasdan: bo'lim → bo'sh xona (tarifi bilan) → bemor
// ma'lumoti → qabul. Bo'limlar va tugmaning o'zi Sozlamalar > Klinika'da.
// =============================================================================

// API'dagi POST /inpatient/admit ruxsati bilan bir xil
const ADMIT_ROLES = ['clinic_owner', 'clinic_admin', 'receptionist', 'super_admin'];
const SETTINGS_ROLES = ['clinic_owner', 'clinic_admin', 'super_admin'];

const fmt = (n: number) => n.toLocaleString('uz-UZ');

type Step = 'dept' | 'room' | 'form';

export function QuickAdmitButton({ className }: { className?: string }) {
  const { role } = useAuth();
  const allowed = ADMIT_ROLES.includes(role);
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ clinic?: { settings?: Record<string, unknown> } }>('/api/v1/auth/me'),
  });
  const cfg = useMemo(() => readQuickAdmit(me?.clinic?.settings), [me]);
  const { data: map } = useQuery({
    queryKey: ['inpatient-room-map'],
    queryFn: () => api.inpatient.roomMap(),
    enabled: allowed && cfg.enabled,
    staleTime: 15_000,
  });
  const rooms = useMemo(
    () => (map?.floors ?? []).flatMap((f) => f.rooms) as QuickAdmitRoom[],
    [map],
  );
  const groups = useMemo(() => groupRooms(rooms, cfg.departments), [rooms, cfg.departments]);
  const freeBeds = groups.reduce((s, g) => s + g.freeBeds, 0);
  const visible = allowed && cfg.enabled && rooms.length > 0;

  const [open, setOpen] = useState(false);

  // F1 — istalgan joydan (input ichida ham) tezkor qabul oynasi.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F1') return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Statsionarga tezkor qabul (F1)"
        className={cn(
          'inline-flex h-10 items-center gap-2 rounded-full bg-red-600 px-5 text-sm font-semibold text-white shadow-md shadow-red-600/25 transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 active:scale-[0.98]',
          className,
        )}
      >
        <BedDouble className="h-4 w-4" />
        Statsionarga qabul
        <span className="rounded bg-white/20 px-1.5 py-0.5 text-[11px] font-bold leading-none">
          F1
        </span>
        <span className="hidden text-xs font-normal text-white/80 sm:inline">
          · {freeBeds} bo&lsquo;sh joy
        </span>
      </button>
      {open && (
        <QuickAdmitDialog
          groups={groups}
          canConfigure={SETTINGS_ROLES.includes(role)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function QuickAdmitDialog({
  groups,
  canConfigure,
  onClose,
}: {
  groups: QuickAdmitGroup[];
  canConfigure: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  // Bitta bo'lim bo'lsa — darrov xonalarga
  const single = groups.length === 1 ? groups[0]!.id : null;
  const [step, setStep] = useState<Step>(single ? 'room' : 'dept');
  const [deptId, setDeptId] = useState<string | null>(single);
  const [roomId, setRoomId] = useState<string | null>(null);

  const dept = groups.find((g) => g.id === deptId) ?? null;
  // Xona ro'yxati yangilansa ham tanlangan xona ma'lumoti saqlanadi
  const room = dept?.rooms.find((r) => r.id === roomId) ?? null;

  const title =
    step === 'dept'
      ? "Statsionarga qabul — bo'limni tanlang"
      : step === 'room'
        ? `${dept?.name ?? ''} — bo'sh xonalar`
        : `№ ${room?.number ?? ''} xonaga qabul`;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BedDouble className="h-5 w-5 text-red-600" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {step === 'dept'
              ? "Bo'lim → xona → bemor ma'lumoti. Statsionar sahifasiga o'tish shart emas."
              : step === 'room'
                ? 'Tarif va narxiga qarab xonani tanlang.'
                : "Bemor ma'lumotini kiriting va qabul qiling."}
          </DialogDescription>
        </DialogHeader>

        {step === 'dept' && (
          <DeptStep
            groups={groups}
            canConfigure={canConfigure}
            onPick={(id) => {
              setDeptId(id);
              setStep('room');
            }}
            onSettings={() => {
              onClose();
              navigate('/settings/clinic');
            }}
          />
        )}

        {step === 'room' && dept && (
          <RoomStep
            group={dept}
            onBack={single ? undefined : () => setStep('dept')}
            onPick={(id) => {
              setRoomId(id);
              setStep('form');
            }}
          />
        )}

        {step === 'form' && dept && room && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-sm dark:border-red-900/50 dark:bg-red-950/20">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-muted-foreground">{dept.name}</span>
                <span className="font-semibold">№ {room.number}</span>
                {room.tier && <TierBadge tier={room.tier} />}
                <span className="font-medium">
                  {fmt(Number(room.daily_price_uzs ?? 0))} so&lsquo;m/kun
                </span>
                <span className="text-muted-foreground text-xs">
                  {room.vacancy}/{room.capacity} bo&lsquo;sh
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1"
                onClick={() => setStep('room')}
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Xonani o&lsquo;zgartirish
              </Button>
            </div>
            <InpatientAdmitForm
              key={room.id}
              fixedRoom={room}
              freeBeds={freeBedNumbers(room)}
              defaultTab="new"
              onCancel={onClose}
              onDone={(stay) => {
                toast.success(`Bemor № ${room.number} xonaga qabul qilindi`, {
                  action: stay
                    ? {
                        label: 'Ochish',
                        onClick: () => navigate(`/inpatient/stays/${stay.id}`),
                      }
                    : undefined,
                });
                onClose();
              }}
            />
          </div>
        )}

        {step === 'form' && (!dept || !room) && (
          <div className="text-muted-foreground py-6 text-center text-sm">
            Xona topilmadi.{' '}
            <button type="button" className="underline" onClick={() => setStep('room')}>
              Xonalarga qaytish
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeptStep({
  groups,
  canConfigure,
  onPick,
  onSettings,
}: {
  groups: QuickAdmitGroup[];
  canConfigure: boolean;
  onPick: (id: string) => void;
  onSettings: () => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="text-muted-foreground space-y-3 py-6 text-center text-sm">
        <div>Bo&lsquo;limlarga xona biriktirilmagan.</div>
        {canConfigure && (
          <Button size="sm" variant="outline" className="gap-1" onClick={onSettings}>
            <SettingsIcon className="h-4 w-4" /> Sozlamalar
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {groups.map((g, i) => {
          const full = g.freeBeds === 0;
          return (
            <button
              key={g.id}
              type="button"
              autoFocus={i === 0}
              onClick={() => onPick(g.id)}
              className={cn(
                'flex min-h-[96px] flex-col items-start justify-between rounded-xl border-2 p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400',
                full
                  ? 'border-muted bg-muted/30 hover:border-muted-foreground/30'
                  : 'border-red-200 bg-red-50/50 hover:border-red-500 hover:bg-red-50 dark:border-red-900/50 dark:bg-red-950/20',
              )}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-base font-semibold">{g.name}</span>
                <Building2 className="text-muted-foreground h-4 w-4 shrink-0" />
              </div>
              <div className="text-sm">
                {full ? (
                  <span className="text-muted-foreground">Bo&lsquo;sh joy yo&lsquo;q</span>
                ) : (
                  <>
                    <b className="text-red-700 dark:text-red-400">{g.freeBeds}</b> bo&lsquo;sh joy
                    <span className="text-muted-foreground"> · {g.freeRooms} xona</span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {canConfigure && (
        <div className="text-right">
          <button
            type="button"
            onClick={onSettings}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
          >
            <SettingsIcon className="h-3 w-3" /> Bo&lsquo;limlarni sozlash
          </button>
        </div>
      )}
    </div>
  );
}

function RoomStep({
  group,
  onBack,
  onPick,
}: {
  group: QuickAdmitGroup;
  onBack?: () => void;
  onPick: (roomId: string) => void;
}) {
  const [showFull, setShowFull] = useState(false);
  const [tier, setTier] = useState<string>('all');

  const tiers = useMemo(() => {
    const set = new Set(group.rooms.filter(isRoomFree).map((r) => r.tier ?? ''));
    return [...set].sort((a, b) => tierOrder(a || null) - tierOrder(b || null));
  }, [group.rooms]);

  const list = group.rooms.filter(
    (r) => (showFull || isRoomFree(r)) && (tier === 'all' || (r.tier ?? '') === tier),
  );
  const hidden = group.rooms.length - group.rooms.filter(isRoomFree).length;
  // Tarif bo'yicha bo'limchalar (bitta tarif bo'lsa — sarlavhasiz)
  const sections = useMemo(() => {
    const m = new Map<string, QuickAdmitRoom[]>();
    for (const r of list) {
      const k = r.tier ?? '';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return [...m.entries()].sort((a, b) => tierOrder(a[0] || null) - tierOrder(b[0] || null));
  }, [list]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {onBack && (
          <Button size="sm" variant="outline" className="h-8 gap-1" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Bo&lsquo;limlar
          </Button>
        )}
        {tiers.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {['all', ...tiers].map((t) => (
              <button
                key={t || 'none'}
                type="button"
                onClick={() => setTier(t)}
                className={cn(
                  'h-8 rounded-full border px-3 text-xs font-medium transition',
                  tier === t
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'hover:bg-accent',
                )}
              >
                {t === 'all' ? 'Barchasi' : t ? (TIER_LABEL[t] ?? t) : 'Tarifsiz'}
              </button>
            ))}
          </div>
        )}
        {hidden > 0 && (
          <label className="text-muted-foreground ml-auto inline-flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={showFull}
              onChange={(e) => setShowFull(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Band xonalar ham ({hidden})
          </label>
        )}
      </div>

      {list.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed py-8 text-center text-sm">
          Bu bo&lsquo;limda bo&lsquo;sh joy yo&lsquo;q.
        </div>
      ) : (
        sections.map(([t, rooms]) => (
          <div key={t || 'none'} className="space-y-2">
            {sections.length > 1 && (
              <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                {t ? (TIER_LABEL[t] ?? t) : 'Tarifsiz'} · {rooms.length}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {rooms.map((r) => (
                <RoomCard key={r.id} room={r} onPick={() => onPick(r.id)} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function RoomCard({ room, onPick }: { room: QuickAdmitRoom; onPick: () => void }) {
  const free = isRoomFree(room);
  const daily = Number(room.daily_price_uzs ?? 0);
  return (
    <button
      type="button"
      disabled={!free}
      onClick={onPick}
      className={cn(
        'flex flex-col gap-1 rounded-xl border-2 p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400',
        free
          ? 'border-emerald-300 bg-emerald-50/60 hover:border-emerald-500 dark:border-emerald-900/60 dark:bg-emerald-950/20'
          : 'border-muted bg-muted/30 cursor-not-allowed opacity-60',
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-base font-semibold">№ {room.number}</span>
        {room.tier && <TierBadge tier={room.tier} />}
      </div>
      <div className="text-sm font-medium">
        {daily > 0 ? `${fmt(daily)} so‘m` : 'Narx yo‘q'}
        <span className="text-muted-foreground text-xs font-normal">/kun</span>
      </div>
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1">
          <BedDouble className="h-3 w-3" />
          {free ? `${room.vacancy}/${room.capacity} bo‘sh` : 'Band'}
        </span>
        {(room.includes_meals || Number(room.meal_daily_uzs ?? 0) > 0) && (
          <Utensils className="h-3 w-3" aria-label="Ovqat" />
        )}
        {room.floor != null && room.floor !== 0 && <span>{room.floor}-qavat</span>}
      </div>
      {room.section && (
        <div className="text-muted-foreground truncate text-[11px]">{room.section}</div>
      )}
    </button>
  );
}

function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none',
        tier === 'lyuks'
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
          : tier === 'comfort'
            ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'
            : 'bg-muted text-muted-foreground',
      )}
    >
      {TIER_LABEL[tier] ?? tier}
    </span>
  );
}
