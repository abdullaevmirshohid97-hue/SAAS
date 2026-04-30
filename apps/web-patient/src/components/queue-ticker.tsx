import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Users, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';

import { queueApi, type QueueStatus } from '@/lib/api';
import { QK } from '@/lib/query-keys';
import { supabase } from '@/lib/supabase';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:    { label: 'Kutilmoqda',     color: 'text-amber-600 bg-amber-50 dark:bg-amber-950' },
  confirmed:  { label: 'Tasdiqlandi',    color: 'text-blue-600 bg-blue-50 dark:bg-blue-950' },
  checked_in: { label: 'Keldi',          color: 'text-violet-600 bg-violet-50 dark:bg-violet-950' },
  completed:  { label: 'Bajarildi',      color: 'text-green-600 bg-green-50 dark:bg-green-950' },
  no_show:    { label: "Kelmadi",        color: 'text-red-600 bg-red-50 dark:bg-red-950' },
  canceled:   { label: 'Bekor qilindi',  color: 'text-gray-600 bg-gray-100 dark:bg-gray-800' },
};

interface Props {
  bookingId: string;
}

export function QueueTicker({ bookingId }: Props) {
  const [tick, setTick] = useState(0);

  const { data, isLoading, refetch } = useQuery({
    queryKey: QK.queueStatus(bookingId),
    queryFn: () => queueApi.status(bookingId),
    refetchInterval: 30_000,
  });

  // Supabase Realtime — re-fetch when booking row changes
  useEffect(() => {
    const channel = supabase
      .channel(`booking-${bookingId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'online_queue_bookings', filter: `id=eq.${bookingId}` },
        () => { void refetch(); setTick((t) => t + 1); },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [bookingId, refetch]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border bg-card p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center rounded-2xl border bg-card p-8 text-muted-foreground text-sm">
        Navbat ma'lumotlari topilmadi
      </div>
    );
  }

  const statusInfo = STATUS_LABELS[data.status] ?? { label: data.status, color: 'text-muted-foreground bg-muted' };
  const isDone = ['completed', 'no_show', 'canceled'].includes(data.status);

  return (
    <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          {data.clinic.logo_url && (
            <img src={data.clinic.logo_url} alt={data.clinic.name} className="h-8 w-8 rounded-lg object-contain" />
          )}
          <div>
            <p className="font-semibold text-sm">{data.clinic.name}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(data.slot.starts_at).toLocaleString('uz-UZ', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          aria-label="Yangilash"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Status */}
      <div className="p-6 flex flex-col items-center gap-4">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold ${statusInfo.color}`}>
          {isDone
            ? data.status === 'completed' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />
            : <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
          }
          {statusInfo.label}
        </span>

        {!isDone && (
          <>
            {data.position !== null && (
              <div className="text-center">
                <p className="text-5xl font-black text-foreground">{data.position}</p>
                <p className="text-sm text-muted-foreground mt-1">Navbatingiz</p>
              </div>
            )}

            <div className="flex gap-6">
              {data.queue_ahead > 0 && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span className="text-sm">{data.queue_ahead} kishi oldinda</span>
                </div>
              )}
              {data.estimated_wait_min !== null && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span className="text-sm">~{data.estimated_wait_min} daqiqa</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="px-4 pb-4 text-center text-xs text-muted-foreground">
        Avtomatik yangilanadi · So'nggi yangilanish {new Date().toLocaleTimeString('uz-UZ')}
      </div>
    </div>
  );
}
