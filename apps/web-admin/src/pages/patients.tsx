import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Users, Clock, Pill, Activity, Stethoscope, Wallet, Home } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
} from '@clary/ui-web';

import { api } from '@/lib/api';

function fmtDate(v?: string | null) {
  if (!v) return '-';
  try {
    return new Date(v).toLocaleString('uz-UZ');
  } catch {
    return String(v);
  }
}

function ageFromBirthDate(v?: string | null) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

export function PatientsPage() {
  const [q, setQ] = useState('');
  const [clinicId, setClinicId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const clinics = useQuery({
    queryKey: ['admin', 'tenants', ''],
    queryFn: () => api.admin.listTenants(),
  });

  const patients = useQuery({
    queryKey: ['admin', 'patients', q, clinicId],
    queryFn: () => api.admin.listPatients({ q: q || undefined, clinic_id: clinicId || undefined, limit: 100 }),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bemorlar (global)</h1>
        <p className="text-sm text-muted-foreground">
          Barcha klinikalar bo&apos;yicha bemorlar. Har bir ochish audit jurnalga yoziladi.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[260px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
            placeholder="Ism yoki telefon bo‘yicha qidirish…"
          />
        </div>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={clinicId}
          onChange={(e) => setClinicId(e.target.value)}
        >
          <option value="">Barcha klinikalar</option>
          {(clinics.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="flex items-center px-2 text-sm text-muted-foreground">
          Jami: <span className="ml-1 font-medium text-foreground">{patients.data?.total ?? 0}</span>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {(patients.data?.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title="Bemorlar topilmadi"
              description="Filtrni o‘zgartiring yoki qidiruvni kengaytiring"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Bemor</th>
                    <th className="px-4 py-2.5">Klinika</th>
                    <th className="px-4 py-2.5">Telefon</th>
                    <th className="px-4 py-2.5">Yosh</th>
                    <th className="px-4 py-2.5">Ro&apos;yxatga olingan</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {(patients.data?.data ?? []).map((p) => (
                    <tr key={p.id} className="border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{p.full_name}</div>
                        <div className="text-xs text-muted-foreground">
                          <Badge variant="outline">{p.gender ?? 'n/a'}</Badge>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{p.clinic?.name ?? '-'}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{p.phone ?? '-'}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{ageFromBirthDate(p.birth_date) ?? '-'}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(p.created_at)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Button size="sm" variant="outline" onClick={() => setSelectedId(p.id)}>
                          Timeline
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedId && (
        <PatientTimelineDrawer id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

function PatientTimelineDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['admin', 'patient-timeline', id],
    queryFn: () => api.admin.patientTimeline(id),
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-[880px] flex-col overflow-hidden border-l bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <div className="text-sm uppercase tracking-wider text-muted-foreground">Bemor timeline</div>
            <div className="text-lg font-semibold">{q.data?.patient?.full_name ?? '…'}</div>
            <div className="text-xs text-muted-foreground">
              {q.data?.patient?.clinic?.name} • tel: {q.data?.patient?.phone ?? '-'}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Yopish
          </Button>
        </div>

        {q.isLoading ? (
          <div className="flex-1 p-6 text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : q.error ? (
          <div className="flex-1 p-6 text-sm text-destructive">Xato: {(q.error as Error).message}</div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            <TimelineSection
              icon={<Clock className="h-4 w-4" />}
              title="Qabullar"
              rows={(q.data?.appointments ?? []) as Array<Record<string, unknown>>}
              render={(r) => `${(r.scheduled_at as string) ?? ''} — ${(r.status as string) ?? ''}`}
            />
            <TimelineSection
              icon={<Stethoscope className="h-4 w-4" />}
              title="Tahlillar"
              rows={(q.data?.lab_orders ?? []) as Array<Record<string, unknown>>}
              render={(r) => `${(r.created_at as string) ?? ''} — ${(r.status as string) ?? ''}`}
            />
            <TimelineSection
              icon={<Pill className="h-4 w-4" />}
              title="Retseptlar"
              rows={(q.data?.prescriptions ?? []) as Array<Record<string, unknown>>}
              render={(r) => `${(r.issued_at as string) ?? ''} — ${(r.status as string) ?? ''}`}
            />
            <TimelineSection
              icon={<Activity className="h-4 w-4" />}
              title="Diagnostika"
              rows={(q.data?.diagnostic_orders ?? []) as Array<Record<string, unknown>>}
              render={(r) => `${(r.created_at as string) ?? ''} — ${(r.status as string) ?? ''}`}
            />
            <TimelineSection
              icon={<Wallet className="h-4 w-4" />}
              title="To&apos;lovlar"
              rows={(q.data?.transactions ?? []) as Array<Record<string, unknown>>}
              render={(r) => `${(r.created_at as string) ?? ''} — ${(r.method as string) ?? ''}: ${(r.amount_uzs as number) ?? 0} so&apos;m`}
            />
            <TimelineSection
              icon={<Home className="h-4 w-4" />}
              title="Uyga chaqiruvlar (hamshira)"
              rows={(q.data?.home_nurse_visits ?? []) as Array<Record<string, unknown>>}
              render={(r) => `${(r.scheduled_at as string) ?? ''} — ${(r.status as string) ?? ''}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineSection({
  title,
  icon,
  rows,
  render,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Array<Record<string, unknown>>;
  render: (r: Record<string, unknown>) => string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
          <span className="text-xs font-normal text-muted-foreground">({rows.length})</span>
        </div>
        {rows.length === 0 ? (
          <div className="mt-2 text-xs text-muted-foreground">Ma&apos;lumot yo&apos;q</div>
        ) : (
          <ul className="mt-2 space-y-1 text-xs">
            {rows.slice(0, 30).map((r, i) => (
              <li key={i} className="rounded border-l-2 border-primary/40 bg-muted/30 px-2 py-1">
                {render(r)}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
