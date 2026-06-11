import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardContent } from '@clary/ui-web';

import { api } from '@/lib/api';

type AuditTab = 'activity' | 'impersonations' | 'admin-actions';

export function AuditPage() {
  const [tab, setTab] = useState<AuditTab>('activity');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Audit</h1>
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
          {([
            { id: 'activity', label: 'Cross-tenant faollik' },
            { id: 'impersonations', label: 'Impersonatsiyalar' },
            { id: 'admin-actions', label: 'Admin amallari' },
          ] as const).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={
                'rounded-sm px-3 py-1.5 text-sm transition-colors ' +
                (tab === id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'activity' && <ActivityTab />}
      {tab === 'impersonations' && <ImpersonationsTab />}
      {tab === 'admin-actions' && <AdminActionsTab />}
    </div>
  );
}

function ActivityTab() {
  const { data } = useQuery({ queryKey: ['audit-cross'], queryFn: () => api.audit.settings({}) });
  const items = data as Array<{ id: string; table_name: string; operation: string; created_at: string; clinic_id: string }> ?? [];
  return (
    <Card><CardContent className="divide-y p-0">
      {items.map((e) => (
        <div key={e.id} className="p-3 font-mono text-xs">
          [{new Date(e.created_at).toISOString()}] {e.clinic_id.slice(0, 8)} {e.table_name}.{e.operation}
        </div>
      ))}
    </CardContent></Card>
  );
}

// Admin amallar auditi — barcha mutatsion /admin/* chaqiriqlar
// (kim, qaysi endpoint, payload qisqartmasi). Oxirgi 30 kun.
function AdminActionsTab() {
  const { data } = useQuery({
    queryKey: ['admin', 'admin-actions'],
    queryFn: () => api.admin.listAdminActions({ days: 30 }),
  });
  const items = data ?? [];

  const methodTone: Record<string, string> = {
    POST: 'bg-sky-100 text-sky-700',
    PATCH: 'bg-amber-100 text-amber-700',
    PUT: 'bg-amber-100 text-amber-700',
    DELETE: 'bg-rose-100 text-rose-700',
  };

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="p-3">Vaqt</th>
              <th className="p-3">Admin</th>
              <th className="p-3">Amal</th>
              <th className="p-3">Payload</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-b last:border-0">
                <td className="whitespace-nowrap p-3 text-xs text-muted-foreground">
                  {new Date(a.created_at).toLocaleString('uz-UZ', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </td>
                <td className="p-3 font-medium">{a.admin_name}</td>
                <td className="p-3">
                  <span className={'mr-2 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ' + (methodTone[a.method] ?? 'bg-muted')}>
                    {a.method}
                  </span>
                  <span className="font-mono text-xs">{a.path.replace('/api/v1/admin', '')}</span>
                </td>
                <td className="max-w-[300px] truncate p-3 font-mono text-[11px] text-muted-foreground">
                  {a.body_excerpt ?? '—'}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-sm text-muted-foreground">
                  Oxirgi 30 kunda yozuv yo&apos;q
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// Impersonatsiya tarixi — kim qachon qaysi klinikaga (qaysi user sifatida)
// kirgani; sabab majburiy bo'lgani uchun har qatorda ko'rinadi.
function ImpersonationsTab() {
  const { data } = useQuery({
    queryKey: ['admin', 'impersonations'],
    queryFn: () => api.admin.listImpersonations({ days: 90 }),
  });
  const items = data ?? [];

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="p-3">Vaqt</th>
              <th className="p-3">Admin</th>
              <th className="p-3">Klinika</th>
              <th className="p-3">Kirilgan user</th>
              <th className="p-3">Sabab</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="whitespace-nowrap p-3 text-xs text-muted-foreground">
                  {new Date(s.started_at).toLocaleString('uz-UZ', {
                    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </td>
                <td className="p-3 font-medium">{s.admin_name}</td>
                <td className="p-3">{s.clinic_name}</td>
                <td className="p-3">{s.target_name}</td>
                <td className="max-w-[320px] p-3 text-xs text-muted-foreground">
                  {s.reason}
                  {s.support_ticket_id && (
                    <Badge variant="outline" className="ml-2">ticket</Badge>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">
                  Oxirgi 90 kunda impersonatsiya bo&apos;lmagan
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
