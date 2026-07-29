import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Users, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';

import { queueApi, type QueueStatus } from '@/lib/api';
import { QK } from '@/lib/query-keys';
import { supabase } from '@/lib/supabase';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Kutilmoqda', color: 'text-amber-600 bg-amber-50 dark:bg-amber-950' },
  confirmed: { label: 'Tasdiqlandi', color: 'text-blue-600 bg-blue-50 dark:bg-blue-950' },
  checked_in: { label: 'Keldi', color: 'text-violet-600 bg-violet-50 dark:bg-violet-950' },
  completed: { label: 'Bajarildi', color: 'text-green-600 bg-green-50 dark:bg-green-950' },
  no_show: { label: 'Kelmadi', color: 'text-red-600 bg-red-50 dark:bg-red-950' },
  canceled: { label: 'Bekor qilindi', color: 'text-gray-600 bg-gray-100 dark:bg-gray-800' },
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
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'online_queue_bookings',
          filter: `id=eq.${bookingId}`,
        },
        () => {
          void refetch();
          setTick((t) => t + 1);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [bookingId, refetch]);

  if (isLoading) {
    return (
      <div className="bg-card flex items-center justify-center rounded-2xl border p-8">
        <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-card text-muted-foreground flex items-center justify-center rounded-2xl border p-8 text-sm">
        Navbat ma'lumotlari topilmadi
      </div>
    );
  }

  const statusInfo = STATUS_LABELS[data.status] ?? {
    label: data.status,
    color: 'text-muted-foreground bg-muted',
  };
  const isDone = ['completed', 'no_show', 'canceled'].includes(data.status);

  return (
    <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          {data.clinic.logo_url && (
            <img
              src={data.clinic.logo_url}
              alt={data.clinic.name}
              className="h-8 w-8 rounded-lg object-contain"
            />
          )}
          <div>
            <p className="text-sm font-semibold">{data.clinic.name}</p>
            <p className="text-muted-foreground text-xs">
              {new Date(data.slot.starts_at).toLocaleString('uz-UZ', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="hover:bg-muted text-muted-foreground flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
          aria-label="Yangilash"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Status */}
      <div className="flex flex-col items-center gap-4 p-6">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold ${statusInfo.color}`}
        >
          {isDone ? (
            data.status === 'completed' ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )
          ) : (
            <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
          )}
          {statusInfo.label}
        </span>

        {!isDone && (
          <>
            {data.position !== null && (
              <div className="text-center">
                <p className="text-foreground text-5xl font-black">{data.position}</p>
                <p className="text-muted-foreground mt-1 text-sm">Navbatingiz</p>
              </div>
            )}

            <div className="flex gap-6">
              {data.queue_ahead > 0 && (
                <div className="text-muted-foreground flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <span className="text-sm">{data.queue_ahead} kishi oldinda</span>
                </div>
              )}
              {data.estimated_wait_min !== null && (
                <div className="text-muted-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span className="text-sm">~{data.estimated_wait_min} daqiqa</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="text-muted-foreground px-4 pb-4 text-center text-xs">
        Avtomatik yangilanadi · So'nggi yangilanish {new Date().toLocaleTimeString('uz-UZ')}
      </div>
    </div>
  );
}
