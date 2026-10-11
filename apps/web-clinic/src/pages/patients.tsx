import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BookUser, ChevronLeft, ChevronRight, Search } from 'lucide-react';

import type { PatientRegistryFilter, PatientRegistryItem } from '@clary/api-client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  EmptyState,
  Input,
  PageHeader,
  cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { GENDER_LABEL, ageOf, fmtDay, fmtUzs } from '@/lib/patient-labels';

// =============================================================================
// Bemorlar daftari — /patients
// =============================================================================
// Barcha bemorlar: necha marta kelgan, oxirgi tashrif, jami to'lov, qarz,
// statsionar. Qatorni bosish — bemorning to'liq xotira daftari (/patient/:id).
// =============================================================================

const PAGE_SIZE = 30;

const FILTERS: Array<{ value: PatientRegistryFilter; label: string }> = [
  { value: 'all', label: 'Hammasi' },
  { value: 'debtors', label: 'Qarzdorlar' },
  { value: 'inpatient', label: 'Statsionarda' },
];

export function PatientsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<PatientRegistryFilter>('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [debounced, filter]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['patients-registry', debounced, filter, page],
    queryFn: () => api.patients.registry({ q: debounced, filter, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Bemorlar"
        title="Bemorlar daftari"
        description="Har bir bemor: necha marta kelgan, qaysi shifokorlarda bo‘lgan, qarzi va statsionar tarixi. Familiya + ism + telefon bir xil bo‘lsa — o‘sha bemor (qayta kelgan)."
      />

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              <Input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Familiya, ism yoki telefon…"
                className="pl-9"
              />
            </div>
            <div className="bg-muted/40 inline-flex rounded-lg border p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    'rounded px-3 py-1.5 text-xs font-medium transition',
                    filter === f.value ? 'bg-background shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <span className="text-muted-foreground text-sm">
              {isFetching ? 'Yuklanmoqda…' : `${total.toLocaleString('uz-UZ')} ta bemor`}
            </span>
          </div>

          <DataTable<PatientRegistryItem>
            isLoading={isLoading}
            rows={data?.items ?? []}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/patient/${r.id}`)}
            emptyState={
              <EmptyState
                icon={<BookUser className="h-6 w-6" />}
                title="Bemor topilmadi"
                description={debounced ? `"${debounced}" bo‘yicha natija yo‘q` : 'Hali bemor yo‘q'}
              />
            }
            columns={[
              {
                key: 'full_name',
                header: 'Bemor',
                render: (r) => (
                  <div className="min-w-0">
                    <div className="font-medium">{r.full_name}</div>
                    <div className="text-muted-foreground text-xs">
                      {[r.phone, ageOf(r.dob), r.gender ? GENDER_LABEL[r.gender] : null]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </div>
                  </div>
                ),
              },
              {
                key: 'visits',
                header: 'Tashriflar',
                render: (r) => {
                  const v = r.stats?.visits ?? 0;
                  return (
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold">{v}</span>
                      <span className="text-muted-foreground text-xs">marta</span>
                      {v >= 2 && (
                        <Badge variant="secondary" className="text-[10px]">
                          qayta kelgan
                        </Badge>
                      )}
                    </div>
                  );
                },
              },
              {
                key: 'last_visit',
                header: 'Oxirgi tashrif',
                render: (r) => fmtDay(r.stats?.last_visit_at),
              },
              {
                key: 'paid',
                header: 'Jami to‘lov',
                align: 'right',
                render: (r) => fmtUzs(r.stats?.paid_uzs),
              },
              {
                key: 'debt',
                header: 'Qarz',
                align: 'right',
                render: (r) =>
                  (r.stats?.debt_uzs ?? 0) > 0 ? (
                    <span className="text-destructive font-semibold">
                      {fmtUzs(r.stats?.debt_uzs)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
              {
                key: 'stays',
                header: 'Statsionar',
                render: (r) =>
                  r.stats?.in_stay ? (
                    <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                      Hozir yotibdi
                    </Badge>
                  ) : (r.stats?.stays ?? 0) > 0 ? (
                    <span className="text-sm">{r.stats!.stays} marta</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
            ]}
          />

          {pages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-muted-foreground text-sm">
                {page} / {pages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
