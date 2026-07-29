import { Building2, MapPin, Zap } from 'lucide-react';

import type { NurseTariff } from '@/lib/api';

interface Props {
  tariff: NurseTariff;
  onSelect: (tariff: NurseTariff) => void;
}

const SERVICE_LABELS: Record<string, string> = {
  injection: 'Ukol',
  iv_drip: 'Tomchi',
  dressing: "Bog'lam",
  wound_care: 'Yara parvarishi',
  vitals: "Ko'rsatkichlar",
  elderly_care: 'Qariyalar parvarishi',
  post_op_care: 'Operatsiyadan keyin',
  pediatric_care: 'Pediatrik',
  other: 'Boshqa',
};

export function NurseCard({ tariff, onSelect }: Props) {
  const label =
    tariff.name_i18n['uz-Latn'] ??
    tariff.name_i18n['uz'] ??
    SERVICE_LABELS[tariff.service] ??
    tariff.service;

  return (
    <div className="bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-sm transition-all duration-200 hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950">
          {tariff.clinic.logo_url ? (
            <img
              src={tariff.clinic.logo_url}
              alt={tariff.clinic.name}
              className="h-8 w-8 rounded-lg object-contain"
            />
          ) : (
            <Building2 className="h-5 w-5 text-blue-600" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{label}</h3>
          <p className="text-muted-foreground truncate text-xs">{tariff.clinic.name}</p>
          {tariff.clinic.city && (
            <span className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
              <MapPin className="h-3 w-3" />
              {tariff.clinic.city}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-foreground text-lg font-bold">
            {tariff.base_uzs.toLocaleString('uz-UZ')}{' '}
            <span className="text-muted-foreground text-sm font-normal">so'm</span>
          </p>
          {tariff.per_km_uzs > 0 && (
            <p className="text-muted-foreground text-xs">
              + {tariff.per_km_uzs.toLocaleString('uz-UZ')} so'm/km
            </p>
          )}
        </div>
        {tariff.urgent_bonus_uzs > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600 dark:bg-amber-950">
            <Zap className="h-3 w-3" />
            Tezkor mavjud
          </span>
        )}
      </div>

      <button
        onClick={() => onSelect(tariff)}
        className="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-xl py-2.5 text-sm font-semibold transition-colors"
      >
        Buyurtma berish
      </button>
    </div>
  );
}
