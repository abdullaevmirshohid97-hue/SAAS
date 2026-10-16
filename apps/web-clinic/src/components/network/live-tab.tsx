import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRightLeft,
  BedDouble,
  Clock,
  Lock,
  Pill,
  RefreshCw,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button, Card, CardContent, Input, Skeleton, StatCard } from '@clary/ui-web';
import type { NetworkLiveRow } from '@clary/api-client';

import { api } from '@/lib/api';
import { switchToBranch } from '@/components/branch-switcher';
import { BranchDot, fmt, todayTashkent } from './shared';

/** Tarmoq markazi — bugungi holat har filial bo'yicha (60 soniyada yangilanadi) */
export function LiveTab({ activeClinicId }: { activeClinicId: string }) {
  const [day, setDay] = useState(todayTashkent());
  const isToday = day === todayTashkent();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['company-live', day],
    queryFn: () => api.company.live(day),
    refetchInterval: isToday ? 60_000 : false,
  });
  const rows = data?.branches ?? [];
  const total = rows.reduce(
    (a, r) => ({
      money: a.money + Number(r.received_uzs) + Number(r.pharmacy_uzs),
      queue: a.queue + r.queue_total,
      waiting: a.waiting + r.queue_waiting,
      newp: a.newp + r.new_patients,
      safe: a.safe + Number(r.safe_uzs),
      cash: a.cash + Number(r.cash_uzs),
      debtors: a.debtors + Number(r.debtors_uzs),
      open: a.open + r.open_shifts,
    }),
    { money: 0, queue: 0, waiting: 0, newp: 0, safe: 0, cash: 0, debtors: 0, open: 0 },
  );
  const maxMoney = Math.max(1, ...rows.map((r) => Number(r.received_uzs) + Number(r.pharmacy_uzs)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={day}
          max={todayTashkent()}
          onChange={(e) => setDay(e.target.value || todayTashkent())}
          className="w-auto"
        />
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Yangilash
        </Button>
        {isToday && (
          <span className="text-muted-foreground text-xs">Har daqiqada avtomatik yangilanadi</span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Jami tushum (kassa + dorixona)"
          value={`${fmt(total.money)} so'm`}
          icon={<Wallet className="h-4 w-4" />}
          tone="success"
          loading={isLoading}
        />
        <StatCard
          label="Navbat (kutmoqda)"
          value={`${total.queue} (${total.waiting})`}
          icon={<Users className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatCard
          label="Kassa / seyf qoldig'i"
          value={`${fmt(total.cash)} / ${fmt(total.safe)}`}
          icon={<Lock className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatCard
          label="Bemorlar qarzi (jami)"
          value={`${fmt(total.debtors)} so'm`}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={total.debtors > 0 ? 'warning' : 'default'}
          loading={isLoading}
        />
      </div>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <BranchLiveCard
              key={r.clinic_id}
              row={r}
              share={(Number(r.received_uzs) + Number(r.pharmacy_uzs)) / maxMoney}
              isActive={r.clinic_id === activeClinicId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BranchLiveCard({
  row: r,
  share,
  isActive,
}: {
  row: NetworkLiveRow;
  share: number;
  isActive: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const money = Number(r.received_uzs) + Number(r.pharmacy_uzs);
  const warnings: string[] = [];
  if (r.open_shifts > 0) warnings.push(`${r.open_shifts} ta ochiq smena`);
  if (r.low_stock > 0) warnings.push(`${r.low_stock} dori kam qoldi`);
  if (r.expiring_30d > 0) warnings.push(`${r.expiring_30d} partiya muddati yaqin`);

  return (
    <Card className={isActive ? 'ring-primary/40 ring-2' : ''}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-semibold">
              <BranchDot id={r.clinic_id} color={r.branch_color} />
              <span className="truncate">{r.name}</span>
              {r.is_hq && (
                <span className="bg-primary/10 text-primary rounded px-1 text-[10px] font-semibold">
                  HQ
                </span>
              )}
            </div>
            {isActive && <div className="text-primary text-[11px]">Siz shu filialdasiz</div>}
          </div>
          {!isActive && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await switchToBranch(r.clinic_id);
                } catch (e) {
                  toast.error((e as Error).message);
                  setBusy(false);
                }
              }}
            >
              <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> O‘tish
            </Button>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground text-xs">Tushum</span>
            <span className="text-lg font-bold">{fmt(money)}</span>
          </div>
          <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${Math.max(2, Math.round(share * 100))}%` }}
            />
          </div>
          <div className="text-muted-foreground mt-1 flex justify-between text-[11px]">
            <span>kassa {fmt(r.received_uzs)}</span>
            <span>dorixona {fmt(r.pharmacy_uzs)}</span>
            {Number(r.debt_uzs) > 0 && (
              <span className="text-amber-600">qarzga {fmt(r.debt_uzs)}</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <Mini icon={<Clock className="h-3.5 w-3.5" />} label="Kutmoqda" value={r.queue_waiting} />
          <Mini icon={<Users className="h-3.5 w-3.5" />} label="Navbat" value={r.queue_total} />
          <Mini icon={<UserPlus className="h-3.5 w-3.5" />} label="Yangi" value={r.new_patients} />
          <Mini
            icon={<BedDouble className="h-3.5 w-3.5" />}
            label="Statsionar"
            value={r.inpatients}
          />
          <Mini icon={<Wallet className="h-3.5 w-3.5" />} label="Kassa" value={fmt(r.cash_uzs)} />
          <Mini icon={<Lock className="h-3.5 w-3.5" />} label="Seyf" value={fmt(r.safe_uzs)} />
        </div>

        {warnings.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {warnings.map((w) => (
              <span
                key={w}
                className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-400"
              >
                {w.includes('dori') || w.includes('partiya') ? (
                  <Pill className="h-3 w-3" />
                ) : (
                  <AlertTriangle className="h-3 w-3" />
                )}
                {w}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Mini({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="bg-muted/40 rounded-md px-1.5 py-1.5">
      <div className="text-muted-foreground flex items-center justify-center gap-1">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  );
}
