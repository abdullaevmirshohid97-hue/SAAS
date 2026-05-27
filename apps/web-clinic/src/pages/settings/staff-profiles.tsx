import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Award,
  Briefcase,
  Camera,
  CheckCircle2,
  FileText,
  GraduationCap,
  Image as ImageIcon,
  KeyRound,
  Phone,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  User2,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';

type StaffProfile = {
  id: string;
  profile_id: string | null;
  last_name: string;
  first_name: string;
  patronymic: string | null;
  phone: string | null;
  email: string | null;
  position: string;
  specialization: string | null;
  education_level: string | null;
  diploma_url: string | null;
  certificates: string[];
  photos: string[];
  salary_type: 'fixed' | 'percent' | 'mixed';
  salary_fixed_uzs: number;
  salary_percent: number;
  // Statsionar uchun alohida payroll
  inpatient_payroll_mode: 'off' | 'percent' | 'monthly' | 'bonus';
  inpatient_percent: number;
  inpatient_monthly_uzs: number;
  inpatient_admission_bonus_uzs: number;
  is_active: boolean;
  notes: string | null;
};

// Login rollar — "Ilovaga ruxsat ber" dialogida tanlanadi.
const LOGIN_ROLES: Array<{ value: string; label: string }> = [
  { value: 'clinic_admin', label: 'Administrator' },
  { value: 'receptionist', label: 'Qabulxona' },
  { value: 'cashier', label: 'Kassir' },
  { value: 'doctor', label: 'Shifokor' },
  { value: 'nurse', label: 'Hamshira' },
  { value: 'pharmacist', label: 'Dorixonachi' },
  { value: 'lab_technician', label: 'Laborant' },
  { value: 'radiologist', label: 'Radiolog' },
  { value: 'staff', label: 'Xodim' },
];

const POSITION_LABELS: Record<string, string> = {
  doctor: 'Shifokor',
  nurse: 'Hamshira',
  cleaner: 'Farrosh',
  administrator: 'Administrator',
  cashier: 'Kassir',
  receptionist: 'Qabulxona xodimi',
  pharmacist: 'Dorixonachi',
  lab_tech: 'Lab xodimi',
  manager: 'Menejer',
  other: 'Boshqa',
};

// Maoshga kirmaydigan position'lar — Hisob-kitob modulida ko'rinmaydi.
const NON_PAYROLL_POSITIONS = new Set(['cashier', 'receptionist', 'other']);

const POSITION_ICONS: Record<string, React.ElementType> = {
  doctor: Briefcase,
  nurse: User2,
  cleaner: User2,
  administrator: User2,
  cashier: Wallet,
  pharmacist: User2,
  lab_tech: User2,
  manager: User2,
  other: User2,
};

const EDUCATION_LABELS: Record<string, string> = {
  secondary: 'O\'rta',
  higher: 'Oliy',
  master: 'Magistr',
  phd: 'PhD',
};

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

export function StaffProfilesPage() {
  const [editing, setEditing] = useState<StaffProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [granting, setGranting] = useState<StaffProfile | null>(null);
  const [filterPosition, setFilterPosition] = useState<string>('all');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['staff-profiles', filterPosition],
    queryFn: () => api.staffProfiles.list({ position: filterPosition === 'all' ? undefined : filterPosition }),
    retry: false,
  });

  // Plan login o'rinlari — limit to'lganda "Ilovaga ruxsat ber" o'chiriladi.
  const seat = useQuery({
    queryKey: ['staff', 'seat-usage'],
    queryFn: () => api.staff.seatUsage(),
  });
  const seatMax = seat.data?.max ?? null;
  const seatUsed = seat.data?.used ?? 0;
  const seatFull = seatMax != null && seatUsed >= seatMax;

  const list = (data ?? []) as unknown as StaffProfile[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Xodimlar anketasi</h1>
          <p className="text-sm text-muted-foreground">
            To'liq xodim ma'lumotlari — rasmlar, diplom, sertifikatlar, oylik
          </p>
          {seatMax != null && (
            <Badge variant={seatFull ? 'destructive' : 'secondary'} className="mt-1.5">
              Ilova o‘rinlari: {seatUsed} / {seatMax}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterPosition} onValueChange={setFilterPosition}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barcha lavozimlar</SelectItem>
              {Object.entries(POSITION_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Xodim qo'shish
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="h-48 animate-pulse" />
            </Card>
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <div className="font-semibold mb-1">Xodimlar ro'yxatini yuklashda xato</div>
          <div className="text-xs">{(error as Error)?.message || 'Noma\'lum xato'}</div>
          <div className="mt-2 text-xs text-muted-foreground">
            Agar xato "klinika biriktirilmagan" bo'lsa — tizimdan chiqib qaytadan kiring.
            Bu JWT'ni yangilaydi.
          </div>
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<User2 className="h-10 w-10" />}
          title="Xodimlar mavjud emas"
          description="Yangi xodim qo'shish uchun yuqoridagi tugmadan foydalaning"
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="mr-1 h-4 w-4" /> Xodim qo'shish
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {list.map((s) => (
            <StaffCard
              key={s.id}
              staff={s}
              onClick={() => setEditing(s)}
              onGrant={() => setGranting(s)}
              seatFull={seatFull}
            />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <StaffFormDialog
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {granting && (
        <GrantAccessDialog staff={granting} onClose={() => setGranting(null)} />
      )}
    </div>
  );
}

function StaffCard({
  staff,
  onClick,
  onGrant,
  seatFull,
}: {
  staff: StaffProfile;
  onClick: () => void;
  onGrant: () => void;
  seatFull: boolean;
}) {
  const Icon = POSITION_ICONS[staff.position] ?? User2;
  const fullName = [staff.last_name, staff.first_name, staff.patronymic].filter(Boolean).join(' ');
  const hasLogin = !!staff.profile_id;
  return (
    <Card
      className={cn(
        'cursor-pointer overflow-hidden transition hover:shadow-md',
        !staff.is_active && 'opacity-60',
      )}
      onClick={onClick}
    >
      <CardContent className="p-0">
        {/* Cover photos */}
        <div className="relative h-32 bg-gradient-to-br from-primary/10 via-info/5 to-success/10">
          {staff.photos[0] ? (
            <img
              src={staff.photos[0]}
              alt={fullName}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Icon className="h-12 w-12 text-muted-foreground/40" />
            </div>
          )}
          <Badge className="absolute right-2 top-2" variant={staff.is_active ? 'default' : 'secondary'}>
            {staff.is_active ? 'Faol' : 'Nofaol'}
          </Badge>
        </div>
        <div className="space-y-2 p-3">
          <div>
            <div className="line-clamp-1 font-semibold">{fullName}</div>
            <div className="text-xs text-muted-foreground">
              {POSITION_LABELS[staff.position] ?? staff.position}
              {staff.specialization ? ` • ${staff.specialization}` : ''}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {staff.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {staff.phone}
              </span>
            )}
            {staff.education_level && (
              <Badge variant="outline" className="text-[10px]">
                <GraduationCap className="mr-1 h-2.5 w-2.5" />
                {EDUCATION_LABELS[staff.education_level]}
              </Badge>
            )}
            {staff.certificates.length > 0 && (
              <Badge variant="outline" className="text-[10px]">
                <Award className="mr-1 h-2.5 w-2.5" />
                {staff.certificates.length} sert.
              </Badge>
            )}
          </div>
          <div className="flex items-center justify-between border-t pt-2">
            <div className="text-[11px] text-muted-foreground">Oylik</div>
            <div className="text-sm font-semibold">
              {staff.salary_type === 'percent'
                ? `${staff.salary_percent}%`
                : staff.salary_type === 'mixed'
                  ? `${fmt(staff.salary_fixed_uzs)} + ${staff.salary_percent}%`
                  : `${fmt(staff.salary_fixed_uzs)} so'm`}
            </div>
          </div>

          {/* Ilovaga kirish — login bormi yoki "ruxsat ber" tugmasi */}
          <div className="flex items-center justify-between border-t pt-2">
            <div className="text-[11px] text-muted-foreground">Ilova</div>
            {hasLogin ? (
              <Badge variant="success" className="gap-1 text-[10px]">
                <ShieldCheck className="h-2.5 w-2.5" /> Login bor
              </Badge>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-[11px]"
                disabled={seatFull}
                title={
                  seatFull
                    ? 'Tarif login o‘rinlari tugadi. Tarifni yangilang.'
                    : 'Ilovaga kirish huquqi berish'
                }
                onClick={(e) => {
                  e.stopPropagation();
                  onGrant();
                }}
              >
                <KeyRound className="h-3 w-3" /> Ilovaga ruxsat ber
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// "Ilovaga ruxsat ber" — maosh xodimiga login akkaunt yaratish
// =============================================================================
function GrantAccessDialog({
  staff,
  onClose,
}: {
  staff: StaffProfile;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fullName = [staff.last_name, staff.first_name].filter(Boolean).join(' ');
  const [email, setEmail] = useState(staff.email ?? '');
  // Lavozimga qarab boshlang'ich rol taxmini.
  const defaultRole =
    staff.position === 'doctor'
      ? 'doctor'
      : staff.position === 'nurse'
        ? 'nurse'
        : staff.position === 'cashier'
          ? 'cashier'
          : staff.position === 'administrator'
            ? 'clinic_admin'
            : staff.position === 'pharmacist'
              ? 'pharmacist'
              : 'staff';
  const [role, setRole] = useState(defaultRole);

  const grantMut = useMutation({
    mutationFn: () => api.staffProfiles.grantAccess(staff.id, { email, role }),
    onSuccess: () => {
      toast.success('Ilovaga kirish huquqi berildi. Xodimga email yuborildi.');
      qc.invalidateQueries({ queryKey: ['staff-profiles'] });
      qc.invalidateQueries({ queryKey: ['staff'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ilovaga ruxsat berish</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{fullName}</span> uchun
            ilovaga kirish akkaunti yaratiladi. Xodim ko‘rsatilgan emailga kelgan
            havola orqali parol o‘rnatadi. Bu tarif login o‘rinlaridan bittasini
            band qiladi.
          </p>
          <Field label="Email *">
            <Input
              type="email"
              placeholder="xodim@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Rol *">
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOGIN_ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button
            disabled={!email || grantMut.isPending}
            onClick={() => grantMut.mutate()}
          >
            <KeyRound className="mr-1 h-4 w-4" />
            Ruxsat berish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Form dialog (create + edit)
// =============================================================================
function StaffFormDialog({
  initial,
  onClose,
}: {
  initial: StaffProfile | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!initial;

  const [lastName, setLastName] = useState(initial?.last_name ?? '');
  const [firstName, setFirstName] = useState(initial?.first_name ?? '');
  const [patronymic, setPatronymic] = useState(initial?.patronymic ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [position, setPosition] = useState(initial?.position ?? 'doctor');
  const [specialization, setSpecialization] = useState(initial?.specialization ?? '');
  const [educationLevel, setEducationLevel] = useState(initial?.education_level ?? '');
  const [photos, setPhotos] = useState<string[]>(initial?.photos ?? []);
  const [diplomaUrl, setDiplomaUrl] = useState(initial?.diploma_url ?? '');
  const [certificates, setCertificates] = useState<string[]>(initial?.certificates ?? []);
  const [salaryType, setSalaryType] = useState<StaffProfile['salary_type']>(initial?.salary_type ?? 'fixed');
  const [salaryFixed, setSalaryFixed] = useState(String(initial?.salary_fixed_uzs ?? 0));
  const [salaryPercent, setSalaryPercent] = useState(String(initial?.salary_percent ?? 0));
  // Statsionar payroll
  const [inpatientMode, setInpatientMode] = useState<StaffProfile['inpatient_payroll_mode']>(initial?.inpatient_payroll_mode ?? 'off');
  const [inpatientPercent, setInpatientPercent] = useState(String(initial?.inpatient_percent ?? 0));
  const [inpatientMonthly, setInpatientMonthly] = useState(String(initial?.inpatient_monthly_uzs ?? 0));
  const [inpatientBonus, setInpatientBonus] = useState(String(initial?.inpatient_admission_bonus_uzs ?? 0));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        last_name: lastName,
        first_name: firstName,
        patronymic: patronymic || undefined,
        phone: phone || undefined,
        position,
        specialization: specialization || undefined,
        education_level: educationLevel || undefined,
        photos,
        diploma_url: diplomaUrl || undefined,
        certificates,
        salary_type: salaryType,
        salary_fixed_uzs: Number(salaryFixed) || 0,
        salary_percent: Number(salaryPercent) || 0,
        inpatient_payroll_mode: inpatientMode,
        inpatient_percent: Number(inpatientPercent) || 0,
        inpatient_monthly_uzs: Number(inpatientMonthly) || 0,
        inpatient_admission_bonus_uzs: Number(inpatientBonus) || 0,
        is_active: isActive,
        notes: notes || undefined,
      };
      return isEdit && initial
        ? api.staffProfiles.update(initial.id, body)
        : api.staffProfiles.create(body);
    },
    onSuccess: async (saved) => {
      toast.success(isEdit ? 'Yangilandi' : 'Qo\'shildi');
      console.info('[staff-profiles] saved:', saved);
      // invalidate + refetchType: 'all' — barcha staff-profiles queries
      // (faol va inactive) majburiy qayta yuklanadi.
      // Xodim ro'yxati boshqa sahifalarda ham ishlatiladi — barchasini
      // invalidate qilamiz (reception dropdown, payroll, queue, inpatient,
      // doctor console). Aks holda yangi xodim 30 sekund ichida ko'rinmaydi.
      await qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return (
            k === 'staff-profiles' ||
            k === 'doctors' ||
            k === 'doctors-list' ||
            k === 'doctors-for-admit' ||
            k === 'staff-for-assign' ||
            k === 'payroll'
          );
        },
        refetchType: 'all',
      });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.staffProfiles.remove(initial!.id),
    onSuccess: async () => {
      toast.success('Arxivga olindi');
      // Xodim ro'yxati boshqa sahifalarda ham ishlatiladi — barchasini
      // invalidate qilamiz (reception dropdown, payroll, queue, inpatient,
      // doctor console). Aks holda yangi xodim 30 sekund ichida ko'rinmaydi.
      await qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return (
            k === 'staff-profiles' ||
            k === 'doctors' ||
            k === 'doctors-list' ||
            k === 'doctors-for-admit' ||
            k === 'staff-for-assign' ||
            k === 'payroll'
          );
        },
        refetchType: 'all',
      });
      onClose();
    },
  });

  // Butunlay o'chirish — qaytarib bo'lmaydi.
  const hardDeleteMut = useMutation({
    mutationFn: () => api.staffProfiles.hardDelete(initial!.id),
    onSuccess: async () => {
      toast.success('Butunlay o‘chirildi');
      // Xodim ro'yxati boshqa sahifalarda ham ishlatiladi — barchasini
      // invalidate qilamiz (reception dropdown, payroll, queue, inpatient,
      // doctor console). Aks holda yangi xodim 30 sekund ichida ko'rinmaydi.
      await qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return (
            k === 'staff-profiles' ||
            k === 'doctors' ||
            k === 'doctors-list' ||
            k === 'doctors-for-admit' ||
            k === 'staff-for-assign' ||
            k === 'payroll'
          );
        },
        refetchType: 'all',
      });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Xodimni tahrirlash' : 'Yangi xodim'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Photos */}
          <Section icon={<Camera className="h-4 w-4" />} title="Rasmlar (3-4 dona)">
            <PhotoGrid photos={photos} onChange={setPhotos} max={4} />
          </Section>

          {/* Identity */}
          <Section icon={<User2 className="h-4 w-4" />} title="Shaxsiy ma'lumotlar">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Familiya *">
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </Field>
              <Field label="Ism *">
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </Field>
              <Field label="Otasining ismi">
                <Input value={patronymic} onChange={(e) => setPatronymic(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Telefon">
                <Input type="tel" placeholder="+998..." value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label="Holat">
                <Select value={isActive ? 'active' : 'inactive'} onValueChange={(v) => setIsActive(v === 'active')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Faol</SelectItem>
                    <SelectItem value="inactive">Nofaol</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </Section>

          {/* Position */}
          <Section icon={<Briefcase className="h-4 w-4" />} title="Lavozim va ma'lumot">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Lavozim *">
                <Select value={position} onValueChange={setPosition}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(POSITION_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {NON_PAYROLL_POSITIONS.has(position) && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    Bu xodim Hisob-kitob (maosh) moduliga kirmaydi.
                  </p>
                )}
              </Field>
              <Field label="Ma'lumot darajasi">
                <Select value={educationLevel} onValueChange={setEducationLevel}>
                  <SelectTrigger><SelectValue placeholder="Tanlang..." /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(EDUCATION_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Mutaxassislik (ixtiyoriy)">
              <Input
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                placeholder="Masalan: kardiolog, pediatr..."
              />
            </Field>
          </Section>

          {/* Documents */}
          <Section icon={<FileText className="h-4 w-4" />} title="Diplom va sertifikatlar">
            <Field label="Diplom (PDF/rasm)">
              <SingleFileUpload value={diplomaUrl} onChange={setDiplomaUrl} accept=".pdf,image/*" />
            </Field>
            <Field label="Sertifikatlar (bir nechta)">
              <MultiFileUpload value={certificates} onChange={setCertificates} accept=".pdf,image/*" />
            </Field>
          </Section>

          {/* Salary */}
          <Section icon={<Wallet className="h-4 w-4" />} title="Oylik maoshi">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Turi">
                <Select value={salaryType} onValueChange={(v: StaffProfile['salary_type']) => setSalaryType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Belgilangan summa</SelectItem>
                    <SelectItem value="percent">Foizga</SelectItem>
                    <SelectItem value="mixed">Aralash</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {(salaryType === 'fixed' || salaryType === 'mixed') && (
                <Field label="Summa (so'm)">
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={salaryFixed}
                    onChange={(e) => setSalaryFixed(e.target.value)}
                  />
                </Field>
              )}
              {(salaryType === 'percent' || salaryType === 'mixed') && (
                <Field label="Foiz (%)">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={salaryPercent}
                    onChange={(e) => setSalaryPercent(e.target.value)}
                  />
                </Field>
              )}
            </div>
          </Section>

          {/* Statsionar maoshi — kassir/qabulxonachi/boshqa'dan tashqari barcha klinik xodimlar uchun */}
          {!NON_PAYROLL_POSITIONS.has(position) && (
            <Section icon={<Wallet className="h-4 w-4" />} title="Statsionar maoshi (alohida)">
              <div className="grid grid-cols-3 gap-2">
                <Field label="Rejim">
                  <Select value={inpatientMode} onValueChange={(v: StaffProfile['inpatient_payroll_mode']) => setInpatientMode(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">O'chirilgan</SelectItem>
                      <SelectItem value="percent">Foiz (tushumdan)</SelectItem>
                      <SelectItem value="monthly">Oylik fix</SelectItem>
                      <SelectItem value="bonus">Faqat admission bonusi</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {inpatientMode === 'percent' && (
                  <Field label="Foiz (%)">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={inpatientPercent}
                      onChange={(e) => setInpatientPercent(e.target.value)}
                    />
                  </Field>
                )}
                {inpatientMode === 'monthly' && (
                  <Field label="Oylik (so'm)">
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={inpatientMonthly}
                      onChange={(e) => setInpatientMonthly(e.target.value)}
                    />
                  </Field>
                )}
                {inpatientMode !== 'off' && (
                  <Field label="Admission bonusi (so'm)">
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={inpatientBonus}
                      onChange={(e) => setInpatientBonus(e.target.value)}
                      placeholder="Har bemorga"
                    />
                  </Field>
                )}
              </div>
              {inpatientMode !== 'off' && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {inpatientMode === 'percent' && 'Statsionar tushumidan ko\'rsatilgan foiz har kun hisoblanadi.'}
                  {inpatientMode === 'monthly' && 'Bemor yotganda har oy uchun fix summa qo\'shiladi.'}
                  {inpatientMode === 'bonus' && 'Faqat bemor yotqizilganda bir martalik bonus beriladi.'}
                  {' '}Admission bonusi har bemor yotqizilganda darhol "Avans/Bonus" daftariga yoziladi.
                </p>
              )}
            </Section>
          )}

          <Field label="Izoh (ixtiyoriy)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
          </Field>
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          {isEdit && (
            <div className="flex flex-wrap gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-amber-700"
                onClick={() => deleteMut.mutate()}
                disabled={deleteMut.isPending || hardDeleteMut.isPending}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Arxivga olish
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-rose-700"
                onClick={() => {
                  const name = [lastName, firstName].filter(Boolean).join(' ');
                  if (
                    window.confirm(
                      `"${name}" xodimni BUTUNLAY o'chirmoqchimisiz? Bu amalni QAYTARIB BO'LMAYDI.`,
                    )
                  ) {
                    hardDeleteMut.mutate();
                  }
                }}
                disabled={deleteMut.isPending || hardDeleteMut.isPending}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Butunlay o‘chirish
              </Button>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              <X className="mr-1 h-4 w-4" />
              Bekor
            </Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={!lastName || !firstName || saveMut.isPending}
            >
              <CheckCircle2 className="mr-1 h-4 w-4" />
              {isEdit ? 'Saqlash' : 'Qo\'shish'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

// =============================================================================
// Photo grid uploader
// =============================================================================
function PhotoGrid({
  photos,
  onChange,
  max,
}: {
  photos: string[];
  onChange: (next: string[]) => void;
  max: number;
}) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    const next = [...photos];
    for (const file of Array.from(files).slice(0, max - photos.length)) {
      try {
        const url = await uploadToStorage(file, 'staff-files', 'photos');
        next.push(url);
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    onChange(next);
    setUploading(false);
  };

  return (
    <div className="grid grid-cols-4 gap-2">
      {photos.map((url, idx) => (
        <div key={idx} className="group relative aspect-square overflow-hidden rounded-lg border">
          <img src={url} alt="" className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(photos.filter((_, i) => i !== idx))}
            className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      {photos.length < max && (
        <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed text-muted-foreground transition hover:border-primary hover:text-primary">
          {uploading ? (
            <span className="text-xs">...</span>
          ) : (
            <>
              <ImageIcon className="h-5 w-5" />
              <span className="mt-1 text-[10px]">Qo'shish</span>
            </>
          )}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
        </label>
      )}
    </div>
  );
}

function SingleFileUpload({
  value,
  onChange,
  accept,
}: {
  value: string | null;
  onChange: (url: string) => void;
  accept: string;
}) {
  const [uploading, setUploading] = useState(false);
  const handleUpload = async (file?: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadToStorage(file, 'staff-files', 'docs');
      onChange(url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      {value ? (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded border bg-muted/40 px-2 py-1 text-xs hover:bg-muted"
        >
          <FileText className="h-3 w-3" />
          Ko'rish
        </a>
      ) : null}
      <label className="inline-flex cursor-pointer items-center gap-1 rounded border bg-card px-2 py-1 text-xs hover:bg-accent">
        <Upload className="h-3 w-3" />
        {uploading ? 'Yuklanmoqda...' : value ? 'O\'zgartirish' : 'Yuklash'}
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => handleUpload(e.target.files?.[0])}
        />
      </label>
      {value && (
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onChange('')}>
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

function MultiFileUpload({
  value,
  onChange,
  accept,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  accept: string;
}) {
  const [uploading, setUploading] = useState(false);
  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const next = [...value];
    for (const file of Array.from(files)) {
      try {
        const url = await uploadToStorage(file, 'staff-files', 'certs');
        next.push(url);
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    onChange(next);
    setUploading(false);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {value.map((url, idx) => (
          <div key={idx} className="inline-flex items-center gap-1 rounded border bg-muted/40 px-2 py-1 text-xs">
            <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              <FileText className="mr-1 inline h-3 w-3" />
              Sertifikat #{idx + 1}
            </a>
            <button onClick={() => onChange(value.filter((_, i) => i !== idx))}>
              <X className="h-3 w-3 text-muted-foreground hover:text-rose-600" />
            </button>
          </div>
        ))}
      </div>
      <label className="inline-flex cursor-pointer items-center gap-1 rounded border bg-card px-2 py-1 text-xs hover:bg-accent">
        <Upload className="h-3 w-3" />
        {uploading ? 'Yuklanmoqda...' : 'Sertifikat qo\'shish'}
        <input
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
      </label>
    </div>
  );
}

// =============================================================================
// Storage helper
// =============================================================================
async function uploadToStorage(file: File, bucket: string, folder: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'bin';
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
