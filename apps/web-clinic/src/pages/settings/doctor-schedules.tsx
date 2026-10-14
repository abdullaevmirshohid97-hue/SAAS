import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  PageHeader,
  Textarea,
  cn,
} from '@clary/ui-web';
import type { BookingDoctor, BookingRule } from '@clary/api-client';
import { CalendarClock, Copy, Plus, Search, Stethoscope, Trash2 } from 'lucide-react';

import { api } from '@/lib/api';

// =============================================================================
// Shifokorlar jadvali — AI qabulxona, Telegram bot va qabulxona shu jadvalga
// qarab navbat beradi (bo'sh vaqtlar avtomatik hisoblanadi).
// =============================================================================

const DAYS = [
  { v: 1, short: 'Du', label: 'Dushanba' },
  { v: 2, short: 'Se', label: 'Seshanba' },
  { v: 3, short: 'Ch', label: 'Chorshanba' },
  { v: 4, short: 'Pa', label: 'Payshanba' },
  { v: 5, short: 'Ju', label: 'Juma' },
  { v: 6, short: 'Sh', label: 'Shanba' },
  { v: 0, short: 'Ya', label: 'Yakshanba' },
];

const CATEGORY_OPTIONS = [
  { v: '', label: '— ko‘rsatilmagan —' },
  { v: 'highest', label: 'Oliy toifa' },
  { v: 'first', label: '1-toifa' },
  { v: 'second', label: '2-toifa' },
  { v: 'none', label: 'Toifasiz' },
];
const DEGREE_OPTIONS = [
  { v: '', label: '— yo‘q —' },
  { v: 'phd', label: 'PhD (t.f.f.d.)' },
  { v: 'dsc', label: 'DSc (t.f.d.)' },
];
const TITLE_OPTIONS = [
  { v: '', label: '— yo‘q —' },
  { v: 'docent', label: 'Dotsent' },
  { v: 'professor', label: 'Professor' },
];
const SLOT_OPTIONS = [10, 15, 20, 30, 40, 45, 60, 90];

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : `${Math.round(n).toLocaleString('ru-RU')} so‘m`;

function selectCls() {
  return 'border-input bg-background h-9 w-full rounded-md border px-2 text-sm';
}

export function DoctorSchedulesPage() {
  const [q, setQ] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [editing, setEditing] = useState<BookingDoctor | null>(null);

  const doctors = useQuery({
    queryKey: ['booking-doctors'],
    queryFn: () => api.aiReception.doctors(),
  });

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (doctors.data ?? []).filter(
      (d) =>
        (!onlyOpen || d.booking_enabled) &&
        (!needle ||
          d.full_name.toLowerCase().includes(needle) ||
          (d.specialization ?? '').toLowerCase().includes(needle) ||
          d.specialty_label.toLowerCase().includes(needle)),
    );
  }, [doctors.data, q, onlyOpen]);

  const openCount = (doctors.data ?? []).filter((d) => d.booking_enabled && d.rules.length).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shifokorlar jadvali (online navbat)"
        description="Har shifokor qaysi kunlari, soat nechadan nechagacha qabul qilishini kiriting. AI qabulxona (telefon), Telegram bot va qabulxona bo‘sh vaqtni shu jadvaldan avtomatik topadi — band vaqtlar, ta’til va bayramlar chiqarib tashlanadi."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="text-muted-foreground absolute left-2.5 top-2.5 h-4 w-4" />
          <Input
            className="pl-8"
            placeholder="Shifokor yoki mutaxassislik…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-primary h-4 w-4"
            checked={onlyOpen}
            onChange={(e) => setOnlyOpen(e.target.checked)}
          />
          Faqat navbat ochiqlar
        </label>
        <Badge variant={openCount ? 'success' : 'outline'} className="ml-auto">
          Navbat ochiq: {openCount} ta shifokor
        </Badge>
      </div>

      {doctors.isLoading ? (
        <div className="text-muted-foreground text-sm">Yuklanmoqda…</div>
      ) : doctors.error ? (
        <Card>
          <CardContent className="text-destructive p-4 text-sm">
            {(doctors.error as Error).message}
          </CardContent>
        </Card>
      ) : list.length === 0 ? (
        <EmptyState
          title="Shifokor topilmadi"
          description="Avval Sozlamalar → Xodimlar anketasi bo‘limida shifokor qo‘shing (lavozim: shifokor, mutaxassislik bilan)."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.map((d) => (
            <DoctorCard key={d.staff_id} doctor={d} onEdit={() => setEditing(d)} />
          ))}
        </div>
      )}

      {editing && <DoctorScheduleDialog doctor={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DoctorCard({ doctor: d, onEdit }: { doctor: BookingDoctor; onEdit: () => void }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      api.aiReception.saveDoctor(d.staff_id, { booking_enabled: enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['booking-doctors'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const ready = d.booking_enabled && d.rules.length > 0;
  return (
    <Card className={cn(ready && 'border-emerald-500/40')}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          {d.photo_url ? (
            <img src={d.photo_url} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-full">
              <Stethoscope className="text-muted-foreground h-5 w-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{d.full_name}</div>
            <div className="text-muted-foreground text-sm">
              {d.specialty_label}
              {d.specialization && d.specialization !== d.specialty_label
                ? ` · ${d.specialization}`
                : ''}
            </div>
            {d.credentials && <div className="mt-0.5 text-xs">{d.credentials}</div>}
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              className="accent-primary h-4 w-4"
              checked={d.booking_enabled}
              disabled={toggle.isPending}
              onChange={(e) => toggle.mutate(e.target.checked)}
            />
            Online navbat
          </label>
        </div>

        <div className="grid gap-1 text-sm">
          <div className="flex items-center gap-2">
            <CalendarClock className="text-muted-foreground h-4 w-4" />
            {d.schedule_summary || <span className="text-amber-600">Jadval kiritilmagan</span>}
          </div>
          <div className="text-muted-foreground text-xs">
            Qabul: {d.slot_minutes} daqiqa · Narx: {fmtMoney(d.service_price_uzs)}
            {d.time_off.length > 0 && ` · Ta’til: ${d.time_off.length} ta`}
          </div>
          {d.booking_enabled && d.rules.length === 0 && (
            <div className="text-xs text-amber-600">
              Navbat yoqilgan, lekin jadval yo‘q — bemorlarga bo‘sh vaqt chiqmaydi.
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={onEdit}>
            Jadval va ma’lumot
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type RuleRow = { weekday: number; start_time: string; end_time: string; capacity: number };

function DoctorScheduleDialog({ doctor, onClose }: { doctor: BookingDoctor; onClose: () => void }) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(doctor.booking_enabled);
  const [category, setCategory] = useState(doctor.medical_category ?? '');
  const [degree, setDegree] = useState(doctor.academic_degree ?? '');
  const [title, setTitle] = useState(doctor.academic_title ?? '');
  const [experience, setExperience] = useState(
    doctor.experience_years != null ? String(doctor.experience_years) : '',
  );
  const [slot, setSlot] = useState(doctor.slot_minutes);
  const [serviceId, setServiceId] = useState(doctor.service_id ?? '');
  const [note, setNote] = useState(doctor.public_note ?? '');
  const [keywords, setKeywords] = useState(doctor.keywords.join(', '));
  const [rules, setRules] = useState<RuleRow[]>(
    doctor.rules.map((r: BookingRule) => ({
      weekday: r.weekday,
      start_time: r.start_time,
      end_time: r.end_time,
      capacity: r.capacity ?? 1,
    })),
  );

  const services = useQuery({
    queryKey: ['services-list-booking'],
    queryFn: () => api.catalog.list('services', { pageSize: 200 }),
  });
  type Svc = { id: string; name_i18n?: Record<string, string>; price_uzs?: number };
  const serviceOptions = ((services.data?.items ?? []) as Svc[]).map((s) => ({
    id: s.id,
    label: `${s.name_i18n?.['uz-Latn'] ?? Object.values(s.name_i18n ?? {})[0] ?? '—'} — ${fmtMoney(s.price_uzs)}`,
  }));

  const save = useMutation({
    mutationFn: () =>
      api.aiReception.saveDoctor(doctor.staff_id, {
        booking_enabled: enabled,
        medical_category: (category || null) as BookingDoctor['medical_category'],
        academic_degree: (degree || null) as BookingDoctor['academic_degree'],
        academic_title: (title || null) as BookingDoctor['academic_title'],
        experience_years: experience.trim() ? Math.max(0, Math.min(70, Number(experience))) : null,
        slot_minutes: slot,
        service_id: serviceId || null,
        public_note: note.trim() || null,
        keywords: keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
          .slice(0, 20),
        rules,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['booking-doctors'] });
      toast.success('Saqlandi');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addRule = (weekday: number) =>
    setRules((r) => [...r, { weekday, start_time: '09:00', end_time: '17:00', capacity: 1 }]);
  const updateRule = (idx: number, patch: Partial<RuleRow>) =>
    setRules((r) => r.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  const removeRule = (idx: number) => setRules((r) => r.filter((_, i) => i !== idx));
  const applyTemplate = (days: number[], ranges: Array<[string, string]>) =>
    setRules(
      days.flatMap((weekday) =>
        ranges.map(([start_time, end_time]) => ({ weekday, start_time, end_time, capacity: 1 })),
      ),
    );
  const copyMondayToWeek = () => {
    const mon = rules.filter((r) => r.weekday === 1);
    if (!mon.length) {
      toast.error('Avval Dushanba uchun vaqt kiriting');
      return;
    }
    setRules([
      ...mon,
      ...[2, 3, 4, 5].flatMap((weekday) => mon.map((r) => ({ ...r, weekday }))),
      ...rules.filter((r) => r.weekday === 6 || r.weekday === 0),
    ]);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {doctor.full_name}
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              {doctor.specialty_label}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-2">
            <div className="text-sm font-semibold">Unvon (bemorga aytiladi)</div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Toifa">
                <select
                  className={selectCls()}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Ilmiy daraja">
                <select
                  className={selectCls()}
                  value={degree}
                  onChange={(e) => setDegree(e.target.value)}
                >
                  {DEGREE_OPTIONS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Ilmiy unvon">
                <select
                  className={selectCls()}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                >
                  {TITLE_OPTIONS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tajriba (yil)">
                <Input
                  type="number"
                  min={0}
                  max={70}
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                />
              </Field>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Navbat</div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="accent-primary h-4 w-4"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                Online navbat ochiq (AI, Telegram)
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Bitta qabul davomiyligi">
                <select
                  className={selectCls()}
                  value={slot}
                  onChange={(e) => setSlot(Number(e.target.value))}
                >
                  {SLOT_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m} daqiqa
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Asosiy xizmat (narx shundan)">
                <select
                  className={selectCls()}
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                >
                  <option value="">— tanlanmagan —</option>
                  {serviceOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Kalit so‘zlar (vergul bilan)">
                <Input
                  placeholder="EKG, bolalar, UZI"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                />
              </Field>
            </div>
            <Field label="AI uchun izoh (bemorga aytiladi)">
              <Textarea
                rows={2}
                maxLength={300}
                placeholder="Masalan: faqat kattalar qabul qilinadi; 3 yoshdan katta bolalar"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">Haftalik jadval</div>
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    applyTemplate(
                      [1, 2, 3, 4, 5],
                      [
                        ['09:00', '13:00'],
                        ['14:00', '17:00'],
                      ],
                    )
                  }
                >
                  Du–Ju 9–17 (tushlik 13–14)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => applyTemplate([1, 2, 3, 4, 5, 6], [['08:00', '14:00']])}
                >
                  Du–Sh 8–14
                </Button>
                <Button size="sm" variant="outline" onClick={copyMondayToWeek}>
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  Dushanbani Du–Ju ga
                </Button>
              </div>
            </div>
            <div className="divide-y rounded-lg border">
              {DAYS.map((day) => {
                const rows = rules
                  .map((r, idx) => ({ r, idx }))
                  .filter(({ r }) => r.weekday === day.v);
                return (
                  <div key={day.v} className="flex flex-wrap items-start gap-3 p-2">
                    <div className="w-24 pt-1.5 text-sm font-medium">{day.label}</div>
                    <div className="flex-1 space-y-1.5">
                      {rows.length === 0 && (
                        <div className="text-muted-foreground pt-1.5 text-xs">Qabul yo‘q</div>
                      )}
                      {rows.map(({ r, idx }) => (
                        <div key={idx} className="flex flex-wrap items-center gap-2">
                          <Input
                            type="time"
                            className="h-8 w-28"
                            value={r.start_time}
                            onChange={(e) => updateRule(idx, { start_time: e.target.value })}
                          />
                          <span className="text-muted-foreground">—</span>
                          <Input
                            type="time"
                            className="h-8 w-28"
                            value={r.end_time}
                            onChange={(e) => updateRule(idx, { end_time: e.target.value })}
                          />
                          <label className="text-muted-foreground flex items-center gap-1 text-xs">
                            bir vaqtda
                            <Input
                              type="number"
                              min={1}
                              max={50}
                              className="h-8 w-16"
                              value={r.capacity}
                              onChange={(e) =>
                                updateRule(idx, {
                                  capacity: Math.max(1, Number(e.target.value) || 1),
                                })
                              }
                            />
                            bemor
                          </label>
                          <Button size="sm" variant="ghost" onClick={() => removeRule(idx)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => addRule(day.v)}>
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      vaqt
                    </Button>
                  </div>
                );
              })}
            </div>
            <p className="text-muted-foreground text-[11px]">
              "Bir vaqtda N bemor" — jonli navbat bilan ishlaydigan shifokorlar uchun (masalan, bir
              soatda 4 kishi). Odatda 1.
            </p>
          </section>

          <TimeOffSection doctor={doctor} />
          <SlotsPreview staffId={doctor.staff_id} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TimeOffSection({ doctor }: { doctor: BookingDoctor }) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState('');
  const [items, setItems] = useState(doctor.time_off);
  useEffect(() => setItems(doctor.time_off), [doctor.time_off]);

  const add = useMutation({
    mutationFn: () =>
      api.aiReception.addTimeOff(doctor.staff_id, {
        // Toshkent vaqti bilan butun kunlar
        starts_at: `${from}T00:00:00+05:00`,
        ends_at: `${to}T23:59:59+05:00`,
        reason: reason.trim() || null,
      }),
    onSuccess: (r) => {
      setItems((x) => [...x, r.time_off]);
      qc.invalidateQueries({ queryKey: ['booking-doctors'] });
      setReason('');
      if (r.affected_appointments.length) {
        toast.warning(
          `Bu kunlarga ${r.affected_appointments.length} ta bemor yozilgan — ularga qo‘ng‘iroq qilib, vaqtni ko‘chiring.`,
          { duration: 10_000 },
        );
      } else toast.success('Qo‘shildi');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.aiReception.removeTimeOff(id),
    onSuccess: (_r, id) => {
      setItems((x) => x.filter((t) => t.id !== id));
      qc.invalidateQueries({ queryKey: ['booking-doctors'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="space-y-2">
      <div className="text-sm font-semibold">Ta’til / kasallik / ishda emas</div>
      {items.length > 0 && (
        <div className="space-y-1">
          {items.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
              <span>
                {new Date(t.starts_at).toLocaleDateString('uz-UZ')} —{' '}
                {new Date(t.ends_at).toLocaleDateString('uz-UZ')}
              </span>
              {t.reason && <span className="text-muted-foreground">· {t.reason}</span>}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => remove.mutate(t.id)}
                disabled={remove.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Boshlanish">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Tugash">
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Sabab">
          <Input placeholder="ta’til" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Button
          size="sm"
          variant="outline"
          onClick={() => add.mutate()}
          disabled={add.isPending || to < from}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Qo‘shish
        </Button>
      </div>
    </section>
  );
}

function SlotsPreview({ staffId }: { staffId: string }) {
  const [open, setOpen] = useState(false);
  const slots = useQuery({
    queryKey: ['booking-slots-preview', staffId],
    queryFn: () => api.aiReception.slots({ staff_id: staffId, days: 7 }),
    enabled: open,
  });
  const byDate = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of slots.data?.slots ?? []) m.set(s.date, [...(m.get(s.date) ?? []), s.time]);
    return [...m.entries()];
  }, [slots.data]);
  return (
    <section className="space-y-2">
      <button
        type="button"
        className="text-primary text-sm font-semibold hover:underline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▾' : '▸'} Bo‘sh vaqtlar (saqlangan jadval bo‘yicha, 7 kun)
      </button>
      {open &&
        (slots.isLoading ? (
          <div className="text-muted-foreground text-xs">Yuklanmoqda…</div>
        ) : byDate.length === 0 ? (
          <div className="text-muted-foreground text-xs">Bo‘sh vaqt yo‘q (jadvalni saqlang).</div>
        ) : (
          <div className="space-y-1 text-xs">
            {byDate.map(([date, times]) => (
              <div key={date} className="flex gap-2">
                <span className="w-24 shrink-0 font-medium">{date}</span>
                <span className="text-muted-foreground">{times.join(' · ')}</span>
              </div>
            ))}
          </div>
        ))}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-muted-foreground text-xs font-medium">{label}</label>
      {children}
    </div>
  );
}
