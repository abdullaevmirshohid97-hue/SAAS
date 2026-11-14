import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge, Button, Card, CardContent, ConfirmDialog, Input, cn } from '@clary/ui-web';
import type { CastAdVideo, CastAdsState } from '@clary/api-client';
import { ArrowDown, ArrowUp, Eye, EyeOff, Film, Loader2, Trash2, Upload } from 'lucide-react';

import { api } from '@/lib/api';
import { fmtBytes, fmtMb, uploadAdVideo } from '@/lib/cast-ads-upload';

// =============================================================================
// TV reklama videolari: navbat TV'sida chaqiruvdan 15 soniya o'tgach, "faqat
// reklama" TV'da doim aylanadi. Limit (soni + jami hajm) tarifdan.
// =============================================================================

const KEY = ['cast-ads'] as const;

export function AdsManagerCard() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ name: string; pct: number } | null>(null);
  const [toDelete, setToDelete] = useState<CastAdVideo | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: KEY,
    queryFn: () => api.cast.ads(),
    retry: false,
  });
  const setState = (s: CastAdsState) => qc.setQueryData(KEY, s);

  const patchMut = useMutation({
    mutationFn: (v: { id: string; title?: string | null; is_active?: boolean }) =>
      api.cast.adsPatch(v.id, { title: v.title, is_active: v.is_active }),
    onSuccess: setState,
    onError: (e: Error) => toast.error(e.message),
  });
  const orderMut = useMutation({
    mutationFn: (ids: string[]) => api.cast.adsOrder(ids),
    onSuccess: setState,
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.cast.adsDelete(id),
    onSuccess: (s) => {
      setState(s);
      toast.success('Video o‘chirildi');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setUpload({ name: file.name, pct: 0 });
      try {
        const s = await uploadAdVideo(file, (pct) => setUpload({ name: file.name, pct }));
        setState(s);
        toast.success(`"${file.name}" yuklandi — TV’da ijro etiladi`);
      } catch (e) {
        toast.error(`"${file.name}": ${(e as Error).message}`);
        void qc.invalidateQueries({ queryKey: KEY });
        break;
      } finally {
        setUpload(null);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  const videos = data?.videos ?? [];
  const limits = data?.limits;
  const usage = data?.usage;
  const full =
    !!limits &&
    !!usage &&
    (usage.count >= limits.max_videos || usage.bytes >= limits.max_storage_mb * 1024 * 1024);
  const pctBytes =
    limits && usage
      ? Math.min(100, (usage.bytes / (limits.max_storage_mb * 1024 * 1024)) * 100)
      : 0;

  const move = (i: number, dir: -1 | 1) => {
    const ids = videos.map((v) => v.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    orderMut.mutate(ids);
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold">
            <Film className="h-4 w-4" /> Reklama videolari (TV)
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
              multiple
              className="hidden"
              onChange={(e) => void onFiles(e.target.files)}
            />
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!!upload || full || !!error}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-4 w-4" /> Video yuklash
            </Button>
          </div>
        </div>

        <p className="text-muted-foreground text-sm">
          Navbat TV’sida bemor chaqirilgandan <b>15 soniya</b> o‘tgach reklama ketadi, yangi
          chaqiruvda to‘xtab navbat ko‘rsatiladi. “Faqat reklama” rejimidagi TV doim reklama
          ko‘rsatadi (Navbat → 📺 TV). MP4 (H.264) tavsiya etiladi.
        </p>

        {limits && usage && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap justify-between gap-2 text-xs">
              <span>
                Videolar: <b>{usage.count}</b> / {limits.max_videos} ta
              </span>
              <span>
                Hajm: <b>{fmtBytes(usage.bytes)}</b> / {fmtMb(limits.max_storage_mb)} · bitta video
                ≤ {fmtMb(limits.max_file_mb)}
              </span>
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div
                className={cn('h-full rounded-full', pctBytes > 90 ? 'bg-amber-500' : 'bg-primary')}
                style={{ width: `${pctBytes}%` }}
              />
            </div>
            {full && (
              <div className="text-xs text-amber-600">
                Tarif limiti to‘ldi — yangi video uchun keraksizini o‘chiring yoki tarifni
                kengaytiring.
              </div>
            )}
          </div>
        )}

        {upload && (
          <div className="space-y-1 rounded-lg border p-3">
            <div className="flex justify-between gap-2 text-sm">
              <span className="truncate">{upload.name}</span>
              <span className="tabular-nums">{upload.pct}%</span>
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-all"
                style={{ width: `${upload.pct}%` }}
              />
            </div>
            <div className="text-muted-foreground text-xs">
              Sahifani yopmang — video yuklanmoqda…
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
          </div>
        ) : error ? (
          <div className="text-sm text-amber-600">{(error as Error).message}</div>
        ) : videos.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            Hali reklama videosi yo‘q
          </div>
        ) : (
          <div className="divide-y rounded-lg border">
            {videos.map((v, i) => (
              <AdRow
                key={v.id}
                video={v}
                first={i === 0}
                last={i === videos.length - 1}
                busy={patchMut.isPending || orderMut.isPending}
                onUp={() => move(i, -1)}
                onDown={() => move(i, 1)}
                onToggle={() => patchMut.mutate({ id: v.id, is_active: !v.is_active })}
                onRename={(title) => patchMut.mutate({ id: v.id, title })}
                onDelete={() => setToDelete(v)}
              />
            ))}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Videoni o‘chirish"
        description={`"${toDelete?.title ?? 'Video'}" butunlay o‘chiriladi va TV’larda ko‘rsatilmaydi.`}
        confirmLabel="O‘chirish"
        destructive
        onConfirm={() => {
          if (toDelete) deleteMut.mutate(toDelete.id);
          setToDelete(null);
        }}
      />
    </Card>
  );
}

function AdRow({
  video,
  first,
  last,
  busy,
  onUp,
  onDown,
  onToggle,
  onRename,
  onDelete,
}: {
  video: CastAdVideo;
  first: boolean;
  last: boolean;
  busy: boolean;
  onUp: () => void;
  onDown: () => void;
  onToggle: () => void;
  onRename: (title: string | null) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(video.title ?? '');
  const dirty = title.trim() !== (video.title ?? '');
  return (
    <div className={cn('flex items-center gap-3 px-3 py-2', !video.is_active && 'opacity-60')}>
      <video
        src={`${video.url}#t=0.5`}
        muted
        preload="metadata"
        playsInline
        className="h-14 w-24 shrink-0 rounded bg-black object-cover"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 120))}
          onBlur={() => dirty && onRename(title.trim() || null)}
          placeholder="Nomi"
          className="h-8"
        />
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          {fmtBytes(video.size_bytes)}
          {video.is_active ? (
            <Badge variant="success">TV’da</Badge>
          ) : (
            <Badge variant="secondary">O‘chiq</Badge>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          disabled={first || busy}
          onClick={onUp}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          disabled={last || busy}
          onClick={onDown}
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          title={video.is_active ? 'TV’da ko‘rsatmaslik' : 'TV’da ko‘rsatish'}
          disabled={busy}
          onClick={onToggle}
        >
          {video.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="text-destructive h-8 w-8"
          title="O‘chirish"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
