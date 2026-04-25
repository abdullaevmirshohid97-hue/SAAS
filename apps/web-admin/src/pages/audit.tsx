import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@clary/ui-web';

import { api } from '@/lib/api';

export function AuditPage() {
  const { data } = useQuery({ queryKey: ['audit-cross'], queryFn: () => api.audit.settings({}) });
  const items = data as Array<{ id: string; table_name: string; operation: string; created_at: string; clinic_id: string }> ?? [];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Cross-tenant audit</h1>
      <Card><CardContent className="divide-y p-0">
        {items.map((e) => (
          <div key={e.id} className="p-3 font-mono text-xs">
            [{new Date(e.created_at).toISOString()}] {e.clinic_id.slice(0, 8)} {e.table_name}.{e.operation}
          </div>
        ))}
      </CardContent></Card>
    </div>
  );
}
