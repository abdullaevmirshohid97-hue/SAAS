import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@clary/ui-web';
import { ArrowRightLeft, X } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { useActiveShift } from '@/hooks/use-active-shift';

// =============================================================================
// Statsionarga qabul formasi — /inpatient/admit sahifasi va qabulxonadagi
// tezkor qabul oynasi (F1) uchun umumiy.
// =============================================================================

type Patient = { id: string; full_name: string; phone?: string | null; dob?: string | null };

/** Formaga oldindan tanlangan xona (narxlar AdmitPricePicker uchun). */
export type AdmitRoom = {
  id: string;
  number: string;
  section?: string | null;
  tier?: string | null;
  capacity?: number;
  daily_price_uzs?: number | null;
  half_day_price_uzs?: number | null;
  meal_daily_uzs?: number | null;
};

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

export function InpatientAdmitForm({
  initialRoomId = '',
  fixedRoom,
  freeBeds,
  defaultTab = 'existing',
  onDone,
  onCancel,
}: {
  initialRoomId?: string;
  /** Xona oldindan tanlangan (tezkor qabul) — xona tanlovi ko'rsatilmaydi. */
  fixedRoom?: AdmitRoom;
  /** Bo'sh yotoq raqamlari — tez tanlash tugmalari (ixtiyoriy). */
  freeBeds?: string[];
  defaultTab?: 'existing' | 'new';
  onDone: (stay: { id: string } | null) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const { hasShift } = useActiveShift();
  const [admitTab, setAdmitTab] = useState<'existing' | 'new'>(defaultTab);

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
  const [roomId, setRoomId] = useState<string>(fixedRoom?.id ?? initialRoomId);
  const [bedNo, setBedNo] = useState('');
  const [doctorId, setDoctorId] = useState<string>('');
  const [admissionCategory, setAdmissionCategory] = useState('');
  const [admissionReason, setAdmissionReason] = useState('');
  // Qabul (yotqizish) sanasi — default bugun (Toshkent). Orqaga qo'yilsa o'tgan
  // kunlar ham kunlik to'lovga hisoblanadi (qabuldagi darrov charge orqali).
  const [admittedAt, setAdmittedAt] = useState(() => new Date().toLocaleDateString('en-CA'));
  // Rejalashtirilgan chiqib ketish sanasi — ixtiyoriy.
  const [plannedDischarge, setPlannedDischarge] = useState('');
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

  const { data: rooms } = useQuery({
    queryKey: ['rooms-available'],
    queryFn: () => api.catalog.list('rooms', { pageSize: 200 }),
    enabled: !fixedRoom,
  });
  const roomList: Array<Record<string, unknown>> = fixedRoom
    ? [fixedRoom]
    : ((rooms as { items?: Array<Record<string, unknown>> } | undefined)?.items ?? []);
  const { data: doctors } = useQuery({
    queryKey: ['doctors-for-admit'],
    queryFn: () => api.doctors.list(),
    enabled: true,
  });
  const { data: patientsRes } = useQuery({
    queryKey: ['patients-search-adm', patientQuery],
    queryFn: () => api.patients.list({ q: patientQuery, pageSize: 10 }),
    enabled: patientQuery.length > 1,
  });
  // Yangi bemor kiritilayotganda — bazada shu ism-familiyali bemor bormi
  // (bir bemorning ikki kartasi bo'lib qolmasligi uchun).
  const twinQuery = `${lastName.trim()} ${firstName.trim()}`;
  const { data: twinsRes } = useQuery({
    queryKey: ['patients-search-adm', twinQuery],
    queryFn: () => api.patients.list({ q: twinQuery, pageSize: 5 }),
    enabled: admitTab === 'new' && lastName.trim().length > 1 && firstName.trim().length > 1,
  });
  const twins = ((twinsRes as { items?: Patient[] } | undefined)?.items ?? []) as Patient[];

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
        admission_reason:
          [admissionCategory, admissionReason].filter(Boolean).join(': ') || undefined,
        admitted_at: admittedAt ? new Date(`${admittedAt}T12:00:00`).toISOString() : undefined,
        planned_discharge_at: plannedDischarge
          ? new Date(`${plannedDischarge}T12:00:00`).toISOString()
          : undefined,
        initial_deposit_uzs: deposit ? Number(deposit) : undefined,
        with_meal: withMeal,
        meal_daily_uzs_override:
          withMeal && mealOverride ? Number(mealOverride) || undefined : undefined,
        is_half_day: isHalfDay,
        attendant_daily_uzs: attendantDaily ? Number(attendantDaily) || undefined : undefined,
        attendant_name: attendantName.trim() || undefined,
        attendant_phone: attendantPhone.trim() || undefined,
        attendant_age: attendantAge ? Number(attendantAge) || undefined : undefined,
        attendant_gender: (attendantGender || undefined) as 'male' | 'female' | 'other' | undefined,
      }),
    onSuccess: (stay) => {
      qc.invalidateQueries({ queryKey: ['inpatient-room-map'] });
      qc.invalidateQueries({ queryKey: ['inpatient-stays'] });
      const id = (stay as { id?: string } | null)?.id;
      onDone(id ? { id } : null);
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

  const pickExisting = (p: Patient) => {
    setPatientId(p.id);
    setPatientQuery(p.full_name);
    setAdmitTab('existing');
  };

  const isPending = createPatientMut.isPending || admitMut.isPending;

  return (
    <div className="space-y-4">
      {/* Deposit kiritilgan, lekin smena yo'q — qizil ogohlantirish */}
      {!hasShift && deposit && Number(deposit) > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
          <div>
            <span className="font-semibold text-red-700">Kassa smenasi ochilmagan.</span> Depozitni
            qabul qilish uchun avval smena oching, aks holda qabul rad etiladi.
          </div>
        </div>
      )}

      {/* Tab toggle */}
      <div className="bg-muted/30 mb-1 inline-flex rounded-lg border p-1">
        <button
          type="button"
          onClick={() => setAdmitTab('existing')}
          className={cn(
            'rounded px-3 py-1.5 text-xs font-medium transition',
            admitTab === 'existing' ? 'bg-background shadow-sm' : 'text-muted-foreground',
          )}
        >
          Mavjud bemor
        </button>
        <button
          type="button"
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
            <div className="text-muted-foreground text-xs font-medium">Bemorni qidirish</div>
            <Input
              autoFocus
              placeholder="Ism familyasi yoki telefon..."
              value={patientQuery}
              onChange={(e) => {
                setPatientQuery(e.target.value);
                setPatientId('');
              }}
            />
            {patientQuery.length > 1 && !patientId && (
              <div className="max-h-40 overflow-auto rounded-md border">
                {(((patientsRes as { items?: Patient[] })?.items ?? []) as Patient[]).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickExisting(p)}
                    className="hover:bg-accent flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm"
                  >
                    <span className="truncate">{p.full_name}</span>
                    {p.phone && (
                      <span className="text-muted-foreground shrink-0 text-xs">{p.phone}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </label>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-1 text-sm">
                <div className="text-muted-foreground text-xs font-medium">Familiya *</div>
                <Input autoFocus value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </label>
              <label className="space-y-1 text-sm">
                <div className="text-muted-foreground text-xs font-medium">Ism *</div>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </label>
              <label className="space-y-1 text-sm">
                <div className="text-muted-foreground text-xs font-medium">Otasining ismi</div>
                <Input value={patronymic} onChange={(e) => setPatronymic(e.target.value)} />
              </label>
            </div>
            {twins.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                <div className="mb-1 font-medium">
                  Bazada shunday bemor bor — yangi karta ochmasdan tanlang:
                </div>
                <div className="space-y-1">
                  {twins.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => pickExisting(p)}
                      className="flex w-full items-center justify-between gap-2 rounded bg-white/70 px-2 py-1 text-left hover:bg-white"
                    >
                      <span className="truncate font-medium">{p.full_name}</span>
                      <span className="shrink-0 text-amber-800/80">
                        {[p.dob, p.phone].filter(Boolean).join(' • ')} · Tanlash
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-sm">
                <div className="text-muted-foreground text-xs font-medium">Tug'ilgan sana</div>
                <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </label>
              <label className="space-y-1 text-sm">
                <div className="text-muted-foreground text-xs font-medium">Jinsi</div>
                <Select value={gender} onValueChange={(v: 'male' | 'female') => setGender(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tanlang..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Erkak</SelectItem>
                    <SelectItem value="female">Ayol</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-sm">
                <div className="text-muted-foreground text-xs font-medium">Telefon</div>
                <Input
                  type="tel"
                  placeholder="+998..."
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                <div className="text-muted-foreground text-xs font-medium">Manzil</div>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} />
              </label>
            </div>
          </>
        )}

        {/* Common fields */}
        {fixedRoom ? (
          freeBeds && freeBeds.length > 1 ? (
            <div className="space-y-1 text-sm">
              <div className="text-muted-foreground text-xs font-medium">Yotoq № (ixtiyoriy)</div>
              <div className="flex flex-wrap gap-1.5">
                {freeBeds.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBedNo(bedNo === b ? '' : b)}
                    className={cn(
                      'h-8 min-w-[2.5rem] rounded-md border px-2 text-sm font-medium transition',
                      bedNo === b
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'hover:bg-accent',
                    )}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
          ) : null
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <div className="text-muted-foreground text-xs font-medium">Xona</div>
              <Select value={roomId} onValueChange={setRoomId}>
                <SelectTrigger>
                  <SelectValue placeholder="Tanlang..." />
                </SelectTrigger>
                <SelectContent>
                  {(roomList as AdmitRoom[]).map((r) => (
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
              <div className="text-muted-foreground text-xs font-medium">Yotoq № (ixtiyoriy)</div>
              <Input value={bedNo} onChange={(e) => setBedNo(e.target.value)} />
            </label>
          </div>
        )}

        {roomId && <RoomIncludedPreview roomId={roomId} />}

        {/* Yarim kunlik tarif va ovqat tugmalari + jonli narx ko'rsatkichi */}
        {roomId && (
          <AdmitPricePicker
            rooms={roomList}
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
            <div className="text-muted-foreground text-xs font-medium">Shifokor</div>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder="Tanlang..." />
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
          <label className="space-y-1 text-sm">
            <div className="text-muted-foreground text-xs font-medium">
              Yotish sababi (kategoriya)
            </div>
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <div className="text-muted-foreground text-xs font-medium">Qabul sanasi</div>
            <Input
              type="date"
              value={admittedAt}
              max={new Date().toLocaleDateString('en-CA')}
              onChange={(e) => setAdmittedAt(e.target.value)}
            />
            <div className="text-muted-foreground text-[11px]">
              O&lsquo;tgan kunga qo&lsquo;ysangiz, o&lsquo;sha kundan kunlik to&lsquo;lov
              hisoblanadi.
            </div>
          </label>

          <label className="space-y-1 text-sm">
            <div className="text-muted-foreground text-xs font-medium">
              Chiqib ketish sanasi (rejalashtirilgan)
            </div>
            <Input
              type="date"
              value={plannedDischarge}
              min={admittedAt}
              onChange={(e) => setPlannedDischarge(e.target.value)}
            />
            <div className="text-muted-foreground text-[11px]">
              Ixtiyoriy — taxminiy chiqish kuni. Haqiqiy chiqarish alohida amalga oshiriladi.
            </div>
          </label>
        </div>

        <label className="space-y-1 text-sm">
          <div className="text-muted-foreground text-xs font-medium">Qo'shimcha izoh</div>
          <textarea
            value={admissionReason}
            onChange={(e) => setAdmissionReason(e.target.value)}
            rows={2}
            className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          />
        </label>

        <label className="space-y-1 text-sm">
          <div className="text-muted-foreground text-xs font-medium">
            Boshlang&lsquo;ich depozit
          </div>
          <Input
            type="number"
            placeholder="0"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
          />
        </label>

        {/* Qarovchi (attendant) — ixtiyoriy */}
        <div className="space-y-2 rounded-lg border p-3">
          <div className="text-muted-foreground text-xs font-semibold">Qarovchi (ixtiyoriy)</div>
          <label className="space-y-1 text-sm">
            <div className="text-muted-foreground text-xs font-medium">F.I.O.</div>
            <Input
              placeholder="Qarovchi F.I.O."
              value={attendantName}
              onChange={(e) => setAttendantName(e.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-sm">
              <div className="text-muted-foreground text-xs font-medium">Telefon</div>
              <Input
                placeholder="+998..."
                value={attendantPhone}
                onChange={(e) => setAttendantPhone(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <div className="text-muted-foreground text-xs font-medium">Yoshi</div>
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
              <div className="text-muted-foreground text-xs font-medium">Jinsi</div>
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
              <div className="text-muted-foreground text-xs font-medium">Kunlik narxi (so'm)</div>
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
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button variant="outline" onClick={onCancel}>
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
      </div>
    </div>
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
      <div className="mb-1 text-xs font-semibold text-emerald-900">
        Bu xonaga qo'shilgan xizmatlar:
      </div>
      <ul className="space-y-0.5">
        {items.map((it) => {
          const name = it.service?.name_i18n
            ? (it.service.name_i18n['uz-Latn'] ??
              Object.values(it.service.name_i18n)[0] ??
              'Xizmat')
            : 'Xizmat';
          return (
            <li key={it.id} className="flex justify-between text-emerald-900">
              <span>{name}</span>
              <span className="font-mono text-xs">{it.frequency_per_week}/hafta</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 text-[11px] text-emerald-900/70">
        Bu xizmatlar admit'dan keyin hamshira tomonidan care_item sifatida qilinadi.
      </div>
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
  const halfDay =
    room.half_day_price_uzs != null ? Number(room.half_day_price_uzs) : Math.floor(daily / 2);
  // Xona default ovqat narxi (0 bo'lishi mumkin)
  const roomMeal = Number(room.meal_daily_uzs ?? 0);
  // Effektiv ovqat narxi: override > 0 bo'lsa o'sha, aks holda xona default
  const overrideNum = Math.max(0, Number(mealOverride) || 0);
  const effectiveMeal = overrideNum > 0 ? overrideNum : roomMeal;
  const base = isHalfDay ? halfDay : daily;
  const total = base + (withMeal ? effectiveMeal : 0);
  const fmt = (n: number) => n.toLocaleString('uz-UZ');

  return (
    <div className="bg-muted/20 space-y-2 rounded-lg border p-3">
      <div className="text-muted-foreground text-xs font-medium">Tarif va qo‘shimcha</div>
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
            <span className="text-muted-foreground text-xs">({fmt(halfDay)} so‘m)</span>
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
            <span className="text-muted-foreground text-xs">(+{fmt(roomMeal)} so‘m/kun)</span>
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
              className="bg-background h-8 w-32 rounded-md border px-2 text-sm"
            />
            <span className="text-muted-foreground text-xs">so‘m/kun</span>
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
            className="bg-background h-7 w-28 rounded-md border px-2 text-xs"
          />
          <span className="text-muted-foreground">so‘m/kun</span>
        </div>
      )}

      <div className="flex items-center justify-between border-t pt-2">
        <span className="text-muted-foreground text-xs">
          {isHalfDay ? 'Yarim kun' : 'Kuniga'}
          {withMeal ? ' + ovqat' : ''}:
        </span>
        <span className="text-base font-semibold">{fmt(total)} so‘m</span>
      </div>

      {withMeal && (
        <div className="text-muted-foreground text-[11px]">
          ℹ️ Ovqat har kun avtomatik hisoblanadi. Keyin xohlasangiz "Faol bemorlar → Ovqat"
          oynasidan to'xtatish/o'zgartirish mumkin.
        </div>
      )}
    </div>
  );
}
