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
  const [selectedDate, setSelectedDate] = useState(startOfDay(new Date()));
  const [selectedSlot, setSelectedSlot] = useState<SlotPublic | null>(null);

  const from = format(selectedDate, "yyyy-MM-dd'T'00:00:00'Z'");
  const to = format(addDays(selectedDate, 1), "yyyy-MM-dd'T'00:00:00'Z'");

  const { data: slots, isLoading } = useQuery({
    queryKey: QK.clinicSlots(clinicSlug, { from, to, doctor_id: selectedDoctor !== 'any' ? selectedDoctor : undefined }),
    queryFn: () => clinicsApi.slots(clinicSlug, {
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
    <div className="rounded-2xl border bg-card shadow-sm p-4 flex flex-col gap-4">
      <h3 className="font-semibold text-base">Navbatga yozilish</h3>

      {/* Doctor filter */}
      {doctors.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedDoctor('any')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              selectedDoctor === 'any' ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
            }`}
          >
            Barchasi
          </button>
          {doctors.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedDoctor(d.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                selectedDoctor === d.id ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
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
          className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted disabled:opacity-40 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center">
          <p className="font-medium text-sm">{format(selectedDate, 'dd MMMM yyyy')}</p>
          <p className="text-xs text-muted-foreground capitalize">{format(selectedDate, 'EEEE')}</p>
        </div>
        <button
          onClick={() => setSelectedDate((d) => addDays(d, 1))}
          className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Slots */}
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : freeSlots.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-4">Bu kunda bo'sh vaqt yo'q</p>
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
          className="w-full rounded-xl bg-primary py-2.5 text-center text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Kirish va navbat olish
        </a>
      ) : (
        <button
          onClick={() => book()}
          disabled={!selectedSlot || isPending}
          className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {selectedSlot ? 'Navbatga yozilish' : 'Vaqt tanlang'}
        </button>
      )}
    </div>
  );
}
