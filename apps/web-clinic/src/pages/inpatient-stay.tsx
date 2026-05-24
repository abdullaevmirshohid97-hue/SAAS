import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRightLeft,
  BedDouble,
  Calendar,
  CircleDollarSign,
  ClipboardList,
  Heart,
  Loader2,
  LogOut,
  Phone,
  Stethoscope,
  User,
  UserCheck,
  Utensils,
  Wallet,
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
  DialogHeader,
  DialogTitle,
  PageHeader,
  cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import {
  AssignmentsPanel,
  TransferPanel,
  ChangeDoctorPanel,
  MealPeriodsPanel,
  LedgerPanel,
  DischargeForm,
} from './inpatient';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('uz-UZ') : '—';
const fmtDateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const STATUS_LABEL: Record<string, { label: string; tone: 'success' | 'default' | 'warning' | 'destructive' }> = {
  admitted: { label: 'Davolanmoqda', tone: 'success' },
  discharged: { label: 'Chiqarilgan', tone: 'default' },
  transferred: { label: "Ko'chirilgan", tone: 'warning' },
  deceased: { label: 'Vafot etgan', tone: 'destructive' },
};

const GENDER_LABEL: Record<string, string> = {
  male: 'Erkak',
  female: 'Ayol',
  other: 'Boshqa',
};

const LEDGER_KIND_LABEL: Record<string, { label: string; sign: '+' | '−'; color: string }> = {
  deposit: { label: 'Depozit', sign: '+', color: 'text-emerald-600' },
  charge: { label: 'Hisob', sign: '−', color: 'text-red-600' },
  refund: { label: 'Qaytarish', sign: '−', color: 'text-amber-600' },
  adjustment: { label: 'Tuzatish', sign: '+', color: 'text-slate-600' },
};

function calcAge(dob: string | null | undefined): string {
  if (!dob) return '—';
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return '—';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return `${age} yosh`;
}

function daysBetween(from: string, to: string | null): number {
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

export function InpatientStayPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Boshqarish dialoglari uchun state
  const [showAssign, setShowAssign] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showChangeDoctor, setShowChangeDoctor] = useState(false);
  const [showMeals, setShowMeals] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [showDischarge, setShowDischarge] = useState(false);

  // Har bir amal'dan keyin sahifani qayta yuklash + journal cache invalidate
  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['inpatient-stay', id] });
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'journal' });
    qc.invalidateQueries({ queryKey: ['inpatient-room-map'] });
    qc.invalidateQueries({ queryKey: ['inpatient-stays'] });
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['inpatient-stay', id],
    queryFn: () => api.inpatient.getStay(id!),
    enabled: !!id,
  });

  const dischargeMut = useMutation({
    mutationFn: (body: Parameters<typeof api.inpatient.discharge>[1]) =>
      api.inpatient.discharge(id!, body),
    onSuccess: () => {
      toast.success('Bemor chiqarildi');
      setShowDischarge(false);
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const days = useMemo(() => {
    if (!data) return 0;
    return daysBetween(data.stay.admitted_at, data.stay.discharged_at);
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/inpatient')} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Orqaga
        </Button>
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Bemor ma'lumoti topilmadi yoki yuklab bo'lmadi.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { stay, ledger, balance, meal_periods, assignments, care_items, vitals } = data;
  const patient = stay.patient;
  const room = stay.room;
  const doctor = stay.doctor;
  const status = STATUS_LABEL[stay.status] ?? { label: stay.status, tone: 'default' as const };

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => navigate('/inpatient')} className="gap-1 self-start">
        <ArrowLeft className="h-4 w-4" /> Statsionar
      </Button>

      <PageHeader
        eyebrow="Statsionar bemori"
        title={patient?.full_name ?? 'Bemor'}
        description={
          stay.admission_reason ? `Sabab: ${stay.admission_reason}` : "Qabul sababi ko'rsatilmagan"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={status.tone as 'success' | 'default' | 'destructive'} className="px-3 py-1">
              {status.label}
            </Badge>
            {stay.status === 'admitted' && (
              <Badge variant="outline" className="px-3 py-1">
                <Calendar className="mr-1 h-3 w-3" />
                {days} kun
              </Badge>
            )}
          </div>
        }
      />

      {/* === Boshqarish paneli — barcha amallar bir joyda === */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Boshqarish</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setShowAssign(true)}
              disabled={stay.status !== 'admitted'}
            >
              <UserCheck className="h-3.5 w-3.5" />
              Xodimlar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setShowChangeDoctor(true)}
              disabled={stay.status !== 'admitted'}
            >
              <Stethoscope className="h-3.5 w-3.5" />
              Shifokorni almashtirish
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setShowTransfer(true)}
              disabled={stay.status !== 'admitted'}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Boshqa xonaga ko'chirish
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setShowMeals(true)}
              disabled={stay.status !== 'admitted'}
            >
              <Utensils className="h-3.5 w-3.5" />
              Ovqat oraliqlari
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setShowLedger(true)}
            >
              <Wallet className="h-3.5 w-3.5" />
              Hisob (debit/kredit)
            </Button>
            {stay.status === 'admitted' && (
              <Button
                size="sm"
                variant="destructive"
                className="gap-1.5"
                onClick={() => setShowDischarge(true)}
              >
                <LogOut className="h-3.5 w-3.5" />
                Chiqarish
              </Button>
            )}
          </div>
          {stay.status !== 'admitted' && (
            <div className="mt-2 text-[11px] text-muted-foreground">
              Bemor allaqachon {STATUS_LABEL[stay.status]?.label.toLowerCase() ?? stay.status} —
              faqat hisob ko'rinadi
            </div>
          )}
        </CardContent>
      </Card>

      {/* === KPI kartochkalari === */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<BedDouble className="h-4 w-4" />}
          label="Xona / yotoq"
          value={
            room
              ? `№${room.number}${stay.bed_no ? ` / ${stay.bed_no}` : ''}`
              : '—'
          }
          sub={room?.building && room?.floor != null ? `${room.building} • ${room.floor}-qavat` : undefined}
        />
        <KpiCard
          icon={<Stethoscope className="h-4 w-4" />}
          label="Shifokor"
          value={doctor?.full_name ?? 'Tayinlanmagan'}
          sub={doctor?.phone ?? undefined}
        />
        <KpiCard
          icon={<CircleDollarSign className="h-4 w-4" />}
          label="Kunlik narx"
          value={room?.daily_price_uzs ? `${fmt(room.daily_price_uzs)} so'm` : '—'}
          sub={
            stay.with_meal && stay.meal_daily_uzs
              ? `+ ${fmt(stay.meal_daily_uzs)} ovqat`
              : undefined
          }
        />
        <KpiCard
          icon={<Wallet className="h-4 w-4" />}
          label="Balans"
          value={`${fmt(balance)} so'm`}
          sub={balance < 0 ? 'Qarzdor' : balance > 0 ? 'Depozit qoldi' : 'Yopiq hisob'}
          tone={balance < 0 ? 'danger' : balance > 0 ? 'success' : 'default'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* === Chap ustun: Bemor + Davolanish ma'lumotlari === */}
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" /> Bemor ma'lumotlari
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <InfoRow label="F.I.O." value={patient?.full_name ?? '—'} />
              <InfoRow label="Yoshi" value={calcAge(patient?.dob)} />
              <InfoRow label="Tug'ilgan" value={fmtDate(patient?.dob)} />
              <InfoRow label="Jinsi" value={patient?.gender ? GENDER_LABEL[patient.gender] ?? patient.gender : '—'} />
              <InfoRow label="Telefon" value={patient?.phone ?? '—'} icon={<Phone className="h-3 w-3" />} />
              {patient?.address && <InfoRow label="Manzil" value={patient.address} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4" /> Davolanish ma'lumotlari
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <InfoRow label="Qabul vaqti" value={fmtDateTime(stay.admitted_at)} />
              {stay.planned_discharge_at && (
                <InfoRow label="Reja chiqish" value={fmtDateTime(stay.planned_discharge_at)} />
              )}
              {stay.discharged_at && (
                <InfoRow label="Chiqish vaqti" value={fmtDateTime(stay.discharged_at)} />
              )}
              {stay.discharge_reason && (
                <InfoRow label="Chiqish sababi" value={stay.discharge_reason} />
              )}
              <InfoRow label="Davomiyligi" value={`${days} kun`} />
              {stay.with_meal && <InfoRow label="Ovqat" value="Bilan" />}
              {stay.is_half_day && <InfoRow label="Yarim kun" value="Ha" />}
              {room?.tier && <InfoRow label="Toifa" value={room.tier} />}
              {stay.admission_reason && (
                <div className="rounded-md bg-muted/40 p-2 text-xs">
                  <div className="mb-0.5 text-[10px] uppercase text-muted-foreground">Qabul sababi</div>
                  {stay.admission_reason}
                </div>
              )}
              {stay.attending_notes && (
                <div className="rounded-md bg-muted/40 p-2 text-xs">
                  <div className="mb-0.5 text-[10px] uppercase text-muted-foreground">Eslatmalar</div>
                  {stay.attending_notes}
                </div>
              )}
              {stay.discharge_summary && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs">
                  <div className="mb-0.5 text-[10px] uppercase text-emerald-700">Chiqarish xulosasi</div>
                  {stay.discharge_summary}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Biriktirilgan xodimlar */}
          {assignments.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserCheck className="h-4 w-4" /> Biriktirilgan xodimlar
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {assignments.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm"
                  >
                    <span>{a.profile?.full_name ?? a.profile_id}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {a.role === 'doctor' ? 'Shifokor' : a.role === 'nurse' ? 'Hamshira' : a.role}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* === O'ng ustun: Hisob, Ovqat oraliqlari, Care items, Vitals === */}
        <div className="space-y-4 lg:col-span-2">
          {/* Hisob */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CircleDollarSign className="h-4 w-4" /> Hisob tarixi ({ledger.length})
              </CardTitle>
              <div className="text-sm">
                Balans:{' '}
                <strong
                  className={cn(
                    'font-mono',
                    balance < 0 ? 'text-red-600' : balance > 0 ? 'text-emerald-600' : '',
                  )}
                >
                  {fmt(balance)} so'm
                </strong>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {ledger.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Hisob yozuvlari yo'q
                </p>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Vaqt</th>
                        <th className="px-3 py-2">Turi</th>
                        <th className="px-3 py-2">Tafsilot</th>
                        <th className="px-3 py-2 text-right">Summa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map((l) => {
                        const meta = LEDGER_KIND_LABEL[l.entry_kind] ?? {
                          label: l.entry_kind,
                          sign: '+' as const,
                          color: 'text-slate-600',
                        };
                        return (
                          <tr key={l.id} className="border-b last:border-b-0 hover:bg-muted/20">
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {fmtDateTime(l.created_at)}
                            </td>
                            <td className="px-3 py-2">
                              <Badge variant="secondary" className="text-[10px]">
                                {meta.label}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {l.description ?? '—'}
                            </td>
                            <td className={cn('px-3 py-2 text-right font-mono font-semibold', meta.color)}>
                              {l.amount_uzs < 0 ? '' : meta.sign}
                              {fmt(Math.abs(l.amount_uzs))} so'm
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ovqat oraliqlari */}
          {meal_periods.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Utensils className="h-4 w-4" /> Ovqat oraliqlari ({meal_periods.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {meal_periods.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
                  >
                    <div>
                      {m.from_date} → {m.to_date ?? 'davom etmoqda'}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {fmt(m.daily_uzs)} so'm/kun
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Care items (hamshira ishlari) */}
          {care_items.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Hamshira ishlari ({care_items.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Vaqt</th>
                        <th className="px-3 py-2">Xizmat</th>
                        <th className="px-3 py-2">Holat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {care_items.map((c) => (
                        <tr key={c.id} className="border-b last:border-b-0">
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {fmtDateTime(c.scheduled_at)}
                          </td>
                          <td className="px-3 py-2">{c.name}</td>
                          <td className="px-3 py-2">
                            <Badge
                              variant={c.status === 'done' ? 'success' : c.status === 'skipped' ? 'destructive' : 'secondary'}
                              className="text-[10px]"
                            >
                              {c.status === 'done' ? 'Bajarildi' : c.status === 'skipped' ? "O'tkazib" : 'Kutilmoqda'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Vitals (so'nggi o'lchovlar) */}
          {vitals.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Heart className="h-4 w-4 text-rose-500" /> So'nggi vitallar
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Vaqt</th>
                        <th className="px-3 py-2 text-right">T°C</th>
                        <th className="px-3 py-2 text-right">BP</th>
                        <th className="px-3 py-2 text-right">Puls</th>
                        <th className="px-3 py-2 text-right">SpO2</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vitals.map((v) => (
                        <tr key={v.id} className="border-b last:border-b-0">
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {fmtDateTime(v.measured_at)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{v.temperature_c ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {v.systolic_mmhg && v.diastolic_mmhg
                              ? `${v.systolic_mmhg}/${v.diastolic_mmhg}`
                              : '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{v.pulse_bpm ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {v.spo2_pct ? `${v.spo2_pct}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ============= Boshqarish dialoglari ============= */}
      <Dialog open={showAssign} onOpenChange={setShowAssign}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Xodimlar — {patient?.full_name ?? 'Bemor'}</DialogTitle>
          </DialogHeader>
          <AssignmentsPanel
            stayId={stay.id}
            assignments={assignments as never}
            onChanged={refreshAll}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showChangeDoctor} onOpenChange={setShowChangeDoctor}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Shifokorni o‘zgartirish — {patient?.full_name ?? 'Bemor'}</DialogTitle>
          </DialogHeader>
          <ChangeDoctorPanel
            stayId={stay.id}
            currentDoctorId={doctor?.id ?? null}
            currentDoctorName={doctor?.full_name ?? null}
            onDone={() => {
              setShowChangeDoctor(false);
              refreshAll();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showTransfer} onOpenChange={setShowTransfer}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Xona ko‘chirish — {patient?.full_name ?? 'Bemor'}</DialogTitle>
          </DialogHeader>
          <TransferPanel
            stayId={stay.id}
            currentRoomId={room?.id ?? null}
            onDone={() => {
              setShowTransfer(false);
              refreshAll();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showMeals} onOpenChange={setShowMeals}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ovqat oraliqlari — {patient?.full_name ?? 'Bemor'}</DialogTitle>
          </DialogHeader>
          <MealPeriodsPanel
            stayId={stay.id}
            defaultDailyUzs={Number(stay.meal_daily_uzs ?? 0)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showLedger} onOpenChange={setShowLedger}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Hisob — {patient?.full_name ?? 'Bemor'}</DialogTitle>
          </DialogHeader>
          <LedgerPanel
            patientId={stay.patient_id}
            stayId={stay.id}
            balance={balance}
            entries={ledger as never}
          />
        </DialogContent>
      </Dialog>

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
    </div>
  );
}

function InfoRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 text-sm font-medium">
        {icon}
        {value}
      </span>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'success' | 'danger';
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </div>
        <div
          className={cn(
            'text-lg font-bold',
            tone === 'success' && 'text-emerald-600',
            tone === 'danger' && 'text-red-600',
          )}
        >
          {value}
        </div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// Eslatma: LogOut/Plus iconlar boshqa joyda ishlatiladi
void LogOut;
