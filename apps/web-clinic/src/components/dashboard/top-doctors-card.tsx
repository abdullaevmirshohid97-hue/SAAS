import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Stethoscope, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@clary/ui-web';

import { api } from '@/lib/api';

function fmtUZS(n: number) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function TopDoctorsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dash-top-doctors'],
    queryFn: () => api.analytics.doctors({ preset: '7d' }),
    refetchInterval: 120_000,
  });

  const top5 = (data ?? []).slice(0, 5);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Stethoscope className="h-4 w-4 text-blue-600" />
          TOP-5 shifokor (7 kun)
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link to="/analytics">
            Hammasi <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : top5.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            7 kun ichida ma'lumot yo'q
          </div>
        ) : (
          <ul className="space-y-2">
            {top5.map((d, i) => (
              <li key={d.doctor_id ?? i} className="flex items-center gap-3 text-sm">
                <span className="w-6 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="flex-1 truncate font-medium">{d.doctor_name}</span>
                <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                  {d.patients} bemor
                </span>
                <span className="w-20 text-right font-semibold tabular-nums">
                  {fmtUZS(d.revenue)} so'm
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
