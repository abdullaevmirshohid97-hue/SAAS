import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { Trash2, RotateCcw, Stethoscope, Clock, User, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card, CardContent } from '@clary/ui-web';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

type Kind = 'transaction' | 'pharmacy_sale' | 'inpatient';

const KIND_LABEL: Record<Kind, string> = {
  transaction: 'Jurnal',
  pharmacy_sale: 'Dorixona',
  inpatient: 'Statsionar',
};

const KIND_BADGE: Record<Kind, string> = {
  transaction: 'bg-indigo-100 text-indigo-700',
  pharmacy_sale: 'bg-emerald-100 text-emerald-700',
  inpatient: 'bg-amber-100 text-amber-700',
};

const FILTERS: Array<{ id: Kind | 'all'; label: string }> = [
  { id: 'all', label: 'Hammasi' },
  { id: 'transaction', label: 'Jurnal' },
  { id: 'pharmacy_sale', label: 'Dorixona' },
  { id: 'inpatient', label: 'Statsionar' },
];

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

// Sana-vaqtni SONIYAGACHA ko'rsatadi (o'chirilgan payt aniq bilinishi uchun).
const fmtExact = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export function SettingsTrashPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const [showRestored, setShowRestored] = useState(false);

  const isOwner = role === 'clinic_owner' || role === 'clinic_admin' || role === 'super_admin';

  const { data: items, isLoading } = useQuery({
    queryKey: ['trash', filter, showRestored],
    queryFn: () =>
      api.trash.list({
        kind: filter === 'all' ? undefined : filter,
        includeRestored: showRestored,
      }),
    enabled: isOwner,
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => api.trash.restore(id),
    onSuccess: () => {
      toast.success('Yozuv qaytarildi');
      qc.invalidateQueries({ queryKey: ['trash'] });
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('journal') });
      qc.invalidateQueries({ queryKey: ['cashier-kpis'] });
      qc.invalidateQueries({ queryKey: ['payroll'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isOwner) return <Navigate to="/settings/clinic" replace />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Trash2 className="h-6 w-6 text-rose-600" /> Savatcha (o'chirilganlar)
        </h1>
        <p className="text-sm text-muted-foreground">
          O'chirilgan jurnal tranzaksiyalari, dorixona savdolari va statsionar yozuvlari shu yerda
          turadi. Har birini <b>qaytarish</b> mumkin. O'chirilgan sana-vaqt, sabab, xizmatlar,
          shifokor va smena ko'rsatilgan.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={
                'rounded px-3 py-1.5 text-sm font-medium transition ' +
                (filter === f.id ? 'bg-background shadow-sm' : 'text-muted-foreground')
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showRestored}
            onChange={(e) => setShowRestored(e.target.checked)}
          />
          Qaytarilganlarni ham ko'rsatish
        </label>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Yuklanmoqda…</div>}
      {!isLoading && (items?.length ?? 0) === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Savatcha bo'sh — o'chirilgan yozuvlar yo'q.
        </div>
      )}

      <div className="space-y-3">
        {(items ?? []).map((it) => {
          const s = it.summary;
          const restored = !!it.restored_at;
          return (
            <Card key={it.id} className={restored ? 'opacity-70' : ''}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={'rounded px-2 py-0.5 text-xs font-semibold ' + KIND_BADGE[it.kind]}>
                        {KIND_LABEL[it.kind]}
                      </span>
                      <span className="font-medium">{s.title}</span>
                      {restored && (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Qaytarilgan
                        </span>
                      )}
                    </div>
                    {s.patient_name && (
                      <div className="flex items-center gap-1.5 text-sm">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        {s.patient_name}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-sm">
                    <div className="font-semibold">{fmt(s.total_uzs)} so'm</div>
                    {s.debt_uzs > 0 && (
                      <div className="text-xs text-rose-600">Qarz: {fmt(s.debt_uzs)} so'm</div>
                    )}
                  </div>
                </div>

                {/* Xizmatlar + turi */}
                {s.services.length > 0 && (
                  <div className="rounded-md border bg-muted/20">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr className="border-b">
                          <th className="px-2 py-1 text-left font-medium">Xizmat</th>
                          <th className="px-2 py-1 text-left font-medium">Turi</th>
                          <th className="px-2 py-1 text-right font-medium">Soni</th>
                          <th className="px-2 py-1 text-right font-medium">Summa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.services.map((sv, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-2 py-1">{sv.name}</td>
                            <td className="px-2 py-1 text-muted-foreground">{sv.type ?? '—'}</td>
                            <td className="px-2 py-1 text-right">{sv.qty}</td>
                            <td className="px-2 py-1 text-right">{fmt(sv.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Meta: shifokor, smena */}
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  <span className="flex items-center gap-1.5">
                    <Stethoscope className="h-3.5 w-3.5 text-muted-foreground" />
                    Shifokor: <b>{s.doctor_name ?? '—'}</b>
                  </span>
                  {s.shift_label && (
                    <span className="flex items-center gap-1.5">
                      <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                      {s.shift_label}
                    </span>
                  )}
                </div>

                {/* O'chirish ma'lumoti — sana soniyagacha + sabab */}
                <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-900">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    O'chirilgan: <b>{fmtExact(it.deleted_at)}</b>
                    {it.deleted_by_name && <span>· {it.deleted_by_name}</span>}
                  </div>
                  <div className="mt-0.5">
                    Sabab: <b>{it.reason}</b>
                  </div>
                  {restored && (
                    <div className="mt-0.5 text-emerald-700">
                      Qaytarilgan: {fmtExact(it.restored_at)}
                    </div>
                  )}
                </div>

                {!restored && (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={restoreMut.isPending}
                      onClick={() => {
                        if (window.confirm('Bu yozuvni qaytarishni tasdiqlaysizmi?')) {
                          restoreMut.mutate(it.id);
                        }
                      }}
                    >
                      <RotateCcw className="h-4 w-4" /> Qaytarish
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
