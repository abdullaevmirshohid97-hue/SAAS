import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { castRoomDisplay } from '@clary/schemas';
import { BookText, DoorOpen, Home, Loader2, Stethoscope } from 'lucide-react';
import { toast } from 'sonner';

import { Button, EmptyState, Input, cn } from '@clary/ui-web';

import { api } from '@/lib/api';
import type { BlankSettings, ClinicInfo } from '@/lib/a4-blank';
import { useAuth } from '@/providers/auth-provider';

// =============================================================================
// Shifokor bo'limi umumiy qobig'i: kim nomidan ishlanyapti, tepa panel
// (Bosh sahifa · Ish stoli · Kabinetim), xona belgisi.
// =============================================================================

export type Doctor = { id: string; full_name: string; role?: string; phone?: string };
export type DocMeta = { clinic: ClinicInfo; settings?: BlankSettings };

// Admin/qabulxona umumiy kompyuterda tanlagan shifokor — har safar qayta
// tanlamaslik uchun brauzerda eslab qolinadi. Shifokor o'zi kirsa — tanlov yo'q.
const PICKED_KEY = 'clary.doctor-ws.doctor';
function readPicked(): Doctor | null {
  try {
    const raw = window.localStorage.getItem(PICKED_KEY);
    const v = raw ? (JSON.parse(raw) as Doctor) : null;
    return v?.id ? v : null;
  } catch {
    return null;
  }
}

export function useMe() {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      api.get<{
        clinic?: ClinicInfo & { document_settings?: BlankSettings };
        full_name?: string;
      }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
}

/** Kim nomidan ishlanyapti: shifokorning o'zi yoki admin tanlagan shifokor. */
export function useDoctorIdentity() {
  const { role, user } = useAuth();
  const isDoctor = role === 'doctor';
  const meQ = useMe();
  const [picked, setPickedState] = useState<Doctor | null>(() => (isDoctor ? null : readPicked()));
  const docMeta: DocMeta = useMemo(
    () => ({ clinic: meQ.data?.clinic ?? {}, settings: meQ.data?.clinic?.document_settings }),
    [meQ.data],
  );
  const doctor: Doctor | null =
    isDoctor && user
      ? { id: user.id, full_name: meQ.data?.full_name ?? user.email ?? 'Shifokor' }
      : picked;

  const pick = (d: Doctor) => {
    setPickedState(d);
    try {
      window.localStorage.setItem(PICKED_KEY, JSON.stringify({ id: d.id, full_name: d.full_name }));
    } catch {
      /* maxfiy rejim */
    }
  };
  const clear = () => {
    setPickedState(null);
    try {
      window.localStorage.removeItem(PICKED_KEY);
    } catch {
      /* ignore */
    }
  };
  return { isDoctor, doctor, docMeta, meQ, pick, clear };
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Xayrli tun';
  if (h < 12) return 'Xayrli tong';
  if (h < 18) return 'Xayrli kun';
  return 'Xayrli kech';
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || 'S';

/** Admin/qabulxona uchun: qaysi shifokor nomidan ishlash. */
export function DoctorPicker({ onPick, title }: { onPick: (d: Doctor) => void; title: string }) {
  const { data: doctors, isLoading } = useQuery({
    queryKey: ['doctors-list'],
    queryFn: () => api.doctors.list(),
  });
  const list = (doctors as Doctor[] | undefined) ?? [];
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">
          Qaysi shifokor nomidan ishlaysiz? Tanlov shu kompyuterda eslab qolinadi.
        </p>
      </header>
      {isLoading ? (
        <div className="text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda...
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          title="Shifokorlar topilmadi"
          description="Avval xodimlar ro'yxatiga shifokor qo'shing."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {list.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onPick(d)}
              className="bg-card hover:border-primary rounded-xl border p-5 text-left shadow-sm transition hover:shadow-md"
            >
              <div className="bg-primary/10 text-primary mb-3 flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold">
                {initialsOf(d.full_name)}
              </div>
              <div className="font-semibold">{d.full_name}</div>
              {d.phone && <div className="text-muted-foreground text-xs">{d.phone}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const NAV = [
  { to: '/doctor', label: 'Bosh sahifa', icon: Home, end: true },
  { to: '/doctor/ish-stoli', label: 'Ish stoli', icon: Stethoscope, end: false },
  { to: '/doctor/kabinet', label: 'Kabinetim', icon: BookText, end: false },
];

/** Tepa panel: shifokor + xona | bo'lim almashtirgich | o'ng tomondagi amallar. */
export function DoctorTopBar({
  doctor,
  isDoctor,
  onChangeDoctor,
  right,
  showRoom = true,
}: {
  doctor: Doctor | null;
  isDoctor: boolean;
  onChangeDoctor?: () => void;
  right?: React.ReactNode;
  showRoom?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {doctor && (
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="from-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br to-teal-500 text-sm font-bold text-white shadow-sm">
            {initialsOf(doctor.full_name)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate font-semibold leading-tight">{doctor.full_name}</div>
              {showRoom && <RoomChip doctorId={doctor.id} self={isDoctor} />}
            </div>
            {!isDoctor && onChangeDoctor ? (
              <button
                type="button"
                onClick={onChangeDoctor}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                Boshqa shifokor
              </button>
            ) : (
              <div className="text-muted-foreground text-xs">
                {new Date().toLocaleDateString('uz-UZ', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <nav className="bg-muted/60 inline-flex rounded-xl p-1" aria-label="Shifokor bo'limlari">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition',
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )
            }
          >
            <n.icon className="h-4 w-4" />
            <span className="hidden sm:inline">{n.label}</span>
          </NavLink>
        ))}
      </nav>

      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

// Shifokorning hozirgi xonasi — TV chaqiruvi "N raqamli bemor, X-xonaga" shu bilan.
// Shifokor xonaga kirganda o'zi belgilaydi (administrator ham belgilashi mumkin).
export function RoomChip({ doctorId, self }: { doctorId: string; self: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const key = ['doctor-room', doctorId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api.doctor.room(self ? undefined : doctorId),
    staleTime: 60_000,
  });
  const saveMut = useMutation({
    mutationFn: (v: string) => api.doctor.setRoom(v.trim() || null, self ? undefined : doctorId),
    onSuccess: (r) => {
      qc.setQueryData(key, { room_label: r.room_label, available: true });
      void qc.invalidateQueries({ queryKey: ['doctor-rooms'] });
      setEditing(false);
      toast.success(
        r.room_label
          ? `Xona: ${castRoomDisplay(r.room_label)} — TV chaqiruvi shu xona bilan aytiladi`
          : 'Xona olib tashlandi',
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!data?.available) return null;

  if (editing) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          saveMut.mutate(draft);
        }}
      >
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 16))}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          placeholder="Masalan: 7"
          className="h-7 w-24 text-sm"
        />
        <Button type="submit" size="sm" className="h-7 px-2" disabled={saveMut.isPending}>
          {saveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Saqlash'}
        </Button>
      </form>
    );
  }
  const room = data.room_label;
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(room ?? '');
        setEditing(true);
      }}
      title="Qaysi xonada qabul qilyapsiz? TV bemorni shu xonaga chaqiradi"
      className={
        room
          ? 'inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300'
          : 'inline-flex animate-pulse items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300'
      }
    >
      <DoorOpen className="h-3.5 w-3.5" />
      {room ? castRoomDisplay(room) : 'Xonani belgilang'}
    </button>
  );
}
