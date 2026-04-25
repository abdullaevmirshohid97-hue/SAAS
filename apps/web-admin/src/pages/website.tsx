import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Archive,
  Eye,
  EyeOff,
  FileText,
  Globe,
  Image as ImageIcon,
  Link as LinkIcon,
  Plus,
  Save,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { landingUrl, landingPreviewUrl } from '@/lib/landing-url';

const LOCALES: Array<{ code: string; label: string; flag: string }> = [
  { code: 'uz-Latn', label: "O'zbek (Lotin)", flag: '🇺🇿' },
  { code: 'uz-Cyrl', label: 'Ўзбек (Кирилл)', flag: '🇺🇿' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'kk', label: 'Қазақша', flag: '🇰🇿' },
  { code: 'ky', label: 'Кыргызча', flag: '🇰🇬' },
  { code: 'tg', label: 'Тоҷикӣ', flag: '🇹🇯' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
];

const KINDS: Array<{ value: string; label: string }> = [
  { value: 'hero', label: 'Hero (bosh ekran)' },
  { value: 'section', label: 'Section' },
  { value: 'feature', label: 'Feature' },
  { value: 'plan', label: 'Plan (tarif)' },
  { value: 'testimonial', label: 'Testimonial' },
  { value: 'faq', label: 'FAQ' },
  { value: 'block', label: 'Blok' },
  { value: 'media', label: 'Media' },
  { value: 'seo', label: 'SEO meta' },
  { value: 'config', label: 'Config' },
];

type Entry = Awaited<ReturnType<typeof api.site.adminListEntries>>[number];

type TabId = 'content' | 'media' | 'revisions';

export function WebsitePage() {
  const [tab, setTab] = useState<TabId>('content');
  const [kindFilter, setKindFilter] = useState<string>('__all__');
  const [selected, setSelected] = useState<Entry | null>(null);
  const [openNew, setOpenNew] = useState(false);

  const entries = useQuery({
    queryKey: ['site', 'entries'],
    queryFn: () => api.site.adminListEntries(),
  });

  const visible = useMemo(() => {
    const rows = entries.data ?? [];
    return kindFilter === '__all__' ? rows : rows.filter((r) => r.kind === kindFilter);
  }, [entries.data, kindFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Websayt boshqaruvi</h1>
          <p className="text-sm text-muted-foreground">
            www.clary.uz landing sahifasi kontentini tahrirlash va nashr etish
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
            {([
              { id: 'content', label: 'Kontent', icon: FileText },
              { id: 'media', label: 'Media', icon: ImageIcon },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id as TabId)}
                className={
                  'flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm transition-colors ' +
                  (tab === id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground')
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'content' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Barchasi</SelectItem>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => setOpenNew(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Yangi blok
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={landingUrl('/')} target="_blank" rel="noreferrer" title={landingUrl('/')}>
                <Globe className="mr-1.5 h-4 w-4" /> Saytga o'tish
              </a>
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {visible.length === 0 ? (
                <EmptyState
                  icon={<FileText className="h-8 w-8" />}
                  title="Bloklar yo‘q"
                  description="Birinchi blokni qo‘shing"
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5">Key</th>
                        <th className="px-4 py-2.5">Tur</th>
                        <th className="px-4 py-2.5">Sarlavha</th>
                        <th className="px-4 py-2.5 text-right">Sort</th>
                        <th className="px-4 py-2.5">Holat</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((e) => {
                        const primary =
                          (e.content_i18n['uz-Latn'] as Record<string, unknown> | undefined) ??
                          (Object.values(e.content_i18n)[0] as Record<string, unknown> | undefined);
                        const title = (primary?.title as string) ?? (primary?.name as string) ?? '-';
                        return (
                          <tr
                            key={e.id}
                            className="border-b last:border-b-0 hover:bg-muted/20 cursor-pointer"
                            onClick={() => setSelected(e)}
                          >
                            <td className="px-4 py-2.5 font-mono text-xs">{e.key}</td>
                            <td className="px-4 py-2.5">
                              <Badge variant="outline">{e.kind}</Badge>
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">{title}</td>
                            <td className="px-4 py-2.5 text-right">{e.sort_order}</td>
                            <td className="px-4 py-2.5">
                              {e.status === 'published' && <Badge variant="success">Nashr qilingan</Badge>}
                              {e.status === 'draft' && <Badge variant="warning">Qoralama</Badge>}
                              {e.status === 'archived' && <Badge variant="secondary">Arxiv</Badge>}
                              {!e.is_visible && <Badge variant="destructive" className="ml-1">Yashirin</Badge>}
                            </td>
                            <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                              <div className="flex items-center justify-end gap-2">
                                <a
                                  href={landingPreviewUrl(e.key)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                                  onClick={(ev) => ev.stopPropagation()}
                                  title="Saytda ko'rish"
                                >
                                  <Eye className="h-3 w-3" /> Preview
                                </a>
                                <span>v{e.version}</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {tab === 'media' && <MediaLibrary />}

      {selected && (
        <EntryEditor
          entry={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            entries.refetch();
          }}
        />
      )}

      {openNew && (
        <NewEntryDialog
          onClose={() => setOpenNew(false)}
          onCreated={() => {
            setOpenNew(false);
            entries.refetch();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry editor
// ---------------------------------------------------------------------------
function EntryEditor({
  entry,
  onClose,
  onSaved,
}: {
  entry: Entry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [locale, setLocale] = useState<string>('uz-Latn');
  const [content, setContent] = useState<Record<string, Record<string, unknown>>>(
    entry.draft_content_i18n ?? entry.content_i18n,
  );
  const [data, setData] = useState<Record<string, unknown>>(entry.draft_data ?? entry.data);
  const [sortOrder, setSortOrder] = useState(String(entry.sort_order));
  const [isVisible, setIsVisible] = useState(entry.is_visible);

  const save = useMutation({
    mutationFn: () =>
      api.site.adminUpdate(entry.id, {
        content_i18n: content,
        data,
        sort_order: Number(sortOrder) || 0,
        is_visible: isVisible,
      }),
    onSuccess: () => {
      toast.success('Qoralama saqlandi');
      qc.invalidateQueries({ queryKey: ['site', 'entries'] });
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: () => api.site.adminPublish(entry.id),
    onSuccess: () => {
      toast.success('Nashr qilindi');
      qc.invalidateQueries({ queryKey: ['site', 'entries'] });
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archive = useMutation({
    mutationFn: () => api.site.adminArchive(entry.id),
    onSuccess: () => {
      toast.success('Arxivlandi');
      qc.invalidateQueries({ queryKey: ['site', 'entries'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const localeContent = (content[locale] ?? {}) as Record<string, string>;
  const fields = useMemo(() => {
    const set = new Set<string>();
    for (const l of Object.values(content)) {
      for (const k of Object.keys(l)) set.add(k);
    }
    if (set.size === 0) ['title', 'body'].forEach((k) => set.add(k));
    return Array.from(set);
  }, [content]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Badge variant="outline">{entry.kind}</Badge>
            <span className="font-mono text-sm">{entry.key}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-1">
            {LOCALES.map((l) => (
              <button
                key={l.code}
                onClick={() => setLocale(l.code)}
                className={
                  'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition ' +
                  (locale === l.code
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground')
                }
              >
                <span>{l.flag}</span>
                {l.code}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {fields.map((f) => (
              <div key={f}>
                <Label className="flex items-center justify-between">
                  <span>{f}</span>
                  {f === 'body' || f === 'desc' ? null : (
                    <button
                      className="text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        const next = { ...content };
                        for (const k of Object.keys(next)) {
                          const copy = { ...next[k]! };
                          delete copy[f];
                          next[k] = copy;
                        }
                        setContent(next);
                      }}
                    >
                      o‘chirish
                    </button>
                  )}
                </Label>
                {f === 'body' || f === 'desc' || f === 'subtitle' ? (
                  <Textarea
                    rows={3}
                    value={String(localeContent[f] ?? '')}
                    onChange={(e) =>
                      setContent((prev) => ({
                        ...prev,
                        [locale]: { ...(prev[locale] ?? {}), [f]: e.target.value },
                      }))
                    }
                  />
                ) : (
                  <Input
                    value={String(localeContent[f] ?? '')}
                    onChange={(e) =>
                      setContent((prev) => ({
                        ...prev,
                        [locale]: { ...(prev[locale] ?? {}), [f]: e.target.value },
                      }))
                    }
                  />
                )}
              </div>
            ))}
            <AddField
              onAdd={(name) =>
                setContent((prev) => ({
                  ...prev,
                  [locale]: { ...(prev[locale] ?? {}), [name]: '' },
                }))
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3 border-t pt-3">
            <div>
              <Label>Sort order</Label>
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={(e) => setIsVisible(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm">{isVisible ? <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> Ko‘rinadi</span> : <span className="flex items-center gap-1"><EyeOff className="h-3.5 w-3.5" /> Yashirin</span>}</span>
              </label>
            </div>
          </div>

          <div>
            <Label>Qo‘shimcha data (JSON)</Label>
            <Textarea
              rows={4}
              className="font-mono text-xs"
              value={JSON.stringify(data, null, 2)}
              onChange={(e) => {
                try {
                  setData(JSON.parse(e.target.value));
                } catch {
                  // keep invalid JSON in the input until parseable
                }
              }}
            />
          </div>
        </div>

        <DialogFooter className="flex justify-between gap-2 sm:justify-between">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => archive.mutate()}
            disabled={archive.isPending}
          >
            <Archive className="mr-1.5 h-4 w-4" /> Arxivlash
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Yopish
            </Button>
            <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
              <Save className="mr-1.5 h-4 w-4" /> Qoralama saqlash
            </Button>
            <Button onClick={() => publish.mutate()} disabled={publish.isPending}>
              <Globe className="mr-1.5 h-4 w-4" /> Nashr qilish
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddField({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="flex gap-2">
      <Input
        placeholder="Yangi maydon kaliti"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!name.trim()}
        onClick={() => {
          onAdd(name.trim());
          setName('');
        }}
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> Maydon qo‘shish
      </Button>
    </div>
  );
}

function NewEntryDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [key, setKey] = useState('');
  const [kind, setKind] = useState<string>('block');
  const [sortOrder, setSortOrder] = useState('10');

  const create = useMutation({
    mutationFn: () =>
      api.site.adminCreate({
        key: key.trim(),
        kind,
        sort_order: Number(sortOrder) || 0,
        content_i18n: { 'uz-Latn': { title: '' } },
        data: {},
      }),
    onSuccess: () => {
      toast.success('Blok yaratildi');
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Yangi blok</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Key (unikal)</Label>
            <Input placeholder="hero.home" value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <div>
            <Label>Tur</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Sort order</Label>
            <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => create.mutate()} disabled={!key.trim() || create.isPending}>
            Yaratish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------
function MediaLibrary() {
  const qc = useQueryClient();
  const media = useQuery({ queryKey: ['site', 'media'], queryFn: () => api.site.adminMedia() });
  const [open, setOpen] = useState(false);

  const del = useMutation({
    mutationFn: (id: string) => api.site.adminDeleteMedia(id),
    onSuccess: () => {
      toast.success('O‘chirildi');
      qc.invalidateQueries({ queryKey: ['site', 'media'] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Upload className="mr-1.5 h-4 w-4" /> Media qo‘shish
        </Button>
      </div>

      {(media.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-10">
            <EmptyState
              icon={<ImageIcon className="h-8 w-8" />}
              title="Media yo‘q"
              description="Supabase Storage yoki tashqi CDN URL'ini qo‘shing"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {(media.data ?? []).map((m) => (
            <Card key={m.id} className="overflow-hidden">
              <div className="aspect-video bg-muted">
                {m.kind === 'video' ? (
                  <div className="flex h-full items-center justify-center bg-black/80 text-white">
                    <Video className="h-10 w-10 opacity-70" />
                  </div>
                ) : (
                  <img src={m.url} alt={m.alt_i18n?.['uz-Latn'] ?? ''} className="h-full w-full object-cover" />
                )}
              </div>
              <CardContent className="space-y-1 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline">{m.kind}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => del.mutate(m.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <a
                  href={m.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
                >
                  <LinkIcon className="h-3 w-3 shrink-0" /> {m.url}
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {open && (
        <AddMediaDialog
          onClose={() => setOpen(false)}
          onAdded={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: ['site', 'media'] });
          }}
        />
      )}
    </div>
  );
}

function AddMediaDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [kind, setKind] = useState<'image' | 'video' | 'document'>('image');
  const [url, setUrl] = useState('');
  const [poster, setPoster] = useState('');
  const [alt, setAlt] = useState('');
  const [tags, setTags] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const onFileSelected = async (file: File) => {
    try {
      const { supabase } = await import('@/main');
      setUploading(true);
      setUploadProgress(0);
      const ext = file.name.split('.').pop() ?? 'bin';
      const path = `landing/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from('site-media')
        .upload(path, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        });
      if (error) throw error;
      const { data } = supabase.storage.from('site-media').getPublicUrl(path);
      setUrl(data.publicUrl);
      setUploadProgress(100);
      if (file.type.startsWith('video/')) setKind('video');
      else if (file.type.startsWith('image/')) setKind('image');
      else setKind('document');
      toast.success("Fayl yuklandi. 'Qo'shish'ni bosing.");
    } catch (e) {
      toast.error(`Yuklashda xatolik: ${(e as Error).message ?? ''}. Bucket 'site-media' mavjudligini tekshiring.`);
    } finally {
      setUploading(false);
    }
  };

  const add = useMutation({
    mutationFn: () =>
      api.site.adminAddMedia({
        kind,
        url,
        poster_url: poster || null,
        alt_i18n: alt ? { 'uz-Latn': alt } : {},
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      toast.success('Qo‘shildi');
      onAdded();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Media qo‘shish</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Tur</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="image">Rasm</SelectItem>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="document">Hujjat</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Fayl yuklash (Supabase Storage)</Label>
            <input
              type="file"
              accept={kind === 'video' ? 'video/*' : kind === 'document' ? '.pdf,.doc,.docx' : 'image/*'}
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFileSelected(f);
              }}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent"
            />
            {uploading && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-muted">
                <div className="h-full bg-[#2563EB] transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            )}
          </div>
          <div className="relative flex items-center">
            <div className="flex-1 border-t" />
            <span className="px-2 text-xs text-muted-foreground">yoki URL kiriting</span>
            <div className="flex-1 border-t" />
          </div>
          <div>
            <Label>URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          </div>
          {kind === 'video' && (
            <div>
              <Label>Poster URL (ixtiyoriy)</Label>
              <Input value={poster} onChange={(e) => setPoster(e.target.value)} />
            </div>
          )}
          <div>
            <Label>Alt (uz-Latn)</Label>
            <Input value={alt} onChange={(e) => setAlt(e.target.value)} />
          </div>
          <div>
            <Label>Tags (vergul bilan)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="hero,gallery,product,clinic,team" />
            <p className="mt-1 text-xs text-muted-foreground">
              Hero galeriya uchun: <code>hero</code>, <code>gallery</code> yoki <code>product</code>. Bemor app ekranlari uchun: <code>patient-app</code>.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button disabled={!url.trim() || add.isPending} onClick={() => add.mutate()}>
            Qo‘shish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
