import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Loader2, Printer, Save, Trash2, UserCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button, Input, Label, Textarea } from '@clary/ui-web';

import { api } from '@/lib/api';
import {
  A4_PREVIEW_CSS,
  DEFAULT_BLANK,
  PATIENT_FIELDS,
  PATIENT_FIELD_LABELS,
  SAMPLE_PATIENT,
  renderA4Blank,
  type BlankSettings,
  type ClinicInfo,
  type PatientField,
} from '@/lib/a4-blank';
import { supabase } from '@/lib/supabase';
import { printA4Document } from '@/lib/print-receipt';

// =============================================================================
// Sozlamalar > Blanka (A4 hujjatlar)
// =============================================================================
// Bitta sozlama — barcha A4 hujjatlarga: tashxis xulosasi, retsept,
// yo'llanma, rozilik. Saqlash joyi: clinics.document_settings (jsonb),
// receipt_settings bilan bir xil naqsh (partial merge serverda).
//
// Logotip: fayl yuklanadi (PNG/JPG) → clinic-media bucket → clinics.logo_url.
// Bucket va yuklash usuli bemor fayllari bilan bir xil.

const LOGO_BUCKET = 'clinic-media';
const MAX_LOGO_MB = 2;

/** Namuna hujjat tanasi — sozlama ta'sirini ko'rsatish uchun. */
const SAMPLE_BODY = `
  <div style="margin-top:6px">
    <div style="font-weight:600;font-size:12px;margin-bottom:3px">Tashxis (ICD-10)</div>
    <div style="line-height:1.5">J06.9 — O'tkir yuqori nafas yo'llari infeksiyasi</div>
  </div>
  <div style="margin-top:12px">
    <div style="font-weight:600;font-size:12px;margin-bottom:3px">S — Shikoyat (subyektiv)</div>
    <div style="line-height:1.5">3 kundan beri tomoq og'rig'i, harorat 37.8°C, holsizlik.</div>
  </div>
  <div style="margin-top:12px">
    <div style="font-weight:600;font-size:12px;margin-bottom:3px">P — Reja</div>
    <div style="line-height:1.5">Simptomatik davolash, ko'p suyuqlik. 3 kundan so'ng qayta ko'rik.</div>
  </div>
`;

export function SettingsBlankPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [filled, setFilled] = useState(true);
  const [s, setS] = useState<BlankSettings>({});
  const [loaded, setLoaded] = useState(false);

  const meQ = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      api.get<{ clinic?: ClinicInfo & { id?: string; document_settings?: BlankSettings } }>(
        '/api/v1/auth/me',
      ),
    staleTime: 60_000,
  });
  const clinic = meQ.data?.clinic;

  useEffect(() => {
    if (loaded || !clinic) return;
    setS({ ...DEFAULT_BLANK, ...(clinic.document_settings ?? {}) });
    setLoaded(true);
  }, [clinic, loaded]);

  const set = (patch: Partial<BlankSettings>) => setS((p) => ({ ...p, ...patch }));

  const toggleField = (f: PatientField) => {
    const cur = s.patient_fields ?? DEFAULT_BLANK.patient_fields;
    set({ patient_fields: cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f] });
  };

  const previewHtml = useMemo(
    () =>
      renderA4Blank({
        title: 'Tibbiy xulosa',
        clinic: clinic ?? {},
        settings: s,
        patient: filled ? SAMPLE_PATIENT : undefined,
        doctorName: filled ? 'Aliyev Mirshohid' : null,
        body: SAMPLE_BODY,
        note: 'Namuna',
      }),
    [clinic, s, filled],
  );

  const saveMut = useMutation({
    mutationFn: () => api.patch<unknown>('/api/v1/auth/clinic/document-settings', s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      toast.success('Blanka sozlamalari saqlandi');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Logotipni yuklash — clinics.logo_url ga public URL yoziladi.
  async function onLogoPick(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.error('Faqat PNG, JPG yoki WEBP');
      return;
    }
    if (file.size > MAX_LOGO_MB * 1024 * 1024) {
      toast.error(`Fayl ${MAX_LOGO_MB} MB dan katta bo'lmasin`);
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `clinic-logo/${clinic?.id ?? 'clinic'}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, file, { upsert: false, cacheControl: '3600' });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
      await api.patch('/api/v1/auth/clinic/logo', { logo_url: data.publicUrl });
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      toast.success('Logotip yuklandi');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Yuklab bo‘lmadi');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeLogo() {
    if (!window.confirm("Logotip olib tashlansinmi?")) return;
    try {
      await api.patch('/api/v1/auth/clinic/logo', { logo_url: null });
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      toast.success('Logotip olib tashlandi');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Xatolik');
    }
  }

  const fields = s.patient_fields ?? DEFAULT_BLANK.patient_fields;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,440px)_1fr]">
      {/* ── CHAP: sozlamalar ──────────────────────────────────────────── */}
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-semibold">Blanka (A4 hujjatlar)</h2>
          <p className="text-muted-foreground text-sm">
            Bu sozlama barcha A4 hujjatlarga qo&apos;llanadi: tibbiy xulosa, retsept,
            yo&apos;llanma, rozilik.
          </p>
        </div>

        {/* Logotip */}
        <section className="space-y-2">
          <Label>Logotip</Label>
          <div className="flex items-center gap-3 rounded-md border p-3">
            {clinic?.logo_url ? (
              <img
                src={clinic.logo_url}
                alt="logotip"
                className="h-12 w-auto max-w-[120px] object-contain"
              />
            ) : (
              <div className="text-muted-foreground bg-muted/40 flex h-12 w-[120px] items-center justify-center rounded text-[11px]">
                yo&apos;q
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void onLogoPick(e.target.files?.[0])}
              />
              <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImageUp className="mr-1.5 h-3.5 w-3.5" />
                )}
                Yuklash
              </Button>
              {clinic?.logo_url && (
                <Button size="sm" variant="ghost" onClick={() => void removeLogo()}>
                  <Trash2 className="h-3.5 w-3.5 text-red-600" />
                </Button>
              )}
            </div>
          </div>
          <p className="text-muted-foreground text-[11px]">
            PNG, JPG yoki WEBP · {MAX_LOGO_MB} MB gacha · shaffof fonli PNG eng yaxshi chiqadi
          </p>
          <Check label="Blankada logotip ko'rsatilsin" checked={s.show_logo ?? true} onChange={(v) => set({ show_logo: v })} />
        </section>

        {/* Sarlavha */}
        <section className="space-y-2">
          <Label>Sarlavha</Label>
          <div className="space-y-1.5 rounded-md border p-3">
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  checked={(s.name_source ?? 'name') === 'name'}
                  onChange={() => set({ name_source: 'name' })}
                />
                Klinika nomi
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  checked={s.name_source === 'legal_name'}
                  onChange={() => set({ name_source: 'legal_name' })}
                />
                Yuridik nom
              </label>
            </div>
            <Check label={`Manzil${clinic?.address ? '' : " (klinika sozlamasida bo'sh)"}`} checked={s.show_address ?? true} onChange={(v) => set({ show_address: v })} />
            <Check label={`Telefon${clinic?.phone ? '' : " (bo'sh)"}`} checked={s.show_phone ?? true} onChange={(v) => set({ show_phone: v })} />
            <Check label="Email" checked={s.show_email ?? false} onChange={(v) => set({ show_email: v })} />
          </div>
        </section>

        {/* Bemor maydonlari */}
        <section className="space-y-2">
          <Label>Bemor maydonlari</Label>
          <div className="space-y-1.5 rounded-md border p-3">
            <div className="text-muted-foreground text-[11px]">
              F.I.Sh. har doim chiqadi. Qolganini tanlang:
            </div>
            {PATIENT_FIELDS.map((f) => (
              <Check
                key={f}
                label={PATIENT_FIELD_LABELS[f]}
                checked={fields.includes(f)}
                onChange={() => toggleField(f)}
                warn={f === 'pinfl' || f === 'passport'}
              />
            ))}
            <p className="text-[11px] text-amber-700">
              PINFL va passport — maxfiy ma&apos;lumot. Faqat haqiqatan kerak bo&apos;lsa yoqing.
            </p>
          </div>
        </section>

        {/* Pastki qism */}
        <section className="space-y-2">
          <Label>Pastki qism</Label>
          <div className="space-y-2 rounded-md border p-3">
            <Check label="Imzo chizig'i" checked={s.show_signature ?? true} onChange={(v) => set({ show_signature: v })} />
            <Check label="Muhr o'rni (M.O.)" checked={s.show_stamp ?? true} onChange={(v) => set({ show_stamp: v })} />
            <div className="space-y-1.5 pt-1">
              <Label htmlFor="lic" className="text-xs">
                Litsenziya raqami
              </Label>
              <Input
                id="lic"
                value={s.license_text ?? ''}
                onChange={(e) => set({ license_text: e.target.value })}
                placeholder="Litsenziya AA-1234, 01.01.2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="foot" className="text-xs">
                Qo&apos;shimcha kolontitul
              </Label>
              <Textarea
                id="foot"
                value={s.footer_text ?? ''}
                onChange={(e) => set({ footer_text: e.target.value })}
                placeholder="Ixtiyoriy: sayt, qo'shimcha manzil…"
                className="min-h-[52px]"
              />
            </div>
          </div>
        </section>

        <Button disabled={saveMut.isPending || !loaded} onClick={() => saveMut.mutate()}>
          {saveMut.isPending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-4 w-4" />
          )}
          Saqlash
        </Button>
      </div>

      {/* ── O'NG: jonli blanka ────────────────────────────────────────── */}
      <div className="xl:sticky xl:top-4 xl:self-start">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-muted-foreground text-xs font-medium">Namuna — A4</div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={filled ? 'default' : 'ghost'}
              title="To'ldirilgan / bo'sh blanka"
              onClick={() => setFilled((v) => !v)}
            >
              <UserCheck className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => printA4Document(previewHtml, 'Blanka namunasi')}
            >
              <Printer className="mr-1.5 h-3.5 w-3.5" />
              Sinov chop etish
            </Button>
          </div>
        </div>

        <div className="bg-muted/40 overflow-auto rounded-md border p-4">
          <style>{A4_PREVIEW_CSS}</style>
          <div
            style={{
              width: 'calc(210mm * 0.7)',
              height: 'calc(297mm * 0.7)',
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
                transform: 'scale(0.7)',
                transformOrigin: 'top left',
              }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  warn,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  warn?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={warn && checked ? 'text-amber-700' : undefined}>{label}</span>
    </label>
  );
}
