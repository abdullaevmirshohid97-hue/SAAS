import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertCircle, Phone, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@clary/ui-web';

import { api } from '@/lib/api';

function fmtUZS(n: number) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function TopDebtorsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dash-top-debtors'],
    queryFn: () => api.cashier.topDebtors(5),
    refetchInterval: 120_000,
  });

  const debtors = data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertCircle className="h-4 w-4 text-rose-600" />
          TOP-5 qarzdor bemor
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link to="/cashier">
            Hammasi <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : debtors.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Qarzdor bemorlar yo'q ✓
          </div>
        ) : (
          <ul className="space-y-2">
            {debtors.map((d, i) => (
              <li key={d.patient_id} className="flex items-center gap-2 text-sm">
                <span className="w-6 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.full_name ?? '—'}</div>
                  {d.phone && (
                    <a
                      href={`tel:${d.phone}`}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                    >
                      <Phone className="h-3 w-3" />
                      {d.phone}
                    </a>
                  )}
                </div>
                <span className="text-right font-semibold tabular-nums text-rose-700">
                  {fmtUZS(d.debt_uzs)} so'm
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
