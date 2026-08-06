import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
} from '@clary/ui-web';
import {
  Ban,
  FileSignature,
  Loader2,
  Paperclip,
  Printer,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

import type { ConsentCode, ConsentStatus, PatientConsent } from '@clary/api-client';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';
import { printConsent } from '@/lib/consent-print';

// =============================================================================
// BEMOR ROZILIKLARI — ro'yxat + yaratish/chop etish + imzolangan skanni yuklash
// =============================================================================
// Oqim: "Yangi rozilik" → matn serverda snapshot bo'ladi → darhol chop etiladi →
// bemor qo'lda imzolaydi → "Skan" tugmasi bilan surat yuklanadi → 'signed'.
// =============================================================================

const CODE_LABEL: Record<ConsentCode, string> = {
  general: 'Umumiy tibbiy aralashuv',
  inpatient: 'Statsionar davolanish',
  dental: 'Stomatologik davolash',
  personal_data: "Shaxsiy ma'lumotlar",
};

const STATUS_UI: Record<
  ConsentStatus,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  printed: { label: 'Imzo kutilmoqda', variant: 'outline' },
  signed: { label: 'Imzolangan', variant: 'default' },
  refused: { label: 'Bosh tortilgan', variant: 'destructive' },
  revoked: { label: 'Qaytarib olingan', variant: 'secondary' },
};

function fmtDate(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('uz-UZ');
}

// Birinchi tashrifda olinishi kerak bo'lgan roziliklar.
const BASELINE_CODES: ConsentCode[] = ['general', 'personal_data'];

/**
 * Qabulxona uchun ixcham eslatma — bemorda asosiy roziliklar yo'q bo'lsa
 * ko'rinadi. BLOKLAMAYDI: kassa oqimi hech qachon to'xtamasligi kerak, bu
 * shunchaki xodimga eslatma. Xato bo'lsa umuman ko'rinmaydi (fail-soft).
 */
export function ConsentNotice({ patientId }: { patientId: string }) {
  const { data, isError } = useQuery({
    queryKey: ['consents', patientId],
    queryFn: () => api.consents.list({ patient_id: patientId }),
    enabled: !!patientId,
    staleTime: 60_000,
  });
  if (isError || !data) return null;

  const missing = BASELINE_CODES.filter(
    (code) => !data.some((c) => c.code === code && c.status === 'signed'),
  );
  if (missing.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs dark:bg-amber-950/20">
      <FileSignature className="h-3.5 w-3.5 shrink-0 text-amber-600" />
      <span>
        Rozilik olinmagan: <b>{missing.map((m) => CODE_LABEL[m]).join(', ')}</b>
      </span>
      <Link to={`/patient/${patientId}`} className="ml-auto underline underline-offset-2">
        Bemor kartasida rasmiylashtirish
      </Link>
    </div>
  );
}

/** Imzolangan qog'oz surati — private bucket'ga to'g'ridan-to'g'ri. */
async function uploadScan(file: File, clinicId: string, patientId: string, consentId: string) {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${clinicId}/${patientId}/${consentId}.${ext}`;
  const { error } = await supabase.storage
    .from('patient-consents')
    .upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type });
  if (error) throw new Error(error.message);
  return path;
}

export function PatientConsents({
  patientId,
  clinicName,
  context,
}: {
  patientId: string;
  clinicName: string;
  /** Ixtiyoriy kontekst — rozilikni statsionar/dental voqeasiga bog'laydi. */
  context?: {
    stay_id?: string | null;
    dental_plan_id?: string | null;
    doctor_id?: string | null;
    doctor_name?: string | null;
    procedure?: string | null;
    defaultCode?: ConsentCode;
  };
}) {
  const qc = useQueryClient();
  const { clinicId, role } = useAuth();
  const isOwner = role === 'clinic_owner' || role === 'clinic_admin' || role === 'super_admin';

  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState<ConsentCode>(context?.defaultCode ?? 'general');
  const [lang, setLang] = useState<'uz' | 'ru'>('uz');
  const [signerRelation, setSignerRelation] = useState<'self' | 'parent' | 'guardian'>('self');
  const [signerName, setSignerName] = useState('');

  const [revokeTarget, setRevokeTarget] = useState<PatientConsent | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  // Skan yuklash — qaysi rozilik uchun ekanini input'ga bog'laymiz.
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<PatientConsent | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['consents', patientId],
    queryFn: () => api.consents.list({ patient_id: patientId }),
    enabled: !!patientId,
  });
  const consents = data ?? [];

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['consents', patientId] });

  const createMut = useMutation({
    mutationFn: () =>
      api.consents.create({
        patient_id: patientId,
        code,
        lang,
        stay_id: context?.stay_id ?? null,
        dental_plan_id: context?.dental_plan_id ?? null,
        doctor_id: context?.doctor_id ?? null,
        doctor_name: context?.doctor_name ?? null,
        procedure: context?.procedure ?? null,
        signer_name: signerRelation === 'self' ? null : signerName.trim() || null,
        signer_relation: signerRelation,
      }),
    onSuccess: (c) => {
      setCreateOpen(false);
      setSignerName('');
      setSignerRelation('self');
      invalidate();
      // Yaratish = chop etish uchun. Darhol printerga yuboramiz.
      printConsent(c, clinicName);
      toast.success('Rozilik tayyor — chop etilmoqda');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const signMut = useMutation({
    mutationFn: (v: { id: string; body: Parameters<typeof api.consents.sign>[1] }) =>
      api.consents.sign(v.id, v.body),
    onSuccess: () => {
      toast.success('Imzolangan deb belgilandi');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refuseMut = useMutation({
    mutationFn: (id: string) => api.consents.refuse(id, {}),
    onSuccess: () => {
      toast.success('Bosh tortish qayd etildi');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeMut = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      api.consents.revoke(v.id, { reason: v.reason }),
    onSuccess: () => {
      toast.success('Rozilik qaytarib olindi');
      setRevokeTarget(null);
      setRevokeReason('');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onFilePicked = async (file: File | undefined) => {
    const target = uploadTarget;
    if (!file || !target || !clinicId) return;
    setUploading(true);
    try {
      const path = await uploadScan(file, clinicId, patientId, target.id);
      await signMut.mutateAsync({
        id: target.id,
        body: {
          storage_path: path,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        },
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      setUploadTarget(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <FileSignature className="h-4 w-4" /> Roziliklar
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Printer className="mr-1 h-3.5 w-3.5" /> Yangi rozilik
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
        </div>
      ) : consents.length === 0 ? (
        <EmptyState
          icon={<FileSignature className="h-8 w-8" />}
          title="Rozilik hujjati yo'q"
          description="Muolajadan oldin bemordan yozma rozilik olish tavsiya etiladi"
        />
      ) : (
        <div className="space-y-2">
          {consents.map((c) => {
            const st = STATUS_UI[c.status] ?? STATUS_UI.printed;
            const editable = c.status !== 'revoked';
            return (
              <div key={c.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">
                        {CODE_LABEL[c.code] ?? c.title_snapshot}
                      </span>
                      <Badge variant={st.variant}>{st.label}</Badge>
                      <span className="text-muted-foreground text-[11px] uppercase">{c.lang}</span>
                    </div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      Chop etilgan: {fmtDate(c.created_at)}
                      {c.signed_at && ` · Imzolangan: ${fmtDate(c.signed_at)}`}
                      {c.signer_relation !== 'self' && c.signer_name && (
                        <> · Vakil: {c.signer_name}</>
                      )}
                      {c.revoked_at && ` · Qaytarib olingan: ${fmtDate(c.revoked_at)}`}
                    </div>
                    {c.revoke_reason && (
                      <div className="mt-1 text-xs text-red-600">Sabab: {c.revoke_reason}</div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => printConsent(c, clinicName)}>
                      <Printer className="mr-1 h-3.5 w-3.5" /> Chop etish
                    </Button>
                    {c.signed_url && (
                      <Button size="sm" variant="outline" asChild>
                        <a href={c.signed_url} target="_blank" rel="noreferrer">
                          <Paperclip className="mr-1 h-3.5 w-3.5" /> Skan
                        </a>
                      </Button>
                    )}
                    {editable && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={uploading}
                        onClick={() => {
                          setUploadTarget(c);
                          fileRef.current?.click();
                        }}
                      >
                        {uploading && uploadTarget?.id === c.id ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="mr-1 h-3.5 w-3.5" />
                        )}
                        {c.storage_path ? 'Skanni almashtirish' : 'Skan yuklash'}
                      </Button>
                    )}
                    {editable && c.status === 'printed' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => signMut.mutate({ id: c.id, body: {} })}
                        >
                          <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Imzolandi
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => refuseMut.mutate(c.id)}>
                          <XCircle className="mr-1 h-3.5 w-3.5" /> Bosh tortdi
                        </Button>
                      </>
                    )}
                    {isOwner && editable && (
                      <Button size="sm" variant="ghost" onClick={() => setRevokeTarget(c)}>
                        <Ban className="mr-1 h-3.5 w-3.5" /> Qaytarib olish
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Skan uchun yashirin fayl tanlagich — telefonda kamera ochiladi */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={(e) => void onFilePicked(e.target.files?.[0])}
      />

      {/* Yangi rozilik */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yangi rozilik</DialogTitle>
            <DialogDescription>
              Matn shu daqiqadagi shablondan olinadi va o'zgarmas nusxa sifatida saqlanadi.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>Rozilik turi</Label>
              <select
                value={code}
                onChange={(e) => setCode(e.target.value as ConsentCode)}
                className="border-input bg-background mt-1 h-9 w-full rounded-md border px-2 text-sm"
              >
                {(Object.keys(CODE_LABEL) as ConsentCode[]).map((k) => (
                  <option key={k} value={k}>
                    {CODE_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>Til</Label>
              <div className="mt-1 flex gap-2">
                {(['uz', 'ru'] as const).map((l) => (
                  <Button
                    key={l}
                    type="button"
                    size="sm"
                    variant={lang === l ? 'default' : 'outline'}
                    onClick={() => setLang(l)}
                  >
                    {l === 'uz' ? "O'zbekcha" : 'Ruscha'}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label>Kim imzolaydi</Label>
              <select
                value={signerRelation}
                onChange={(e) =>
                  setSignerRelation(e.target.value as 'self' | 'parent' | 'guardian')
                }
                className="border-input bg-background mt-1 h-9 w-full rounded-md border px-2 text-sm"
              >
                <option value="self">Bemorning o'zi</option>
                <option value="parent">Ota-ona</option>
                <option value="guardian">Vasiy / qonuniy vakil</option>
              </select>
              <p className="text-muted-foreground mt-1 text-[11px]">
                14 yoshgacha bo'lgan bemor uchun ota-ona yoki vasiy imzolaydi.
              </p>
            </div>

            {signerRelation !== 'self' && (
              <div>
                <Label>Vakilning F.I.O.</Label>
                <Input
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Familiya Ism Otasining ismi"
                  className="mt-1"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Bekor qilish
            </Button>
            <Button
              disabled={createMut.isPending || (signerRelation !== 'self' && !signerName.trim())}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Printer className="mr-1 h-3.5 w-3.5" />
              )}
              Yaratish va chop etish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Qaytarib olish */}
      <Dialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rozilikni qaytarib olish</DialogTitle>
            <DialogDescription>
              Hujjat o'chirilmaydi — "qaytarib olingan" holatiga o'tadi va tarixda qoladi.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Sabab (majburiy)</Label>
            <Input
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder="Masalan: bemor yozma ariza berdi"
              className="mt-1"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Bekor qilish
            </Button>
            <Button
              variant="destructive"
              disabled={revokeReason.trim().length < 3 || revokeMut.isPending}
              onClick={() =>
                revokeTarget &&
                revokeMut.mutate({ id: revokeTarget.id, reason: revokeReason.trim() })
              }
            >
              Qaytarib olish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
