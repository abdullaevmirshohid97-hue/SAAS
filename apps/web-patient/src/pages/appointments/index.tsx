import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Calendar, Clock, MapPin, Eye, XCircle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

import { bookingsApi, type BookingPublic } from '@/lib/api';
import { QK } from '@/lib/query-keys';

const STATUS = {
  pending: { label: 'Kutilmoqda', color: 'text-amber-600 bg-amber-50 dark:bg-amber-950' },
  confirmed: { label: 'Tasdiqlandi', color: 'text-blue-600 bg-blue-50 dark:bg-blue-950' },
  checked_in: { label: 'Keldi', color: 'text-violet-600 bg-violet-50 dark:bg-violet-950' },
  completed: { label: 'Bajarildi', color: 'text-green-600 bg-green-50 dark:bg-green-950' },
  no_show: { label: 'Kelmadi', color: 'text-red-600 bg-red-50 dark:bg-red-950' },
  canceled: { label: 'Bekor qilindi', color: 'text-gray-500 bg-gray-100 dark:bg-gray-800' },
  refunded: { label: 'Qaytarildi', color: 'text-gray-500 bg-gray-100 dark:bg-gray-800' },
} as const;

function BookingCard({
  booking,
  onCancel,
}: {
  booking: BookingPublic;
  onCancel: (id: string) => void;
}) {
  const navigate = useNavigate();
  const status = STATUS[booking.status as keyof typeof STATUS] ?? {
    label: booking.status,
    color: 'text-muted-foreground bg-muted',
  };
  const isPast = new Date(booking.slot.starts_at) < new Date();
  const canCancel = ['pending', 'confirmed'].includes(booking.status) && !isPast;

  return (
    <div className="bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          {booking.clinic.logo_url && (
            <img
              src={booking.clinic.logo_url}
              alt={booking.clinic.name}
              className="h-10 w-10 rounded-xl object-contain"
            />
          )}
          <div>
            <p className="text-sm font-semibold">{booking.clinic.name}</p>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${status.color}`}
            >
              {status.label}
            </span>
          </div>
        </div>
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <Calendar className="h-4 w-4" />
          {format(new Date(booking.slot.starts_at), 'dd MMMM yyyy')}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="h-4 w-4" />
          {format(new Date(booking.slot.starts_at), 'HH:mm')} · {booking.slot.duration_min} daqiqa
        </span>
      </div>

      <div className="flex gap-2">
        {['pending', 'confirmed', 'checked_in'].includes(booking.status) && (
          <button
            onClick={() => navigate(`/queue/${booking.id}`)}
            className="hover:bg-muted flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <Eye className="h-3.5 w-3.5" />
            Navbat holati
          </button>
        )}
        {canCancel && (
          <button
            onClick={() => onCancel(booking.id)}
            className="border-destructive/30 text-destructive hover:bg-destructive/5 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <XCircle className="h-3.5 w-3.5" />
            Bekor qilish
          </button>
        )}
      </div>
    </div>
  );
}

export function AppointmentsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  const { data: bookings, isLoading } = useQuery({
    queryKey: QK.bookings(),
    queryFn: bookingsApi.list,
  });

  const { mutate: cancel } = useMutation({
    mutationFn: (id: string) => bookingsApi.cancel(id),
    onSuccess: () => {
      toast.success('Navbat bekor qilindi');
      qc.invalidateQueries({ queryKey: QK.bookings() });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const now = new Date();
  const upcoming =
    bookings?.filter(
      (b) =>
        new Date(b.slot.starts_at) >= now &&
        !['canceled', 'completed', 'no_show'].includes(b.status),
    ) ?? [];
  const past =
    bookings?.filter(
      (b) =>
        new Date(b.slot.starts_at) < now || ['canceled', 'completed', 'no_show'].includes(b.status),
    ) ?? [];
  const shown = tab === 'upcoming' ? upcoming : past;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Navbatlarim</h1>

      {/* Tabs */}
      <div className="bg-muted/50 mb-6 flex w-fit gap-1 rounded-xl p-1">
        {(['upcoming', 'past'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'upcoming' ? `Kelgusi (${upcoming.length})` : `O'tgan (${past.length})`}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
        </div>
      ) : shown.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center">
          <Calendar className="mx-auto mb-3 h-12 w-12 opacity-30" />
          <p>Navbat yo'q</p>
          {tab === 'upcoming' && (
            <a href="/clinics" className="text-primary mt-3 inline-block text-sm hover:underline">
              Klinika toping →
            </a>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((b) => (
            <BookingCard key={b.id} booking={b} onCancel={(id) => cancel(id)} />
          ))}
        </div>
      )}
    </div>
  );
}
