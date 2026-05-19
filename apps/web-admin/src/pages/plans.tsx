import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input, Label } from '@clary/ui-web';
import { Save } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

type Plan = {
  id: string;
  code: string;
  name: string;
  price_uzs: number | null;
  price_yearly_uzs: number | null;
  max_staff: number | null;
  max_devices: number | null;
  max_patients: number | null;
  is_active: boolean;
};

const fmt = (n: number | null) =>
  n == null ? '—' : Number(n).toLocaleString('uz-UZ');

export function PlansPage() {
  const { data } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: () => api.admin.listPlans(),
  });
  const plans = (data ?? []) as Plan[];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Tariflar</h1>
        <p className="text-sm text-muted-foreground">
          Tarif narxlari va cheklovlarini boshqarish. Saqlash bosilgandan
          keyin landing/clinic pricing avtomatik yangilanadi.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {plans.map((p) => (
          <PlanCard key={p.code} plan={p} />
        ))}
      </div>
    </div>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const qc = useQueryClient();
  const [name, setName] = useState(plan.name);
  const [priceUzs, setPriceUzs] = useState(String(plan.price_uzs ?? 0));
  const [priceYearly, setPriceYearly] = useState(String(plan.price_yearly_uzs ?? 0));
  const [maxStaff, setMaxStaff] = useState(plan.max_staff == null ? '' : String(plan.max_staff));
  const [maxDevices, setMaxDevices] = useState(
    plan.max_devices == null ? '' : String(plan.max_devices),
  );
  const [maxPatients, setMaxPatients] = useState(
    plan.max_patients == null ? '' : String(plan.max_patients),
  );
  const [isActive, setIsActive] = useState(plan.is_active);

  // Server'dan kelgan qiymatlar yangilanganda inputlarni qaytarib sinxronlash.
  useEffect(() => {
    setName(plan.name);
    setPriceUzs(String(plan.price_uzs ?? 0));
    setPriceYearly(String(plan.price_yearly_uzs ?? 0));
    setMaxStaff(plan.max_staff == null ? '' : String(plan.max_staff));
    setMaxDevices(plan.max_devices == null ? '' : String(plan.max_devices));
    setMaxPatients(plan.max_patients == null ? '' : String(plan.max_patients));
    setIsActive(plan.is_active);
  }, [plan]);

  const saveMut = useMutation({
    mutationFn: () =>
      api.admin.updatePlan(plan.code, {
        name,
        price_uzs: Number(priceUzs) || 0,
        price_yearly_uzs: Number(priceYearly) || 0,
        max_staff: maxStaff === '' ? null : Number(maxStaff),
        max_devices: maxDevices === '' ? null : Number(maxDevices),
        max_patients: maxPatients === '' ? null : Number(maxPatients),
        is_active: isActive,
      }),
    onSuccess: () => {
      toast.success('Saqlandi');
      qc.invalidateQueries({ queryKey: ['admin', 'plans'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Yillik narxni avtomatik tavsiya etish (oylik × 12 × 0.8).
  function suggestYearly() {
    const monthly = Number(priceUzs) || 0;
    setPriceYearly(String(Math.round(monthly * 12 * 0.8)));
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{plan.code}</Badge>
            {isActive ? (
              <Badge variant="success">Faol</Badge>
            ) : (
              <Badge variant="destructive">Nofaol</Badge>
            )}
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Faol
          </label>
        </div>

        <div className="space-y-1.5">
          <Label>Nom</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Oylik narx (so‘m)</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={priceUzs}
              onChange={(e) => setPriceUzs(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">{fmt(Number(priceUzs))} so‘m</p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Yillik narx (so‘m)</Label>
              <button
                type="button"
                onClick={suggestYearly}
                className="text-[10px] text-primary hover:underline"
              >
                Avto: ×12×0.8
              </button>
            </div>
            <Input
              type="number"
              inputMode="numeric"
              value={priceYearly}
              onChange={(e) => setPriceYearly(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">{fmt(Number(priceYearly))} so‘m</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5">
            <Label>Max xodim</Label>
            <Input
              type="number"
              placeholder="cheksiz"
              value={maxStaff}
              onChange={(e) => setMaxStaff(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Max qurilma</Label>
            <Input
              type="number"
              placeholder="cheksiz"
              value={maxDevices}
              onChange={(e) => setMaxDevices(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Max bemor</Label>
            <Input
              type="number"
              placeholder="cheksiz"
              value={maxPatients}
              onChange={(e) => setMaxPatients(e.target.value)}
            />
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Bo‘sh qoldirilsa — cheksiz.
        </p>

        <Button
          className="w-full gap-1.5"
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
        >
          <Save className="h-4 w-4" />
          Saqlash
        </Button>
      </CardContent>
    </Card>
  );
}
