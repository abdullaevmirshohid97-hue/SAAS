import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { castRoomDisplay, castSeq } from '@clary/schemas';
import { CastVoice } from '@clary/ui-web';
import { UZ_MONTHS, UZ_WEEKDAYS } from '@clary/utils';

import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';

type Pairing = {
  paired: boolean;
  clinicId: string | null;
  code: string | null;
};
type CallPayload = {
  queue_id?: string;
  ticket_code?: string | null;
  seq?: number | null;
  room?: string | null;
  patient_name?: string;
  doctor_name?: string;
  device_id?: string | null;
};
type ActiveCall = {
  ticket: string | null;
  room: string;
  patient: string;
  doctor: string;
};

// Qurilma ID — localStorage'da saqlanadi (TV doimiy bog'lanib qoladi).
function getDeviceId(): string {
  const KEY = 'clary.cast.deviceId';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID?.() ?? `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

/**
 * Kiosk / Clary Cast TV — full-screen navbat ekrani.
 * Bog'lanmagan bo'lsa pairing kodi; bog'langach bugungi navbat taxtasi va
 * chaqiruvlar: "4 raqamli bemor, 8-xonaga" (xona — shifokor profilidan).
 * Chaqiruvni server yuboradi (navbat "called" bo'lganda).
 */
export function KioskPage() {
  const [now, setNow] = useState(() => new Date());
  const deviceId = useMemo(() => getDeviceId(), []);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [call, setCall] = useState<ActiveCall | null>(null);
  const callTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ovoz: yozib olingan iboralar → qurilmaning o'zbek ovozi → faqat qo'ng'iroq
  const voice = useMemo(() => new CastVoice(), []);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => voice.onChange(rerender), [voice]);
  const soundOn = voice.unlocked; // Chrome --autoplay-policy=no-user-gesture-required bo'lsa darhol true

  // 1) Register + poll status (bog'languncha 5s, keyin heartbeat 30s).
  const paired = pairing?.paired ?? false;
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const r = paired ? await api.cast.status(deviceId) : await api.cast.register(deviceId);
        if (active) setPairing({ paired: r.paired, clinicId: r.clinic_id, code: r.pairing_code });
      } catch {
        /* tarmoq xatosi — keyingi tick */
      }
    };
    void tick();
    const i = setInterval(tick, paired ? 30_000 : 5_000);
    return () => {
      active = false;
      clearInterval(i);
    };
  }, [deviceId, paired]);

  // 2) Soat.
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  // 3) Navbat taxtasi — login'siz TV uchun ochiq endpoint (bog'langan qurilma).
  const { data: board, refetch: refetchBoard } = useQuery({
    queryKey: ['kiosk-board', deviceId],
    queryFn: () => api.cast.board(deviceId),
    refetchInterval: 5_000,
    retry: false,
    enabled: paired,
  });
  const called = useMemo(() => (board?.called ?? []).slice(0, 6), [board]);
  const waiting = useMemo(() => (board?.waiting ?? []).slice(0, 12), [board]);

  // 4) Yozib olingan ovoz (platforma standarti + klinikaniki).
  const { data: voiceData } = useQuery({
    queryKey: ['kiosk-voice', deviceId],
    queryFn: () => api.cast.publicVoice(deviceId),
    refetchInterval: 10 * 60_000,
    retry: false,
    enabled: paired,
  });
  useEffect(() => {
    if (voiceData) voice.setPack(voiceData.clips);
  }, [voice, voiceData]);

  // 5) Chaqiruvlar (Supabase Realtime Broadcast).
  const clinicId = pairing?.clinicId ?? null;
  useEffect(() => {
    if (!paired || !clinicId) return;
    const ch = supabase
      .channel(`clinic-${clinicId}-cast`)
      .on('broadcast', { event: 'call' }, ({ payload }) => {
        const p = (payload ?? {}) as CallPayload;
        // device_id berilgan bo'lsa faqat shu TV (yo'q = barcha TV).
        if (p.device_id && p.device_id !== deviceId) return;
        const room = (p.room ?? '').trim();
        setCall({
          ticket: p.ticket_code ?? null,
          room,
          patient: p.patient_name ?? '',
          doctor: p.doctor_name ?? '',
        });
        void voice.announce({ seq: castSeq(p.ticket_code, p.seq), room });
        void refetchBoard();
        if (callTimer.current) clearTimeout(callTimer.current);
        callTimer.current = setTimeout(() => setCall(null), 12_000);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [paired, clinicId, deviceId, refetchBoard, voice]);

  // ─── Pairing ekrani ───────────────────────────────────────────────────────
  if (pairing && !pairing.paired) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white">
        <div className="text-sm uppercase tracking-[0.3em] text-white/50">Clary Cast — TV</div>
        <div className="mt-6 text-2xl text-white/70">Ushbu ekranni bog'lash uchun kod:</div>
        <div className="my-8 rounded-3xl border border-white/15 bg-white/5 px-16 py-10 font-mono text-8xl font-black tracking-[0.2em] shadow-2xl">
          {pairing.code ?? '······'}
        </div>
        <div className="flex items-center gap-2 text-white/50">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400" />
          Bog'lanishni kutmoqda…
        </div>
        <div className="mt-10 text-center text-sm text-white/40">
          Qabulxona kompyuterida: <b className="text-white/70">Navbat</b> →{' '}
          <b className="text-white/70">📺 TV</b> → kodni kiriting →{' '}
          <b className="text-white/70">Bog'lash</b>
        </div>
      </div>
    );
  }

  const mode = voice.mode();
  const modeLabel =
    mode === 'pack'
      ? 'Ovoz: yozib olingan'
      : mode === 'device'
        ? `Ovoz: ${voice.deviceVoiceName ?? 'qurilma'}`
        : 'Ovoz yozilmagan — faqat qo‘ng‘iroq';

  // ─── TV ekrani (bog'langan) ───────────────────────────────────────────────
  return (
    <div className="fixed inset-0 flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white">
      {/* Chaqiruv — butun ekran */}
      {call && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm">
          <div className="animate-pulse text-3xl uppercase tracking-[0.3em] text-emerald-300">
            🔔 Chaqiruv
          </div>
          {call.ticket && (
            <div className="mt-6 font-mono text-[9rem] font-black leading-none tracking-wider">
              {call.ticket}
            </div>
          )}
          {call.room ? (
            <div className="mt-8 rounded-3xl bg-emerald-500/20 px-14 py-6 text-8xl font-black text-emerald-300">
              → {castRoomDisplay(call.room)}
            </div>
          ) : (
            <div className="mt-8 text-5xl font-bold text-emerald-300">Qabulga marhamat</div>
          )}
          <div className="mt-8 text-3xl text-white/70">
            {[call.patient, call.doctor].filter(Boolean).join(' · ')}
          </div>
        </div>
      )}

      {!soundOn && (
        <button
          type="button"
          onClick={() => {
            void voice.unlock();
            void document.documentElement.requestFullscreen?.().catch(() => undefined);
          }}
          className="absolute bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-amber-400 px-6 py-3 text-lg font-semibold text-black shadow-2xl"
        >
          🔊 Ovozli chaqiruvni yoqish uchun bosing
        </button>
      )}

      <header className="flex items-center justify-between px-8 py-5">
        <div>
          <div className="text-3xl font-semibold">{board?.clinic_name ?? 'Navbat'}</div>
          <div className="text-sm uppercase tracking-[0.25em] text-white/50">Navbat</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-4xl font-bold tabular-nums">
            {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
          </div>
          {/* Brauzerlarda "uz" lokali ko'pincha yo'q ("M10 18, Sun") — qo'lda */}
          <div className="text-sm capitalize text-white/60">
            {UZ_WEEKDAYS[now.getDay()]}, {now.getDate()}-{UZ_MONTHS[now.getMonth()]}
          </div>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-12 gap-6 px-8 pb-4">
        <section className="col-span-8 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Qabulga chaqirildi</h2>
            <div className="text-white/60">Iltimos, ko‘rsatilgan xonaga o‘ting</div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {called.length === 0 && (
              <div className="col-span-2 py-16 text-center text-white/40">—</div>
            )}
            {called.map((q) => (
              <div
                key={q.id}
                className="flex items-center gap-4 rounded-xl border border-white/15 bg-white/10 p-5 shadow-xl"
                style={{ borderLeft: `6px solid ${q.ticket_color ?? '#60a5fa'}` }}
              >
                <div className="min-w-0 flex-1">
                  <div
                    className="font-mono text-5xl font-black tracking-wider"
                    style={{ color: q.ticket_color ?? '#60a5fa' }}
                  >
                    {q.ticket_code ?? '—'}
                  </div>
                  <div className="mt-2 truncate text-xl font-semibold">{q.patient}</div>
                  <div className="truncate text-sm text-white/60">{q.doctor ?? ''}</div>
                </div>
                {q.room && (
                  <div className="shrink-0 rounded-xl bg-emerald-500/20 px-4 py-3 text-center text-4xl font-black text-emerald-300">
                    {castRoomDisplay(q.room)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="col-span-4 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <h2 className="mb-4 text-2xl font-semibold">Navbatda</h2>
          <ol className="space-y-2">
            {waiting.length === 0 && <li className="text-white/40">—</li>}
            {waiting.map((q) => (
              <li
                key={q.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2"
              >
                <span
                  className="font-mono text-xl font-bold"
                  style={{ color: q.ticket_color ?? '#93c5fd' }}
                >
                  {q.ticket_code ?? '—'}
                </span>
                <span className="truncate text-sm text-white/70">
                  {q.room ? castRoomDisplay(q.room) : (q.doctor ?? '—')}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="px-8 pb-3 text-right text-xs text-white/30">{modeLabel}</footer>
    </div>
  );
}
