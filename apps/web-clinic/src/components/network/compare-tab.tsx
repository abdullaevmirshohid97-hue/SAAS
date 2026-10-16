import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';

import { Card, CardContent, EmptyState } from '@clary/ui-web';
import type { NetworkCompareRow } from '@clary/api-client';

import { api } from '@/lib/api';
import { PresetBar, type Preset } from '@/components/analytics/preset-bar';
import { BranchDot, fmt, presetRange } from './shared';

type SortKey = 'net' | 'received_uzs' | 'visits' | 'new_patients' | 'avg';

const net = (r: NetworkCompareRow) =>
  Number(r.received_uzs) -
  Number(r.refunds_uzs) +
  Number(r.pharmacy_uzs) -
  Number(r.expenses_uzs) -
  Number(r.payroll_uzs);
const avgCheck = (r: NetworkCompareRow) =>
  r.visits > 0 ? Math.round((Number(r.received_uzs) - Number(r.refunds_uzs)) / r.visits) : 0;

/** Davr bo'yicha filiallarni solishtirish: kassa ma'lumoti + buxgalteriya (GL) */
export function CompareTab({ colors }: { colors: Record<string, string | null> }) {
  const [preset, setPreset] = useState<Preset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [sort, setSort] = useState<SortKey>('net');
  const range = presetRange(preset, customFrom, customTo);

  const { data, isLoading } = useQuery({
    queryKey: ['company-compare', range.from, range.to],
    queryFn: () => api.company.compare(range),
  });
  const { data: gl } = useQuery({
    queryKey: ['company-cons', range.from, range.to],
    queryFn: () => api.company.consolidated(range),
  });

  const rows = useMemo(() => {
    const list = [...(data?.branches ?? [])];
    const val = (r: NetworkCompareRow) =>
      sort === 'net' ? net(r) : sort === 'avg' ? avgCheck(r) : Number(r[sort]);
    return list.sort((a, b) => val(b) - val(a));
  }, [data, sort]);

  const totals = rows.reduce(
    (a, r) => ({
      received: a.received + Number(r.received_uzs),
      refunds: a.refunds + Number(r.refunds_uzs),
      debt: a.debt + Number(r.debt_uzs),
      pharmacy: a.pharmacy + Number(r.pharmacy_uzs),
      expenses: a.expenses + Number(r.expenses_uzs),
      payroll: a.payroll + Number(r.payroll_uzs),
      visits: a.visits + r.visits,
      patients: a.patients + r.unique_patients,
      newp: a.newp + r.new_patients,
      net: a.net + net(r),
    }),
    {
      received: 0,
      refunds: 0,
      debt: 0,
      pharmacy: 0,
      expenses: 0,
      payroll: 0,
      visits: 0,
      patients: 0,
      newp: 0,
      net: 0,
    },
  );
  const maxNet = Math.max(1, ...rows.map((r) => Math.abs(net(r))));

  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => setSort(key)}
      className={`rounded-md px-2 py-1 text-xs ${sort === key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PresetBar
          value={preset}
          onChange={setPreset}
          customFrom={customFrom}
          customTo={customTo}
          onFromChange={setCustomFrom}
          onToChange={setCustomTo}
        />
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground mr-1 text-xs">Saralash:</span>
          {sortBtn('net', 'Sof natija')}
          {sortBtn('received_uzs', 'Tushum')}
          {sortBtn('visits', 'Tashrif')}
          {sortBtn('avg', "O'rtacha chek")}
          {sortBtn('new_patients', 'Yangi bemor')}
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-600" />
            <span className="font-semibold">
              Filiallar reytingi — {range.from} … {range.to}
            </span>
          </div>
          {!isLoading && rows.length === 0 ? (
            <EmptyState
              title="Ma'lumot yo'q"
              description="Tanlangan davrda filial faoliyati yo'q."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-1.5">#</th>
                    <th>Filial</th>
                    <th className="text-right">Tushum</th>
                    <th className="text-right">Qaytarish</th>
                    <th className="text-right">Dorixona</th>
                    <th className="text-right">Rasxot</th>
                    <th className="text-right">Maosh</th>
                    <th className="text-right">Sof natija</th>
                    <th className="text-right">Tashrif</th>
                    <th className="text-right">Bemor</th>
                    <th className="text-right">Yangi</th>
                    <th className="text-right">O'rt. chek</th>
                    <th className="text-right">Qarzga</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const n = net(r);
                    return (
                      <tr key={r.clinic_id} className="border-b last:border-0">
                        <td className="py-1.5">
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                        </td>
                        <td className="font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <BranchDot id={r.clinic_id} color={colors[r.clinic_id]} />
                            {r.name}
                            {r.is_hq && (
                              <span className="text-primary text-[10px] font-semibold">HQ</span>
                            )}
                          </span>
                          <div className="bg-muted mt-1 h-1 w-full max-w-[10rem] overflow-hidden rounded-full">
                            <div
                              className={`h-full ${n >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                              style={{
                                width: `${Math.max(2, Math.round((Math.abs(n) / maxNet) * 100))}%`,
                              }}
                            />
                          </div>
                        </td>
                        <td className="text-right text-emerald-600">{fmt(r.received_uzs)}</td>
                        <td className="text-right text-rose-600">{fmt(r.refunds_uzs)}</td>
                        <td className="text-right">{fmt(r.pharmacy_uzs)}</td>
                        <td className="text-right">{fmt(r.expenses_uzs)}</td>
                        <td className="text-right">{fmt(r.payroll_uzs)}</td>
                        <td className={`text-right font-semibold ${n >= 0 ? '' : 'text-rose-600'}`}>
                          {fmt(n)}
                        </td>
                        <td className="text-right">{r.visits}</td>
                        <td className="text-right">{r.unique_patients}</td>
                        <td className="text-right">{r.new_patients}</td>
                        <td className="text-right">{fmt(avgCheck(r))}</td>
                        <td className="text-right text-amber-600">{fmt(r.debt_uzs)}</td>
                      </tr>
                    );
                  })}
                  {rows.length > 1 && (
                    <tr className="bg-muted/40 font-semibold">
                      <td className="py-1.5" />
                      <td>Jami tarmoq</td>
                      <td className="text-right">{fmt(totals.received)}</td>
                      <td className="text-right">{fmt(totals.refunds)}</td>
                      <td className="text-right">{fmt(totals.pharmacy)}</td>
                      <td className="text-right">{fmt(totals.expenses)}</td>
                      <td className="text-right">{fmt(totals.payroll)}</td>
                      <td className="text-right">{fmt(totals.net)}</td>
                      <td className="text-right">{totals.visits}</td>
                      <td className="text-right">{totals.patients}</td>
                      <td className="text-right">{totals.newp}</td>
                      <td className="text-right">
                        {fmt(
                          totals.visits ? (totals.received - totals.refunds) / totals.visits : 0,
                        )}
                      </td>
                      <td className="text-right">{fmt(totals.debt)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-muted-foreground mt-2 text-xs">
            Sof natija = tushum − qaytarish + dorixona − rasxot − to'langan maosh (kassa ma'lumoti
            bo'yicha). Buxgalteriya (GL) bo'yicha foyda — pastda.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 font-semibold">Buxgalteriya (GL) bo'yicha foyda/zarar</div>
          {(gl?.branches ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">Tanlangan davrda provodkalar yo'q.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-1.5">Filial</th>
                    <th className="text-right">Daromad</th>
                    <th className="text-right">Xarajat</th>
                    <th className="text-right">Foyda</th>
                  </tr>
                </thead>
                <tbody>
                  {gl?.branches.map((b) => (
                    <tr key={b.clinic_id} className="border-b last:border-0">
                      <td className="py-1.5 font-medium">{b.clinic_name}</td>
                      <td className="text-right text-emerald-600">{fmt(b.income)}</td>
                      <td className="text-right text-rose-600">{fmt(b.expense)}</td>
                      <td
                        className={`text-right font-semibold ${b.profit >= 0 ? '' : 'text-rose-600'}`}
                      >
                        {fmt(b.profit)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/40 font-semibold">
                    <td className="py-1.5">Konsolidatsiya</td>
                    <td className="text-right">{fmt(gl?.consolidated.income)}</td>
                    <td className="text-right">{fmt(gl?.consolidated.expense)}</td>
                    <td className="text-right">{fmt(gl?.consolidated.profit)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
