import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Siren } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';

// WebAudio beep — no external asset required.
function playAlarm(volume = 0.2) {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.2);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.4);
    osc.stop(ctx.currentTime + 0.6);
    setTimeout(() => ctx.close(), 1000);
  } catch {
    // ignore audio errors (e.g. autoplay restrictions)
  }
}

export function EmergencyListener() {
  const { clinicId, session } = useAuth();
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!clinicId || !session) return;

    const channel = supabase
      .channel(`clinic-${clinicId}-emergency`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'emergency_calls',
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            message: string;
            severity: string;
            initiated_by: string;
          } | null;
          if (!row || seen.current.has(row.id)) return;
          seen.current.add(row.id);

          playAlarm(row.severity === 'critical' ? 0.35 : 0.2);

          toast.custom(
            (t) => (
              <div className="flex items-start gap-3 rounded-lg border border-destructive bg-background p-4 shadow-lg">
                <div className="rounded-full bg-destructive/15 p-2 text-destructive">
                  <Siren className="h-5 w-5 animate-pulse" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-destructive">Tezkor chaqiruv</div>
                  <div className="text-sm">{row.message}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Daraja: {row.severity}
                  </div>
                  <Link
                    to="/nurse"
                    onClick={() => toast.dismiss(t)}
                    className="mt-2 inline-block text-xs font-semibold text-primary underline"
                  >
                    Hamshira postiga o‘tish →
                  </Link>
                </div>
              </div>
            ),
            { duration: 15_000 },
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinicId, session]);

  return null;
}
