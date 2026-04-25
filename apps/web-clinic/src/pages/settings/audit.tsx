import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, Badge, EmptyState } from '@clary/ui-web';
import { ShieldCheck } from 'lucide-react';

import { api } from '@/lib/api';

export function SettingsAuditPage() {
  const { data: log } = useQuery({ queryKey: ['audit-settings'], queryFn: () => api.audit.settings({}) });
  const items = (log ?? []) as Array<{ id: string; table_name: string; operation: string; actor_role: string; created_at: string; current_hash: string }>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Settings Audit Log</h2>
        <Badge variant="success"><ShieldCheck className="mr-1 h-3 w-3" /> Hash zanjiri OK</Badge>
      </div>

      {items.length === 0 ? (
        <EmptyState title="Audit yozuvlari yo’q" />
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {items.map((e) => (
              <div key={e.id} className="p-4 space-y-1">
                <div className="flex justify-between">
                  <div className="font-mono text-sm">{e.table_name}.{e.operation}</div>
                  <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString('uz-UZ')}</span>
                </div>
                <div className="text-sm text-muted-foreground">{e.actor_role}</div>
                <div className="font-mono text-[10px] text-muted-foreground">hash: {e.current_hash.slice(0, 16)}…</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
