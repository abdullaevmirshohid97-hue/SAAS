import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Card, CardHeader, CardTitle, CardContent, Badge } from '@clary/ui-web';

import { api } from '@/lib/api';

export function DashboardPage() {
  const { t } = useTranslation();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ clinic?: { name?: string }; full_name?: string }>('/api/v1/auth/me') });
  const { data: queue } = useQuery({ queryKey: ['queue'], queryFn: () => api.queues.list() });
  const { data: appts } = useQuery({ queryKey: ['appts-today'], queryFn: () => api.appointments.list({ from: new Date().toISOString().slice(0, 10) }) });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('dashboard.greeting')}, {me?.full_name ?? ''}!</h1>
        <p className="text-muted-foreground">{me?.clinic?.name ?? 'Clary'}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">{t('dashboard.inQueue')}</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{Array.isArray(queue) ? queue.length : 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">{t('dashboard.todayAppointments')}</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{Array.isArray(appts) ? appts.length : 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">{t('dashboard.activeStaff')}</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">—</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">{t('dashboard.todayRevenue')}</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">— UZS</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('dashboard.gettingStarted')} <Badge variant="secondary">8/10</Badge></CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked readOnly /> {t('dashboard.setupClinicProfile')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked readOnly /> {t('dashboard.addFirstService')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" /> {t('dashboard.addFirstRoom')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" /> {t('dashboard.inviteFirstStaff')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" /> {t('dashboard.connectSms')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" /> {t('dashboard.connectPayment')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" /> {t('dashboard.addFirstPatient')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" /> {t('dashboard.selectPlan')}</label>
        </CardContent>
      </Card>
    </div>
  );
}
