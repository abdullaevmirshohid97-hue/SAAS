import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Search } from 'lucide-react';
import { Card, CardContent, EmptyState, Input, Badge } from '@clary/ui-web';

import { api } from '@/lib/api';

const MODALITY_LABELS: Record<string, string> = {
  xray: 'Rentgen',
  ultrasound: 'UZI',
  mri: 'MRT',
  ct: 'KT',
  ecg: 'EKG',
  echo: 'Ex-EKG',
  mammography: 'Mammografiya',
  fluoroscopy: 'Floroskopiya',
  dexa: 'DEXA',
  pet: 'PET-KT',
  endoscopy: 'Endoskopiya',
};

export function DiagnosticsPage() {
  const [q, setQ] = useState('');
  const [modality, setModality] = useState<string>('');
  const query = useQuery({
    queryKey: ['admin', 'diagnostics', 'popularity'],
    queryFn: () => api.admin.diagnosticsPopularity(),
  });

  const modalities = useMemo(() => {
    const set = new Set<string>();
    for (const r of query.data ?? []) set.add(r.modality);
    return Array.from(set).sort();
  }, [query.data]);

  const filtered = useMemo(() => {
    const rows = query.data ?? [];
    return rows.filter((r) => {
      if (modality && r.modality !== modality) return false;
      if (q && !`${r.name} ${r.clinic_name}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [q, modality, query.data]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Diagnostika aparatlari</h1>
        <p className="text-sm text-muted-foreground">
          30 kunlik faollik bo&apos;yicha ommabop apparatlar va klinika taqsimoti.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[260px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
            placeholder="Aparat yoki klinika bo‘yicha qidirish…"
          />
        </div>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={modality}
          onChange={(e) => setModality(e.target.value)}
        >
          <option value="">Barcha turlar</option>
          {modalities.map((m) => (
            <option key={m} value={m}>
              {MODALITY_LABELS[m] ?? m}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Activity className="h-8 w-8" />}
              title="Ma&apos;lumot yo&apos;q"
              description="Oxirgi 30 kun ichida diagnostika tekshiruvlari yo&apos;q"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">#</th>
                    <th className="px-4 py-2.5">Aparat</th>
                    <th className="px-4 py-2.5">Turi</th>
                    <th className="px-4 py-2.5">Klinika</th>
                    <th className="px-4 py-2.5 text-right">Buyurtmalar</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={r.equipment_id} className="border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-2.5 font-medium">{r.name}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline">{MODALITY_LABELS[r.modality] ?? r.modality}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.clinic_name}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{r.orders.toLocaleString('uz-UZ')}</td>
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
