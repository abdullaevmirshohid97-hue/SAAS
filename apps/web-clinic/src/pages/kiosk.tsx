import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';

type QueueRow = {
  id: string;
  ticket_code: string | null;
  ticket_color: string | null;
  status: 'waiting' | 'called' | 'serving' | 'served' | 'left';
  doctor_id: string | null;
  doctor?: { id: string; full_name: string } | null;
  patient?: { id: string; full_name: string } | null;
  called_at: string | null;
};

/**
 * Kiosk display — full-screen waiting-room monitor.
 * Shows currently called tickets + next waiting tickets.
 */
export function KioskPage() {
  const qc = useQueryClient();
  const [now, setNow] = useState(() => new Date());

  const { data: kanban } = useQuery({
    queryKey: ['kiosk-kanban'],
    queryFn: () => api.queues.kanban(),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    const ch = supabase
      .channel('kiosk-queue')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'queues' },
        () => qc.invalidateQueries({ queryKey: ['kiosk-kanban'] }),
      )
      .subscribe();
    return () => {
      clearInterval(i);
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const called = useMemo(() => {
    const arr = (kanban?.by_status?.called ?? []) as QueueRow[];
    return arr.slice(0, 6);
  }, [kanban]);

  const waiting = useMemo(() => {
    const arr = (kanban?.by_status?.waiting ?? []) as QueueRow[];
    return arr.slice(0, 10);
  }, [kanban]);

  return (
    <div className="fixed inset-0 flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white">
      <header className="flex items-center justify-between px-8 py-5">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-white/50">Clary Queue</div>
          <div className="text-3xl font-semibold">Navbat tayyor</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-4xl font-bold tabular-nums">
            {now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="text-sm text-white/60">
            {now.toLocaleDateString('uz-UZ', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-12 gap-6 px-8 pb-8">
        <section className="col-span-8 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Chaqirilgan</h2>
            <div className="text-sm text-white/60">Iltimos, xonangizga o&lsquo;ting</div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {called.length === 0 && (
              <div className="col-span-2 py-16 text-center text-white/40">—</div>
            )}
            {called.map((q) => (
              <div
                key={q.id}
                className="rounded-xl border border-white/15 bg-white/10 p-5 shadow-xl"
                style={{ borderLeft: `6px solid ${q.ticket_color ?? '#60a5fa'}` }}
              >
                <div
                  className="font-mono text-5xl font-black tracking-wider"
                  style={{ color: q.ticket_color ?? '#60a5fa' }}
                >
                  {q.ticket_code ?? '—'}
                </div>
                <div className="mt-2 text-lg font-medium">{q.patient?.full_name ?? ''}</div>
                <div className="mt-1 text-sm text-white/60">{q.doctor?.full_name ?? ''}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="col-span-4 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <h2 className="mb-4 text-xl font-semibold">Kutmoqda</h2>
          <ol className="space-y-2">
            {waiting.length === 0 && <li className="text-white/40">—</li>}
            {waiting.map((q) => (
              <li key={q.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                <span
                  className="font-mono text-lg font-bold"
                  style={{ color: q.ticket_color ?? '#93c5fd' }}
                >
                  {q.ticket_code ?? '—'}
                </span>
                <span className="truncate text-sm text-white/70">
                  {q.doctor?.full_name ?? 'Biriktirilmagan'}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
