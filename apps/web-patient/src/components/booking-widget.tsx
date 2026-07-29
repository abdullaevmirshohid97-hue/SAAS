import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, addDays, startOfDay } from 'date-fns';
import { ChevronLeft, ChevronRight, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { clinicsApi, bookingsApi, type SlotPublic, type DoctorPublic } from '@/lib/api';
import { QK } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

interface Props {
  clinicSlug: string;
  doctors: DoctorPublic[];
  onBooked?: (bookingId: string) => void;
}

export function BookingWidget({ clinicSlug, doctors, onBooked }: Props) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [selectedDoctor, setSelectedDoctor] = useState<string | 'any'>('any');
  const [selectedDate, setSelectedDate] = useState<Date>(startOfDay(new Date()));
  const [selectedSlot, setSelectedSlot] = useState<SlotPublic | null>(null);

  const from = format(selectedDate, "yyyy-MM-dd'T'00:00:00'Z'");
  const to = format(addDays(selectedDate, 1), "yyyy-MM-dd'T'00:00:00'Z'");

  const { data: slots, isLoading } = useQuery({
    queryKey: QK.clinicSlots(clinicSlug, {
      from,
      to,
      doctor_id: selectedDoctor !== 'any' ? selectedDoctor : undefined,
    }),
    queryFn: () =>
      clinicsApi.slots(clinicSlug, {
        from,
        to,
        ...(selectedDoctor !== 'any' ? { doctor_id: selectedDoctor } : {}),
      }),
  });

  const { mutate: book, isPending } = useMutation({
    mutationFn: () => bookingsApi.create({ slot_id: selectedSlot!.id }),
    onSuccess: (b) => {
      toast.success('Navbat tasdiqlandi!');
      qc.invalidateQueries({ queryKey: QK.bookings() });
      onBooked?.(b.id);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const freeSlots = slots?.filter((s) => s.booked_count < s.capacity) ?? [];

  return (
    <div className="bg-card flex flex-col gap-4 rounded-2xl border p-4 shadow-sm">
      <h3 className="text-base font-semibold">Navbatga yozilish</h3>

      {/* Doctor filter */}
      {doctors.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedDoctor('any')}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedDoctor === 'any'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'hover:bg-muted'
            }`}
          >
            Barchasi
          </button>
          {doctors.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedDoctor(d.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedDoctor === d.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'hover:bg-muted'
              }`}
            >
              {d.full_name}
            </button>
          ))}
        </div>
      )}

      {/* Date picker */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setSelectedDate((d) => addDays(d, -1))}
          disabled={selectedDate <= startOfDay(new Date())}
          className="hover:bg-muted flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center">
          <p className="text-sm font-medium">{format(selectedDate, 'dd MMMM yyyy')}</p>
          <p className="text-muted-foreground text-xs capitalize">{format(selectedDate, 'EEEE')}</p>
        </div>
        <button
          onClick={() => setSelectedDate((d) => addDays(d, 1))}
          className="hover:bg-muted flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Slots */}
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : freeSlots.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-sm">Bu kunda bo'sh vaqt yo'q</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {freeSlots.map((slot) => (
            <button
              key={slot.id}
              onClick={() => setSelectedSlot(slot)}
              className={`flex items-center justify-center gap-1 rounded-xl border py-2.5 text-sm font-medium transition-colors ${
                selectedSlot?.id === slot.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'hover:bg-muted'
              }`}
            >
              <Clock className="h-3 w-3" />
              {format(new Date(slot.starts_at), 'HH:mm')}
            </button>
          ))}
        </div>
      )}

      {/* Book button */}
      {!session ? (
        <a
          href="/auth/login"
          className="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-xl py-2.5 text-center text-sm font-semibold transition-colors"
        >
          Kirish va navbat olish
        </a>
      ) : (
        <button
          onClick={() => book()}
          disabled={!selectedSlot || isPending}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {selectedSlot ? 'Navbatga yozilish' : 'Vaqt tanlang'}
        </button>
      )}
    </div>
  );
}
