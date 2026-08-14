import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Loader2,
  Maximize2,
  Minimize2,
  Printer,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button, Input, Label, PageHeader, Textarea } from '@clary/ui-web';

import { api } from '@/lib/api';
import {
  A4_PREVIEW_CSS,
  printTemplate,
  templateA4Html,
  type TemplateDoc,
} from '@/lib/diagnosis-template-print';

// =============================================================================
// Shablon muharriri — ALOHIDA SAHIFA
// =============================================================================
// Ilgari modal oyna edi: blanka kichkina ko'rinardi va uzun SOAP matnlarini
// yozish noqulay edi. Endi to'liq sahifa — chapda maydonlar, o'ngda A4 blanka
// yopishqoq (sticky) holatda, masshtab boshqaruvi bilan.
//
// Marshrutlar:
//   /doctor/kabinet/yangi        — yangi shablon
//   /doctor/kabinet/yangi?from=  — klinika shablonidan nusxa
//   /doctor/kabinet/:id          — tahrirlash

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

// Ko'rsatish masshtabi. Indeks bilan saqlaymiz — qiymatni ro'yxatdan qidirish
// (indexOf) suzuvchi nuqtali sonlarda ishonchsiz.
const ZOOMS = [0.5, 0.65, 0.8, 1];

export function DoctorTemplateEditPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const copyFrom = params.get('from');
  const isNew = !id;

  const navigate = useNavigate();
  const qc = useQueryClient();

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [zoomIdx, setZoomIdx] = useState(1);
  const [wide, setWide] = useState(false);
  const zoom = ZOOMS[zoomIdx] ?? 0.65;

  const templatesQ = useQuery({
    queryKey: ['doctor-templates'],
    queryFn: () => api.doctor.listTemplates(),
  });

  const meQ = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ clinic?: { name?: string }; full_name?: string }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
  const meta = useMemo(
    () => ({
      clinicName: meQ.data?.clinic?.name ?? 'Klinika',
      doctorName: meQ.data?.full_name ?? null,
    }),
    [meQ.data],
  );

  // Mavjud shablonni (yoki nusxa manbasini) ro'yxatdan olamiz — alohida
  // endpoint kerak emas, ro'yxat allaqachon keshda.
  useEffect(() => {
    if (loaded || !templatesQ.data) return;
    const sourceId = id ?? copyFrom;
    if (!sourceId) {
      setLoaded(true);
      return;
    }
    const t = templatesQ.data.find((x) => x.id === sourceId);
    if (!t) {
      setLoaded(true);
      return;
    }
    setDraft({
      name: copyFrom ? `${t.name} (nusxa)` : t.name,
      diagnosis_code: t.diagnosis_code ?? '',
      diagnosis_text: t.diagnosis_text ?? '',
      soap_subjective: t.soap_subjective ?? '',
      soap_objective: t.soap_objective ?? '',
      soap_assessment: t.soap_assessment ?? '',
      soap_plan: t.soap_plan ?? '',
      shared: copyFrom ? false : t.visibility === 'clinic',
    });
    setLoaded(true);
  }, [templatesQ.data, id, copyFrom, loaded]);

  const doc: TemplateDoc = useMemo(
    () => ({
      name: draft.name || 'Nomsiz shablon',
      diagnosis_code: draft.diagnosis_code,
      diagnosis_text: draft.diagnosis_text,
      soap_subjective: draft.soap_subjective,
      soap_objective: draft.soap_objective,
      soap_assessment: draft.soap_assessment,
      soap_plan: draft.soap_plan,
    }),
    [draft],
  );
  const previewHtml = useMemo(() => templateA4Html(doc, meta), [doc, meta]);

  const saveMut = useMutation({
    mutationFn: () => {
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
      return isNew ? api.doctor.createTemplate(body) : api.doctor.updateTemplate(id, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor-templates'] });
      toast.success(isNew ? 'Shablon yaratildi' : 'Shablon yangilandi');
      navigate('/doctor/kabinet');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (patch: Partial<Draft>) => setDraft((p) => ({ ...p, ...patch }));
  const canSave = draft.name.trim().length > 0 && !saveMut.isPending;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Shifokor kabineti"
        title={isNew ? 'Yangi shablon' : 'Shablonni tahrirlash'}
        description="Chapda to'ldiring — o'ngda qog'ozdagi joylashuv darhol ko'rinadi."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => navigate('/doctor/kabinet')}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Orqaga
            </Button>
            <Button variant="outline" onClick={() => printTemplate(doc, meta)}>
              <Printer className="mr-1.5 h-4 w-4" />
              Chop etish / PDF
            </Button>
            <Button disabled={!canSave} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Saqlash
            </Button>
          </div>
        }
      />

      <div className={wide ? 'space-y-5' : 'grid gap-5 xl:grid-cols-[minmax(0,420px)_1fr]'}>
        {/* ── CHAP: maydonlar ─────────────────────────────────────────── */}
        {!wide && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Shablon nomi *</Label>
              <Input
                id="tpl-name"
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Masalan: O'tkir respirator infeksiya"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-[130px_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-code">ICD-10</Label>
                <Input
                  id="tpl-code"
                  value={draft.diagnosis_code}
                  onChange={(e) => set({ diagnosis_code: e.target.value })}
                  placeholder="J06.9"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-dx">Tashxis matni</Label>
                <Input
                  id="tpl-dx"
                  value={draft.diagnosis_text}
                  onChange={(e) => set({ diagnosis_text: e.target.value })}
                  placeholder="O'tkir yuqori nafas yo'llari infeksiyasi"
                />
              </div>
            </div>

            {(
              [
                ['soap_subjective', 'S — Shikoyat (subyektiv)', 'Bemor nimadan shikoyat qiladi…'],
                ['soap_objective', "O — Obyektiv ko'rik", "Ko'rik natijalari, vitallar…"],
                ['soap_assessment', 'A — Baho', 'Klinik xulosa…'],
                ['soap_plan', 'P — Reja', 'Davolash, tahlillar, keyingi qabul…'],
              ] as const
            ).map(([key, label, ph]) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`tpl-${key}`}>{label}</Label>
                <Textarea
                  id={`tpl-${key}`}
                  value={draft[key]}
                  onChange={(e) => set({ [key]: e.target.value } as Partial<Draft>)}
                  placeholder={ph}
                  className="min-h-[90px]"
                />
              </div>
            ))}

            <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5">
              <input
                type="checkbox"
                checked={draft.shared}
                onChange={(e) => set({ shared: e.target.checked })}
                className="mt-0.5"
              />
              <span className="text-xs">
                <span className="font-medium">Klinikaga ulashish</span>
                <span className="text-muted-foreground block">
                  {draft.shared
                    ? "Barcha shifokorlar ko'radi va nusxa oladi. Tahrirlash sizda qoladi."
                    : "Faqat siz ko'rasiz."}
                </span>
              </span>
            </label>
          </div>
        )}

        {/* ── O'NG: A4 blanka ─────────────────────────────────────────── */}
        <div className="xl:sticky xl:top-4 xl:self-start">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-muted-foreground text-xs font-medium">
              Blanka ko&apos;rinishi — A4 (210 × 297 mm)
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                title="Kichraytirish"
                disabled={zoomIdx === 0}
                onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <span className="text-muted-foreground w-10 text-center text-xs tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                size="sm"
                variant="ghost"
                title="Kattalashtirish"
                disabled={zoomIdx === ZOOMS.length - 1}
                onClick={() => setZoomIdx((i) => Math.min(ZOOMS.length - 1, i + 1))}
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title={wide ? 'Maydonlarni ko‘rsatish' : 'Blankani kengaytirish'}
                onClick={() => setWide((v) => !v)}
              >
                {wide ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <A4Sheet html={previewHtml} zoom={zoom} />

          <p className="text-muted-foreground mt-2 text-[11px]">
            Nuqtali joylar qabul paytida to&apos;ldiriladi. &laquo;Chop etish / PDF&raquo; da
            brauzerning &laquo;PDF sifatida saqlash&raquo; tanlovi bor.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * A4 varaq — chop etish bilan AYNI HTML/CSS. Masshtab faqat ko'rsatish uchun,
 * qog'ozdagi o'lchamlarga ta'sir qilmaydi.
 */
function A4Sheet({ html, zoom }: { html: string; zoom: number }) {
  return (
    <div className="bg-muted/40 overflow-auto rounded-md border p-4">
      <style>{A4_PREVIEW_CSS}</style>
      <div
        style={{
          width: `calc(210mm * ${zoom})`,
          height: `calc(297mm * ${zoom})`,
          overflow: 'hidden',
          margin: '0 auto',
          boxShadow: '0 2px 10px rgba(0,0,0,.18)',
        }}
      >
        <div
          className="a4-preview"
          style={{
            width: '210mm',
            minHeight: '297mm',
            padding: '16mm',
            background: '#fff',
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
