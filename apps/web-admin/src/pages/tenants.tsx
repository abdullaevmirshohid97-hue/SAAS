import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, Badge } from '@clary/ui-web';

import { api } from '@/lib/api';

export function TenantsPage() {
  const { data } = useQuery({ queryKey: ['tenants'], queryFn: () => api.get<Array<{ id: string; name: string; slug: string; current_plan: string; subscription_status: string; is_suspended: boolean }>>('/api/v1/admin/tenants') });
  const tenants = data ?? [];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Tenants</h1>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr><th className="p-3">Name</th><th className="p-3">Plan</th><th className="p-3">Status</th></tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-accent/50">
                  <td className="p-3">
                    <Link to={`/tenants/${t.id}`} className="font-medium text-primary">{t.name}</Link>
                    <div className="text-xs text-muted-foreground">{t.slug}</div>
                  </td>
                  <td className="p-3"><Badge variant="outline">{t.current_plan}</Badge></td>
                  <td className="p-3">
                    {t.is_suspended ? <Badge variant="destructive">Suspended</Badge> : <Badge variant="success">{t.subscription_status}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
