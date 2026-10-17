import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminClinicEntitlements, EntitlementsPatch } from '@clary/api-client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Input,
  Label,
  Textarea,
  cn,
} from '@clary/ui-web';
import { BadgePercent, CalendarClock, History, RotateCcw, Save, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/query-state';
import { EntitlementsEditor } from '@/components/entitlements/entitlements-editor';
import {
  DEFAULT_ENT,
  clone,
  compactPatch,
  countOverrides,
  fmtUzs,
  limitText,
} from '@/components/entitlements/ent-utils';

// =============================================================================
// Klinika — "Tarif va ruxsatlar": tarif ustidan individual kelishuv (modul,
// jurnal, to'lov turlari, analitika, rollar/qurilmalar, limitlar), maxsus
// narx/chegirma va muddat. Har maydon "Tarifdagidek" yoki aniq qiymat.
// =============================================================================

interface Deal {
  custom_price_uzs: string;
  custom_price_yearly_uzs: string;
  discount_percent: string;
  valid_until: string;
  note: string;
}

const dealOf = (d: AdminClinicEntitlements): Deal => ({
  custom_price_uzs: d.override?.custom_price_uzs == null ? '' : String(d.override.custom_price_uzs),
  custom_price_yearly_uzs:
    d.override?.custom_price_yearly_uzs == null ? '' : String(d.override.custom_price_yearly_uzs),
  discount_percent: d.override?.discount_percent == null ? '' : String(d.override.discount_percent),
  valid_until: d.override?.valid_until ?? '',
  note: d.override?.note ?? '',
});

const intOrNull = (s: string) => (s.trim() === '' ? null : Math.max(0, Math.floor(Number(s))));

export function TenantEntitlements({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'clinic-entitlements', clinicId],
    queryFn: () => api.admin.clinicEntitlements(clinicId),
  });
  const catalogQ = useQuery({
    queryKey: ['admin', 'entitlements-catalog'],
    queryFn: () => api.admin.entitlementsCatalog(),
    staleTime: 10 * 60_000,
  });

  const [patch, setPatch] = useState<EntitlementsPatch>({});
  const [deal, setDeal] = useState<Deal | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (q.data) {
      setPatch(clone(q.data.override?.overrides ?? {}));
      setDeal(dealOf(q.data));
    }
  }, [q.data]);

  const originalKey = useMemo(
    () =>
      q.data
        ? JSON.stringify([compactPatch(q.data.override?.overrides ?? {}), dealOf(q.data)])
        : '',
    [q.data],
  );
  const dirty = !!deal && JSON.stringify([compactPatch(patch), deal]) !== originalKey;

  const onSaved = (d: AdminClinicEntitlements) => {
    qc.setQueryData(['admin', 'clinic-entitlements', clinicId], d);
    void qc.invalidateQueries({ queryKey: ['admin', 'entitlement-plans'] });
  };
  const saveMut = useMutation({
    mutationFn: () =>
      api.admin.saveClinicEntitlements(clinicId, {
        overrides: compactPatch(patch),
        custom_price_uzs: intOrNull(deal!.custom_price_uzs),
        custom_price_yearly_uzs: intOrNull(deal!.custom_price_yearly_uzs),
        discount_percent:
          deal!.discount_percent.trim() === ''
            ? null
            : Math.max(0, Math.min(100, Number(deal!.discount_percent))),
        valid_until: deal!.valid_until || null,
        note: deal!.note.trim() || null,
      }),
    onSuccess: (d) => {
      toast.success('Individual kelishuv saqlandi — klinikaga darhol amal qiladi');
      onSaved(d);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const resetMut = useMutation({
    mutationFn: () => api.admin.resetClinicEntitlements(clinicId),
    onSuccess: (d) => {
      toast.success('Klinika tarif sozlamalariga qaytarildi');
      setConfirmReset(false);
      onSaved(d);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading || catalogQ.isLoading) return <LoadingState />;
  if (q.isError || catalogQ.isError) {
    return (
      <ErrorState
        message={((q.error ?? catalogQ.error) as Error)?.message}
        onRetry={() => void q.refetch()}
      />
    );
  }
  const data = q.data!;
  const catalog = catalogQ.data!;
  const base = data.plan?.entitlements ?? DEFAULT_ENT;
  const eff = data.effective;
  const nOverrides = countOverrides(patch);
  const planPrice = data.plan?.price_uzs ?? null;
  const dealPrice = deal
    ? (intOrNull(deal.custom_price_uzs) ??
      (deal.discount_percent && planPrice != null
        ? Math.round(planPrice * (1 - Number(deal.discount_percent) / 100))
        : null))
    : null;

  return (
    <div className="space-y-4 pb-16">
      {/* Holat */}
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-muted-foreground text-xs uppercase">Tarif</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-lg font-semibold">
                {data.plan?.name ?? data.clinic.current_plan}
              </span>
              <Link
                to={`/plans/${data.clinic.current_plan}`}
                className="text-primary text-xs hover:underline"
              >
                tarifni ochish
              </Link>
            </div>
            <div className="text-muted-foreground mt-0.5 text-xs">
              {fmtUzs(planPrice)} / oy · {data.clinic.subscription_status}
            </div>
          </CardContent>
        </Card>
        <Usage label="Xodimlar" used={data.usage.staff} max={eff.limits.max_staff} />
        <Usage label="Qurilmalar" used={data.usage.devices} max={eff.limits.max_devices} />
        <Usage label="Bemorlar" used={data.usage.patients} max={eff.limits.max_patients} />
      </div>

      {data.clinic.company_id && !data.clinic.is_hq && (
        <p className="rounded-lg border bg-sky-500/10 p-3 text-xs text-sky-800 dark:text-sky-300">
          Bu filial. Tarmoq “bitta obuna” rejimida bo‘lsa — tarif va HQ kelishuvi filialga ham
          tarqaladi, shu yerdagi sozlama ularning ustidan qo‘llanadi.
        </p>
      )}

      {/* Kelishuv */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <CardTitle className="text-base">Individual kelishuv</CardTitle>
          {data.override ? (
            data.override && (data.effective.override?.active ?? true) ? (
              <Badge variant="warning">{nOverrides} ta o‘zgartirish · faol</Badge>
            ) : (
              <Badge variant="destructive">Muddati tugagan — tarif amal qilmoqda</Badge>
            )
          ) : (
            <Badge variant="outline">Yo‘q — tarif bo‘yicha</Badge>
          )}
          {data.override && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto gap-1"
              onClick={() => setConfirmReset(true)}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Tarifga qaytarish
            </Button>
          )}
        </CardHeader>
        {deal && (
          <CardContent className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Maxsus oylik narx</Label>
              <Input
                type="number"
                placeholder={planPrice != null ? String(planPrice) : 'tarif narxi'}
                value={deal.custom_price_uzs}
                onChange={(e) => setDeal({ ...deal, custom_price_uzs: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Maxsus yillik narx</Label>
              <Input
                type="number"
                placeholder={
                  data.plan?.price_yearly_uzs != null ? String(data.plan.price_yearly_uzs) : ''
                }
                value={deal.custom_price_yearly_uzs}
                onChange={(e) => setDeal({ ...deal, custom_price_yearly_uzs: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                <BadgePercent className="h-3.5 w-3.5" /> Chegirma, %
              </Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={deal.discount_percent}
                onChange={(e) => setDeal({ ...deal, discount_percent: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" /> Amal qilish muddati
              </Label>
              <Input
                type="date"
                value={deal.valid_until}
                onChange={(e) => setDeal({ ...deal, valid_until: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-4">
              <Label>Izoh (ichki)</Label>
              <Textarea
                rows={2}
                value={deal.note}
                placeholder="Masalan: 6 oylik shartnoma, dorixona sovg‘a sifatida"
                onChange={(e) => setDeal({ ...deal, note: e.target.value })}
              />
            </div>
            <p className="text-muted-foreground text-xs md:col-span-4">
              Klinika uchun amaldagi narx:{' '}
              <b className="text-foreground">{fmtUzs(dealPrice ?? planPrice)}</b> / oy. Muddat
              tugagach kelishuv avtomatik o‘chadi va tarif sozlamalari qaytadi.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Imkoniyatlar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Imkoniyatlar (tarif ustidan)</CardTitle>
          <p className="text-muted-foreground text-xs">
            “Tarif” — tarifdagi qiymat amal qiladi. “Ha”/“Yo‘q” — faqat shu klinika uchun. Sariq fon
            — o‘zgartirilgan maydon.
          </p>
        </CardHeader>
        <CardContent>
          <EntitlementsEditor
            mode="override"
            catalog={catalog}
            base={base}
            patch={patch}
            onChange={setPatch}
          />
        </CardContent>
      </Card>

      {/* Tarix */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <History className="text-muted-foreground h-4 w-4" />
          <CardTitle className="text-base">Tarix</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.history.length === 0 ? (
            <p className="text-muted-foreground px-4 pb-4 text-sm">O‘zgarish yo‘q</p>
          ) : (
            <ul className="divide-y text-sm">
              {data.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <Badge variant={h.action === 'reset' ? 'destructive' : 'outline'}>
                    {h.action === 'reset'
                      ? 'Tarifga qaytarildi'
                      : h.action === 'create'
                        ? 'Yaratildi'
                        : 'Yangilandi'}
                  </Badge>
                  <span className="text-muted-foreground ml-auto text-xs">
                    {new Date(h.created_at).toLocaleString('uz-UZ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div
        className={cn(
          'bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur transition-transform',
          dirty ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <span className="text-sm font-medium">{data.clinic.name}: saqlanmagan o‘zgarishlar</span>
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              setPatch(clone(data.override?.overrides ?? {}));
              setDeal(dealOf(data));
            }}
          >
            Bekor qilish
          </Button>
          <Button className="gap-1.5" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            <Save className="h-4 w-4" /> Saqlash
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Tarifga qaytarilsinmi?"
        description="Individual kelishuv (imkoniyatlar, maxsus narx, chegirma) o‘chiriladi va klinika tarif sozlamalari bilan ishlaydi."
        confirmLabel="Qaytarish"
        destructive
        loading={resetMut.isPending}
        onConfirm={() => resetMut.mutate()}
      />
    </div>
  );
}

function Usage({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const over = max != null && used > max;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-muted-foreground text-xs uppercase">{label}</div>
        <div className={cn('mt-1 text-lg font-semibold', over && 'text-destructive')}>
          {used}{' '}
          <span className="text-muted-foreground text-sm font-normal">/ {limitText(max)}</span>
        </div>
        {max != null && (
          <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
            <div
              className={cn(
                'h-full rounded-full',
                over ? 'bg-destructive' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500',
              )}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
