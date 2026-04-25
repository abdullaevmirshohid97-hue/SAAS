import { useQuery } from '@tanstack/react-query';

import { Card, CardHeader, CardTitle, CardContent, Badge } from '@clary/ui-web';

import { api } from '@/lib/api';

export function DashboardPage() {
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ clinic?: { name?: string }; full_name?: string }>('/api/v1/auth/me') });
  const { data: queue } = useQuery({ queryKey: ['queue'], queryFn: () => api.queues.list() });
  const { data: appts } = useQuery({ queryKey: ['appts-today'], queryFn: () => api.appointments.list({ from: new Date().toISOString().slice(0, 10) }) });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Salom, {me?.full_name ?? 'mehmon'}!</h1>
        <p className="text-muted-foreground">{me?.clinic?.name ?? 'Clary v2'}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Navbatda</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{Array.isArray(queue) ? queue.length : 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Bugungi qabullar</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{Array.isArray(appts) ? appts.length : 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Faol xodimlar</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">—</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Bugungi tushum</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">— UZS</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Boshlash uchun <Badge variant="secondary">8/10</Badge></CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked readOnly /> Klinika profiling to’ldirildi</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked readOnly /> Birinchi xizmatni qo’shdingiz</label>
          <label className="flex items-center gap-2"><input type="checkbox" /> Birinchi xonani qo’shish</label>
          <label className="flex items-center gap-2"><input type="checkbox" /> Birinchi xodimni taklif qilish</label>
          <label className="flex items-center gap-2"><input type="checkbox" /> SMS provider ulanishi (Eskiz)</label>
          <label className="flex items-center gap-2"><input type="checkbox" /> To’lov provider ulanishi</label>
          <label className="flex items-center gap-2"><input type="checkbox" /> Birinchi bemorni qo’shish</label>
          <label className="flex items-center gap-2"><input type="checkbox" /> Tarifni tanlash</label>
        </CardContent>
      </Card>
    </div>
  );
}
