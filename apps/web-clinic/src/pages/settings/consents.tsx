import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input, PageHeader } from '@clary/ui-web';
import { FileSignature, Loader2, RotateCcw, Save, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

import type { ConsentCode, ConsentTemplate } from '@clary/api-client';
import { api } from '@/lib/api';

// =============================================================================
// SOZLAMALAR > ROZILIK SHABLONLARI
// =============================================================================
// Klinika o'z matnini yozadi. Matn o'zgartirilsa API yangi VERSIYA yaratadi —
// avval chop etilgan roziliklar tegilmaydi (ular matn nusxasini saqlab qolgan).
// =============================================================================

const CODE_LABEL: Record<ConsentCode, string> = {
  general: 'Umumiy tibbiy aralashuv',
  inpatient: 'Statsionar davolanish',
  dental: 'Stomatologik davolash',
  personal_data: "Shaxsiy ma'lumotlar",
};

const LANG_LABEL: Record<string, string> = { uz: "O'zbekcha", ru: 'Ruscha' };

export function SettingsConsentsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['consent-templates'],
    queryFn: () => api.consents.templates(),
  });

  const templates = useMemo(() => data?.templates ?? [], [data]);
  const placeholders = data?.placeholders ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = templates.find((t) => t.id === selectedId) ?? templates[0] ?? null;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  // Tanlangan shablon almashganda tahrir maydonlarini sinxronlash.
  useEffect(() => {
    setTitle(selected?.title ?? '');
    setBody(selected?.body ?? '');
  }, [selected?.id, selected?.title, selected?.body]);

  const saveMut = useMutation({
    mutationFn: (t: ConsentTemplate) =>
      api.consents.updateTemplate(t.id, { title: title.trim(), body: body.trim() }),
    onSuccess: (updated) => {
      toast.success(`Saqlandi — versiya ${updated.version}`);
      setSelectedId(updated.id);
      void qc.invalidateQueries({ queryKey: ['consent-templates'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dirty = !!selected && (title !== selected.title || body !== selected.body);

  const insertPlaceholder = (key: string) => {
    setBody((b) => `${b}{{${key}}}`);
  };

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rozilik shablonlari"
        description="Bemor imzolaydigan hujjat matnlari — klinika o'zi tahrirlaydi"
      />

      <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
        <CardContent className="flex gap-3 p-3 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <div className="font-semibold">Huquqiy ogohlantirish</div>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Boshlang'ich matnlar <b>loyiha (draft)</b> sifatida beriladi. Ulardan foydalanishdan
              oldin klinika yuristi ko'rib chiqishi va tasdiqlashi shart. Asos: "Fuqarolar
              sog'lig'ini saqlash to'g'risida"gi qonun (265-I, 29.08.1996).
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Shablonlar ro'yxati */}
        <Card className="h-fit">
          <CardContent className="space-y-1 p-2">
            {templates.length === 0 && (
              <div className="text-muted-foreground p-3 text-xs">Shablon topilmadi</div>
            )}
            {templates.map((t) => {
              const active = selected?.id === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
                    active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                  }`}
                >
                  <div className="font-semibold">{CODE_LABEL[t.code] ?? t.code}</div>
                  <div className={`mt-0.5 ${active ? 'opacity-80' : 'text-muted-foreground'}`}>
                    {LANG_LABEL[t.lang] ?? t.lang} · v{t.version}
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Tahrirlash */}
        {selected && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileSignature className="h-4 w-4" />
                  <span className="text-sm font-semibold">
                    {CODE_LABEL[selected.code] ?? selected.code}
                  </span>
                  <Badge variant="outline">{LANG_LABEL[selected.lang] ?? selected.lang}</Badge>
                  <Badge variant="secondary">versiya {selected.version}</Badge>
                </div>
                <div className="flex gap-2">
                  {dirty && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setTitle(selected.title);
                        setBody(selected.body);
                      }}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> Bekor qilish
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={!dirty || saveMut.isPending || !title.trim() || !body.trim()}
                    onClick={() => saveMut.mutate(selected)}
                  >
                    {saveMut.isPending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="mr-1 h-3.5 w-3.5" />
                    )}
                    Saqlash
                  </Button>
                </div>
              </div>

              <div>
                <label className="text-muted-foreground mb-1 block text-xs">Sarlavha</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>

              <div>
                <label className="text-muted-foreground mb-1 block text-xs">Matn</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={22}
                  className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1"
                />
              </div>

              <div>
                <div className="text-muted-foreground mb-1.5 text-xs">
                  O'rin egallovchilar — chop etishda haqiqiy qiymatga almashadi (bosing → matn
                  oxiriga qo'shiladi):
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {placeholders.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      title={p.desc}
                      onClick={() => insertPlaceholder(p.key)}
                      className="bg-muted hover:bg-accent rounded px-2 py-0.5 font-mono text-[11px]"
                    >
                      {`{{${p.key}}}`}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-muted-foreground border-t pt-2 text-[11px]">
                Matn saqlanganda yangi versiya yaratiladi. Avval chop etilgan roziliklar o'z matnini
                saqlab qoladi — ular hech qachon o'zgarmaydi.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
