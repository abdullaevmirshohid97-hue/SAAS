import * as React from 'react';
import { CAST_VOICE_CLIPS, castAnnouncementPlan, type CastVoiceGroup } from '@clary/schemas';
import { Loader2, Mic, Play, Square, Trash2, Upload, Volume2 } from 'lucide-react';
import { toast } from 'sonner';

import { CastVoice } from '../cast-voice';
import { cn } from '../utils';
import { Badge } from './badge';
import { Button } from './button';
import { Input } from './input';

// =============================================================================
// Navbat ovozini yozib olish: har bir ibora bitta tugma bilan yoziladi va
// darhol saqlanadi. "Bo'sh joy" (Space) — yozishni boshlash/to'xtatish; saqlangach
// keyingi yozilmagan iboraga o'tadi. Tayyor studiya yozuvini fayl qilib ham
// yuklash mumkin (mp3/wav/webm).
// =============================================================================

export interface CastVoiceRecorderProps {
  /** Shu to'plamdagi yozuvlar: kalit → URL */
  clips: Record<string, string>;
  /** Meros ovoz (masalan, Clary standart) — yozilmagan iboralar shu bilan aytiladi */
  fallback?: Record<string, string>;
  fallbackLabel?: string;
  onSave: (key: string, blob: Blob) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
}

const GROUPS: Array<{ id: CastVoiceGroup; title: string; hint: string }> = [
  { id: 'phrase', title: 'Iboralar', hint: 'Chaqiruv shu iboralardan yig‘iladi' },
  {
    id: 'number',
    title: 'Navbat raqami uchun sonlar',
    hint: '“to‘rt raqamli bemor”, “yigirma besh raqamli bemor”',
  },
  {
    id: 'ordinal',
    title: 'Xona raqami uchun tartib sonlar',
    hint: '“sakkizinchi xonaga”, “yuz beshinchi xonaga”',
  },
];

const MAX_RECORD_MS = 6_000;
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

export function CastVoiceRecorder({
  clips,
  fallback = {},
  fallbackLabel = 'Standart',
  onSave,
  onDelete,
}: CastVoiceRecorderProps) {
  const voice = React.useMemo(() => new CastVoice(), []);
  const streamRef = React.useRef<MediaStream | null>(null);
  const recRef = React.useRef<MediaRecorder | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const fileKeyRef = React.useRef<string | null>(null);
  const [recKey, setRecKey] = React.useState<string | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [activeKey, setActiveKey] = React.useState<string>(
    () => CAST_VOICE_CLIPS.find((c) => !clips[c.key])?.key ?? CAST_VOICE_CLIPS[0]!.key,
  );
  const [testSeq, setTestSeq] = React.useState('4');
  const [testRoom, setTestRoom] = React.useState('8');

  React.useEffect(
    () => () => {
      recRef.current?.state === 'recording' && recRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const own = CAST_VOICE_CLIPS.filter((c) => !!clips[c.key]).length;
  const effective = CAST_VOICE_CLIPS.filter((c) => !!clips[c.key] || !!fallback[c.key]).length;
  const total = CAST_VOICE_CLIPS.length;

  const nextKey = (after: string) => {
    const i = CAST_VOICE_CLIPS.findIndex((c) => c.key === after);
    const rest = [...CAST_VOICE_CLIPS.slice(i + 1), ...CAST_VOICE_CLIPS.slice(0, i + 1)];
    return (rest.find((c) => c.key !== after && !clips[c.key]) ?? CAST_VOICE_CLIPS[i + 1])?.key;
  };

  async function save(key: string, blob: Blob, advance: boolean) {
    setBusyKey(key);
    try {
      await onSave(key, blob);
      void voice.preview(blob); // darhol eshitib ko'rsin
      if (advance) {
        const n = nextKey(key);
        if (n) setActiveKey(n);
      }
    } catch (e) {
      toast.error((e as Error).message || 'Saqlanmadi');
    } finally {
      setBusyKey(null);
    }
  }

  async function startRec(key: string) {
    if (recRef.current || busyKey) return;
    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      }
      const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
      const rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const timer = setTimeout(() => rec.state === 'recording' && rec.stop(), MAX_RECORD_MS);
      rec.onstop = () => {
        clearTimeout(timer);
        recRef.current = null;
        setRecKey(null);
        const type = (rec.mimeType || mime || 'audio/webm').split(';')[0]!;
        void save(key, new Blob(chunks, { type }), true);
      };
      rec.start();
      recRef.current = rec;
      setRecKey(key);
      setActiveKey(key);
    } catch {
      toast.error('Mikrofonga ruxsat berilmadi yoki mikrofon topilmadi');
    }
  }

  function stopRec() {
    if (recRef.current?.state === 'recording') recRef.current.stop();
  }

  // Space — faol iborani yozish / to'xtatish
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName)) return;
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (recRef.current) stopRec();
      else void startRec(activeKey);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function remove(key: string) {
    setBusyKey(key);
    try {
      await onDelete(key);
    } catch (e) {
      toast.error((e as Error).message || 'O‘chirilmadi');
    } finally {
      setBusyKey(null);
    }
  }

  const testPlan = castAnnouncementPlan({ seq: Number(testSeq) || null, room: testRoom });
  const merged = { ...fallback, ...clips };
  const missing = (testPlan.clips ?? []).filter((k) => !merged[k]);

  async function test() {
    voice.setPack(merged);
    await voice.unlock();
    if (missing.length || !testPlan.clips) {
      toast.message(
        voice.deviceVoiceName
          ? `Yozuv to‘liq emas — qurilma ovozi (${voice.deviceVoiceName}) bilan aytiladi`
          : 'Yozuv to‘liq emas — TV faqat qo‘ng‘iroq chaladi',
      );
    }
    await voice.announce({ seq: Number(testSeq) || null, room: testRoom }, { repeat: 1 });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            <b>{own}</b> / {total} ta ibora yozilgan
            {effective > own && (
              <span className="text-muted-foreground">
                {' '}
                · yana {effective - own} tasi “{fallbackLabel}” ovozidan
              </span>
            )}
          </span>
          {effective === total ? (
            <Badge variant="success">Chaqiruv to‘liq ovozli</Badge>
          ) : (
            <Badge variant="warning">{total - effective} ta ibora yetishmaydi</Badge>
          )}
        </div>
        <div className="bg-muted h-2 overflow-hidden rounded-full">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${(effective / total) * 100}%` }}
          />
        </div>
      </div>

      <div className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs leading-relaxed">
        Tinch xonada, mikrofonga 20–30 sm masofada, <b>bir xil ohangda</b> va aniq o‘qing. Tugmani
        bosing → so‘zni ayting → yana bosing (yoki <b>Bo‘sh joy</b> tugmasi). Boshidagi va oxiridagi
        jimlik avtomatik kesiladi, balandlik tenglashtiriladi. Tayyor studiya yozuvi bo‘lsa —{' '}
        <Upload className="inline h-3 w-3" /> orqali fayl yuklang.
      </div>

      {/* Sinov */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border p-3">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Navbat raqami</span>
          <Input
            className="w-24"
            inputMode="numeric"
            value={testSeq}
            onChange={(e) => setTestSeq(e.target.value.replace(/\D/g, '').slice(0, 3))}
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Xona</span>
          <Input
            className="w-24"
            value={testRoom}
            onChange={(e) => setTestRoom(e.target.value.slice(0, 16))}
          />
        </label>
        <Button onClick={() => void test()}>
          <Volume2 className="h-4 w-4" /> Sinab eshitish
        </Button>
        <div className="min-w-0 flex-1 text-sm">
          <div className="italic">“{testPlan.text}”</div>
          {missing.length > 0 && (
            <div className="text-xs text-amber-600">
              Yetishmaydi:{' '}
              {missing.map((k) => CAST_VOICE_CLIPS.find((c) => c.key === k)?.text ?? k).join(', ')}
            </div>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          const key = fileKeyRef.current;
          e.target.value = '';
          if (f && key) void save(key, withAudioType(f), false);
        }}
      />

      {GROUPS.map((g) => (
        <section key={g.id} className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold">{g.title}</h3>
            <p className="text-muted-foreground text-xs">{g.hint}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {CAST_VOICE_CLIPS.filter((c) => c.group === g.id).map((c) => {
              const mine = clips[c.key];
              const inherited = !mine ? fallback[c.key] : undefined;
              const recording = recKey === c.key;
              const busy = busyKey === c.key;
              return (
                <div
                  key={c.key}
                  onClick={() => setActiveKey(c.key)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 transition',
                    activeKey === c.key && 'border-primary ring-primary/30 ring-2',
                    recording && 'border-red-500 bg-red-50 dark:bg-red-500/10',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold">{c.text}</div>
                    <div className="text-xs">
                      {recording ? (
                        <span className="text-red-600">● Yozilmoqda… gapiring</span>
                      ) : mine ? (
                        <span className="text-emerald-600">Yozilgan</span>
                      ) : inherited ? (
                        <span className="text-sky-600">{fallbackLabel}</span>
                      ) : (
                        <span className="text-muted-foreground">Yozilmagan</span>
                      )}
                    </div>
                  </div>
                  {(mine || inherited) && !recording && (
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Eshitish"
                      onClick={(e) => {
                        e.stopPropagation();
                        void voice.preview((mine ?? inherited)!);
                      }}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant={recording ? 'destructive' : 'outline'}
                    title={recording ? 'To‘xtatish' : 'Yozish'}
                    disabled={busy || (!!recKey && !recording)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (recording) stopRec();
                      else void startRec(c.key);
                    }}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : recording ? (
                      <Square className="h-4 w-4" />
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Fayl yuklash"
                    disabled={busy || !!recKey}
                    onClick={(e) => {
                      e.stopPropagation();
                      fileKeyRef.current = c.key;
                      fileRef.current?.click();
                    }}
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                  {mine && (
                    <Button
                      size="icon"
                      variant="ghost"
                      title="O‘chirish"
                      disabled={busy || !!recKey}
                      onClick={(e) => {
                        e.stopPropagation();
                        void remove(c.key);
                      }}
                    >
                      <Trash2 className="text-destructive h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

const EXT_TYPE: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'audio/webm',
};

/** Ba'zi tizimlar faylga tur bermaydi — kengaytmadan aniqlanadi. */
function withAudioType(f: File): Blob {
  if (f.type.startsWith('audio/')) return f;
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  return new Blob([f], { type: EXT_TYPE[ext] ?? 'audio/mpeg' });
}

/** Blob → base64 (API'ga yuklash uchun). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
