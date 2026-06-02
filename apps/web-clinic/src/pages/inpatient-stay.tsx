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
  FileDown,
  Heart,
  Loader2,
  LogOut,
  Phone,
  Plus,
  Printer,
  Stethoscope,
  User,
  UserCheck,
  UserCog,
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
  Input,
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
  ServicePanel,
  AttendantPanel,
  DischargeForm,
} from './inpatient';
import {
  printReceiptHybrid,
  inpatientDischargeReceiptHtml,
} from '@/lib/print-receipt';
import { exportInpatientInvoicePdf } from '@/lib/inpatient-invoice-pdf';

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
  const [showService, setShowService] = useState(false);
  const [showAttendant, setShowAttendant] = useState(false);
  const [showDischarge, setShowDischarge] = useState(false);

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ clinic?: { name?: string } }>('/api/v1/auth/me'),
  });
  const clinicName = me?.clinic?.name ?? 'Klinika';

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

  const { stay, ledger, balance, meal_periods, assignments, care_items, vitals, services, totals } =
    data;
  const patient = stay.patient;
  const room = stay.room;
  const doctor = stay.doctor;
  const status = STATUS_LABEL[stay.status] ?? { label: stay.status, tone: 'default' as const };
  const roomLabel = room ? `№${room.number}${stay.bed_no ? ` / ${stay.bed_no}` : ''}` : null;

  // Chiqish termal cheki
  const handlePrintDischargeReceipt = async () => {
    const html = inpatientDischargeReceiptHtml({
      clinicName,
      date: new Date().toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' }),
      patientName: patient?.full_name ?? '—',
      roomLabel,
      doctorName: doctor?.full_name ?? null,
      days: totals.days,
      roomDailyUzs: totals.room_daily_uzs,
      mealDailyUzs: totals.meal_daily_uzs,
      attendantDailyUzs: totals.attendant_daily_uzs,
      totalRoomUzs: totals.total_room_uzs,
      totalMealUzs: totals.total_meal_uzs,
      totalAttendantUzs: totals.total_attendant_uzs,
      attendantName: totals.attendant_name,
      totalDailyUzs: totals.total_charged_uzs,
      totalServicesUzs: totals.total_services_uzs,
      totalDepositedUzs: totals.total_deposited_uzs,
      balanceUzs: totals.balance_uzs,
    });
    try {
      await printReceiptHybrid(
        {
          header: clinicName,
          title: 'STATSIONAR — CHIQISH',
          lines: [
            { text: `Bemor: ${patient?.full_name ?? '—'}`, align: 'left' },
            { text: `Davolanish: ${totals.days} kun`, align: 'left' },
          ],
          total_uzs: totals.total_charged_uzs + totals.total_services_uzs,
          paid_uzs: totals.total_deposited_uzs,
          debt_uzs: totals.balance_uzs < 0 ? Math.abs(totals.balance_uzs) : 0,
          cut: true,
        },
        html,
        'receipt',
      );
    } catch (e) {
      toast.error('Chek chop etilmadi: ' + (e as Error).message);
    }
  };

  // A4 PDF hisob-faktura
  const handleExportPdf = async () => {
    try {
      await exportInpatientInvoicePdf(
        {
          clinicName,
          patientName: patient?.full_name ?? '—',
          patientPhone: patient?.phone ?? null,
          patientDob: patient?.dob ?? null,
          patientGender: patient?.gender ?? null,
          patientAddress: patient?.address ?? null,
          roomLabel,
          doctorName: doctor?.full_name ?? null,
          admittedAt: stay.admitted_at,
          dischargedAt: stay.discharged_at,
          days: totals.days,
          services: services.map((s) => ({
            name: s.items.map((it) => it.name).join(', ') || 'Xizmat',
            quantity: s.items.reduce((sum, it) => sum + it.quantity, 0) || 1,
            amount_uzs: s.total_uzs,
            doctor_name: s.doctor_name,
          })),
          roomDailyUzs: totals.room_daily_uzs,
          mealDailyUzs: totals.meal_daily_uzs,
          attendantDailyUzs: totals.attendant_daily_uzs,
          totalRoomUzs: totals.total_room_uzs,
          totalMealUzs: totals.total_meal_uzs,
          totalAttendantUzs: totals.total_attendant_uzs,
          attendantName: totals.attendant_name,
          attendantPhone: totals.attendant_phone,
          attendantAge: stay.attendant_age ?? null,
          attendantGender: stay.attendant_gender ?? null,
          totalDailyChargedUzs: totals.total_charged_uzs,
          totalServicesUzs: totals.total_services_uzs,
          totalDepositedUzs: totals.total_deposited_uzs,
          balanceUzs: totals.balance_uzs,
        },
        `statsionar-${patient?.full_name ?? 'bemor'}.pdf`,
      );
    } catch (e) {
      toast.error('PDF yaratilmadi: ' + (e as Error).message);
    }
  };

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
              onClick={() => setShowService(true)}
              disabled={stay.status !== 'admitted'}
            >
              <Plus className="h-3.5 w-3.5" />
              Xizmat qo'shish
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setShowAttendant(true)}
              disabled={stay.status !== 'admitted'}
            >
              <UserCog className="h-3.5 w-3.5" />
              Qarovchi
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
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={handlePrintDischargeReceipt}
            >
              <Printer className="h-3.5 w-3.5" />
              Chek
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={handleExportPdf}
            >
              <FileDown className="h-3.5 w-3.5" />
              A4 PDF
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
              {stay.discharged_at ? (
                <InfoRow label="Qabul vaqti" value={fmtDateTime(stay.admitted_at)} />
              ) : (
                <AdmittedAtEditor
                  stayId={id!}
                  admittedAt={stay.admitted_at}
                  onSaved={refreshAll}
                />
              )}
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

          {/* Qarovchi (attendant) */}
          {stay.attendant_name && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <User className="h-4 w-4" /> Qarovchi
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <InfoRow label="F.I.O." value={stay.attendant_name} />
                <InfoRow label="Telefon" value={stay.attendant_phone ?? '—'} icon={<Phone className="h-3 w-3" />} />
                <InfoRow label="Yoshi" value={stay.attendant_age != null ? `${stay.attendant_age} yosh` : '—'} />
                <InfoRow
                  label="Jinsi"
                  value={stay.attendant_gender ? GENDER_LABEL[stay.attendant_gender] ?? stay.attendant_gender : '—'}
                />
                <InfoRow label="Kunlik narx" value={`${fmt(Number(stay.attendant_daily_uzs ?? 0))} so'm`} />
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

          {/* Qo'shimcha xizmatlar */}
          {services.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Plus className="h-4 w-4" /> Qo'shimcha xizmatlar ({services.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Vaqt</th>
                        <th className="px-3 py-2">Xizmat</th>
                        <th className="px-3 py-2">Shifokor</th>
                        <th className="px-3 py-2">To'lov</th>
                        <th className="px-3 py-2 text-right">Summa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {services.map((s) => (
                        <tr key={s.transaction_id} className="border-b last:border-b-0 hover:bg-muted/20">
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {fmtDateTime(s.occurred_at)}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {s.items.map((it, i) => (
                              <div key={i}>
                                {it.name}
                                {it.quantity > 1 && (
                                  <span className="text-muted-foreground"> ×{it.quantity}</span>
                                )}
                              </div>
                            ))}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {s.doctor_name ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {s.paid_uzs > 0 ? (
                              <Badge variant="secondary" className="text-[10px]">
                                {s.payment_method ?? 'to‘landi'}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">
                                Balansga
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">
                            {fmt(s.total_uzs)} so'm
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

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

      {/* ============= Amaliyotlar tarixi (journal) ============= */}
      <ActivityHistoryCard
        patientId={stay.patient_id}
        from={stay.admitted_at}
        to={stay.discharged_at}
      />

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

      <Dialog open={showService} onOpenChange={setShowService}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Xizmat qo'shish — {patient?.full_name ?? 'Bemor'}</DialogTitle>
          </DialogHeader>
          <ServicePanel
            patientId={stay.patient_id}
            stayId={stay.id}
            clinicName={clinicName}
            patientName={patient?.full_name ?? 'Bemor'}
            onDone={() => setShowService(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showAttendant} onOpenChange={setShowAttendant}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Qarovchi — {patient?.full_name ?? 'Bemor'}</DialogTitle>
          </DialogHeader>
          <AttendantPanel
            stayId={stay.id}
            initialDaily={Number(stay.attendant_daily_uzs ?? 0)}
            initialName={stay.attendant_name ?? null}
            initialPhone={stay.attendant_phone ?? null}
            initialAge={stay.attendant_age ?? null}
            initialGender={stay.attendant_gender ?? null}
            onDone={() => setShowAttendant(false)}
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

// Statsionar amaliyotlar tarixi — journal feed'dan shu bemor uchun
// inpatient_* manbalarni filterlaydi. Kunlik tarix ko'rinishi.
function ActivityHistoryCard({
  patientId,
  from,
  to,
}: {
  patientId: string;
  from: string;
  to: string | null;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['journal', 'inpatient-history', patientId, from, to],
    queryFn: () =>
      api.journal.feed({
        from,
        to: to ?? new Date().toISOString(),
        source: 'inpatient',
        limit: 200,
      }),
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter(
      (r) =>
        r.patient_id === patientId &&
        r.source.startsWith('inpatient_'),
    );
  }, [data, patientId]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4" /> Amaliyotlar tarixi ({filtered.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Hozircha amaliyot yo'q
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Vaqt</th>
                  <th className="px-3 py-2 text-left font-medium">Amal</th>
                  <th className="px-3 py-2 text-left font-medium">Tafsilot</th>
                  <th className="px-3 py-2 text-left font-medium">Xodim</th>
                  <th className="px-3 py-2 text-right font-medium">Summa</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => (
                  <tr key={r.id} className={cn(r.is_void && 'opacity-50 line-through')}>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {fmtDateTime(r.occurred_at)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {SOURCE_LABEL[r.source] ?? r.source}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.description ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.cashier_name ?? r.doctor_name ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                      {r.amount_uzs ? `${fmt(r.amount_uzs)} so'm` : '—'}
                    </td>
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

// Source key -> uzbek label (statsionar uchun)
const SOURCE_LABEL: Record<string, string> = {
  inpatient_stay: 'Qabul (statsionar)',
  inpatient_discharge: 'Chiqarish',
  inpatient_transfer: 'Xona ko‘chirish',
  inpatient_assignment: 'Xodim biriktirish',
  inpatient_doctor_change: 'Shifokor almashtirish',
  inpatient_meal_period: 'Ovqat oraliq',
  inpatient_ledger: 'Hisob yozuvi',
};

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

// Yotgan bemorning qabul (yotqizish) sanasini tahrirlash. Sana yozuvni va kun
// sonini to'g'rilaydi. ESLATMA: kunlik to'lovlar avtomatik qayta hisoblanmaydi
// (patient_ledger append-only) — farq bo'lsa balans/xizmat orqali qo'lda kiritiladi.
function AdmittedAtEditor({
  stayId,
  admittedAt,
  onSaved,
}: {
  stayId: string;
  admittedAt: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => new Date(admittedAt).toLocaleDateString('en-CA'));

  const mut = useMutation({
    mutationFn: () =>
      api.inpatient.updateExtras(stayId, {
        admitted_at: new Date(`${value}T12:00:00`).toISOString(),
      }),
    onSuccess: () => {
      toast.success('Qabul sanasi yangilandi');
      setEditing(false);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!editing) {
    return (
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">Qabul vaqti</span>
        <span className="flex items-center gap-1 text-sm font-medium">
          {fmtDateTime(admittedAt)}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              setValue(new Date(admittedAt).toLocaleDateString('en-CA'));
              setEditing(true);
            }}
          >
            <Calendar className="mr-0.5 h-3 w-3" /> Tahrir
          </Button>
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">Qabul sanasi</span>
      <div className="flex items-center gap-1">
        <Input
          type="date"
          value={value}
          max={new Date().toLocaleDateString('en-CA')}
          onChange={(e) => setValue(e.target.value)}
          className="h-7 w-36 text-xs"
        />
        <Button size="sm" className="h-7 px-2 text-xs" disabled={mut.isPending} onClick={() => mut.mutate()}>
          Saqlash
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(false)}>
          Bekor
        </Button>
      </div>
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
