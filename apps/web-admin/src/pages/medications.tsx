import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pill, Search } from 'lucide-react';
import { Card, CardContent, EmptyState, Input } from '@clary/ui-web';

import { api } from '@/lib/api';

function fmtUzs(n: number) {
  return `${Math.round(n).toLocaleString('uz-UZ')} so‘m`;
}

export function MedicationsPage() {
  const [q, setQ] = useState('');
  const query = useQuery({
    queryKey: ['admin', 'medications', 'ranking'],
    queryFn: () => api.admin.medicationsRanking(200),
  });

  const filtered = useMemo(() => {
    const rows = query.data ?? [];
    if (!q.trim()) return rows;
    const s = q.toLowerCase();
    return rows.filter(
      (r) => r.name.toLowerCase().includes(s) || r.clinic_name.toLowerCase().includes(s),
    );
  }, [q, query.data]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dorilar (barcha klinika)</h1>
        <p className="text-sm text-muted-foreground">
          So&apos;nggi 30 kunda eng ko&apos;p sotilgan dorilar — klinikalar bo&apos;yicha daraja.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
          placeholder="Dori yoki klinika bo‘yicha qidirish…"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Pill className="h-8 w-8" />}
              title="Ma&apos;lumot yo&apos;q"
              description="Oxirgi 30 kun ichida sotuvlar hali yo&apos;q"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">#</th>
                    <th className="px-4 py-2.5">Dori</th>
                    <th className="px-4 py-2.5">Klinika</th>
                    <th className="px-4 py-2.5 text-right">Sotildi (dona)</th>
                    <th className="px-4 py-2.5 text-right">Tushum (UZS)</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={`${r.clinic_id}-${r.name}`} className="border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-2.5 font-medium">{r.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.clinic_name}</td>
                      <td className="px-4 py-2.5 text-right">{r.qty.toLocaleString('uz-UZ')}</td>
                      <td className="px-4 py-2.5 text-right">{fmtUzs(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
