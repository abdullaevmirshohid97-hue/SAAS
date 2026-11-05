import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge, Card, CardContent, Input, PageHeader } from '@clary/ui-web';
import type { DoctorRoomRow } from '@clary/api-client';
import { castRoomDisplay } from '@clary/schemas';
import { DoorOpen, Loader2, Tv } from 'lucide-react';

import { api } from '@/lib/api';

// =============================================================================
// Navbat ekrani (Clary Cast): shifokor xonalari. TV chaqiruvda qo'ng'iroq
// chaladi va raqam + xonani ekranda ko'rsatadi (so'zli e'lon o'chirilgan).
// =============================================================================

const ROLE_LABEL: Record<string, string> = {
  doctor: 'Shifokor',
  clinic_admin: 'Administrator',
  clinic_owner: 'Rahbar',
};

export function SettingsCastPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Navbat ekrani (TV)"
        description="Shifokor bemorni chaqirganda TV qisqa qo‘ng‘iroq chaladi va navbat raqami bilan xonani butun ekranda katta ko‘rsatadi. Xona shifokor profilidan olinadi — shifokor xonaga kirganda o‘zi ham ish joyidan belgilashi mumkin."
      />
      <RoomsCard />
      <Card>
        <CardContent className="text-muted-foreground space-y-1 p-4 text-sm">
          <div className="text-foreground flex items-center gap-2 font-medium">
            <Tv className="h-4 w-4" /> TV ulash
          </div>
          <div>
            TV brauzerida <b>{window.location.host}/kiosk</b> ni oching → chiqqan kodni{' '}
            <b>Navbat → 📺 TV</b> oynasida kiriting. TV’da bir marta “Chaqiruv qo‘ng‘irog‘ini
            yoqish” tugmasini bosing.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RoomsCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['doctor-rooms'],
    queryFn: () => api.doctor.rooms(),
    retry: false,
  });
  const rows = (data ?? []).slice().sort((a, b) => {
    const ra = a.role === 'doctor' ? 0 : 1;
    const rb = b.role === 'doctor' ? 0 : 1;
    return ra - rb || a.full_name.localeCompare(b.full_name);
  });
  const missing = rows.filter((r) => r.role === 'doctor' && !r.room_label).length;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold">
            <DoorOpen className="h-4 w-4" /> Shifokorlar xonasi
          </div>
          {rows.length > 0 &&
            (missing > 0 ? (
              <Badge variant="warning">{missing} ta shifokorning xonasi belgilanmagan</Badge>
            ) : (
              <Badge variant="success">Hammasi belgilangan</Badge>
            ))}
        </div>
        {isLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
          </div>
        ) : error ? (
          <div className="text-sm text-amber-600">{(error as Error).message}</div>
        ) : (
          <div className="divide-y rounded-lg border">
            {rows.map((r) => (
              <RoomRow key={r.id} row={r} />
            ))}
          </div>
        )}
        <p className="text-muted-foreground text-xs">
          Raqam (masalan <b>7</b> yoki <b>205</b>) yoki nom (masalan <b>UZI</b>) yozing — TV
          chaqiruvda shuni ko‘rsatadi.
        </p>
      </CardContent>
    </Card>
  );
}

function RoomRow({ row }: { row: DoctorRoomRow }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(row.room_label ?? '');
  const dirty = value.trim() !== (row.room_label ?? '');
  const mut = useMutation({
    mutationFn: () => api.doctor.setRoom(value.trim() || null, row.id),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['doctor-rooms'] });
      void qc.invalidateQueries({ queryKey: ['doctor-room', row.id] });
      toast.success(
        r.room_label
          ? `${row.full_name}: ${castRoomDisplay(r.room_label)}`
          : `${row.full_name}: xona olib tashlandi`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="flex items-center gap-3 px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) mut.mutate();
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{row.full_name}</div>
        <div className="text-muted-foreground text-xs">{ROLE_LABEL[row.role] ?? row.role}</div>
      </div>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 16))}
        onBlur={() => dirty && mut.mutate()}
        placeholder="Xona"
        className="h-8 w-28"
      />
      <div className="w-20 text-right text-xs">
        {mut.isPending ? (
          <Loader2 className="ml-auto h-4 w-4 animate-spin" />
        ) : row.room_label ? (
          <span className="font-semibold text-emerald-600">{castRoomDisplay(row.room_label)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
    </form>
  );
}
