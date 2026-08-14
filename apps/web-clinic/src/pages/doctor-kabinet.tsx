import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookText, Copy, Loader2, Pencil, Plus, Share2, Stethoscope, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageHeader,
  Textarea,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

// =============================================================================
// Shifokor kabineti — bemorsiz, tinch muhitda tashxis shablonlari bilan ishlash
// =============================================================================
// Nega kerak edi: shablonni faqat konsultatsiya ichidan ("Shablon sifatida
// saqlash") yaratish mumkin edi — ya'ni bemor oldida, shoshib turganda.
// Shu sabab prod'da 0 ta shablon bor edi. Bu sahifa shifokorga ertalab tinch
// o'tirib o'ziga 10 ta shablon tayyorlash imkonini beradi.
//
// Egalik: shablon standart holda SHAXSIY (visibility='private'). Xohlasa
// klinikaga ulashadi — boshqalar ko'radi va nusxa oladi, lekin tahrirlash
// va o'chirish faqat egasida qoladi (server ham shuni tekshiradi).

type Template = Awaited<ReturnType<typeof api.doctor.listTemplates>>[number];

type Draft = {
  name: string;
  diagnosis_code: string;
  diagnosis_text: string;
  soap_subjective: string;
  soap_objective: string;
  soap_assessment: string;
  soap_plan: string;
  shared: boolean;
};

const EMPTY: Draft = {
  name: '',
  diagnosis_code: '',
  diagnosis_text: '',
  soap_subjective: '',
  soap_objective: '',
  soap_assessment: '',
  soap_plan: '',
  shared: false,
};

function toDraft(t: Template): Draft {
  return {
    name: t.name,
    diagnosis_code: t.diagnosis_code ?? '',
    diagnosis_text: t.diagnosis_text ?? '',
    soap_subjective: t.soap_subjective ?? '',
    soap_objective: t.soap_objective ?? '',
    soap_assessment: t.soap_assessment ?? '',
    soap_plan: t.soap_plan ?? '',
    shared: t.visibility === 'clinic',
  };
}

export function DoctorKabinetPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);

  const templatesQ = useQuery({
    queryKey: ['doctor-templates'],
    queryFn: () => api.doctor.listTemplates(),
  });

  const statsQ = useQuery({
    queryKey: ['doctor-analytics', 'me'],
    queryFn: () => api.doctor.analytics(),
  });

  const mine = useMemo(
    () => (templatesQ.data ?? []).filter((t) => t.is_mine),
    [templatesQ.data],
  );
  const clinic = useMemo(
    () => (templatesQ.data ?? []).filter((t) => !t.is_mine),
    [templatesQ.data],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ['doctor-templates'] });

  const saveMut = useMutation({
    mutationFn: ({ id, draft }: { id: string | null; draft: Draft }) => {
      const body = {
        name: draft.name.trim(),
        diagnosis_code: draft.diagnosis_code.trim() || null,
        diagnosis_text: draft.diagnosis_text.trim() || null,
        soap_subjective: draft.soap_subjective.trim() || null,
        soap_objective: draft.soap_objective.trim() || null,
        soap_assessment: draft.soap_assessment.trim() || null,
        soap_plan: draft.soap_plan.trim() || null,
        visibility: (draft.shared ? 'clinic' : 'private') as 'clinic' | 'private',
      };
      return id ? api.doctor.updateTemplate(id, body) : api.doctor.createTemplate(body);
    },
    onSuccess: (_d, v) => {
      invalidate();
      toast.success(v.id ? 'Shablon yangilandi' : 'Shablon yaratildi');
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.doctor.deleteTemplate(id),
    onSuccess: () => {
      invalidate();
      toast.success("Shablon o'chirildi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stats = statsQ.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Shifokor kabineti"
        title={user?.email ? `Salom, ${user.email.split('@')[0]}` : 'Shifokor kabineti'}
        description="Tashxis shablonlaringizni shu yerda tayyorlang — qabul paytida bir bosishda qo'llanadi."
        actions={
          <Button onClick={() => setEditing({ id: null, draft: EMPTY })}>
            <Plus className="mr-1.5 h-4 w-4" />
            Yangi shablon
          </Button>
        }
      />

      {/* Shaxsiy ko'rsatkichlar — mavjud doctor/analytics endpointidan */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatBox
          label="Shablonlarim"
          value={String(mine.length)}
          hint={clinic.length > 0 ? `klinikada yana ${clinic.length} ta` : undefined}
        />
        <StatBox
          label={`Bemorlar (${stats?.period_days ?? 30} kun)`}
          value={stats ? String(stats.unique_patients) : '—'}
          hint={stats ? `qabullar: ${stats.total_appointments}` : undefined}
        />
        <StatBox
          label="Eng ko'p tashxis"
          value={stats?.top_diagnoses?.[0]?.code ?? '—'}
          hint={stats?.top_diagnoses?.[0]?.text ?? undefined}
        />
      </div>

      {/* ── Mening shablonlarim ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookText className="h-4 w-4" />
            Mening shablonlarim
          </CardTitle>
          <CardDescription>
            Faqat siz ko&apos;rasiz. &laquo;Klinikaga ulashish&raquo; belgilansa — hamma
            ko&apos;radi, lekin tahrirlash sizda qoladi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {templatesQ.isLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Yuklanmoqda…
            </div>
          ) : mine.length === 0 ? (
            <div className="text-muted-foreground rounded-md border border-dashed py-8 text-center text-sm">
              Hali shablon yo&apos;q.
              <div className="mt-1 text-xs">
                Tez-tez qo&apos;yadigan tashxisingizni shablon qilib qo&apos;ying — qabulda vaqt
                tejaysiz.
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {mine.map((t) => (
                <div key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{t.name}</span>
                      {t.diagnosis_code && (
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {t.diagnosis_code}
                        </Badge>
                      )}
                      {t.visibility === 'clinic' && (
                        <Badge className="gap-1 text-[10px]">
                          <Share2 className="h-3 w-3" />
                          klinikada
                        </Badge>
                      )}
                      {t.usage_count > 0 && (
                        <span className="text-muted-foreground text-[11px]">
                          {t.usage_count} marta ishlatilgan
                        </span>
                      )}
                    </div>
                    {t.diagnosis_text && (
                      <div className="text-muted-foreground truncate text-xs">
                        {t.diagnosis_text}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing({ id: t.id, draft: toDraft(t) })}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm(`«${t.name}» shabloni o'chirilsinmi?`))
                          deleteMut.mutate(t.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-600" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Klinika shablonlari ─────────────────────────────────────────── */}
      {clinic.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Stethoscope className="h-4 w-4" />
              Klinika shablonlari
            </CardTitle>
            <CardDescription>
              Hamkasblar ulashgan. Nusxa olib, o&apos;zingizga moslashtirishingiz mumkin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {clinic.map((t) => (
                <div key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{t.name}</span>
                      {t.diagnosis_code && (
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {t.diagnosis_code}
                        </Badge>
                      )}
                    </div>
                    {t.diagnosis_text && (
                      <div className="text-muted-foreground truncate text-xs">
                        {t.diagnosis_text}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() =>
                      setEditing({
                        id: null,
                        draft: { ...toDraft(t), name: `${t.name} (nusxa)`, shared: false },
                      })
                    }
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Nusxa
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {editing && (
        <TemplateEditor
          state={editing}
          busy={saveMut.isPending}
          onChange={(draft) => setEditing({ ...editing, draft })}
          onClose={() => setEditing(null)}
          onSave={() => saveMut.mutate(editing)}
        />
      )}
    </div>
  );
}

function StatBox({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-0.5 text-xl font-semibold">{value}</div>
      {hint && <div className="text-muted-foreground truncate text-[11px]">{hint}</div>}
    </div>
  );
}

function TemplateEditor({
  state,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  state: { id: string | null; draft: Draft };
  busy: boolean;
  onChange: (d: Draft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const d = state.draft;
  const set = (patch: Partial<Draft>) => onChange({ ...d, ...patch });
  const canSave = d.name.trim().length > 0 && !busy;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{state.id ? 'Shablonni tahrirlash' : 'Yangi shablon'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Shablon nomi *</Label>
            <Input
              id="tpl-name"
              value={d.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Masalan: O'tkir respirator infeksiya"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-code">ICD-10 kodi</Label>
              <Input
                id="tpl-code"
                value={d.diagnosis_code}
                onChange={(e) => set({ diagnosis_code: e.target.value })}
                placeholder="J06.9"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-dx">Tashxis matni</Label>
              <Input
                id="tpl-dx"
                value={d.diagnosis_text}
                onChange={(e) => set({ diagnosis_text: e.target.value })}
                placeholder="O'tkir yuqori nafas yo'llari infeksiyasi"
              />
            </div>
          </div>

          {(
            [
              ['soap_subjective', 'S — Shikoyat (subyektiv)', 'Bemor nimadan shikoyat qiladi…'],
              ['soap_objective', 'O — Obyektiv ko‘rik', 'Ko‘rik natijalari, vitallar…'],
              ['soap_assessment', 'A — Baho', 'Klinik xulosa…'],
              ['soap_plan', 'P — Reja', 'Davolash, tahlillar, keyingi qabul…'],
            ] as const
          ).map(([key, label, ph]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`tpl-${key}`}>{label}</Label>
              <Textarea
                id={`tpl-${key}`}
                value={d[key]}
                onChange={(e) => set({ [key]: e.target.value } as Partial<Draft>)}
                placeholder={ph}
                className="min-h-[70px]"
              />
            </div>
          ))}

          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5">
            <input
              type="checkbox"
              checked={d.shared}
              onChange={(e) => set({ shared: e.target.checked })}
              className="mt-0.5"
            />
            <span className="text-xs">
              <span className="font-medium">Klinikaga ulashish</span>
              <span className="text-muted-foreground block">
                {d.shared
                  ? "Barcha shifokorlar ko'radi va nusxa oladi. Tahrirlash va o'chirish sizda qoladi."
                  : "Faqat siz ko'rasiz."}
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button disabled={!canSave} onClick={onSave}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
