import { useEffect, useMemo, useRef, useState } from 'react';
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

type Pairing = { paired: boolean; clinicId: string | null; name: string | null; code: string | null };
type CallPayload = {
  patient_name?: string;
  room?: string;
  doctor_name?: string;
  device_id?: string | null;
  lang?: string;
};

// Qurilma ID — localStorage'da saqlanadi (TV doimiy bog'lanib qoladi).
function getDeviceId(): string {
  const KEY = 'clary.cast.deviceId';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(KEY, id);
  }
  return id;
}

// Ding — WebAudio (tashqi fayl shart emas).
function playDing(volume = 0.25) {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.18);
    osc.stop(ctx.currentTime + 0.45);
    setTimeout(() => ctx.close(), 800);
  } catch { /* autoplay cheklovi — e'tiborsiz */ }
}

// Ovozli chaqirish — brauzer TTS (uz/ru/en).
function speak(name: string, room: string, lang = 'uz') {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    let text: string;
    let voiceLang: string;
    const hasRoom = !!room?.trim();
    if (lang === 'ru') { text = hasRoom ? `${name}. Пройдите в кабинет ${room}.` : `${name}. Пройдите, пожалуйста.`; voiceLang = 'ru-RU'; }
    else if (lang === 'en') { text = hasRoom ? `${name}. Please proceed to room ${room}.` : `${name}. Please proceed.`; voiceLang = 'en-US'; }
    else { text = hasRoom ? `${name}. ${room}-kabinetga marhamat.` : `${name}. Marhamat.`; voiceLang = 'ru-RU'; } // uz ovozi kam — ru fallback
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voiceLang;
    u.rate = 0.95;
    synth.cancel();
    setTimeout(() => synth.speak(u), 400); // ding'dan keyin
  } catch { /* e'tiborsiz */ }
}

/**
 * Kiosk / Clary Cast TV — full-screen navbat ekrani.
 * Bog'lanmagan bo'lsa pairing kodi; bog'langach cast broadcast'ni tinglaydi
 * (reception "TV ga chiqarish") → katta overlay + ovozli chaqirish.
 */
export function KioskPage() {
  const qc = useQueryClient();
  const [now, setNow] = useState(() => new Date());
  const deviceId = useMemo(() => getDeviceId(), []);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [call, setCall] = useState<{ patient: string; room: string; doctor: string } | null>(null);
  const callTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1) Register + poll status (bog'languncha 5s, keyin heartbeat 30s).
  const paired = pairing?.paired ?? false;
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const r = paired ? await api.cast.status(deviceId) : await api.cast.register(deviceId);
        if (active) setPairing({ paired: r.paired, clinicId: r.clinic_id, name: r.name, code: r.pairing_code });
      } catch { /* tarmoq xatosi — keyingi tick */ }
    };
    void tick();
    const i = setInterval(tick, paired ? 30_000 : 5_000);
    return () => { active = false; clearInterval(i); };
  }, [deviceId, paired]);

  // 2) Soat.
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  // 3) Cast broadcast listener (bog'langach).
  const clinicId = pairing?.clinicId ?? null;
  useEffect(() => {
    if (!paired || !clinicId) return;
    const ch = supabase
      .channel(`clinic-${clinicId}-cast`)
      .on('broadcast', { event: 'call' }, ({ payload }) => {
        const p = (payload ?? {}) as CallPayload;
        // Target filtri: device_id berilgan bo'lsa faqat shu TV (yo'q = barcha TV).
        if (p.device_id && p.device_id !== deviceId) return;
        setCall({ patient: p.patient_name ?? '', room: p.room ?? '', doctor: p.doctor_name ?? '' });
        playDing();
        speak(p.patient_name ?? '', p.room ?? '', p.lang ?? 'uz');
        if (callTimer.current) clearTimeout(callTimer.current);
        callTimer.current = setTimeout(() => setCall(null), 14_000);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [paired, clinicId, deviceId]);

  // 4) Kanban (sessiya bo'lsa) — anon TV'da bo'sh qoladi, cast overlay asosiy.
  const { data: kanban } = useQuery({
    queryKey: ['kiosk-kanban'],
    queryFn: () => api.queues.kanban(),
    refetchInterval: 10_000,
    retry: false,
    enabled: paired,
  });
  useEffect(() => {
    if (!paired) return;
    const ch = supabase
      .channel('kiosk-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queues' }, () =>
        qc.invalidateQueries({ queryKey: ['kiosk-kanban'] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, paired]);

  const called = useMemo(() => ((kanban?.by_status?.called ?? []) as QueueRow[]).slice(0, 6), [kanban]);
  const waiting = useMemo(() => ((kanban?.by_status?.waiting ?? []) as QueueRow[]).slice(0, 10), [kanban]);

  // ─── Pairing ekrani ───────────────────────────────────────────────────────
  if (pairing && !pairing.paired) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white">
        <div className="text-sm uppercase tracking-[0.3em] text-white/50">Clary Cast — TV</div>
        <div className="mt-6 text-2xl text-white/70">Ushbu ekranni bog'lash uchun reception'da kodni kiriting:</div>
        <div className="my-8 rounded-3xl border border-white/15 bg-white/5 px-16 py-10 font-mono text-8xl font-black tracking-[0.2em] shadow-2xl">
          {pairing.code ?? '······'}
        </div>
        <div className="flex items-center gap-2 text-white/50">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400" />
          Listening… (bog'lanishni kutmoqda)
        </div>
        <div className="mt-10 text-xs text-white/30">Reception → Navbat → "TV qo'shish"</div>
      </div>
    );
  }

  // ─── TV ekrani (bog'langan) ───────────────────────────────────────────────
  return (
    <div className="fixed inset-0 flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white">
      {/* Cast overlay — chaqirilganda */}
      {call && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="animate-pulse text-2xl uppercase tracking-[0.3em] text-emerald-300">🔔 Chaqirilmoqda</div>
          <div className="mt-6 text-center text-8xl font-black leading-tight">{call.patient}</div>
          {call.room && (
            <div className="mt-8 rounded-2xl bg-emerald-500/20 px-12 py-6 text-6xl font-bold text-emerald-300">
              {call.room}-kabinet
            </div>
          )}
          {call.doctor && <div className="mt-6 text-3xl text-white/70">{call.doctor}</div>}
        </div>
      )}

      <header className="flex items-center justify-between px-8 py-5">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-white/50">{pairing?.name ?? 'Clary Queue'}</div>
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
            {called.length === 0 && <div className="col-span-2 py-16 text-center text-white/40">—</div>}
            {called.map((q) => (
              <div
                key={q.id}
                className="rounded-xl border border-white/15 bg-white/10 p-5 shadow-xl"
                style={{ borderLeft: `6px solid ${q.ticket_color ?? '#60a5fa'}` }}
              >
                <div className="font-mono text-5xl font-black tracking-wider" style={{ color: q.ticket_color ?? '#60a5fa' }}>
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
                <span className="font-mono text-lg font-bold" style={{ color: q.ticket_color ?? '#93c5fd' }}>
                  {q.ticket_code ?? '—'}
                </span>
                <span className="truncate text-sm text-white/70">{q.doctor?.full_name ?? 'Biriktirilmagan'}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
