import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminEntitlementPlan, EntitlementsData } from '@clary/api-client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
  cn,
} from '@clary/ui-web';
import { AlertTriangle, ArrowLeft, Copy, History, Plus, Save, X } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/query-state';
import { EntitlementsEditor, Switch } from '@/components/entitlements/entitlements-editor';
import { clone, fmtUzs, planToPatch } from '@/components/entitlements/ent-utils';

// =============================================================================
// Tarif muharriri — asosiy ma'lumot, narx, limitlar va imkoniyatlar.
// Saqlanganda: tarifdagi barcha klinikalarga darhol ta'sir qiladi (individual
// kelishuvi bor klinikalarda kelishuv ustun), landing narxi sinxronlanadi,
// o'zgarish tarixga yoziladi.
// =============================================================================

interface Draft {
  name: string;
  price_uzs: string;
  price_yearly_uzs: string;
  max_staff: string;
  max_devices: string;
  max_patients: string;
  is_active: boolean;
  is_public: boolean;
  sort_order: string;
  description: string;
  highlights: string[];
  entitlements: EntitlementsData;
}

const toDraft = (p: AdminEntitlementPlan): Draft => ({
  name: p.name,
  price_uzs: String(p.price_uzs ?? 0),
  price_yearly_uzs: String(p.price_yearly_uzs ?? 0),
  max_staff: p.max_staff == null ? '' : String(p.max_staff),
  max_devices: p.max_devices == null ? '' : String(p.max_devices),
  max_patients: p.max_patients == null ? '' : String(p.max_patients),
  is_active: p.is_active,
  is_public: p.is_public,
  sort_order: String(p.sort_order ?? 0),
  description: p.description ?? '',
  highlights: [...(p.highlights ?? [])],
  entitlements: clone(p.entitlements),
});

const numOrNull = (s: string) => (s.trim() === '' ? null : Math.max(0, Math.floor(Number(s))));

export function PlanEditorPage() {
  const { code = '' } = useParams<{ code: string }>();
  const qc = useQueryClient();
  const plansQ = useQuery({
    queryKey: ['admin', 'entitlement-plans'],
    queryFn: () => api.admin.entitlementPlans(),
  });
  const catalogQ = useQuery({
    queryKey: ['admin', 'entitlements-catalog'],
    queryFn: () => api.admin.entitlementsCatalog(),
    staleTime: 10 * 60_000,
  });
  const historyQ = useQuery({
    queryKey: ['admin', 'entitlement-history', 'plan', code],
    queryFn: () => api.admin.entitlementHistory({ plan_code: code, limit: 20 }),
  });

  const plan = plansQ.data?.find((p) => p.code === code) ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newHighlight, setNewHighlight] = useState('');
  const original = useMemo(() => (plan ? toDraft(plan) : null), [plan]);

  useEffect(() => {
    if (plan) setDraft(toDraft(plan));
  }, [plan]);

  const dirty = !!draft && !!original && JSON.stringify(draft) !== JSON.stringify(original);

  const saveMut = useMutation({
    mutationFn: () => {
      const d = draft!;
      return api.admin.updateEntitlementPlan(code, {
        name: d.name.trim(),
        price_uzs: Number(d.price_uzs) || 0,
        price_yearly_uzs: Number(d.price_yearly_uzs) || 0,
        max_staff: numOrNull(d.max_staff),
        max_devices: numOrNull(d.max_devices),
        max_patients: numOrNull(d.max_patients),
        is_active: d.is_active,
        is_public: d.is_public,
        sort_order: Number(d.sort_order) || 0,
        description: d.description.trim() || null,
        highlights: d.highlights.map((h) => h.trim()).filter(Boolean),
        entitlements: planToPatch(d.entitlements),
      });
    },
    onSuccess: () => {
      toast.success('Tarif saqlandi — klinikalarga darhol amal qiladi');
      void qc.invalidateQueries({ queryKey: ['admin', 'entitlement-plans'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'entitlement-history'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyMut = useMutation({
    mutationFn: (from: string) => api.admin.copyEntitlementPlan(code, from),
    onSuccess: () => {
      toast.success('Imkoniyatlar nusxalandi');
      void qc.invalidateQueries({ queryKey: ['admin', 'entitlement-plans'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (plansQ.isLoading || catalogQ.isLoading) return <LoadingState />;
  if (plansQ.isError || catalogQ.isError) {
    return <ErrorState message={((plansQ.error ?? catalogQ.error) as Error)?.message} />;
  }
  if (!plan || !draft) {
    return <p className="text-muted-foreground py-12 text-center">Tarif topilmadi</p>;
  }
  const catalog = catalogQ.data!;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const others = (plansQ.data ?? []).filter((p) => p.code !== code);

  return (
    <div className="space-y-5 pb-20">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/plans">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold">{plan.name}</h1>
          <p className="text-muted-foreground text-sm">
            <span className="font-mono">{plan.code}</span> · {plan.clinics.total} ta klinika (
            {plan.clinics.active} faol)
          </p>
        </div>
        {others.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Copy className="text-muted-foreground h-4 w-4" />
            <select
              className="bg-background h-8 rounded-md border px-2 text-xs"
              value=""
              disabled={copyMut.isPending}
              onChange={(e) => {
                const from = e.target.value;
                if (
                  from &&
                  confirm(
                    `"${others.find((o) => o.code === from)?.name}" imkoniyatlarini shu tarifga ko‘chirasizmi? (narx va limitlar o‘zgarmaydi)`,
                  )
                ) {
                  copyMut.mutate(from);
                }
              }}
            >
              <option value="">Boshqa tarifdan nusxa…</option>
              {others.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {plan.clinics.total > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Bu tarifda <b>{plan.clinics.total}</b> ta klinika bor. Saqlangan o‘zgarish ularga darhol
            ta’sir qiladi (individual kelishuvi bor klinikalarda kelishuv ustun). Modulni yopish
            ma’lumotni o‘chirmaydi — faqat kirish yopiladi.
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Asosiy ma’lumot va narx</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nomi</Label>
                <Input value={draft.name} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Tartib (saytda)</Label>
                <Input
                  type="number"
                  value={draft.sort_order}
                  onChange={(e) => set('sort_order', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Oylik narx (so‘m)</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={draft.price_uzs}
                  onChange={(e) => set('price_uzs', e.target.value)}
                />
                <p className="text-muted-foreground text-[11px]">
                  {fmtUzs(Number(draft.price_uzs))}
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Yillik narx (so‘m)</Label>
                  <button
                    type="button"
                    className="text-primary text-[11px] hover:underline"
                    onClick={() =>
                      set(
                        'price_yearly_uzs',
                        String(Math.round((Number(draft.price_uzs) || 0) * 12 * 0.8)),
                      )
                    }
                  >
                    Avto: ×12 −20%
                  </button>
                </div>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={draft.price_yearly_uzs}
                  onChange={(e) => set('price_yearly_uzs', e.target.value)}
                />
                <p className="text-muted-foreground text-[11px]">
                  {fmtUzs(Number(draft.price_yearly_uzs))}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Qisqa tavsif (saytda)</Label>
              <Textarea
                rows={2}
                value={draft.description}
                placeholder="Masalan: kichik klinikalar uchun — qabulxona, kassa va dorixona"
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Afzalliklar ro‘yxati (saytdagi kartochkada)</Label>
              <div className="space-y-1.5">
                {draft.highlights.map((h, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={h}
                      onChange={(e) => {
                        const next = [...draft.highlights];
                        next[i] = e.target.value;
                        set('highlights', next);
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() =>
                        set(
                          'highlights',
                          draft.highlights.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input
                    value={newHighlight}
                    placeholder="Yangi qator, masalan: 10 tagacha filial"
                    onChange={(e) => setNewHighlight(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newHighlight.trim()) {
                        set('highlights', [...draft.highlights, newHighlight.trim()]);
                        setNewHighlight('');
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    disabled={!newHighlight.trim()}
                    onClick={() => {
                      set('highlights', [...draft.highlights, newHighlight.trim()]);
                      setNewHighlight('');
                    }}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Holat</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <label className="flex items-center justify-between gap-2">
                <span>
                  Faol
                  <span className="text-muted-foreground block text-xs">
                    Nofaol tarifni yangi klinika tanlay olmaydi
                  </span>
                </span>
                <Switch checked={draft.is_active} onChange={(v) => set('is_active', v)} />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span>
                  Saytda ko‘rinadi
                  <span className="text-muted-foreground block text-xs">clary.uz/pricing</span>
                </span>
                <Switch checked={draft.is_public} onChange={(v) => set('is_public', v)} />
              </label>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Limitlar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(
                [
                  ['max_staff', 'Xodimlar'],
                  ['max_devices', 'Qurilmalar'],
                  ['max_patients', 'Bemorlar'],
                ] as const
              ).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <Label className="text-sm">{label}</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="cheksiz"
                    className="h-8 w-28"
                    value={draft[k]}
                    onChange={(e) => set(k, e.target.value)}
                  />
                </div>
              ))}
              <p className="text-muted-foreground text-[11px]">Bo‘sh — cheksiz.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Imkoniyatlar</CardTitle>
        </CardHeader>
        <CardContent>
          <EntitlementsEditor
            mode="plan"
            catalog={catalog}
            value={draft.entitlements}
            onChange={(v) => set('entitlements', v)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <History className="text-muted-foreground h-4 w-4" />
          <CardTitle className="text-base">O‘zgarishlar tarixi</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(historyQ.data ?? []).length === 0 ? (
            <p className="text-muted-foreground px-4 pb-4 text-sm">Hali o‘zgarish yo‘q</p>
          ) : (
            <ul className="divide-y text-sm">
              {(historyQ.data ?? []).map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <Badge variant="outline">{h.action}</Badge>
                  <span>{h.actor_name ?? 'Super-admin'}</span>
                  <span className="text-muted-foreground ml-auto text-xs">
                    {new Date(h.created_at).toLocaleString('uz-UZ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Saqlash paneli — doim ko'rinadi */}
      <div
        className={cn(
          'bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur transition-transform',
          dirty ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <span className="text-sm font-medium">Saqlanmagan o‘zgarishlar bor</span>
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => original && setDraft(clone(original))}
          >
            Bekor qilish
          </Button>
          <Button className="gap-1.5" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            <Save className="h-4 w-4" /> Saqlash
          </Button>
        </div>
      </div>
    </div>
  );
}
