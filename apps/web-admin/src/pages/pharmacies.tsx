import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Pill } from 'lucide-react';
import { Badge, Card, CardContent, EmptyState } from '@clary/ui-web';

import { api } from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/query-state';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

export function PharmaciesPage() {
  const list = useQuery({
    queryKey: ['admin', 'pharmacies'],
    queryFn: () => api.admin.listPharmacies(),
  });
  const subs = useQuery({
    queryKey: ['admin', 'pharmacy-subscriptions'],
    queryFn: () => api.admin.pharmacySubscriptions(),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dorixonalar</h1>
        <p className="text-muted-foreground text-sm">
          Har bir klinikaning dorixona holati va 30-kunlik savdosi
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Alohida dorixona obunalari</div>
              <div className="text-muted-foreground text-xs">
                Klinikaga biriktirish: Klinika → Batafsil → "Dorixona" tabi (300 000 so‘m/oy, 3
                qurilma)
              </div>
            </div>
          </div>
          {subs.isLoading ? (
            <LoadingState />
          ) : subs.isError ? (
            <ErrorState message={(subs.error as Error)?.message} onRetry={() => subs.refetch()} />
          ) : (subs.data ?? []).length === 0 ? (
            <div className="text-muted-foreground text-sm">
              Hali birorta klinikaga alohida dorixona biriktirilmagan.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-muted-foreground border-b text-left text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2">Klinika</th>
                    <th className="px-3 py-2">Holat</th>
                    <th className="px-3 py-2">Tugash</th>
                    <th className="px-3 py-2 text-right">Qolgan kun</th>
                    <th className="px-3 py-2">Akkaunt</th>
                    <th className="px-3 py-2 text-right">Narx</th>
                    <th className="px-3 py-2 text-right">Qurilma</th>
                  </tr>
                </thead>
                <tbody>
                  {(subs.data ?? []).map((s) => (
                    <tr key={s.id} className="hover:bg-muted/20 border-b last:border-b-0">
                      <td className="px-3 py-2">
                        <Link
                          to={`/tenants/${s.clinic_id}/manage`}
                          className="text-primary font-medium hover:underline"
                        >
                          {s.clinic?.name ?? s.clinic_id}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            s.active ? 'success' : s.status === 'suspended' ? 'warning' : 'outline'
                          }
                        >
                          {s.active
                            ? 'Faol'
                            : s.status === 'suspended'
                              ? "To'xtatilgan"
                              : s.status === 'canceled'
                                ? 'Bekor'
                                : 'Tugagan'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {new Date(s.ends_at).toLocaleDateString('uz-UZ')}
                      </td>
                      <td
                        className={`px-3 py-2 text-right ${s.active && s.days_left <= 5 ? 'font-semibold text-amber-600' : ''}`}
                      >
                        {s.days_left}
                      </td>
                      <td className="px-3 py-2 text-xs">{s.account_email ?? '—'}</td>
                      <td className="px-3 py-2 text-right">{fmt(s.price_uzs)}</td>
                      <td className="px-3 py-2 text-right">{s.max_devices}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {list.isLoading ? (
            <LoadingState />
          ) : list.isError ? (
            <ErrorState message={(list.error as Error)?.message} onRetry={() => list.refetch()} />
          ) : (list.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Pill className="h-8 w-8" />}
              title="Dorixona ma'lumotlari yo‘q"
              description="Klinikalar o‘z dorixona nomenklaturasini kiritganda bu yerda ko‘rinadi"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-muted-foreground border-b text-left text-xs uppercase">
                  <tr>
                    <th className="px-4 py-2.5">Klinika</th>
                    <th className="px-4 py-2.5 text-right">Dorilar</th>
                    <th className="px-4 py-2.5 text-right">Kam qoldiq</th>
                    <th className="px-4 py-2.5 text-right">30 kun savdo (so‘m)</th>
                  </tr>
                </thead>
                <tbody>
                  {(list.data ?? []).map((p) => (
                    <tr key={p.clinic_id} className="hover:bg-muted/20 border-b last:border-b-0">
                      <td className="px-4 py-2.5">
                        <Link
                          to={`/tenants/${p.clinic_id}`}
                          className="text-primary font-medium hover:underline"
                        >
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
