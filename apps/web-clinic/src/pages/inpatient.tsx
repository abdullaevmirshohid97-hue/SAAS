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
  StatCard,
  cn,
} from '@clary/ui-web';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Eye,
  BedDouble,
  CheckCircle2,
  CircleDollarSign,
  LogOut,
  MapPin,
  Phone,
  Plus,
  Printer,
  Receipt,
  Search,
  Stethoscope,
  Trash2,
  UserCheck,
  UserCog,
  UserPlus,
  Utensils,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link, useNavigate } from 'react-router-dom';

import type { InpatientDebtor } from '@clary/api-client';

import { api } from '@/lib/api';
import { printReceiptHybrid, paymentReceiptHtml, inpatientDischargeReceiptHtml } from '@/lib/print-receipt';
import { PaymentSplitEditor, type PaymentLeg } from '@/components/cashier/payment-split-editor';
import { EncashDialog } from '@/components/cashier/encash-dialog';
import { DrawerPanelDialog } from '@/components/cashier/drawer-panel-dialog';
import { SafePanelDialog } from '@/components/cashier/safe-panel-dialog';
import { KpiDetailDialog, type KpiMetric } from '@/components/cashier/kpi-detail-dialog';

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

export type Stay = {
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

type InpatientView = 'map' | 'current' | 'history' | 'debtors' | 'cashier' | 'journal';

// Faol kassa smenasi yo'q bo'lsa ko'rsatiladigan qizil ogohlantirish banneri.
// Pul amallari (deposit, to'lov, rasxot) faqat smena ochiq bo'lganda ishlaydi.
export function ShiftWarningBanner() {
  const { data: shift, isLoading } = useQuery({
    queryKey: ['shift-active'],
    queryFn: () => api.shifts.active(),
    refetchInterval: 30_000,
  });
  if (isLoading || shift) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
      <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
      <div>
        <div className="font-semibold text-red-700">Kassa smenasi ochilmagan!</div>
        <div className="text-xs">
          Depozit, to'lov, kirim/chiqim va rasxot amallari bloklangan. Avval{' '}
          <strong>Kassa → Smena ochish</strong> orqali smenani oching.
        </div>
      </div>
    </div>
  );
}

// Faol smena bormi — hook (tugmalarni disable qilish uchun).
export function useActiveShift() {
  const { data: shift } = useQuery({
    queryKey: ['shift-active'],
    queryFn: () => api.shifts.active(),
    refetchInterval: 30_000,
  });
  return { hasShift: !!shift, shift };
}

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

  // Qarzdorlar — faqat debtors tab tanlanganda yuklanadi.
  const { data: debtors, isLoading: debtorsLoading } = useQuery({
    queryKey: ['inpatient-debtors'],
    queryFn: () => api.inpatient.debtors(),
    enabled: view === 'debtors',
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
      <ShiftWarningBanner />
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
                  { id: 'cashier', label: 'Kassa' },
                  { id: 'journal', label: 'Jurnal' },
                  { id: 'debtors', label: 'Qarzdorlar' },
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

      {/* ============ KPI kartochkalar (har doim tepada, map view'da) ============ */}
      {view === 'map' && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Jami xonalar"
            value={String(totalRooms)}
            icon={<BedDouble className="h-4 w-4" />}
            tone="info"
          />
          <StatCard
            label="Band joylar"
            value={`${totalOccupied} / ${totalCapacity}`}
            icon={<UserCheck className="h-4 w-4" />}
            tone={totalOccupied >= totalCapacity ? 'danger' : totalOccupied > totalCapacity * 0.75 ? 'warning' : 'success'}
          />
          <StatCard
            label="Faol bemorlar"
            value={String(((stays as Stay[] | undefined) ?? []).length)}
            icon={<Activity className="h-4 w-4" />}
            tone="default"
          />
          <StatCard
            label="Bo'sh joy"
            value={String(Math.max(0, totalCapacity - totalOccupied))}
            icon={<Plus className="h-4 w-4" />}
            tone="success"
          />
        </div>
      )}

      {/* ============ FAOL BEMORLAR — map view'da tepada (xaritadan oldin) ============ */}
      {view === 'map' && ((stays as Stay[] | undefined) ?? []).length > 0 && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Activity className="h-4 w-4 text-emerald-600" />
                Faol bemorlar ({((stays as Stay[] | undefined) ?? []).length})
              </h3>
              <Badge variant="secondary" className="text-[10px]">
                Hozir davolanmoqda
              </Badge>
            </div>
            <div className="divide-y divide-emerald-100">
              {(stays as Stay[]).map((s) => (
                <StayRow key={s.id} stay={s} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ============ Kontent (map / current / history) ============ */}
      {view === 'cashier' ? (
        <InpatientCashierView />
      ) : view === 'journal' ? (
        <InpatientJournalView />
      ) : view === 'debtors' ? (
        <InpatientDebtorsView data={debtors} loading={debtorsLoading} />
      ) : view === 'current' ? (
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

export type Assignment = {
  id: string;
  profile_id: string;
  role: 'doctor' | 'nurse';
  profile?: { id: string; full_name: string; role?: string };
};

function StayRow({ stay }: { stay: Stay }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showDischarge, setShowDischarge] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showMeals, setShowMeals] = useState(false);
  const [showChangeDoctor, setShowChangeDoctor] = useState(false);

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
      <div className="flex flex-wrap items-center gap-0.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => navigate(`/inpatient/stays/${stay.id}`)}
          title="Batafsil ko'rish"
        >
          <Eye className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => setShowAssign(true)}
          title="Xodimlar"
        >
          <UserCheck className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => setShowMeals(true)}
          title="Ovqat oraliqlari"
        >
          <Utensils className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => setShowLedger(true)}
          title="Hisob"
        >
          <Wallet className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => setShowTransfer(true)}
          title="Boshqa xonaga ko'chirish"
        >
          <ArrowRightLeft className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => setShowChangeDoctor(true)}
          title="Shifokorni o'zgartirish"
        >
          <Stethoscope className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs ml-1"
          onClick={() => setShowDischarge(true)}
          title="Statsionardan chiqarish"
        >
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

      <Dialog open={showChangeDoctor} onOpenChange={setShowChangeDoctor}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Shifokorni o‘zgartirish — {stay.patient?.full_name ?? 'Bemor'}</DialogTitle>
          </DialogHeader>
          <ChangeDoctorPanel
            stayId={stay.id}
            currentDoctorId={stay.doctor?.id ?? null}
            currentDoctorName={stay.doctor?.full_name ?? null}
            onDone={() => {
              setShowChangeDoctor(false);
              qc.invalidateQueries({ queryKey: ['inpatient-room-map'] });
              qc.invalidateQueries({ queryKey: ['inpatient-stays'] });
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Shifokorni o'zgartirish paneli ---
export function ChangeDoctorPanel({
  stayId,
  currentDoctorId,
  currentDoctorName,
  onDone,
}: {
  stayId: string;
  currentDoctorId: string | null;
  currentDoctorName: string | null;
  onDone: () => void;
}) {
  const [doctorId, setDoctorId] = useState(currentDoctorId ?? '');
  const [reason, setReason] = useState('');

  const { data: doctors } = useQuery({
    queryKey: ['doctors-list'],
    queryFn: () => api.doctors.list(),
  });

  const mut = useMutation({
    mutationFn: () =>
      api.inpatient.changeDoctor(stayId, {
        attending_doctor_id: doctorId || null,
        reason: reason || undefined,
      }),
    onSuccess: () => {
      toast.success('Shifokor o‘zgartirildi');
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = ((doctors as Array<{ id: string; full_name: string }>) ?? []).filter(
    (d) => d.id !== currentDoctorId,
  );

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Hozirgi shifokor: <span className="font-medium">{currentDoctorName ?? '— tayinlanmagan —'}</span>
      </div>
      <label className="space-y-1 text-sm">
        <div className="text-xs font-medium text-muted-foreground">Yangi shifokor</div>
        <Select value={doctorId} onValueChange={setDoctorId}>
          <SelectTrigger>
            <SelectValue placeholder="Shifokorni tanlang..." />
          </SelectTrigger>
          <SelectContent>
            {items.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="space-y-1 text-sm">
        <div className="text-xs font-medium text-muted-foreground">Sabab (ixtiyoriy)</div>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <DialogFooter>
        <Button
          onClick={() => mut.mutate()}
          disabled={!doctorId || doctorId === currentDoctorId || mut.isPending}
          className="gap-1"
        >
          <Stethoscope className="h-4 w-4" />
          O‘zgartirish
        </Button>
      </DialogFooter>
    </div>
  );
}

// --- Xona ko'chirish paneli ---
export function TransferPanel({
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
  const [changeDoctor, setChangeDoctor] = useState(false);
  const [doctorId, setDoctorId] = useState('');

  const { data: rooms } = useQuery({
    queryKey: ['rooms-for-transfer'],
    queryFn: () => api.catalog.list('rooms', { pageSize: 200 }),
  });

  const { data: doctors } = useQuery({
    queryKey: ['doctors-list'],
    queryFn: () => api.doctors.list(),
    enabled: changeDoctor,
  });

  const mut = useMutation({
    mutationFn: () =>
      api.inpatient.transfer(stayId, {
        room_id: roomId,
        bed_no: bedNo || undefined,
        reason: reason || undefined,
        // changeDoctor=true va doctorId tanlangan bo'lsa shifokor ham almashadi
        attending_doctor_id: changeDoctor && doctorId ? doctorId : undefined,
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
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={changeDoctor}
          onChange={(e) => setChangeDoctor(e.target.checked)}
        />
        <span>Shifokorni ham o‘zgartirish</span>
      </label>
      {changeDoctor && (
        <label className="space-y-1 text-sm">
          <div className="text-xs font-medium text-muted-foreground">Yangi shifokor</div>
          <Select value={doctorId} onValueChange={setDoctorId}>
            <SelectTrigger>
              <SelectValue placeholder="Shifokorni tanlang..." />
            </SelectTrigger>
            <SelectContent>
              {((doctors as Array<{ id: string; full_name: string }>) ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      <DialogFooter>
        <Button
          onClick={() => mut.mutate()}
          disabled={!roomId || (changeDoctor && !doctorId) || mut.isPending}
          className="gap-1"
        >
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

export function MealPeriodsPanel({ stayId, defaultDailyUzs }: { stayId: string; defaultDailyUzs: number }) {
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

export function AssignmentsPanel({
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

// Xizmat to'lovi uchun — qarz (debt) ham mumkin. Discharge'da qarz yo'q.
const SERVICE_PAYMENT_METHODS: Array<{
  value: 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'humo' | 'uzcard' | 'debt';
  label: string;
}> = [...PAYMENT_METHODS, { value: 'debt', label: 'Qarz' }];

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: 'Naqd',
  card: 'Karta',
  transfer: "O'tkazma",
  click: 'Click',
  payme: 'Payme',
  humo: 'Humo',
  uzcard: 'Uzcard',
  debt: 'Qarz',
};

type InpService = {
  id: string;
  name_i18n: Record<string, string>;
  price_uzs: number;
};
function svcName(n: Record<string, string>): string {
  return n['uz-Latn'] ?? n.ru ?? Object.values(n)[0] ?? 'xizmat';
}

function fmtUzs(n: number) {
  return n.toLocaleString('uz-UZ') + " so'm";
}

// Statsionar qarzdorlar — faol (yotgan) va chiqarilgan qarzdor bemorlar.
function InpatientDebtorsView({
  data,
  loading,
}: {
  data?: { active: InpatientDebtor[]; discharged: InpatientDebtor[]; totals: { active_debt: number; discharged_debt: number } };
  loading: boolean;
}) {
  const navigate = useNavigate();
  const [payTarget, setPayTarget] = useState<InpatientDebtor | null>(null);

  // Chek uchun klinika nomi
  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ clinic?: { name?: string } }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
  const clinicName = (me as { clinic?: { name?: string } } | undefined)?.clinic?.name ?? 'Klinika';

  // Ko'rsatilgan xizmatlar/davolanish cheki — getStay totals bilan
  const printServicesReceipt = async (d: InpatientDebtor) => {
    try {
      const detail = await api.inpatient.getStay(d.stay_id);
      const t = detail.totals;
      const html = inpatientDischargeReceiptHtml({
        clinicName,
        date: new Date().toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' }),
        patientName: d.full_name,
        roomLabel: d.room_label,
        doctorName: d.doctor_name,
        days: t.days,
        roomDailyUzs: t.room_daily_uzs,
        mealDailyUzs: t.meal_daily_uzs,
        attendantDailyUzs: t.attendant_daily_uzs,
        totalRoomUzs: t.total_room_uzs,
        totalMealUzs: t.total_meal_uzs,
        totalAttendantUzs: t.total_attendant_uzs,
        attendantName: t.attendant_name,
        totalDailyUzs: t.total_charged_uzs,
        totalServicesUzs: t.total_services_uzs,
        totalDepositedUzs: t.total_deposited_uzs,
        balanceUzs: t.balance_uzs,
      });
      await printReceiptHybrid(
        {
          header: clinicName,
          title: 'STATSIONAR — XIZMATLAR',
          lines: [
            { text: `Bemor: ${d.full_name}`, align: 'left' },
            { text: `Davolanish: ${t.days} kun`, align: 'left' },
          ],
          total_uzs: t.total_charged_uzs + t.total_services_uzs,
          paid_uzs: t.total_deposited_uzs,
          debt_uzs: t.balance_uzs < 0 ? Math.abs(t.balance_uzs) : 0,
          cut: true,
        },
        html,
        'receipt',
      );
    } catch (e) {
      toast.error('Chek chop etilmadi: ' + (e as Error).message);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Yuklanmoqda…</div>;
  }
  const active = data?.active ?? [];
  const discharged = data?.discharged ?? [];
  const totals = data?.totals ?? { active_debt: 0, discharged_debt: 0 };

  return (
    <div className="space-y-6">
      {/* ===== Faol bemorlar qarzi ===== */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Activity className="h-4 w-4 text-amber-600" />
            Faol bemorlar qarzi ({active.length})
          </h3>
          <Badge variant="outline" className="border-amber-300 text-amber-700">
            Jami: {fmtUzs(totals.active_debt)}
          </Badge>
        </div>
        {active.length === 0 ? (
          <EmptyState title="Faol qarzdor yo'q" description="Hozir yotgan bemorlarda qarz yo'q" />
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {active.map((d) => (
                  <button
                    key={d.stay_id}
                    type="button"
                    onClick={() => navigate(`/inpatient/stays/${d.stay_id}`)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{d.full_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.room_label ?? '—'} • {d.days} kun • {d.doctor_name ?? 'Shifokor yo\'q'}
                        {d.phone ? ` • ${d.phone}` : ''}
                      </div>
                    </div>
                    <div className="shrink-0 text-right font-mono font-semibold text-destructive">
                      {fmtUzs(d.debt_uzs)}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ===== Chiqarilgan qarzdor bemorlar ===== */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <LogOut className="h-4 w-4 text-rose-600" />
            Chiqarilgan qarzdorlar ({discharged.length})
          </h3>
          <Badge variant="outline" className="border-rose-300 text-rose-700">
            Jami: {fmtUzs(totals.discharged_debt)}
          </Badge>
        </div>
        {discharged.length === 0 ? (
          <EmptyState title="Chiqarilgan qarzdor yo'q" description="Qarz bilan chiqarilgan bemor yo'q" />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {discharged.map((d) => (
              <Card key={d.stay_id} className="border-rose-200">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold">{d.full_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.room_label ?? '—'} • {d.doctor_name ?? 'Shifokor yo\'q'} • {d.days} kun
                      </div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-base font-bold text-destructive">
                      {fmtUzs(d.debt_uzs)}
                    </div>
                  </div>

                  {/* Aloqa ma'lumotlari */}
                  <div className="space-y-1 text-sm">
                    {d.phone && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Phone className="h-3.5 w-3.5" /> {d.phone}
                      </div>
                    )}
                    {d.address && (
                      <div className="flex items-start gap-1.5 text-muted-foreground">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {d.address}
                      </div>
                    )}
                  </div>

                  {/* Sana/vaqt */}
                  <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Qabul</div>
                      <div className="font-medium">{new Date(d.admitted_at).toLocaleString('uz-UZ')}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Chiqarilgan</div>
                      <div className="font-medium">
                        {d.discharged_at ? new Date(d.discharged_at).toLocaleString('uz-UZ') : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Qarovchi (bo'lsa) */}
                  {d.attendant && (
                    <div className="rounded-md border bg-card p-2 text-xs">
                      <div className="mb-0.5 font-medium text-muted-foreground">Qarovchi</div>
                      <div>
                        {d.attendant.name}
                        {d.attendant.phone ? ` • ${d.attendant.phone}` : ''}
                        {d.attendant.age ? ` • ${d.attendant.age} yosh` : ''}
                        {d.attendant.gender ? ` • ${GENDER_LABEL[d.attendant.gender] ?? d.attendant.gender}` : ''}
                      </div>
                    </div>
                  )}

                  {/* Qarz sababi */}
                  {d.debt_reason && (
                    <div className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span><strong>Qarz sababi:</strong> {d.debt_reason}</span>
                    </div>
                  )}

                  {/* Amallar — qarz yopish + cheklar */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button size="sm" className="gap-1" onClick={() => setPayTarget(d)}>
                      <CircleDollarSign className="h-3.5 w-3.5" /> Qarz yopish
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => printServicesReceipt(d)}>
                      <Receipt className="h-3.5 w-3.5" /> Xizmatlar cheki
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {payTarget && (
        <DebtPayDialog
          debtor={payTarget}
          clinicName={clinicName}
          onClose={() => setPayTarget(null)}
        />
      )}
    </div>
  );
}

// Chiqarilgan qarzdorning qarzini yopish — summa (qisman ham) + to'lov usuli.
// Tasdiqlanganda kassaga/jurnalga tushadi va to'lov cheki avtomatik chiqadi.
function DebtPayDialog({
  debtor,
  clinicName,
  onClose,
}: {
  debtor: InpatientDebtor;
  clinicName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(String(debtor.debt_uzs));
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]['value']>('cash');

  const amtNum = Math.max(0, Math.min(debtor.debt_uzs, Number(amount) || 0));
  const remaining = Math.max(0, debtor.debt_uzs - amtNum);

  const mut = useMutation({
    mutationFn: () =>
      api.inpatient.addLedger({
        patient_id: debtor.patient_id,
        stay_id: debtor.stay_id,
        entry_kind: 'deposit',
        amount_uzs: amtNum,
        payment_method: method,
        description: 'Qarz yopish (statsionar)',
      }),
    onSuccess: () => {
      toast.success(`Qarz yopildi: ${fmtUzs(amtNum)}`);
      qc.invalidateQueries({ queryKey: ['inpatient-debtors'] });
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'cashier' });
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('journal') });
      // To'lov cheki avtomatik
      const html = paymentReceiptHtml({
        clinicName,
        ticketNo: null,
        date: new Date().toLocaleString('uz-UZ'),
        patientName: debtor.full_name,
        items: [{ name: 'Statsionar qarz to\'lash', qty: 1, amount: amtNum }],
        totalUzs: amtNum,
        paidUzs: amtNum,
        debtUzs: remaining,
        paymentMethod: method,
        transactionId: debtor.stay_id,
      });
      void printReceiptHybrid(
        {
          header: clinicName,
          title: "QARZ TO'LASH CHEKI",
          lines: [
            { text: `Bemor: ${debtor.full_name}`, align: 'left' },
            ...(remaining > 0 ? [{ text: `Qoldiq qarz: ${fmtUzs(remaining)}`, bold: true }] : []),
          ],
          items: [{ name: 'Statsionar qarz to\'lash', qty: 1, amount: amtNum }],
          total_uzs: amtNum,
          paid_uzs: amtNum,
          debt_uzs: remaining > 0 ? remaining : undefined,
          footer: 'Rahmat!',
          cut: true,
        },
        html,
        'receipt',
      );
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleDollarSign className="h-5 w-5 text-emerald-600" />
            Qarz yopish — {debtor.full_name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="rounded-md border border-rose-300 bg-rose-50 p-2 text-sm text-rose-900">
            Joriy qarz: <strong className="font-mono">{fmtUzs(debtor.debt_uzs)}</strong>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-xs font-medium">To'lanadigan summa *</div>
              <div className="flex gap-1">
                <Input
                  type="number"
                  min={0}
                  max={debtor.debt_uzs}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="px-2 text-xs"
                  onClick={() => setAmount(String(debtor.debt_uzs))}
                >
                  To'liq
                </Button>
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium">To'lov usuli *</div>
              <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {remaining > 0 && amtNum > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              Qisman to'lov. Qoldiq qarz: <strong>{fmtUzs(remaining)}</strong>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => mut.mutate()} disabled={amtNum <= 0 || mut.isPending} className="gap-1">
            <Printer className="h-4 w-4" />
            {mut.isPending ? 'Saqlanmoqda…' : "To'lash + chek"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DischargeForm({
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
  const [debtReason, setDebtReason] = useState('');

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
  // Qarz bilan chiqarish (force) + qarz qoladi → qarz sababi majburiy
  const debtRemains = force && paidNum < outstanding && !(isDeceased && writeoff);
  const canConfirm =
    !pending &&
    !balLoading &&
    ((isDeceased && writeoff) || paidNum >= outstanding || force) &&
    (!debtRemains || debtReason.trim().length > 0);

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

          {debtRemains && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-destructive">
                Qarz sababi * (majburiy)
              </div>
              <textarea
                value={debtReason}
                onChange={(e) => setDebtReason(e.target.value)}
                rows={2}
                placeholder="Masalan: mablag' yetishmadi, keyin to'lab beradi, qarindoshi keladi..."
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              />
            </div>
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
              debt_reason: debtRemains ? debtReason.trim() : undefined,
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

export type LedgerEntry = {
  id: string;
  entry_kind: 'deposit' | 'charge' | 'refund' | 'adjustment';
  amount_uzs: number;
  description: string | null;
  created_at: string;
};

// Statsionar bemorga qo'shimcha xizmat qo'shish paneli.
// Xizmat tanlash (cart) + alohida shifokor + to'lov rejimi (darrov/balansga).
export function ServicePanel({
  patientId,
  stayId,
  clinicName,
  patientName,
  onDone,
}: {
  patientId: string;
  stayId: string;
  clinicName: string;
  patientName: string;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const { hasShift } = useActiveShift();
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<Array<{ service_id: string; name: string; price: number; qty: number }>>([]);
  const [doctorId, setDoctorId] = useState<string>('');
  const [settle, setSettle] = useState<'pay' | 'balance'>('pay');
  const [paymentMethod, setPaymentMethod] =
    useState<(typeof SERVICE_PAYMENT_METHODS)[number]['value']>('cash');
  // Aralash (split) xizmat to'lovi — naqd + karta bo'laklari.
  const [splitOn, setSplitOn] = useState(false);
  const [splitLegs, setSplitLegs] = useState<PaymentLeg[]>([]);

  const { data: services } = useQuery({
    queryKey: ['services-list'],
    queryFn: () => api.services.list() as Promise<InpService[]>,
  });
  const { data: doctors } = useQuery({
    queryKey: ['doctors-list'],
    queryFn: () => api.doctors.list(),
  });

  const filtered = useMemo(() => {
    const list = (services ?? []) as InpService[];
    if (!q) return list.slice(0, 24);
    const needle = q.toLowerCase();
    return list
      .filter((s) => Object.values(s.name_i18n).some((v) => v.toLowerCase().includes(needle)))
      .slice(0, 40);
  }, [q, services]);

  const total = cart.reduce((sum, c) => sum + c.price * c.qty, 0);

  const addToCart = (s: InpService) => {
    setCart((prev) => {
      const ex = prev.find((c) => c.service_id === s.id);
      if (ex) return prev.map((c) => (c.service_id === s.id ? { ...c, qty: c.qty + 1 } : c));
      return [...prev, { service_id: s.id, name: svcName(s.name_i18n), price: Number(s.price_uzs), qty: 1 }];
    });
  };
  const removeFromCart = (id: string) => setCart((prev) => prev.filter((c) => c.service_id !== id));

  const addMut = useMutation({
    mutationFn: () =>
      api.inpatient.addService({
        stay_id: stayId,
        patient_id: patientId,
        items: cart.map((c) => ({ service_id: c.service_id, quantity: c.qty })),
        doctor_id: doctorId || undefined,
        settle,
        payment_method: settle === 'pay' ? paymentMethod : undefined,
        payments:
          settle === 'pay' && splitOn && splitLegs.filter((l) => l.amount_uzs > 0).length > 1
            ? splitLegs.filter((l) => l.amount_uzs > 0)
            : undefined,
      }),
    onSuccess: async () => {
      // Darrov to'lov bo'lsa — termal chek chiqaramiz.
      if (settle === 'pay') {
        const doctorName = doctors?.find((d) => d.id === doctorId)?.full_name ?? null;
        const html = paymentReceiptHtml({
          clinicName,
          ticketNo: null,
          date: new Date().toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' }),
          patientName,
          items: cart.map((c) => ({ name: c.name, qty: c.qty, amount: c.price * c.qty })),
          totalUzs: total,
          paidUzs: total,
          debtUzs: 0,
          paymentMethod: PAYMENT_METHOD_LABEL[paymentMethod] ?? paymentMethod,
          transactionId: '',
          doctorName,
        });
        try {
          await printReceiptHybrid(
            {
              header: clinicName,
              title: "TO'LOV CHEKI",
              items: cart.map((c) => ({ name: c.name, qty: c.qty, amount: c.price * c.qty })),
              total_uzs: total,
              paid_uzs: total,
              debt_uzs: 0,
              footer: doctorName ? `Shifokor: ${doctorName}` : undefined,
              cut: true,
            },
            html,
            'receipt',
          );
        } catch {
          /* chek chop etilmasa ham xizmat saqlandi */
        }
      }
      toast.success(settle === 'pay' ? "Xizmat qo'shildi va to'landi" : "Xizmat balansga yozildi");
      setCart([]);
      setDoctorId('');
      qc.invalidateQueries({ queryKey: ['inpatient-stay', stayId] });
      qc.invalidateQueries({ queryKey: ['inp-ledger', patientId] });
      qc.invalidateQueries({ queryKey: ['inp-balance', stayId] });
      qc.invalidateQueries({ predicate: (qk) => qk.queryKey[0] === 'journal' });
      onDone?.();
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? 'Xatolik'),
  });

  return (
    <div className="space-y-3">
      {/* Xizmat qidirish */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Xizmat nomini yozing..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="grid max-h-48 grid-cols-2 gap-2 overflow-auto md:grid-cols-3">
        {filtered.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => addToCart(s)}
            className="flex flex-col rounded-lg border bg-card p-2 text-left transition hover:border-primary"
          >
            <div className="line-clamp-2 text-xs font-medium">{svcName(s.name_i18n)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{fmtUzs(Number(s.price_uzs))}</div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-4 text-center text-xs text-muted-foreground">
            Xizmat topilmadi
          </div>
        )}
      </div>

      {/* Cart */}
      {cart.length > 0 && (
        <div className="space-y-1 rounded-lg border p-2">
          {cart.map((c) => (
            <div key={c.service_id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex-1 truncate">
                {c.name} {c.qty > 1 && <span className="text-muted-foreground">×{c.qty}</span>}
              </span>
              <span className="font-mono tabular-nums">{fmtUzs(c.price * c.qty)}</span>
              <button
                type="button"
                onClick={() => removeFromCart(c.service_id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1 text-sm font-semibold">
            <span>Jami</span>
            <span className="font-mono tabular-nums">{fmtUzs(total)}</span>
          </div>
        </div>
      )}

      {/* Shifokor — qo'shimcha xizmat uchun (attending'dan mustaqil) */}
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">Xizmatni qilgan shifokor (ixtiyoriy)</div>
        <Select value={doctorId || 'none'} onValueChange={(v) => setDoctorId(v === 'none' ? '' : v)}>
          <SelectTrigger>
            <SelectValue placeholder="Shifokor tanlang" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Tanlanmagan —</SelectItem>
            {(doctors ?? []).map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-[11px] text-muted-foreground">
          Bu shifokor alohida komissiya oladi — statsionardagi asosiy shifokorga ta'sir qilmaydi.
        </div>
      </div>

      {/* To'lov rejimi */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSettle('pay')}
          className={cn(
            'rounded-lg border px-3 py-2 text-sm font-medium transition',
            settle === 'pay' ? 'border-primary bg-primary/10' : 'hover:border-primary/50',
          )}
        >
          Darrov to'lash
        </button>
        <button
          type="button"
          onClick={() => setSettle('balance')}
          className={cn(
            'rounded-lg border px-3 py-2 text-sm font-medium transition',
            settle === 'balance' ? 'border-primary bg-primary/10' : 'hover:border-primary/50',
          )}
        >
          Balansga yozish
        </button>
      </div>

      {settle === 'pay' && !splitOn && (
        <div className="flex flex-wrap gap-1">
          {SERVICE_PAYMENT_METHODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPaymentMethod(p.value)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-medium transition',
                paymentMethod === p.value ? 'border-primary bg-primary/10' : 'hover:border-primary/50',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      {settle === 'pay' && (
        <div>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium">
            <input
              type="checkbox"
              checked={splitOn}
              onChange={(e) => {
                setSplitOn(e.target.checked);
                if (e.target.checked) setSplitLegs([{ method: paymentMethod, amount_uzs: total }]);
              }}
            />
            Aralash to'lov (naqd + karta)
          </label>
          {splitOn && (
            <div className="mt-2">
              <PaymentSplitEditor legs={splitLegs} target={total} onChange={setSplitLegs} />
            </div>
          )}
        </div>
      )}

      {settle === 'pay' && !hasShift && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
          <div>
            <span className="font-semibold text-red-700">Kassa smenasi ochilmagan.</span> Darrov
            to'lov uchun smena oching yoki "Balansga yozish"ni tanlang.
          </div>
        </div>
      )}

      <Button
        className="w-full gap-1"
        onClick={() => addMut.mutate()}
        disabled={cart.length === 0 || addMut.isPending || (settle === 'pay' && !hasShift)}
      >
        <Plus className="h-4 w-4" />
        {settle === 'pay' ? `To'lash — ${fmtUzs(total)}` : `Balansga yozish — ${fmtUzs(total)}`}
      </Button>
    </div>
  );
}

// Qarovchi (attendant) tahrirlash paneli.
export function AttendantPanel({
  stayId,
  initialDaily,
  initialName,
  initialPhone,
  initialAge,
  initialGender,
  onDone,
}: {
  stayId: string;
  initialDaily: number;
  initialName: string | null;
  initialPhone?: string | null;
  initialAge?: number | null;
  initialGender?: string | null;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [daily, setDaily] = useState(String(initialDaily || ''));
  const [name, setName] = useState(initialName ?? '');
  const [phone, setPhone] = useState(initialPhone ?? '');
  const [age, setAge] = useState(initialAge != null ? String(initialAge) : '');
  const [gender, setGender] = useState<string>(initialGender ?? '');

  const mut = useMutation({
    mutationFn: () =>
      api.inpatient.updateExtras(stayId, {
        attendant_daily_uzs: Math.max(0, Number(daily) || 0),
        attendant_name: name.trim() || null,
        attendant_phone: phone.trim() || null,
        attendant_age: age ? Number(age) : null,
        attendant_gender: (gender || null) as 'male' | 'female' | 'other' | null,
      }),
    onSuccess: () => {
      toast.success('Qarovchi yangilandi');
      qc.invalidateQueries({ queryKey: ['inpatient-stay', stayId] });
      onDone?.();
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? 'Xatolik'),
  });

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">Qarovchi F.I.O.</div>
        <Input placeholder="F.I.O." value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Telefon</div>
          <Input placeholder="+998..." value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Yoshi</div>
          <Input type="number" placeholder="0" value={age} onChange={(e) => setAge(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">Jinsi</div>
        <Select value={gender || 'none'} onValueChange={(v) => setGender(v === 'none' ? '' : v)}>
          <SelectTrigger>
            <SelectValue placeholder="Tanlang" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            <SelectItem value="male">Erkak</SelectItem>
            <SelectItem value="female">Ayol</SelectItem>
            <SelectItem value="other">Boshqa</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">Kunlik narx (so'm)</div>
        <Input
          type="number"
          placeholder="0"
          value={daily}
          onChange={(e) => setDaily(e.target.value)}
        />
        <div className="text-[11px] text-muted-foreground">
          Bu summa har kuni bemor hisobiga avtomatik qo'shiladi.
        </div>
      </div>
      <Button className="w-full" onClick={() => mut.mutate()} disabled={mut.isPending}>
        Saqlash
      </Button>
    </div>
  );
}

export function LedgerPanel({
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
  const { hasShift } = useActiveShift();
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<'deposit' | 'charge' | 'refund' | 'adjustment'>('deposit');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] =
    useState<(typeof PAYMENT_METHODS)[number]['value']>('cash');
  // Aralash (split) to'lov/qaytarish — naqd + karta bo'laklari.
  const [splitOn, setSplitOn] = useState(false);
  const [splitLegs, setSplitLegs] = useState<PaymentLeg[]>([]);

  // Deposit/refund — pul harakati, to'lov turi kerak (kassaga tushadi).
  const needsPaymentMethod = kind === 'deposit' || kind === 'refund';
  // Pul harakati (deposit/refund) smena talab qiladi.
  const blockedNoShift = needsPaymentMethod && !hasShift;
  const validSplit = splitLegs.filter((l) => l.amount_uzs > 0);

  const addMut = useMutation({
    mutationFn: () =>
      api.inpatient.addLedger({
        patient_id: patientId,
        stay_id: stayId,
        entry_kind: kind,
        amount_uzs: Math.abs(Number(amount) || 0),
        description: description || undefined,
        payment_method: needsPaymentMethod ? paymentMethod : undefined,
        payments:
          needsPaymentMethod && splitOn && validSplit.length > 1 ? validSplit : undefined,
      }),
    onSuccess: () => {
      toast.success('Hisobga yozildi');
      setAmount('');
      setDescription('');
      qc.invalidateQueries({ queryKey: ['inp-ledger', patientId] });
      qc.invalidateQueries({ queryKey: ['inpatient-stay', stayId] });
      qc.invalidateQueries({ queryKey: ['inp-balance', stayId] });
      qc.invalidateQueries({ predicate: (qk) => qk.queryKey[0] === 'journal' });
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? 'Xatolik'),
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
      {needsPaymentMethod && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">To'lov turi</div>
          <div className="flex flex-wrap gap-1">
            {PAYMENT_METHODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPaymentMethod(p.value)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-medium transition',
                  paymentMethod === p.value ? 'border-primary bg-primary/10' : 'hover:border-primary/50',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-xs font-medium">
            <input
              type="checkbox"
              checked={splitOn}
              onChange={(e) => {
                setSplitOn(e.target.checked);
                if (e.target.checked) {
                  setSplitLegs([{ method: paymentMethod, amount_uzs: Math.abs(Number(amount) || 0) }]);
                }
              }}
            />
            Aralash to'lov (naqd + karta)
          </label>
          {splitOn && (
            <div className="mt-2">
              <PaymentSplitEditor
                legs={splitLegs}
                target={Math.abs(Number(amount) || 0)}
                onChange={(l) => {
                  setSplitLegs(l);
                  const s = l.reduce((a, x) => a + (Number(x.amount_uzs) || 0), 0);
                  setAmount(String(s));
                }}
              />
            </div>
          )}
        </div>
      )}
      <Input
        placeholder="Izoh (ixtiyoriy)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {blockedNoShift && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
          <div>
            <span className="font-semibold text-red-700">Kassa smenasi ochilmagan.</span> Depozit /
            qaytarish uchun avval kassada smena oching.
          </div>
        </div>
      )}
      <Button
        className="w-full gap-1"
        onClick={() => addMut.mutate()}
        disabled={!amount || addMut.isPending || blockedNoShift}
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
  const { hasShift } = useActiveShift();
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
  // Qabul (yotqizish) sanasi — default bugun (Toshkent). Orqaga qo'yilsa o'tgan
  // kunlar ham kunlik to'lovga hisoblanadi (qabuldagi darrov charge orqali).
  const [admittedAt, setAdmittedAt] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [deposit, setDeposit] = useState('');
  // Ovqat va yarim kunlik tariflar — xonadagi narxlardan o'qiladi,
  // foydalanuvchi qo'lda override qila oladi.
  const [withMeal, setWithMeal] = useState(false);
  const [mealOverride, setMealOverride] = useState<string>(''); // qo'lda kiritilgan narx
  const [isHalfDay, setIsHalfDay] = useState(false);
  // Qarovchi (attendant) — ixtiyoriy kunlik narx + ism + ma'lumot.
  const [attendantName, setAttendantName] = useState('');
  const [attendantDaily, setAttendantDaily] = useState('');
  const [attendantPhone, setAttendantPhone] = useState('');
  const [attendantAge, setAttendantAge] = useState('');
  const [attendantGender, setAttendantGender] = useState('');

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
        dob: dob || undefined,
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
        admitted_at: admittedAt ? new Date(`${admittedAt}T12:00:00`).toISOString() : undefined,
        initial_deposit_uzs: deposit ? Number(deposit) : undefined,
        with_meal: withMeal,
        meal_daily_uzs_override: withMeal && mealOverride ? Number(mealOverride) || undefined : undefined,
        is_half_day: isHalfDay,
        attendant_daily_uzs: attendantDaily ? Number(attendantDaily) || undefined : undefined,
        attendant_name: attendantName.trim() || undefined,
        attendant_phone: attendantPhone.trim() || undefined,
        attendant_age: attendantAge ? Number(attendantAge) || undefined : undefined,
        attendant_gender: (attendantGender || undefined) as 'male' | 'female' | 'other' | undefined,
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
    setAdmittedAt(new Date().toLocaleDateString('en-CA'));
    setDeposit('');
    setWithMeal(false);
    setMealOverride('');
    setIsHalfDay(false);
    setAttendantName('');
    setAttendantDaily('');
    setAttendantPhone('');
    setAttendantAge('');
    setAttendantGender('');
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

        {/* Deposit kiritilgan, lekin smena yo'q — qizil ogohlantirish */}
        {!hasShift && deposit && Number(deposit) > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
            <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
            <div>
              <span className="font-semibold text-red-700">Kassa smenasi ochilmagan.</span>{' '}
              Depozitni qabul qilish uchun avval smena oching, aks holda qabul rad etiladi.
            </div>
          </div>
        )}

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
              mealOverride={mealOverride}
              onWithMealChange={setWithMeal}
              onHalfDayChange={setIsHalfDay}
              onMealOverrideChange={setMealOverride}
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
            <div className="text-xs font-medium text-muted-foreground">Qabul sanasi</div>
            <Input
              type="date"
              value={admittedAt}
              max={new Date().toLocaleDateString('en-CA')}
              onChange={(e) => setAdmittedAt(e.target.value)}
            />
            <div className="text-[11px] text-muted-foreground">
              O&lsquo;tgan kunga qo&lsquo;ysangiz, o&lsquo;sha kundan boshlab kunlik to&lsquo;lov hisoblanadi.
            </div>
          </label>

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

          {/* Qarovchi (attendant) — ixtiyoriy */}
          <div className="space-y-2 rounded-lg border p-3">
            <div className="text-xs font-semibold text-muted-foreground">Qarovchi (ixtiyoriy)</div>
            <label className="space-y-1 text-sm">
              <div className="text-xs font-medium text-muted-foreground">F.I.O.</div>
              <Input
                placeholder="Qarovchi F.I.O."
                value={attendantName}
                onChange={(e) => setAttendantName(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-sm">
                <div className="text-xs font-medium text-muted-foreground">Telefon</div>
                <Input
                  placeholder="+998..."
                  value={attendantPhone}
                  onChange={(e) => setAttendantPhone(e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                <div className="text-xs font-medium text-muted-foreground">Yoshi</div>
                <Input
                  type="number"
                  placeholder="0"
                  value={attendantAge}
                  onChange={(e) => setAttendantAge(e.target.value)}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-sm">
                <div className="text-xs font-medium text-muted-foreground">Jinsi</div>
                <Select
                  value={attendantGender || 'none'}
                  onValueChange={(v) => setAttendantGender(v === 'none' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tanlang" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    <SelectItem value="male">Erkak</SelectItem>
                    <SelectItem value="female">Ayol</SelectItem>
                    <SelectItem value="other">Boshqa</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1 text-sm">
                <div className="text-xs font-medium text-muted-foreground">Kunlik narxi (so'm)</div>
                <Input
                  type="number"
                  placeholder="0"
                  value={attendantDaily}
                  onChange={(e) => setAttendantDaily(e.target.value)}
                />
              </label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose}>
            <X className="mr-1 h-4 w-4" />
            Bekor
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isPending ||
              (admitTab === 'existing' && !patientId) ||
              (!hasShift && !!deposit && Number(deposit) > 0)
            }
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
  mealOverride,
  onWithMealChange,
  onHalfDayChange,
  onMealOverrideChange,
}: {
  rooms: Array<Record<string, unknown>>;
  roomId: string;
  withMeal: boolean;
  isHalfDay: boolean;
  mealOverride: string;
  onWithMealChange: (v: boolean) => void;
  onHalfDayChange: (v: boolean) => void;
  onMealOverrideChange: (v: string) => void;
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
  // Xona default ovqat narxi (0 bo'lishi mumkin)
  const roomMeal = Number(room.meal_daily_uzs ?? 0);
  // Effektiv ovqat narxi: override > 0 bo'lsa o'sha, aks holda xona default
  const overrideNum = Math.max(0, Number(mealOverride) || 0);
  const effectiveMeal = overrideNum > 0 ? overrideNum : roomMeal;
  const base = isHalfDay ? halfDay : daily;
  const total = base + (withMeal ? effectiveMeal : 0);
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
        {/* Ovqat tugmasi HAR DOIM ko'rinadi (xonada narx 0 bo'lsa ham) */}
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={withMeal}
            onChange={(e) => onWithMealChange(e.target.checked)}
            className="h-4 w-4"
          />
          Ovqat bilan
          {roomMeal > 0 && !overrideNum && (
            <span className="text-xs text-muted-foreground">
              (+{fmt(roomMeal)} so‘m/kun)
            </span>
          )}
        </label>
      </div>

      {/* Ovqat yoqilgan + xonada narx yo'q bo'lsa, qo'lda narx kiritish */}
      {withMeal && roomMeal === 0 && (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs">
          <div className="mb-1 font-medium text-amber-900">
            Bu xonada ovqat narxi sozlanmagan. Iltimos, kunlik narxni kiriting:
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={mealOverride}
              onChange={(e) => onMealOverrideChange(e.target.value)}
              placeholder="Masalan: 30000"
              className="h-8 w-32 rounded-md border bg-background px-2 text-sm"
            />
            <span className="text-xs text-muted-foreground">so‘m/kun</span>
          </div>
        </div>
      )}

      {/* Xonada narx bor, lekin foydalanuvchi qo'lda boshqa narx tanlasa */}
      {withMeal && roomMeal > 0 && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Boshqa narx (ixtiyoriy):</span>
          <input
            type="number"
            min={0}
            value={mealOverride}
            onChange={(e) => onMealOverrideChange(e.target.value)}
            placeholder={String(roomMeal)}
            className="h-7 w-28 rounded-md border bg-background px-2 text-xs"
          />
          <span className="text-muted-foreground">so‘m/kun</span>
        </div>
      )}

      <div className="flex items-center justify-between border-t pt-2">
        <span className="text-xs text-muted-foreground">
          {isHalfDay ? 'Yarim kun' : 'Kuniga'}{withMeal ? ' + ovqat' : ''}:
        </span>
        <span className="text-base font-semibold">
          {fmt(total)} so‘m
        </span>
      </div>

      {withMeal && (
        <div className="text-[11px] text-muted-foreground">
          ℹ️ Ovqat har kun avtomatik hisoblanadi. Keyin xohlasangiz "Faol bemorlar
          → Ovqat" oynasidan to'xtatish/o'zgartirish mumkin.
        </div>
      )}
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



// ===========================================================================
// Statsionar KASSA — alohida registr (register='inpatient'). KPIs + seyfga
// o'tmagan naqd + seyf + inkasatsiya + tranzaksiyalar. Reception kassasidan mustaqil.
// ===========================================================================
function InpatientCashierView() {
  const [encashOpen, setEncashOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [safePanelOpen, setSafePanelOpen] = useState(false);
  const [kpiDetail, setKpiDetail] = useState<{ metric: KpiMetric; from?: string; to?: string; label: string } | null>(null);
  const kNow = new Date();
  const kToday = new Date(kNow.getFullYear(), kNow.getMonth(), kNow.getDate()).toISOString();
  const kMonth = new Date(kNow.getFullYear(), kNow.getMonth(), 1).toISOString();
  const kNowIso = kNow.toISOString();
  const { data: kpis } = useQuery({
    queryKey: ['cashier', 'kpis', 'inpatient'],
    queryFn: () => api.cashier.kpis('inpatient'),
    refetchInterval: 30_000,
  });
  const { data: coh } = useQuery({
    queryKey: ['cashier', 'cash-on-hand', 'inpatient'],
    queryFn: () => api.cashier.cashOnHand('inpatient'),
    refetchInterval: 30_000,
  });
  const { data: safe } = useQuery({
    queryKey: ['cashier', 'safe-balance', 'inpatient'],
    queryFn: () => api.cashier.safeBalance('inpatient'),
    refetchInterval: 30_000,
  });
  const { data: txs } = useQuery({
    queryKey: ['cashier', 'transactions', 'inpatient'],
    queryFn: () => api.cashier.transactions({ register: 'inpatient', limit: 50 }),
  });

  const cashNotInSafe = coh?.cash_on_hand_uzs ?? 0;
  const rows = (txs ?? []) as Array<{
    id: string;
    created_at: string;
    amount_uzs: number;
    kind: string;
    payment_method: string | null;
    patient?: { full_name?: string } | null;
  }>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Bugungi tushum" value={`${fmtUzs(kpis?.today_total ?? 0)} so'm`} icon={<CircleDollarSign className="h-4 w-4" />} tone="success"
          onClick={() => setKpiDetail({ metric: 'revenue', from: kToday, to: kNowIso, label: 'Bugun' })} />
        <StatCard label="Oylik tushum" value={`${fmtUzs(kpis?.month_revenue ?? 0)} so'm`} icon={<CircleDollarSign className="h-4 w-4" />} tone="info"
          onClick={() => setKpiDetail({ metric: 'revenue', from: kMonth, to: kNowIso, label: 'Joriy oy' })} />
        <StatCard
          label="Oylik sof foyda"
          value={`${fmtUzs(kpis?.month_profit ?? 0)} so'm`}
          icon={<CircleDollarSign className="h-4 w-4" />}
          tone={(kpis?.month_profit ?? 0) >= 0 ? 'success' : 'danger'}
          onClick={() => setKpiDetail({ metric: 'profit', from: kMonth, to: kNowIso, label: 'Joriy oy' })}
        />
        <StatCard
          label="Seyfga o'tmagan naqd"
          value={`${fmtUzs(cashNotInSafe)} so'm`}
          icon={<CircleDollarSign className="h-4 w-4" />}
          tone={cashNotInSafe > 0 ? 'warning' : undefined}
          onClick={() => setDrawerOpen(true)}
        />
        <StatCard
          label="Seyfdagi pul"
          value={`${fmtUzs(safe?.safe_balance_uzs ?? 0)} so'm`}
          icon={<CircleDollarSign className="h-4 w-4" />}
          tone="info"
          onClick={() => setSafePanelOpen(true)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setEncashOpen(true)}>
          Seyfga o'tkazish (inkasatsiya)
        </Button>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(kpis?.by_payment_method_today_total ?? {}).map(([m, v]) => (
            <Badge key={m} variant="secondary" className="text-xs">
              {m === 'mixed' ? 'Aralash' : m}: {fmtUzs(v as number)}
            </Badge>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">To'lovlar yo'q</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Sana</th>
                    <th className="px-3 py-2">Bemor</th>
                    <th className="px-3 py-2">Usul</th>
                    <th className="px-3 py-2 text-right">Summa</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString('uz-UZ')}</td>
                      <td className="px-3 py-2">{r.patient?.full_name ?? '—'}</td>
                      <td className="px-3 py-2 text-xs">{r.payment_method === 'mixed' ? 'Aralash' : (r.payment_method ?? '—')}</td>
                      <td className={cn('px-3 py-2 text-right font-mono tabular-nums', r.amount_uzs < 0 ? 'text-destructive' : '')}>{fmtUzs(r.amount_uzs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {encashOpen && (
        <EncashDialog
          register="inpatient"
          defaultAmount={cashNotInSafe > 0 ? cashNotInSafe : undefined}
          defaultDestination="Seyf"
          onClose={() => setEncashOpen(false)}
        />
      )}
      {drawerOpen && <DrawerPanelDialog register="inpatient" onClose={() => setDrawerOpen(false)} />}
      {safePanelOpen && <SafePanelDialog register="inpatient" onClose={() => setSafePanelOpen(false)} />}
      {kpiDetail && (
        <KpiDetailDialog
          metric={kpiDetail.metric}
          from={kpiDetail.from}
          to={kpiDetail.to}
          label={kpiDetail.label}
          register="inpatient"
          onClose={() => setKpiDetail(null)}
        />
      )}
    </div>
  );
}

// ===========================================================================
// Statsionar JURNAL — register='inpatient' feed (statsionar yozuvlari).
// ===========================================================================
function InpatientJournalView() {
  const { data: feed, isLoading } = useQuery({
    queryKey: ['journal', 'feed', 'inpatient'],
    queryFn: () => api.journal.feed({ register: 'inpatient', limit: 100 }),
    refetchInterval: 60_000,
  });
  const rows = feed ?? [];
  return (
    <Card>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Statsionar jurnali bo'sh</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Sana</th>
                  <th className="px-3 py-2">Bemor</th>
                  <th className="px-3 py-2">Shifokor</th>
                  <th className="px-3 py-2">Tavsif</th>
                  <th className="px-3 py-2">Usul</th>
                  <th className="px-3 py-2 text-right">Summa</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={cn('border-b last:border-0 hover:bg-muted/20', r.is_void && 'line-through opacity-50')}>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.occurred_at).toLocaleString('uz-UZ')}</td>
                    <td className="px-3 py-2">{r.patient_name ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{r.doctor_name ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.description ?? r.diagnosis ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{r.payment_method === 'mixed' ? 'Aralash' : (r.payment_method ?? '—')}</td>
                    <td className={cn('px-3 py-2 text-right font-mono tabular-nums', r.amount_uzs < 0 ? 'text-destructive' : '')}>{fmtUzs(r.amount_uzs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
