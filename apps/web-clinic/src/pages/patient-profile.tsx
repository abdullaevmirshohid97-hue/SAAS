import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, CalendarDays, FlaskConical, Pill, Receipt, Bed } from 'lucide-react';
import {
  PageHeader,
  StatCard,
  Card,
  CardContent,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  EmptyState,
  DataTable,
  Badge,
} from '@clary/ui-web';

import { api } from '@/lib/api';

// =============================================================================
// Bemor profili — /patient/:id. Bitta sahifada bemor tarixi: tashriflar,
// tahlillar, retseptlar, to'lovlar, statsionar. patients.timeline endpoint'idan.
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

function fmtDate(v: unknown): string {
  if (!v || typeof v !== 'string') return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('uz-UZ', { year: 'numeric', month: 'short', day: 'numeric' });
}

function calcAge(dob: string | null): string {
  if (!dob) return '—';
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return '—';
  const age = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
  return `${age} yosh`;
}

export function PatientProfilePage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['patient-profile', id],
    queryFn: () => api.patients.timeline(id!),
    enabled: !!id,
  });

  const patient = data?.patient;
  const summary = data?.summary;

  return (
    <div className="space-y-5">
      <PageHeader
        title={patient?.full_name ?? 'Bemor'}
        description={
          patient
            ? `${calcAge(patient.dob)} · ${patient.gender === 'male' ? 'Erkak' : patient.gender === 'female' ? 'Ayol' : '—'} · ${patient.phone ?? '—'}`
            : 'Yuklanmoqda…'
        }
        breadcrumbs={[
          { label: 'Bemorlar', href: '/reception' },
          { label: patient?.full_name ?? 'Bemor' },
        ]}
        actions={
          <Link
            to="/reception"
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" /> Orqaga
          </Link>
        }
      />

      {/* Summary KPI */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Tashriflar"
          value={String(summary?.visits ?? 0)}
          icon={<CalendarDays className="h-4 w-4" />}
        />
        <StatCard
          label="Tahlillar"
          value={String(summary?.lab_orders ?? 0)}
          icon={<FlaskConical className="h-4 w-4" />}
        />
        <StatCard
          label="Retseptlar"
          value={String(summary?.prescriptions ?? 0)}
          icon={<Pill className="h-4 w-4" />}
        />
        <StatCard
          label="Statsionar"
          value={String(summary?.stays ?? 0)}
          icon={<Bed className="h-4 w-4" />}
        />
        <StatCard
          label="Jami to'lov"
          value={`${fmt(summary?.total_spent_uzs ?? 0)} so'm`}
          icon={<Receipt className="h-4 w-4" />}
          tone="success"
        />
      </div>

      <Card>
        <CardContent className="p-4">
          <Tabs defaultValue="visits">
            <TabsList>
              <TabsTrigger value="visits">Tashriflar</TabsTrigger>
              <TabsTrigger value="labs">Tahlillar</TabsTrigger>
              <TabsTrigger value="prescriptions">Retseptlar</TabsTrigger>
              <TabsTrigger value="payments">To'lovlar</TabsTrigger>
              <TabsTrigger value="inpatient">Statsionar</TabsTrigger>
            </TabsList>

            <TabsContent value="visits">
              <DataTable
                isLoading={isLoading}
                rows={data?.appointments ?? []}
                rowKey={(r) => String((r as { id?: string }).id ?? Math.random())}
                emptyState={<EmptyState title="Tashrif yo'q" description="Bemorda tashrif yozuvi yo'q" />}
                columns={[
                  {
                    key: 'scheduled_at',
                    header: 'Sana',
                    render: (r) => fmtDate((r as Record<string, unknown>).scheduled_at),
                  },
                  {
                    key: 'service_name_snapshot',
                    header: 'Xizmat',
                    render: (r) => String((r as Record<string, unknown>).service_name_snapshot ?? '—'),
                  },
                  {
                    key: 'status',
                    header: 'Holat',
                    render: (r) => (
                      <Badge variant="secondary">
                        {String((r as Record<string, unknown>).status ?? '—')}
                      </Badge>
                    ),
                  },
                ]}
              />
            </TabsContent>

            <TabsContent value="labs">
              <DataTable
                isLoading={isLoading}
                rows={data?.lab_orders ?? []}
                rowKey={(r) => String((r as { id?: string }).id ?? Math.random())}
                emptyState={<EmptyState title="Tahlil yo'q" description="Bemorda tahlil buyurtmasi yo'q" />}
                columns={[
                  {
                    key: 'created_at',
                    header: 'Sana',
                    render: (r) => fmtDate((r as Record<string, unknown>).created_at),
                  },
                  {
                    key: 'status',
                    header: 'Holat',
                    render: (r) => (
                      <Badge variant="secondary">
                        {String((r as Record<string, unknown>).status ?? '—')}
                      </Badge>
                    ),
                  },
                  {
                    key: 'total_uzs',
                    header: 'Summa',
                    align: 'right',
                    render: (r) =>
                      `${fmt(Number((r as Record<string, unknown>).total_uzs ?? 0))} so'm`,
                  },
                ]}
              />
            </TabsContent>

            <TabsContent value="prescriptions">
              <DataTable
                isLoading={isLoading}
                rows={data?.prescriptions ?? []}
                rowKey={(r) => String((r as { id?: string }).id ?? Math.random())}
                emptyState={<EmptyState title="Retsept yo'q" description="Bemorda retsept yozuvi yo'q" />}
                columns={[
                  {
                    key: 'created_at',
                    header: 'Sana',
                    render: (r) => fmtDate((r as Record<string, unknown>).created_at),
                  },
                  {
                    key: 'rx_number',
                    header: 'Retsept №',
                    render: (r) => String((r as Record<string, unknown>).rx_number ?? '—'),
                  },
                  {
                    key: 'status',
                    header: 'Holat',
                    render: (r) => (
                      <Badge variant="secondary">
                        {String((r as Record<string, unknown>).status ?? '—')}
                      </Badge>
                    ),
                  },
                ]}
              />
            </TabsContent>

            <TabsContent value="payments">
              <DataTable
                isLoading={isLoading}
                rows={data?.transactions ?? []}
                rowKey={(r) => String((r as { id?: string }).id ?? Math.random())}
                emptyState={<EmptyState title="To'lov yo'q" description="Bemorda to'lov yozuvi yo'q" />}
                columns={[
                  {
                    key: 'created_at',
                    header: 'Sana',
                    render: (r) => fmtDate((r as Record<string, unknown>).created_at),
                  },
                  {
                    key: 'kind',
                    header: 'Turi',
                    render: (r) => String((r as Record<string, unknown>).kind ?? '—'),
                  },
                  {
                    key: 'amount_uzs',
                    header: 'Summa',
                    align: 'right',
                    render: (r) =>
                      `${fmt(Number((r as Record<string, unknown>).amount_uzs ?? 0))} so'm`,
                  },
                ]}
              />
            </TabsContent>

            <TabsContent value="inpatient">
              <DataTable
                isLoading={isLoading}
                rows={data?.inpatient_stays ?? []}
                rowKey={(r) => String((r as { id?: string }).id ?? Math.random())}
                emptyState={<EmptyState title="Statsionar yo'q" description="Bemorda statsionar yozuvi yo'q" />}
                columns={[
                  {
                    key: 'admitted_at',
                    header: 'Yotqizilgan',
                    render: (r) => fmtDate((r as Record<string, unknown>).admitted_at),
                  },
                  {
                    key: 'discharged_at',
                    header: 'Chiqarilgan',
                    render: (r) => fmtDate((r as Record<string, unknown>).discharged_at),
                  },
                  {
                    key: 'status',
                    header: 'Holat',
                    render: (r) => (
                      <Badge variant="secondary">
                        {String((r as Record<string, unknown>).status ?? '—')}
                      </Badge>
                    ),
                  },
                ]}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
