import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookText,
  Copy,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Share2,
  Stethoscope,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { printTemplate } from '@/lib/diagnosis-template-print';
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

// Muharrir alohida sahifada — /doctor/kabinet/yangi va /doctor/kabinet/:id
// (doctor-template-edit.tsx). Modal kichik edi, blanka to'liq ko'rinmasdi.

export function DoctorKabinetPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const templatesQ = useQuery({
    queryKey: ['doctor-templates'],
    queryFn: () => api.doctor.listTemplates(),
  });

  const statsQ = useQuery({
    queryKey: ['doctor-analytics', 'me'],
    queryFn: () => api.doctor.analytics(),
  });

  // Blankadagi klinika nomi — chek/rozilik hujjatlari bilan bir xil manba.
  const meQ = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ clinic?: { name?: string }; full_name?: string }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
  const docMeta = {
    clinicName: meQ.data?.clinic?.name ?? 'Klinika',
    doctorName: meQ.data?.full_name ?? null,
  };

  const mine = useMemo(
    () => (templatesQ.data ?? []).filter((t) => t.is_mine),
    [templatesQ.data],
  );
  const clinic = useMemo(
    () => (templatesQ.data ?? []).filter((t) => !t.is_mine),
    [templatesQ.data],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ['doctor-templates'] });

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
          <Button onClick={() => navigate('/doctor/kabinet/yangi')}>
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
                      title="Blanka ko'rinishida chop etish"
                      onClick={() => printTemplate(t, docMeta)}
                    >
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate(`/doctor/kabinet/${t.id}`)}
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
                    onClick={() => navigate(`/doctor/kabinet/yangi?from=${t.id}`)}
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
