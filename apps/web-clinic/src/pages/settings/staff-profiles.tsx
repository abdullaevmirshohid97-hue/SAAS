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
  Phone,
  Plus,
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
  position: string;
  specialization: string | null;
  education_level: string | null;
  diploma_url: string | null;
  certificates: string[];
  photos: string[];
  salary_type: 'fixed' | 'percent' | 'mixed';
  salary_fixed_uzs: number;
  salary_percent: number;
  is_active: boolean;
  notes: string | null;
};

const POSITION_LABELS: Record<string, string> = {
  doctor: 'Shifokor',
  nurse: 'Hamshira',
  cleaner: 'Farrosh',
  administrator: 'Administrator',
  cashier: 'Kassir',
  pharmacist: 'Dorixonachi',
  lab_tech: 'Lab xodimi',
  manager: 'Menejer',
  other: 'Boshqa',
};

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
  const [filterPosition, setFilterPosition] = useState<string>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['staff-profiles', filterPosition],
    queryFn: () => api.staffProfiles.list({ position: filterPosition === 'all' ? undefined : filterPosition }),
  });

  const list = (data ?? []) as StaffProfile[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Xodimlar anketasi</h1>
          <p className="text-sm text-muted-foreground">
            To'liq xodim ma'lumotlari — rasmlar, diplom, sertifikatlar, oylik
          </p>
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
            <StaffCard key={s.id} staff={s} onClick={() => setEditing(s)} />
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
    </div>
  );
}

function StaffCard({ staff, onClick }: { staff: StaffProfile; onClick: () => void }) {
  const Icon = POSITION_ICONS[staff.position] ?? User2;
  const fullName = [staff.last_name, staff.first_name, staff.patronymic].filter(Boolean).join(' ');
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
        </div>
      </CardContent>
    </Card>
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
        is_active: isActive,
        notes: notes || undefined,
      };
      return isEdit && initial
        ? api.staffProfiles.update(initial.id, body)
        : api.staffProfiles.create(body);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Yangilandi' : 'Qo\'shildi');
      qc.invalidateQueries({ queryKey: ['staff-profiles'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.staffProfiles.remove(initial!.id),
    onSuccess: () => {
      toast.success('Arxivga olindi');
      qc.invalidateQueries({ queryKey: ['staff-profiles'] });
      onClose();
    },
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
            <Button
              variant="ghost"
              size="sm"
              className="text-rose-600"
              onClick={() => deleteMut.mutate()}
              disabled={deleteMut.isPending}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Arxivga olish
            </Button>
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
