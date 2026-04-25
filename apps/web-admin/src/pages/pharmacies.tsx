import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Pill } from 'lucide-react';
import { Badge, Card, CardContent, EmptyState } from '@clary/ui-web';

import { api } from '@/lib/api';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

export function PharmaciesPage() {
  const list = useQuery({
    queryKey: ['admin', 'pharmacies'],
    queryFn: () => api.admin.listPharmacies(),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dorixonalar</h1>
        <p className="text-sm text-muted-foreground">
          Har bir klinikaning dorixona holati va 30-kunlik savdosi
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {(list.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Pill className="h-8 w-8" />}
              title="Dorixona ma'lumotlari yo‘q"
              description="Klinikalar o‘z dorixona nomenklaturasini kiritganda bu yerda ko‘rinadi"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Klinika</th>
                    <th className="px-4 py-2.5 text-right">Dorilar</th>
                    <th className="px-4 py-2.5 text-right">Kam qoldiq</th>
                    <th className="px-4 py-2.5 text-right">30 kun savdo (so‘m)</th>
                  </tr>
                </thead>
                <tbody>
                  {(list.data ?? []).map((p) => (
                    <tr key={p.clinic_id} className="border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <Link to={`/tenants/${p.clinic_id}`} className="font-medium text-primary hover:underline">
                          {p.clinic_name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right">{fmt(p.medications_count)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {p.low_stock > 0 ? (
                          <Badge variant="warning">
                            <AlertTriangle className="mr-1 h-3 w-3" /> {p.low_stock}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">{fmt(p.sales_30d_uzs)}</td>
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
