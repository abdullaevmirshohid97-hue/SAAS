import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BedDouble, ArrowRight, LogIn, LogOut, Wallet } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@clary/ui-web';

import { api } from '@/lib/api';

function fmtUZS(n: number) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function InpatientDashboardCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dash-inpatient'],
    queryFn: () => api.inpatient.dashboard(),
    refetchInterval: 60_000,
  });

  const occupancyPct =
    data && data.total_rooms > 0
      ? Math.round((data.occupied_rooms / data.total_rooms) * 100)
      : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <BedDouble className="h-4 w-4 text-sky-600" />
          Statsionar
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link to="/inpatient">
            Batafsil <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Stat
              icon={<BedDouble className="h-3.5 w-3.5" />}
              label="Faol bemorlar"
              value={String(data.active_stays)}
            />
            <Stat
              icon={<BedDouble className="h-3.5 w-3.5" />}
              label="Palatalar"
              value={`${data.occupied_rooms}/${data.total_rooms}`}
              sub={`${occupancyPct}% band`}
            />
            <Stat
              icon={<LogIn className="h-3.5 w-3.5 text-emerald-600" />}
              label="Bugun qabul"
              value={String(data.today_admissions)}
            />
            <Stat
              icon={<LogOut className="h-3.5 w-3.5 text-amber-600" />}
              label="Bugun chiqarish"
              value={String(data.today_discharges)}
            />
            {data.total_outstanding_uzs > 0 && (
              <div className="col-span-2 flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                <Wallet className="h-3.5 w-3.5" />
                <span className="font-medium">Qarz: {fmtUZS(data.total_outstanding_uzs)} so'm</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
