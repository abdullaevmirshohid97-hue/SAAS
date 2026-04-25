import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  CalendarRange,
  Download,
  Filter,
  User,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';

type ActivityEntry = {
  id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  summary_i18n: Record<string, string> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor: { full_name: string; role: string } | null;
};

const ACTION_GROUPS: Array<{ id: string; label: string; prefix: string }> = [
  { id: 'reception', label: 'Qabul', prefix: 'reception' },
  { id: 'queue', label: 'Navbat', prefix: 'queue' },
  { id: 'prescription', label: 'Retsept', prefix: 'prescription' },
  { id: 'referral', label: 'Yo‘llanma', prefix: 'referral' },
  { id: 'pharmacy', label: 'Dorixona', prefix: 'pharmacy' },
  { id: 'lab', label: 'Laboratoriya', prefix: 'lab' },
  { id: 'inpatient', label: 'Statsionar', prefix: 'inpatient' },
  { id: 'cashier', label: 'Kassa', prefix: 'cashier' },
  { id: 'staff', label: 'Xodim', prefix: 'staff' },
  { id: 'patient', label: 'Bemor', prefix: 'patient' },
];

export function JournalPage() {
  const qc = useQueryClient();
  const [actionPrefix, setActionPrefix] = useState<string>('');
  const [from, setFrom] = useState<string>(() =>
    new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [actorQuery, setActorQuery] = useState('');
  const [openPatient, setOpenPatient] = useState<string | null>(null);

  const params = useMemo(
    () => ({
      from: from ? `${from}T00:00:00.000Z` : undefined,
      to: to ? `${to}T23:59:59.999Z` : undefined,
      action: actionPrefix || undefined,
      limit: 500,
    }),
    [from, to, actionPrefix],
  );

  const { data } = useQuery({
    queryKey: ['activity', params],
    queryFn: () => api.audit.activity(params),
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    const rows = (data ?? []) as ActivityEntry[];
    if (!actorQuery.trim()) return rows;
    const q = actorQuery.toLowerCase();
    return rows.filter((r) => (r.actor?.full_name ?? '').toLowerCase().includes(q));
  }, [data, actorQuery]);

  useEffect(() => {
    const ch = supabase
      .channel('activity')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activity_journal' },
        () => {
          qc.invalidateQueries({ queryKey: ['activity'] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const exportHref = api.audit.activityCsvUrl({ ...params, limit: undefined } as never);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Faoliyat jurnali</h1>
          <p className="text-sm text-muted-foreground">Real-vaqtda yangilanadigan operatsion feed</p>
        </div>
        <a href={exportHref} target="_blank" rel="noopener">
          <Button variant="outline" size="sm">
            <Download className="mr-1.5 h-4 w-4" /> CSV export
          </Button>
        </a>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[repeat(4,1fr)_auto]">
          <FieldInline label="Boshlanish">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </FieldInline>
          <FieldInline label="Tugash">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </FieldInline>
          <FieldInline label="Xodim">
            <Input
              value={actorQuery}
              onChange={(e) => setActorQuery(e.target.value)}
              placeholder="ism bo‘yicha qidirish"
            />
          </FieldInline>
          <FieldInline label="Modul">
            <select
              value={actionPrefix}
              onChange={(e) => setActionPrefix(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Hammasi</option>
              {ACTION_GROUPS.map((g) => (
                <option key={g.id} value={g.prefix}>
                  {g.label}
                </option>
              ))}
            </select>
          </FieldInline>
          <div className="flex items-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setActionPrefix('');
                setActorQuery('');
              }}
            >
              <X className="mr-1 h-4 w-4" />
              Tozalash
            </Button>
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-10 w-10" />}
          title="Hodisalar topilmadi"
          description="Filtrlarni o‘zgartirib ko‘ring"
        />
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {filtered.map((e) => {
              const patientId =
                (e.resource_type === 'patients' && e.resource_id) ||
                ((e.metadata as { patient_id?: string } | null)?.patient_id as string | undefined);
              return (
                <div key={e.id} className="flex items-start gap-3 p-4">
                  <div className="mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary/10">
                    <Activity className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {e.action}
                        </Badge>
                        {e.resource_type && (
                          <Badge variant="secondary" className="text-[10px]">
                            {e.resource_type}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(e.created_at).toLocaleString('uz-UZ')}
                      </span>
                    </div>
                    <div className="mt-1 text-sm">
                      {e.summary_i18n?.['uz-Latn'] ?? e.summary_i18n?.['en'] ?? '—'}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <User className="h-3 w-3" />
                      {e.actor?.full_name ?? 'Tizim'} · {e.actor?.role ?? ''}
                      {patientId && (
                        <button
                          className="ml-auto text-primary hover:underline"
                          onClick={() => setOpenPatient(patientId)}
                        >
                          Bemor tarixi →
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {openPatient && (
        <PatientTimelineDrawer patientId={openPatient} onClose={() => setOpenPatient(null)} />
      )}
    </div>
  );
}

function FieldInline({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
function PatientTimelineDrawer({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['patient-timeline', patientId],
    queryFn: () => api.patients.timeline(patientId),
  });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {data?.patient?.full_name ?? 'Bemor tarixi'}
          </SheetTitle>
        </SheetHeader>
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : !data ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Ma‘lumot topilmadi</div>
        ) : (
          <div className="space-y-4 overflow-auto pr-1">
            <div className="grid grid-cols-5 gap-2 text-xs">
              <SummaryTile label="Jami to‘langan" value={`${Number(data.summary.total_spent_uzs).toLocaleString('uz-UZ')} UZS`} />
              <SummaryTile label="Qabullar" value={String(data.summary.visits)} />
              <SummaryTile label="Retsept" value={String(data.summary.prescriptions)} />
              <SummaryTile label="Analizlar" value={String(data.summary.lab_orders)} />
              <SummaryTile label="Statsionar" value={String(data.summary.stays)} />
            </div>

            <TimelineSection title="Qabullar" icon={<CalendarRange className="h-4 w-4" />} rows={data.appointments}>
              {(row) => (
                <div className="text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">
                      {(row as { service_name_snapshot?: string }).service_name_snapshot ?? '—'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date((row as { scheduled_at: string }).scheduled_at).toLocaleString('uz-UZ')}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {(row as { doctor?: { full_name?: string } }).doctor?.full_name ?? ''} ·{' '}
                    {(row as { status: string }).status}
                  </div>
                </div>
              )}
            </TimelineSection>

            <TimelineSection title="To‘lovlar" rows={data.transactions}>
              {(row) => (
                <div className="text-sm">
                  <div className="flex justify-between">
                    <span>
                      {(row as { kind: string }).kind} · {(row as { payment_method: string }).payment_method}
                    </span>
                    <span className="font-medium">
                      {Number((row as { amount_uzs: number }).amount_uzs).toLocaleString('uz-UZ')} UZS
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date((row as { created_at: string }).created_at).toLocaleString('uz-UZ')}
                  </div>
                </div>
              )}
            </TimelineSection>

            <TimelineSection title="Retseptlar" rows={data.prescriptions}>
              {(row) => (
                <div className="text-sm">
                  <div className="flex justify-between">
                    <span className="font-mono text-xs">{(row as { rx_number: string }).rx_number}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {(row as { status: string }).status}
                    </Badge>
                  </div>
                  <ul className="mt-1 ml-4 list-disc text-xs text-muted-foreground">
                    {((row as { items?: Array<{ medication_name_snapshot: string; quantity: number }> }).items ?? []).map(
                      (it, idx) => (
                        <li key={idx}>
                          {it.medication_name_snapshot} × {it.quantity}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              )}
            </TimelineSection>

            <TimelineSection title="Yo‘llanmalar" rows={data.referrals}>
              {(row) => (
                <div className="text-sm">
                  <div className="flex justify-between">
                    <span>
                      {(row as { kind: string }).kind} —{' '}
                      {(row as { service_name_snapshot?: string | null }).service_name_snapshot ?? '—'}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {(row as { status: string }).status}
                    </Badge>
                  </div>
                </div>
              )}
            </TimelineSection>

            <TimelineSection title="Laboratoriya" rows={data.lab_orders}>
              {(row) => (
                <div className="text-sm">
                  <div className="flex justify-between">
                    <span>Lab #{String((row as { id: string }).id).slice(0, 6)}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {(row as { status: string }).status}
                    </Badge>
                  </div>
                  <ul className="mt-1 ml-4 list-disc text-xs text-muted-foreground">
                    {((row as { items?: Array<{ name_snapshot: string }> }).items ?? []).map((it, idx) => (
                      <li key={idx}>{it.name_snapshot}</li>
                    ))}
                  </ul>
                </div>
              )}
            </TimelineSection>

            <TimelineSection title="Statsionar" rows={data.inpatient_stays}>
              {(row) => (
                <div className="text-sm">
                  <div className="flex justify-between">
                    <span>
                      Xona{' '}
                      {((row as { room?: { number?: string } }).room)?.number ?? '—'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date((row as { admitted_at: string }).admitted_at).toLocaleDateString('uz-UZ')}
                      {(row as { discharged_at?: string | null }).discharged_at
                        ? ` → ${new Date((row as { discharged_at: string }).discharged_at).toLocaleDateString('uz-UZ')}`
                        : ' — davom etmoqda'}
                    </span>
                  </div>
                </div>
              )}
            </TimelineSection>

            <TimelineSection title="Klinik yozuvlar" rows={data.clinical_notes}>
              {(row) => (
                <div className="text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">
                      {(row as { diagnosis_text?: string | null }).diagnosis_text ?? 'SOAP yozuvi'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date((row as { created_at: string }).created_at).toLocaleString('uz-UZ')}
                    </span>
                  </div>
                  {(row as { soap_assessment?: string | null }).soap_assessment && (
                    <p className="text-xs text-muted-foreground">
                      {(row as { soap_assessment: string }).soap_assessment}
                    </p>
                  )}
                </div>
              )}
            </TimelineSection>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function TimelineSection<T>({
  title,
  icon,
  rows,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  rows: T[];
  children: (row: T) => React.ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        {icon ?? <Filter className="h-4 w-4" />} {title}
        <Badge variant="secondary" className="ml-1 text-[10px]">
          {rows.length}
        </Badge>
      </div>
      <div className="space-y-1.5">
        {rows.slice(0, 20).map((row, idx) => (
          <div key={idx} className="rounded-md border bg-background px-3 py-2">
            {children(row)}
          </div>
        ))}
      </div>
    </section>
  );
}
