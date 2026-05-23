import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@clary/ui-web';
import {
  Activity,
  ArrowRightLeft,
  BedDouble,
  CheckCircle2,
  CircleDollarSign,
  LogOut,
  Plus,
  Stethoscope,
  UserCheck,
  UserPlus,
  Utensils,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '@/lib/api';

type Room = {
  id: string;
  number: string;
  floor: number | null;
  section: string | null;
  building: string | null;
  capacity: number;
  daily_price_uzs: number | null;
  half_day_price_uzs: number | null;
  meal_daily_uzs: number | null;
  status: string;
  type: string | null;
  includes_meals: boolean;
  notes: string | null;
  occupants: Array<{
    id: string;
    bed_no: string | null;
    patient: { id: string; full_name: string } | null;
    admitted_at: string;
  }>;
  occupied: number;
  vacancy: number;
};

type Stay = {
  id: string;
  patient_id: string;
  room_id: string | null;
  bed_no: string | null;
  admitted_at: string;
  discharged_at: string | null;
  status: string;
  planned_discharge_at: string | null;
  admission_reason: string | null;
  patient?: {
    id: string;
    full_name: string;
    phone?: string | null;
    dob?: string | null;
    gender?: string | null;
  };
  room?: { id: string; number: string; section: string | null; floor: number | null; building?: string | null; daily_price_uzs: number | null };
  doctor?: { id: string; full_name: string };
};

type InpatientView = 'map' | 'current' | 'history';

export function InpatientPage() {
  const [admitOpen, setAdmitOpen] = useState(false);
  const [preferredRoomId, setPreferredRoomId] = useState<string | null>(null);
  const [view, setView] = useState<InpatientView>('map');
  const navigate = useNavigate();

  const { data: map, isLoading } = useQuery({
    queryKey: ['inpatient-room-map'],
    queryFn: () => api.inpatient.roomMap(),
    refetchInterval: 30_000,
  });

  const { data: stays } = useQuery({
    queryKey: ['inpatient-stays', 'admitted'],
    queryFn: () => api.inpatient.list({ status: 'admitted' }),
  });

  // Tarix uchun barcha stays — faqat history tab tanlanganda yuklanadi.
  const { data: allStays, isLoading: allLoading } = useQuery({
    queryKey: ['inpatient-stays', 'all'],
    queryFn: () => api.inpatient.list(),
    enabled: view === 'history',
  });

  const totalRooms = (map?.floors ?? []).reduce((a, f) => a + f.rooms.length, 0);
  const totalCapacity = (map?.floors ?? []).reduce(
    (a, f) => a + f.rooms.reduce((s, r) => s + r.capacity, 0),
    0,
  );
  const totalOccupied = (map?.floors ?? []).reduce(
    (a, f) => a + f.rooms.reduce((s, r) => s + r.occupied, 0),
    0,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Statsionar"
        title="Bemorlar va xonalar"
        description="Xonalar xaritasi, qabul, davolash jadvali va bemor hisobi."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
              {(
                [
                  { id: 'map', label: 'Xonalar' },
                  { id: 'current', label: 'Faol bemorlar' },
                  { id: 'history', label: 'Barcha (tarix)' },
                ] as const
              ).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  className={cn(
                    'rounded px-3 py-1.5 text-xs font-medium transition',
                    view === v.id ? 'bg-background shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <Badge variant="secondary" className="gap-1">
              <BedDouble className="h-3.5 w-3.5" />
              {totalOccupied}/{totalCapacity} band
            </Badge>
            <Button size="sm" onClick={() => setAdmitOpen(true)}>
              <UserPlus className="mr-1 h-4 w-4" />
              Yangi qabul
            </Button>
          </div>
        }
      />

      {view === 'current' ? (
        <StaysTable
          rows={((stays as Stay[] | undefined) ?? [])}
          loading={false}
          empty="Hozir davolanayotgan bemor yo'q"
        />
      ) : view === 'history' ? (
        <StaysTable
          rows={((allStays as Stay[] | undefined) ?? [])}
          loading={allLoading}
          empty="Statsionar bemorlar tarixi bo'sh"
          showStatus
        />
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="h-40 animate-pulse" />
            </Card>
          ))}
        </div>
      ) : totalRooms === 0 ? (
        <EmptyState
          title="Xonalar sozlanmagan"
          description="Sozlamalar \u2192 Xonalar bo'limidan xonalarni qo'shing (bino, qavat, sig'im)."
          action={
            <Link to="/settings/catalog/rooms">
              <Button>
                <Plus className="mr-1 h-4 w-4" /> Xona qo&lsquo;shish
              </Button>
            </Link>
          }
        />
      ) : (() => {
          // Binolar bo'yicha guruhlash — agar 2+ bo'lsa chap/o'ng panel, aks holda
          // to'liq kenglik. Backend buildings[] qaytaradi (yangi), floors[] zaxira.
          const buildings = map?.buildings ?? [];
          const multipleBuildings = buildings.length >= 2;
          // Eski mijozlar uchun: buildings yo'q bo'lsa floors[] ni "Asosiy bino"ga
          // jamlab ko'rsatamiz.
          const list = buildings.length
            ? buildings
            : [{ building: 'Asosiy bino', floors: map?.floors ?? [] }];

          return (
            <div
              className={
                multipleBuildings
                  ? 'grid gap-0 lg:grid-cols-2 lg:divide-x lg:divide-border'
                  : 'space-y-4'
              }
            >
              {list.map((b, idx) => (
                <div
                  key={b.building}
                  className={cn(
                    'space-y-4',
                    multipleBuildings && (idx === 0 ? 'lg:pr-4' : 'lg:pl-4'),
                  )}
                >
                  {multipleBuildings && (
                    <div className="flex items-center gap-2 border-b pb-2">
                      <span className="rounded-md bg-primary/10 px-2.5 py-1 text-sm font-semibold text-primary">
                        {b.building}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {b.floors.reduce((s, f) => s + f.rooms.length, 0)} xona
                      </span>
                    </div>
                  )}
                  {b.floors.map((f) => (
                    <Card key={`${b.building}-${f.floor}`}>
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                            {f.floor === 0 ? 'Asosiy qavat' : `${f.floor}-qavat`}
                          </h3>
                          <span className="text-xs text-muted-foreground">
                            {f.rooms.length} xona
                          </span>
                        </div>
                        <div
                          className={
                            multipleBuildings
                              ? 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-3'
                              : 'grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'
                          }
                        >
                          {f.rooms.map((r) => (
                            <RoomTile
                              key={r.id}
                              room={r}
                              onAdmit={() => {
                                setPreferredRoomId(r.id);
                                setAdmitOpen(true);
                              }}
                              onSelect={(stayId) => navigate(`/inpatient/stays/${stayId}`)}
                            />
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ))}
            </div>
          );
        })()}

      {view === 'map' && ((stays as Stay[] | undefined) ?? []).length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <h3 className="text-sm font-semibold">Faol bemorlar</h3>
            <div className="divide-y">
              {(stays as Stay[]).map((s) => (
                <StayRow key={s.id} stay={s} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <AdmitDialog
        open={admitOpen}
        onClose={() => {
          setAdmitOpen(false);
          setPreferredRoomId(null);
        }}
        preferredRoomId={preferredRoomId}
      />
    </div>
  );
}

function RoomTile({
  room,
  onAdmit,
  onSelect,
}: {
  room: Room;
  onAdmit: () => void;
  onSelect: (stayId: string) => void;
}) {
  const full = room.vacancy === 0;
  const partial = room.occupied > 0 && !full;
  const empty = room.occupied === 0;
  const utilization = room.capacity > 0 ? (room.occupied / room.capacity) * 100 : 0;
  return (
    <div
      className={cn(
        'group flex min-h-[120px] flex-col justify-between rounded-xl border-2 p-3 transition',
        full && 'border-destructive/50 bg-destructive/5',
        partial && 'border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/20',
        empty && 'border-emerald-400/60 bg-emerald-50/60 hover:border-emerald-500 dark:bg-emerald-950/20',
      )}
    >
      <div>
        <div className="flex items-center justify-between">
          <div className="font-semibold">№ {room.number}</div>
          {room.includes_meals && <Utensils className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
        {room.section && (
          <div className="truncate text-xs text-muted-foreground">{room.section}</div>
        )}
        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <BedDouble className="h-3 w-3" /> {room.occupied}/{room.capacity}
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full transition-all',
              utilization >= 100 ? 'bg-destructive' : utilization >= 75 ? 'bg-warning' : 'bg-success',
            )}
            style={{ width: `${Math.min(100, utilization)}%` }}
          />
        </div>
      </div>

      <div className="mt-2 space-y-1">
        {room.occupants.slice(0, 2).map((o) => (
          <button
            key={o.id}
            onClick={() => onSelect(o.id)}
            className="block w-full truncate rounded bg-accent/40 px-1.5 py-0.5 text-left text-[11px] hover:bg-accent"
          >
            {o.patient?.full_name ?? '—'}
          </button>
        ))}
        {room.occupants.length > 2 && (
          <div className="text-[10px] text-muted-foreground">+{room.occupants.length - 2} yana</div>
        )}
        {!full && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-full gap-1 text-[10px]"
            onClick={onAdmit}
          >
            <Plus className="h-3 w-3" />
            Qabul
          </Button>
        )}
      </div>
    </div>
  );
}

type Assignment = {
  id: string;
  profile_id: string;
  role: 'doctor' | 'nurse';
  profile?: { id: string; full_name: string; role?: string };
};

function StayRow({ stay }: { stay: Stay }) {
  const qc = useQueryClient();
  const [showDischarge, setShowDischarge] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showMeals, setShowMeals] = useState(false);

  const { data: ledger } = useQuery({
    queryKey: ['inp-ledger', stay.patient_id],
    queryFn: () => api.inpatient.ledger(stay.patient_id),
    enabled: showLedger,
  });

  const { data: assignments } = useQuery({
    queryKey: ['inp-assignments', stay.id],
    queryFn: () => api.inpatient.listAssignments(stay.id),
    enabled: showAssign,
  });

  const dischargeMut = useMutation({
    mutationFn: (body: Parameters<typeof api.inpatient.discharge>[1]) =>
      api.inpatient.discharge(stay.id, body),
    onSuccess: () => {
      toast.success('Bemor chiqarildi');
      qc.invalidateQueries({ queryKey: ['inpatient-room-map'] });
      qc.invalidateQueries({ queryKey: ['inpatient-stays'] });
      setShowDischarge(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const days = Math.max(
    1,
    Math.round((Date.now() - new Date(stay.admitted_at).getTime()) / 86_400_000),
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate font-medium">{stay.patient?.full_name ?? '—'}</div>
          {stay.room && (
            <Badge variant="outline" className="text-[10px]">
              № {stay.room.number}
              {stay.bed_no ? ` / ${stay.bed_no}` : ''}
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {days} kun • {new Date(stay.admitted_at).toLocaleDateString()} •{' '}
          {stay.doctor?.full_name ?? 'Shifokor tayinlanmagan'}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => setShowAssign(true)}>
          <UserCheck className="h-3.5 w-3.5" />
          Xodimlar
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => setShowMeals(true)}>
          <Utensils className="h-3.5 w-3.5" />
          Ovqat
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => setShowLedger(true)}>
          <Wallet className="h-3.5 w-3.5" />
          Hisob
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => setShowTransfer(true)}>
          <ArrowRightLeft className="h-3.5 w-3.5" />
          Ko‘chirish
        </Button>
        <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setShowDischarge(true)}>
          <LogOut className="h-3.5 w-3.5" />
          Chiqarish
        </Button>
      </div>

      <Dialog open={showDischarge} onOpenChange={setShowDischarge}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Statsionardan chiqarish</DialogTitle>
          </DialogHeader>
          <DischargeForm
            stayId={stay.id}
            onSubmit={(body) => dischargeMut.mutate(body)}
            pending={dischargeMut.isPending}
            onCancel={() => setShowDischarge(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showLedger} onOpenChange={setShowLedger}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{stay.patient?.full_name ?? 'Bemor'} — hisob</DialogTitle>
          </DialogHeader>
          <LedgerPanel
            patientId={stay.patient_id}
            stayId={stay.id}
            balance={ledger?.balance ?? 0}
            entries={(ledger?.entries as LedgerEntry[] | undefined) ?? []}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showAssign} onOpenChange={setShowAssign}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{stay.patient?.full_name ?? 'Bemor'} — xodimlar</DialogTitle>
          </DialogHeader>
          <AssignmentsPanel
            stayId={stay.id}
            assignments={(assignments as Assignment[] | undefined) ?? []}
            onChanged={() => qc.invalidateQueries({ queryKey: ['inp-assignments', stay.id] })}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showTransfer} onOpenChange={setShowTransfer}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Xona ko‘chirish — {stay.patient?.full_name ?? 'Bemor'}</DialogTitle>
          </DialogHeader>
          <TransferPanel
            stayId={stay.id}
            currentRoomId={stay.room?.id ?? null}
            onDone={() => {
              setShowTransfer(false);
              qc.invalidateQueries({ queryKey: ['inpatient-room-map'] });
              qc.invalidateQueries({ queryKey: ['inpatient-stays'] });
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showMeals} onOpenChange={setShowMeals}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ovqat oraliqlari — {stay.patient?.full_name ?? 'Bemor'}</DialogTitle>
          </DialogHeader>
          <MealPeriodsPanel stayId={stay.id} defaultDailyUzs={stay.room?.daily_price_uzs ? 0 : 0} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Xona ko'chirish paneli ---
function TransferPanel({
  stayId,
  currentRoomId,
  onDone,
}: {
  stayId: string;
  currentRoomId: string | null;
  onDone: () => void;
}) {
  const [roomId, setRoomId] = useState('');
  const [bedNo, setBedNo] = useState('');
  const [reason, setReason] = useState('');

  const { data: rooms } = useQuery({
    queryKey: ['rooms-for-transfer'],
    queryFn: () => api.catalog.list('rooms', { pageSize: 200 }),
  });

  const mut = useMutation({
    mutationFn: () =>
      api.inpatient.transfer(stayId, {
        room_id: roomId,
        bed_no: bedNo || undefined,
        reason: reason || undefined,
      }),
    onSuccess: () => {
      toast.success('Bemor boshqa xonaga ko‘chirildi');
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items =
    (((rooms as { items?: Array<{ id: string; number: string; section: string | null; building?: string | null }> })?.items) ?? []).filter(
      (r) => r.id !== currentRoomId,
    );

  return (
    <div className="space-y-3">
      <label className="space-y-1 text-sm">
        <div className="text-xs font-medium text-muted-foreground">Yangi xona *</div>
        <Select value={roomId} onValueChange={setRoomId}>
          <SelectTrigger>
            <SelectValue placeholder="Xonani tanlang..." />
          </SelectTrigger>
          <SelectContent>
            {items.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.building ? `${r.building} • ` : ''}№ {r.number}
                {r.section ? ` • ${r.section}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="space-y-1 text-sm">
        <div className="text-xs font-medium text-muted-foreground">Yotoq № (ixtiyoriy)</div>
        <Input value={bedNo} onChange={(e) => setBedNo(e.target.value)} />
      </label>
      <label className="space-y-1 text-sm">
        <div className="text-xs font-medium text-muted-foreground">Sabab (ixtiyoriy)</div>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <DialogFooter>
        <Button onClick={() => mut.mutate()} disabled={!roomId || mut.isPending} className="gap-1">
          <ArrowRightLeft className="h-4 w-4" />
          Ko‘chirish
        </Button>
      </DialogFooter>
    </div>
  );
}

// --- Ovqat oraliqlari paneli ---
type MealPeriod = {
  id: string;
  stay_id: string;
  from_date: string;
  to_date: string | null;
  daily_uzs: number;
};

function MealPeriodsPanel({ stayId, defaultDailyUzs }: { stayId: string; defaultDailyUzs: number }) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState('');
  const [daily, setDaily] = useState(String(defaultDailyUzs || ''));

  const { data: periods } = useQuery({
    queryKey: ['meal-periods', stayId],
    queryFn: () => api.inpatient.listMealPeriods(stayId),
  });

  const addMut = useMutation({
    mutationFn: () =>
      api.inpatient.addMealPeriod({
        stay_id: stayId,
        from_date: fromDate,
        to_date: toDate || undefined,
        daily_uzs: Number(daily) || 0,
      }),
    onSuccess: () => {
      toast.success('Ovqat oralig‘i qo‘shildi');
      setToDate('');
      qc.invalidateQueries({ queryKey: ['meal-periods', stayId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const endMut = useMutation({
    mutationFn: (vars: { id: string; to: string }) =>
      api.inpatient.endMealPeriod(vars.id, { to_date: vars.to }),
    onSuccess: () => {
      toast.success('Ovqat to‘xtatildi');
      qc.invalidateQueries({ queryKey: ['meal-periods', stayId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = (periods as MealPeriod[] | undefined) ?? [];
  const fmt = (n: number) => n.toLocaleString('uz-UZ');

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/20 p-3">
        <div className="mb-2 text-xs font-semibold text-muted-foreground">Yangi oraliq qo‘shish</div>
        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-1 text-xs">
            <div className="text-muted-foreground">Boshlanish</div>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="space-y-1 text-xs">
            <div className="text-muted-foreground">Tugash (bo‘sh = davom)</div>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          <label className="space-y-1 text-xs">
            <div className="text-muted-foreground">Narx so‘m/kun</div>
            <Input type="number" min={0} value={daily} onChange={(e) => setDaily(e.target.value)} />
          </label>
        </div>
        <Button
          size="sm"
          className="mt-2 w-full gap-1"
          onClick={() => addMut.mutate()}
          disabled={!fromDate || !daily || addMut.isPending}
        >
          <Plus className="h-3.5 w-3.5" />
          Qo‘shish
        </Button>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Yangi oraliq qo‘shilganda eski ochiq oraliq avtomatik tugatiladi. Kunlik to‘lov shu sanalardan boshlab avto hisoblanadi.
        </p>
      </div>

      <div className="space-y-1">
        <div className="text-xs font-semibold text-muted-foreground">Mavjud oraliqlar</div>
        {list.length === 0 && (
          <p className="py-3 text-center text-sm text-muted-foreground">Ovqat oraliqlari yo‘q</p>
        )}
        <ul className="divide-y">
          {list.map((p) => {
            const open = p.to_date === null;
            return (
              <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <Utensils className="h-3.5 w-3.5 text-amber-600" />
                    <span className="font-medium">
                      {p.from_date} → {p.to_date ?? 'davom etmoqda'}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{fmt(p.daily_uzs)} so‘m/kun</div>
                </div>
                {open && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() =>
                      endMut.mutate({
                        id: p.id,
                        to: new Date().toISOString().slice(0, 10),
                      })
                    }
                    disabled={endMut.isPending}
                  >
                    Bugun to‘xtatish
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function AssignmentsPanel({
  stayId,
  assignments,
  onChanged,
}: {
  stayId: string;
  assignments: Assignment[];
  onChanged: () => void;
}) {
  const [profileId, setProfileId] = useState('');
  const [role, setRole] = useState<'doctor' | 'nurse'>('doctor');

  const { data: staff } = useQuery({
    queryKey: ['staff-for-assign'],
    queryFn: () => api.doctors.list(),
  });

  const addMut = useMutation({
    mutationFn: () => api.inpatient.addAssignment(stayId, { profile_id: profileId, role }),
    onSuccess: () => {
      toast.success('Xodim biriktirildi');
      setProfileId('');
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: (pid: string) => api.inpatient.removeAssignment(stayId, pid),
    onSuccess: () => {
      toast.success('Olib tashlandi');
      onChanged();
    },
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {assignments.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-3">Xodimlar biriktirilmagan</p>
        )}
        {assignments.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div className="flex items-center gap-2">
              {a.role === 'doctor' ? (
                <Stethoscope className="h-4 w-4 text-blue-500" />
              ) : (
                <Activity className="h-4 w-4 text-green-500" />
              )}
              <span className="text-sm font-medium">
                {(a as unknown as { profile?: { full_name?: string } }).profile?.full_name ?? a.profile_id}
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {a.role === 'doctor' ? 'Shifokor' : 'Hamshira'}
              </Badge>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeMut.mutate(a.profile_id)}
              disabled={removeMut.isPending}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="border-t pt-3 space-y-2">
        <div className="text-xs font-semibold text-muted-foreground">Xodim biriktirish</div>
        <div className="flex gap-2">
          <Select value={role} onValueChange={(v: 'doctor' | 'nurse') => setRole(v)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="doctor">Shifokor</SelectItem>
              <SelectItem value="nurse">Hamshira</SelectItem>
            </SelectContent>
          </Select>
          <Select value={profileId} onValueChange={setProfileId}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Tanlang..." />
            </SelectTrigger>
            <SelectContent>
              {((staff as Array<{ id: string; full_name: string }>) ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={() => addMut.mutate()}
            disabled={!profileId || addMut.isPending}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

const DISCHARGE_REASONS: Array<{
  value:
    | 'recovery'
    | 'treatment_refused'
    | 'negative_review'
    | 'admin'
    | 'transferred'
    | 'deceased'
    | 'other';
  label: string;
}> = [
  { value: 'recovery', label: 'Tuzaldi' },
  { value: 'treatment_refused', label: 'Davolanishdan voz kechdi' },
  { value: 'negative_review', label: 'Salbiy sharh' },
  { value: 'admin', label: "Ma'muriy" },
  { value: 'transferred', label: "Ko'chirildi" },
  { value: 'deceased', label: 'Vafot etgan' },
  { value: 'other', label: 'Boshqa' },
];

const PAYMENT_METHODS: Array<{
  value: 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'humo' | 'uzcard';
  label: string;
}> = [
  { value: 'cash', label: 'Naqd' },
  { value: 'card', label: 'Karta' },
  { value: 'transfer', label: "O'tkazma" },
  { value: 'click', label: 'Click' },
  { value: 'payme', label: 'Payme' },
  { value: 'humo', label: 'Humo' },
  { value: 'uzcard', label: 'Uzcard' },
];

function fmtUzs(n: number) {
  return n.toLocaleString('uz-UZ') + " so'm";
}

function DischargeForm({
  stayId,
  onSubmit,
  onCancel,
  pending,
}: {
  stayId: string;
  onSubmit: (body: Parameters<typeof api.inpatient.discharge>[1]) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [summary, setSummary] = useState('');
  const [reason, setReason] = useState<(typeof DISCHARGE_REASONS)[number]['value']>('recovery');
  const [paymentMethod, setPaymentMethod] = useState<
    (typeof PAYMENT_METHODS)[number]['value']
  >('cash');
  const [paid, setPaid] = useState('');
  const [force, setForce] = useState(false);
  const [writeoff, setWriteoff] = useState(false);
  const [refundDeposit, setRefundDeposit] = useState(false);

  const { data: bal, isLoading: balLoading } = useQuery({
    queryKey: ['inp-balance', stayId],
    queryFn: () => api.inpatient.balance(stayId),
  });

  const outstanding = bal?.outstanding_uzs ?? 0;
  const deposit = bal?.deposit_uzs ?? 0;
  const paidNum = Math.max(0, Number(paid) || 0);
  const remaining = Math.max(0, outstanding - paidNum);
  const isDeceased = reason === 'deceased';
  const needPay = !isDeceased || !writeoff;
  const canConfirm =
    !pending &&
    !balLoading &&
    ((isDeceased && writeoff) || paidNum >= outstanding || force);

  return (
    <div className="space-y-3">
      {balLoading ? (
        <div className="text-sm text-muted-foreground">Hisob yuklanmoqda...</div>
      ) : (
        <div className="rounded-lg border p-3 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-[11px] text-muted-foreground">Depozit</div>
              <div className="font-mono font-semibold">{fmtUzs(deposit)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Qoldiq</div>
              <div
                className={
                  'font-mono font-semibold ' +
                  (outstanding > 0 ? 'text-destructive' : 'text-emerald-600')
                }
              >
                {fmtUzs(outstanding)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Hozirgi to'lov</div>
              <div className="font-mono font-semibold">{fmtUzs(paidNum)}</div>
            </div>
          </div>
          {outstanding > 0 && paidNum < outstanding && !force && !(isDeceased && writeoff) && (
            <div className="mt-2 text-xs text-destructive">
              Yana {fmtUzs(remaining)} to'lash kerak (yoki "qarz bilan chiqarish")
            </div>
          )}
        </div>
      )}

      {/* Depozit qoldig'i ogohlantirishi — operator qaytarishni tanlashi mumkin */}
      {!balLoading && deposit > 0 && !isDeceased && (
        <label className="flex items-start gap-2 rounded-md border border-sky-300 bg-sky-50 p-2.5 text-sm">
          <input
            type="checkbox"
            checked={refundDeposit}
            onChange={(e) => setRefundDeposit(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <strong>Bemorda {fmtUzs(deposit)} depozit qoldig'i bor.</strong>{' '}
            Belgilansa — qoldiq qaytariladi (kassa va jurnalga yoziladi).
            Belgilanmasa — depozit bemor hisobida qoladi.
          </span>
        </label>
      )}

      <div className="space-y-1">
        <div className="text-xs font-medium">Chiqarish sababi *</div>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as typeof reason)}
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
        >
          {DISCHARGE_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {isDeceased && outstanding > 0 && (
        <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm">
          <input
            type="checkbox"
            checked={writeoff}
            onChange={(e) => setWriteoff(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <strong>Balance write-off</strong> — qoldiq {fmtUzs(outstanding)} adjustment bilan yopiladi
            (oilaga taqdim etish kerak emas).
          </span>
        </label>
      )}

      {needPay && (
        <>
          <div className="space-y-1">
            <div className="text-xs font-medium">To'lov turi</div>
            <div className="flex flex-wrap gap-1">
              {PAYMENT_METHODS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPaymentMethod(p.value)}
                  className={
                    'rounded-md border px-2.5 py-1 text-xs ' +
                    (paymentMethod === p.value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'hover:bg-accent')
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium">To'langan summa (so'm)</div>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
                placeholder={String(outstanding)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPaid(String(outstanding))}
              >
                To'liq
              </Button>
            </div>
          </div>

          {outstanding > 0 && paidNum < outstanding && (
            <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>Qarz bilan chiqarish</strong> — qoldiq {fmtUzs(remaining)} keyinroq to'lash uchun yoziladi.
              </span>
            </label>
          )}
        </>
      )}

      <div className="space-y-1">
        <div className="text-xs font-medium">Chiqarish xulosasi (ixtiyoriy)</div>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Bekor
        </Button>
        <Button
          onClick={() =>
            onSubmit({
              summary: summary || undefined,
              discharge_reason: reason,
              discharge_payment_method: needPay ? paymentMethod : undefined,
              paid_amount_uzs: needPay ? paidNum : 0,
              force,
              deceased_writeoff: isDeceased && writeoff,
              refund_deposit: refundDeposit,
            })
          }
          disabled={!canConfirm}
        >
          <CheckCircle2 className="mr-1 h-4 w-4" />
          Tasdiqlash
        </Button>
      </DialogFooter>
    </div>
  );
}

type LedgerEntry = {
  id: string;
  entry_kind: 'deposit' | 'charge' | 'refund' | 'adjustment';
  amount_uzs: number;
  description: string | null;
  created_at: string;
};

function LedgerPanel({
  patientId,
  stayId,
  balance,
  entries,
}: {
  patientId: string;
  stayId: string;
  balance: number;
  entries: LedgerEntry[];
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<'deposit' | 'charge' | 'refund' | 'adjustment'>('deposit');
  const [description, setDescription] = useState('');

  const addMut = useMutation({
    mutationFn: () =>
      api.inpatient.addLedger({
        patient_id: patientId,
        stay_id: stayId,
        entry_kind: kind,
        amount_uzs: Math.abs(Number(amount) || 0),
        description: description || undefined,
      }),
    onSuccess: () => {
      toast.success('Hisobga yozildi');
      setAmount('');
      setDescription('');
      qc.invalidateQueries({ queryKey: ['inp-ledger', patientId] });
    },
  });

  const sign = (kind: string) => (kind === 'charge' ? '-' : '+');

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-muted/30 p-4 text-center">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Joriy qoldiq</div>
        <div
          className={cn(
            'mt-1 text-3xl font-bold tabular-nums',
            balance < 0 ? 'text-destructive' : 'text-success',
          )}
        >
          {balance.toLocaleString()} so&lsquo;m
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={kind} onValueChange={(v: typeof kind) => setKind(v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="deposit">Depozit (+)</SelectItem>
            <SelectItem value="charge">Xarajat (\u2212)</SelectItem>
            <SelectItem value="refund">Qaytarish (+)</SelectItem>
            <SelectItem value="adjustment">Tuzatish</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          placeholder="Miqdor (so'm)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <Input
        placeholder="Izoh (ixtiyoriy)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Button
        className="w-full gap-1"
        onClick={() => addMut.mutate()}
        disabled={!amount || addMut.isPending}
      >
        <CircleDollarSign className="h-4 w-4" />
        Yozish
      </Button>

      <div className="space-y-1 border-t pt-3">
        <div className="text-xs font-semibold text-muted-foreground">Oxirgi yozuvlar</div>
        {entries.length === 0 && (
          <div className="py-4 text-center text-xs text-muted-foreground">Yozuvlar yo&lsquo;q</div>
        )}
        <ul className="max-h-60 divide-y overflow-auto">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-1.5 text-sm">
              <div>
                <div className="text-xs font-medium capitalize">{e.entry_kind}</div>
                {e.description && (
                  <div className="text-[11px] text-muted-foreground">{e.description}</div>
                )}
              </div>
              <div
                className={cn(
                  'font-mono text-sm font-semibold tabular-nums',
                  e.amount_uzs < 0 ? 'text-destructive' : 'text-success',
                )}
              >
                {sign(e.entry_kind)}
                {Math.abs(e.amount_uzs).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type Patient = { id: string; full_name: string };

const ADMISSION_CATEGORIES = [
  { value: 'kardiologiya', label: 'Kardiologiya' },
  { value: 'jarrohlik', label: 'Jarrohlik' },
  { value: 'yuqumli', label: 'Yuqumli kasallik' },
  { value: 'nevrologiya', label: 'Nevrologiya' },
  { value: 'terapiya', label: 'Terapiya' },
  { value: 'ginekologiya', label: 'Ginekologiya' },
  { value: 'pediatriya', label: 'Pediatriya' },
  { value: 'boshqa', label: 'Boshqa' },
];

function AdmitDialog({
  open,
  onClose,
  preferredRoomId,
}: {
  open: boolean;
  onClose: () => void;
  preferredRoomId: string | null;
}) {
  const qc = useQueryClient();
  const [admitTab, setAdmitTab] = useState<'existing' | 'new'>('existing');

  // Existing patient fields
  const [patientId, setPatientId] = useState('');
  const [patientQuery, setPatientQuery] = useState('');

  // New patient fields
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [patronymic, setPatronymic] = useState('');
  const [dob, setDob] = useState('');
  const [address, setAddress] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [phone, setPhone] = useState('');

  // Common fields
  const [roomId, setRoomId] = useState<string>(preferredRoomId ?? '');
  const [bedNo, setBedNo] = useState('');
  const [doctorId, setDoctorId] = useState<string>('');
  const [admissionCategory, setAdmissionCategory] = useState('');
  const [admissionReason, setAdmissionReason] = useState('');
  const [deposit, setDeposit] = useState('');
  // Ovqat va yarim kunlik tariflar — xonadagi narxlardan o'qiladi.
  const [withMeal, setWithMeal] = useState(false);
  const [isHalfDay, setIsHalfDay] = useState(false);

  useEffect(() => {
    if (preferredRoomId) setRoomId(preferredRoomId);
  }, [preferredRoomId]);

  const { data: rooms } = useQuery({
    queryKey: ['rooms-available'],
    queryFn: () => api.catalog.list('rooms', { pageSize: 200 }),
    enabled: open,
  });
  const { data: doctors } = useQuery({
    queryKey: ['doctors-for-admit'],
    queryFn: () => api.doctors.list(),
    enabled: open,
  });
  const { data: patientsRes } = useQuery({
    queryKey: ['patients-search-adm', patientQuery],
    queryFn: () => api.patients.list({ q: patientQuery, pageSize: 10 }),
    enabled: open && patientQuery.length > 1,
  });

  const createPatientMut = useMutation({
    mutationFn: () =>
      api.patients.create({
        last_name: lastName,
        first_name: firstName,
        patronymic: patronymic || undefined,
        date_of_birth: dob || undefined,
        address: address || undefined,
        gender: gender || undefined,
        phone: phone || undefined,
      }),
  });

  const admitMut = useMutation({
    mutationFn: (pid: string) =>
      api.inpatient.admit({
        patient_id: pid,
        room_id: roomId || undefined,
        bed_no: bedNo || undefined,
        attending_doctor_id: doctorId || undefined,
        admission_reason: [admissionCategory, admissionReason].filter(Boolean).join(': ') || undefined,
        initial_deposit_uzs: deposit ? Number(deposit) : undefined,
        with_meal: withMeal,
        is_half_day: isHalfDay,
      }),
    onSuccess: () => {
      toast.success('Bemor statsionarga qabul qilindi');
      qc.invalidateQueries({ queryKey: ['inpatient-room-map'] });
      qc.invalidateQueries({ queryKey: ['inpatient-stays'] });
      resetAndClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSubmit = async () => {
    try {
      let pid = patientId;
      if (admitTab === 'new') {
        if (!lastName || !firstName) {
          toast.error('Familiya va ism majburiy');
          return;
        }
        const newPatient = await createPatientMut.mutateAsync();
        pid = (newPatient as { id: string }).id;
      }
      if (!pid) {
        toast.error('Bemorni tanlang');
        return;
      }
      admitMut.mutate(pid);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const resetAndClose = () => {
    setPatientId('');
    setPatientQuery('');
    setLastName('');
    setFirstName('');
    setPatronymic('');
    setDob('');
    setAddress('');
    setGender('');
    setPhone('');
    setRoomId('');
    setBedNo('');
    setDoctorId('');
    setAdmissionCategory('');
    setAdmissionReason('');
    setDeposit('');
    setWithMeal(false);
    setIsHalfDay(false);
    setAdmitTab('existing');
    onClose();
  };

  const isPending = createPatientMut.isPending || admitMut.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? resetAndClose() : null)}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Statsionarga qabul</DialogTitle>
        </DialogHeader>

        {/* Tab toggle */}
        <div className="inline-flex rounded-lg border bg-muted/30 p-1 mb-1">
          <button
            onClick={() => setAdmitTab('existing')}
            className={cn(
              'rounded px-3 py-1.5 text-xs font-medium transition',
              admitTab === 'existing' ? 'bg-background shadow-sm' : 'text-muted-foreground',
            )}
          >
            Mavjud bemor
          </button>
          <button
            onClick={() => setAdmitTab('new')}
            className={cn(
              'rounded px-3 py-1.5 text-xs font-medium transition',
              admitTab === 'new' ? 'bg-background shadow-sm' : 'text-muted-foreground',
            )}
          >
            Yangi bemor
          </button>
        </div>

        <div className="space-y-3">
          {admitTab === 'existing' ? (
            <label className="space-y-1 text-sm">
              <div className="text-xs font-medium text-muted-foreground">Bemorni qidirish</div>
              <Input
                placeholder="Ism familyasi..."
                value={patientQuery}
                onChange={(e) => setPatientQuery(e.target.value)}
              />
              {patientQuery.length > 1 && (
                <div className="max-h-40 overflow-auto rounded-md border">
                  {(((patientsRes as { items?: Patient[] })?.items ?? []) as Patient[]).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPatientId(p.id);
                        setPatientQuery(p.full_name);
                      }}
                      className={cn(
                        'block w-full px-3 py-1.5 text-left text-sm hover:bg-accent',
                        p.id === patientId ? 'bg-primary/10 text-primary' : '',
                      )}
                    >
                      {p.full_name}
                    </button>
                  ))}
                </div>
              )}
            </label>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-1 text-sm">
                  <div className="text-xs font-medium text-muted-foreground">Familiya *</div>
                  <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </label>
                <label className="space-y-1 text-sm">
                  <div className="text-xs font-medium text-muted-foreground">Ism *</div>
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </label>
                <label className="space-y-1 text-sm">
                  <div className="text-xs font-medium text-muted-foreground">Otasining ismi</div>
                  <Input value={patronymic} onChange={(e) => setPatronymic(e.target.value)} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-sm">
                  <div className="text-xs font-medium text-muted-foreground">Tug'ilgan sana</div>
                  <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
                </label>
                <label className="space-y-1 text-sm">
                  <div className="text-xs font-medium text-muted-foreground">Jinsi</div>
                  <Select value={gender} onValueChange={(v: 'male' | 'female') => setGender(v)}>
                    <SelectTrigger><SelectValue placeholder="Tanlang..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Erkak</SelectItem>
                      <SelectItem value="female">Ayol</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-sm">
                  <div className="text-xs font-medium text-muted-foreground">Telefon</div>
                  <Input type="tel" placeholder="+998..." value={phone} onChange={(e) => setPhone(e.target.value)} />
                </label>
                <label className="space-y-1 text-sm">
                  <div className="text-xs font-medium text-muted-foreground">Manzil</div>
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} />
                </label>
              </div>
            </>
          )}

          {/* Common fields */}
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <div className="text-xs font-medium text-muted-foreground">Xona</div>
              <Select value={roomId} onValueChange={setRoomId}>
                <SelectTrigger>
                  <SelectValue placeholder="Tanlang..." />
                </SelectTrigger>
                <SelectContent>
                  {(((rooms as { items?: Array<{ id: string; number: string; section: string | null; tier?: string | null; daily_price_uzs?: number | null }> })?.items ?? []) as Array<{
                    id: string;
                    number: string;
                    section: string | null;
                    tier?: string | null;
                    daily_price_uzs?: number | null;
                  }>).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      № {r.number}
                      {r.tier ? ` • ${r.tier}` : ''}
                      {r.section ? ` • ${r.section}` : ''}
                      {r.daily_price_uzs ? ` • ${r.daily_price_uzs.toLocaleString()}/kun` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <div className="text-xs font-medium text-muted-foreground">Yotoq № (ixtiyoriy)</div>
              <Input value={bedNo} onChange={(e) => setBedNo(e.target.value)} />
            </label>
          </div>

          {roomId && <RoomIncludedPreview roomId={roomId} />}

          {/* Yarim kunlik tarif va ovqat tugmalari + jonli narx ko'rsatkichi */}
          {roomId && (
            <AdmitPricePicker
              rooms={(rooms as { items?: Array<Record<string, unknown>> } | undefined)?.items ?? []}
              roomId={roomId}
              withMeal={withMeal}
              isHalfDay={isHalfDay}
              onWithMealChange={setWithMeal}
              onHalfDayChange={setIsHalfDay}
            />
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <div className="text-xs font-medium text-muted-foreground">Shifokor</div>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Tanlang..." />
                </SelectTrigger>
                <SelectContent>
                  {(((doctors as Array<{ id: string; full_name: string }>) ?? [])).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <div className="text-xs font-medium text-muted-foreground">Yotish sababi (kategoriya)</div>
              <Select value={admissionCategory} onValueChange={setAdmissionCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Tanlang..." />
                </SelectTrigger>
                <SelectContent>
                  {ADMISSION_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          <label className="space-y-1 text-sm">
            <div className="text-xs font-medium text-muted-foreground">Qo'shimcha izoh</div>
            <textarea
              value={admissionReason}
              onChange={(e) => setAdmissionReason(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
          </label>

          <label className="space-y-1 text-sm">
            <div className="text-xs font-medium text-muted-foreground">Boshlang&lsquo;ich depozit</div>
            <Input
              type="number"
              placeholder="0"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose}>
            <X className="mr-1 h-4 w-4" />
            Bekor
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || (admitTab === 'existing' && !patientId)}
            className="gap-1"
          >
            <ArrowRightLeft className="h-4 w-4" />
            {isPending ? 'Saqlanmoqda…' : 'Qabul qilish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoomIncludedPreview({ roomId }: { roomId: string }) {
  const { data } = useQuery({
    queryKey: ['room-included', roomId],
    queryFn: () => api.inpatient.listIncludedServices(roomId),
    enabled: !!roomId,
  });
  const items = data ?? [];
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm">
      <div className="mb-1 text-xs font-semibold text-emerald-900">Bu xonaga qo'shilgan xizmatlar:</div>
      <ul className="space-y-0.5">
        {items.map((it) => {
          const name = it.service?.name_i18n
            ? (it.service.name_i18n['uz-Latn'] ?? Object.values(it.service.name_i18n)[0] ?? 'Xizmat')
            : 'Xizmat';
          return (
            <li key={it.id} className="flex justify-between text-emerald-900">
              <span>{name}</span>
              <span className="font-mono text-xs">{it.frequency_per_week}/hafta</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 text-[11px] text-emerald-900/70">Bu xizmatlar admit'dan keyin hamshira tomonidan care_item sifatida qilinadi.</div>
    </div>
  );
}

// Ovqat va yarim kunlik tariflar — bemorni qabul qilishda tanlash + jonli narx.
function AdmitPricePicker({
  rooms,
  roomId,
  withMeal,
  isHalfDay,
  onWithMealChange,
  onHalfDayChange,
}: {
  rooms: Array<Record<string, unknown>>;
  roomId: string;
  withMeal: boolean;
  isHalfDay: boolean;
  onWithMealChange: (v: boolean) => void;
  onHalfDayChange: (v: boolean) => void;
}) {
  const room = rooms.find((r) => r.id === roomId) as
    | {
        daily_price_uzs?: number | null;
        half_day_price_uzs?: number | null;
        meal_daily_uzs?: number | null;
      }
    | undefined;
  if (!room) return null;
  const daily = Number(room.daily_price_uzs ?? 0);
  const halfDay = room.half_day_price_uzs != null ? Number(room.half_day_price_uzs) : Math.floor(daily / 2);
  const meal = Number(room.meal_daily_uzs ?? 0);
  const base = isHalfDay ? halfDay : daily;
  const total = base + (withMeal ? meal : 0);
  const fmt = (n: number) => n.toLocaleString('uz-UZ');

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div className="text-xs font-medium text-muted-foreground">Tarif va qo‘shimcha</div>
      <div className="flex flex-wrap items-center gap-3">
        {(halfDay > 0 || daily > 0) && (
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isHalfDay}
              onChange={(e) => onHalfDayChange(e.target.checked)}
              className="h-4 w-4"
            />
            Yarim kunlik tarif
            <span className="text-xs text-muted-foreground">
              ({fmt(halfDay)} so‘m)
            </span>
          </label>
        )}
        {meal > 0 && (
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withMeal}
              onChange={(e) => onWithMealChange(e.target.checked)}
              className="h-4 w-4"
            />
            Ovqat bilan
            <span className="text-xs text-muted-foreground">
              (+{fmt(meal)} so‘m/kun)
            </span>
          </label>
        )}
      </div>
      <div className="flex items-center justify-between border-t pt-2">
        <span className="text-xs text-muted-foreground">
          {isHalfDay ? 'Yarim kun' : 'Kuniga'}{withMeal ? ' + ovqat' : ''}:
        </span>
        <span className="text-base font-semibold">
          {fmt(total)} so‘m
        </span>
      </div>
    </div>
  );
}

// Yosh hisoblash (dob -> bugungi yosh).
function calcAge(dob: string | null | undefined): string {
  if (!dob) return '—';
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return '—';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return `${age}`;
}

const GENDER_LABEL: Record<string, string> = {
  male: 'Erkak',
  female: 'Ayol',
  other: 'Boshqa',
  unknown: '—',
};

const STATUS_LABEL: Record<string, { label: string; tone: 'success' | 'default' | 'warning' | 'destructive' }> = {
  admitted: { label: 'Davolanmoqda', tone: 'success' },
  discharged: { label: 'Chiqarilgan', tone: 'default' },
  transferred: { label: 'O‘tkazilgan', tone: 'warning' },
  deceased: { label: 'Vafot etgan', tone: 'destructive' },
};

// Statsionar bemorlar jadvali — Joriy va Tarix tab'lari ishlatadi.
function StaysTable({
  rows,
  loading,
  empty,
  showStatus,
}: {
  rows: Stay[];
  loading: boolean;
  empty: string;
  showStatus?: boolean;
}) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Yuklanmoqda…</CardContent>
      </Card>
    );
  }
  if (rows.length === 0) {
    return <EmptyState title={empty} description="Ma'lumot topilmadi" />;
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5">Xona</th>
                <th className="px-3 py-2.5">Bemor</th>
                <th className="px-3 py-2.5">Telefon</th>
                <th className="px-3 py-2.5">Yosh</th>
                <th className="px-3 py-2.5">Jins</th>
                <th className="px-3 py-2.5">Shifokor</th>
                <th className="px-3 py-2.5">Qabul</th>
                {showStatus && <th className="px-3 py-2.5">Holat</th>}
                <th className="px-3 py-2.5">Izoh</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const status = STATUS_LABEL[s.status] ?? { label: s.status, tone: 'default' as const };
                const roomLabel = s.room
                  ? `№${s.room.number}${s.room.section ? ` · ${s.room.section}` : ''}${s.bed_no ? ` / ${s.bed_no}` : ''}`
                  : '—';
                return (
                  <tr
                    key={s.id}
                    className="cursor-pointer border-b last:border-b-0 hover:bg-accent/30"
                    onClick={() => navigate(`/inpatient/stays/${s.id}`)}
                  >
                    <td className="px-3 py-2.5 font-medium">{roomLabel}</td>
                    <td className="px-3 py-2.5">{s.patient?.full_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {s.patient?.phone ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{calcAge(s.patient?.dob)}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {s.patient?.gender ? (GENDER_LABEL[s.patient.gender] ?? s.patient.gender) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{s.doctor?.full_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {new Date(s.admitted_at).toLocaleDateString('uz-UZ')}
                    </td>
                    {showStatus && (
                      <td className="px-3 py-2.5">
                        <Badge variant={status.tone as 'success' | 'default' | 'destructive'}>{status.label}</Badge>
                      </td>
                    )}
                    <td className="px-3 py-2.5 max-w-[240px] truncate text-xs text-muted-foreground" title={s.admission_reason ?? ''}>
                      {s.admission_reason ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button size="sm" variant="outline">Batafsil</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}


