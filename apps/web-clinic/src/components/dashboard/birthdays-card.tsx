import { useQuery } from '@tanstack/react-query';
import { Cake, Phone } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@clary/ui-web';

import { api } from '@/lib/api';

function fmtBirthday(iso: string, daysUntil: number) {
  if (daysUntil === 0) return 'Bugun!';
  if (daysUntil === 1) return 'Ertaga';
  const d = new Date(iso);
  return d.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long' });
}

export function BirthdaysCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dash-birthdays'],
    queryFn: () => api.analytics.upcomingBirthdays(7),
    refetchInterval: 10 * 60_000,
  });

  const list = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cake className="h-4 w-4 text-pink-600" />
          Tug'ilgan kunlar (7 kun)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : list.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Yaqin 7 kunda tug'ilgan kun yo'q
          </div>
        ) : (
          <ul className="space-y-2 max-h-64 overflow-y-auto">
            {list.slice(0, 10).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.full_name ?? '—'}</div>
                  {p.phone && (
                    <a
                      href={`tel:${p.phone}`}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                    >
                      <Phone className="h-3 w-3" />
                      {p.phone}
                    </a>
                  )}
                </div>
                <span
                  className={
                    p.days_until === 0
                      ? 'rounded-full bg-pink-100 px-2 py-0.5 text-xs font-medium text-pink-700'
                      : 'text-xs text-muted-foreground'
                  }
                >
                  {fmtBirthday(p.next_birthday, p.days_until)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
