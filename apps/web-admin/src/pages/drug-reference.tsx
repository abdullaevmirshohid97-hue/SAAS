import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpenCheck,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, Input, StatCard } from '@clary/ui-web';
import type { DrugRefKind, DrugReferenceSyncLog } from '@clary/api-client';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { ErrorState, LoadingState } from '@/components/query-state';
import {
  REGISTRY_FIELDS,
  parseRegistryMatrix,
  readSpreadsheetMatrix,
  type ColumnMap,
  type RegistryField,
} from '@/lib/registry-import';

// =============================================================================
// Davlat dori katalogi (MXIK) va davlat reestri — super admin
// =============================================================================
// * MXIK katalogi API tomonidan tasnif.soliq.uz'dan yig'iladi (har kuni
//   tekshiriladi, 6.5 kundan eski bo'lsa yangilanadi) — bu yerda qo'lda ham.
// * Davlat reestri (uzpharm-control.uz) — saytdan Excel'ni yuklab, shu yerga
//   tashlanadi: ro'yxat holati, retsept belgisi katalogga moslanadi.
// =============================================================================

const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('uz-UZ');
const REGISTRY_URL =
  'https://www.uzpharm-control.uz/uz/pages/state-register-of-medicines-and-medical-products';
const KIND_LABEL: Record<DrugRefKind, string> = {
  drug: 'Dori',
  bad: 'BAD',
  device: 'Tibbiy buyum',
  other: 'Boshqa',
};
const CHUNK = 1000;

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

function statusBadge(s: DrugReferenceSyncLog['status']) {
  if (s === 'ok') return <Badge variant="success">Tayyor</Badge>;
  if (s === 'partial') return <Badge variant="warning">Qisman</Badge>;
  if (s === 'running') return <Badge variant="info">Ketmoqda…</Badge>;
  return <Badge variant="destructive">Xato</Badge>;
}

type ClassProgress = {
  label: string;
  total: number;
  fetched: number;
  upserted: number;
  complete: boolean;
  error: string | null;
};

export function DrugReferencePage() {
  const qc = useQueryClient();
  const statsQ = useQuery({
    queryKey: ['admin', 'drug-reference', 'stats'],
    queryFn: () => api.admin.drugReference.stats(),
    refetchInterval: (q) =>
      q.state.data?.syncing || q.state.data?.logs.some((l) => l.status === 'running')
        ? 4000
        : false,
  });
  const syncMut = useMutation({
    mutationFn: () => api.admin.drugReference.sync(),
    onSuccess: (r) => {
      toast.success(
        r.already_running
          ? 'Sinxronlash allaqachon ketmoqda'
          : 'MXIK katalogi yuklanmoqda (3–6 daqiqa)',
      );
      void qc.invalidateQueries({ queryKey: ['admin', 'drug-reference', 'stats'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stats = statsQ.data?.stats;
  const logs = statsQ.data?.logs ?? [];
  const lastMxik = logs.find((l) => l.source === 'mxik');
  const lastRegistry = logs.find((l) => l.source === 'registry');
  const classes = (lastMxik?.details as { classes?: Record<string, ClassProgress> } | undefined)
    ?.classes;
  const syncing = !!statsQ.data?.syncing || lastMxik?.status === 'running';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BookOpenCheck className="h-6 w-6 text-indigo-600" /> Dori katalogi (MXIK)
        </h1>
        <p className="text-muted-foreground text-sm">
          Barcha dorixonalar uchun umumiy: dorilar, BAD va tibbiy buyumlar. Dorixonachi prixodda
          nomning 1–2 harfini yozsa — nomi, ishlab chiqaruvchi, MXIK, qadoq soni o‘zi to‘ladi.
        </p>
      </div>

      {statsQ.isLoading ? (
        <LoadingState />
      ) : statsQ.isError ? (
        <ErrorState message={(statsQ.error as Error)?.message} onRetry={() => statsQ.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Katalogda"
              value={fmt(stats?.total)}
              hint={(Object.entries(stats?.by_kind ?? {}) as Array<[DrugRefKind, number]>)
                .map(([k, n]) => `${KIND_LABEL[k] ?? k}: ${fmt(n)}`)
                .join(' · ')}
            />
            <StatCard
              label="Shtrix-kodli"
              value={fmt(stats?.with_barcode)}
              hint={`${fmt(stats?.barcodes)} kod · dorixonalar o‘rgatgani: ${fmt(stats?.barcodes_from_clinics)}`}
            />
            <StatCard
              label="Davlat reestri"
              value={fmt(stats?.reg_matched)}
              hint={`amalda ${fmt(stats?.reg_active)} · muddati o‘tgan ${fmt(stats?.reg_inactive)}`}
              tone={stats?.reg_matched ? 'success' : 'default'}
            />
            <StatCard
              label="Foydalanayotgan klinikalar"
              value={fmt(stats?.adopted_clinics)}
              hint="katalogdan dori qo‘shgan"
            />
          </div>

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">MXIK katalogi (tasnif.soliq.uz)</div>
                  <div className="text-muted-foreground text-xs">
                    Har kuni 04:10 da tekshiriladi, oxirgi yangilanish 6.5 kundan eski bo‘lsa o‘zi
                    yangilanadi. 20 kun MXIK’da ko‘rinmagan yozuv nofaol bo‘ladi.
                  </div>
                </div>
                <Button onClick={() => syncMut.mutate()} disabled={syncing || syncMut.isPending}>
                  {syncing ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-4 w-4" />
                  )}
                  {syncing ? 'Yuklanmoqda…' : 'MXIK’dan yangilash'}
                </Button>
              </div>
              {lastMxik ? (
                <div className="space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {statusBadge(lastMxik.status)}
                    <span className="text-muted-foreground">
                      {new Date(lastMxik.started_at).toLocaleString('uz-UZ')} ·{' '}
                      {fmt(lastMxik.rows_upserted)} yozuv
                      {lastMxik.rows_deactivated
                        ? ` · ${fmt(lastMxik.rows_deactivated)} nofaol`
                        : ''}
                    </span>
                    {lastMxik.error && lastMxik.status !== 'running' && (
                      <span className="text-xs text-amber-700">{lastMxik.error}</span>
                    )}
                  </div>
                  {classes && (
                    <div className="grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                      {Object.entries(classes).map(([code, p]) => (
                        <div
                          key={code}
                          className="flex items-center justify-between gap-2 rounded border px-2 py-1"
                        >
                          <span className="min-w-0 truncate" title={p.label}>
                            <span className="font-mono">{code}</span> {p.label}
                          </span>
                          <span
                            className={
                              p.error
                                ? 'text-destructive'
                                : p.complete
                                  ? 'text-emerald-700'
                                  : 'text-muted-foreground'
                            }
                            title={p.error ?? undefined}
                          >
                            {p.error ? 'xato' : `${fmt(p.fetched)}/${fmt(p.total)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded border border-dashed p-3 text-sm">
                  Katalog hali yuklanmagan. <b>“MXIK’dan yangilash”</b> tugmasini bosing — taxminan
                  50 ming yozuv 3–6 daqiqada yuklanadi.
                </div>
              )}
            </CardContent>
          </Card>

          <RegistryImportCard
            last={lastRegistry}
            onDone={() => qc.invalidateQueries({ queryKey: ['admin', 'drug-reference', 'stats'] })}
          />

          <CatalogSearchCard />

          <Card>
            <CardContent className="p-0">
              <div className="border-b px-4 py-2 text-sm font-semibold">Tarix</div>
              {logs.length === 0 ? (
                <div className="text-muted-foreground p-4 text-sm">Hali hech narsa yo‘q</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-muted-foreground border-b text-left text-xs uppercase">
                      <tr>
                        <th className="px-3 py-2">Manba</th>
                        <th className="px-3 py-2">Holat</th>
                        <th className="px-3 py-2">Boshlandi</th>
                        <th className="px-3 py-2">Tugadi</th>
                        <th className="px-3 py-2 text-right">Qator</th>
                        <th className="px-3 py-2 text-right">Yozildi / moslandi</th>
                        <th className="px-3 py-2">Izoh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((l) => (
                        <tr key={l.id} className="border-b last:border-b-0">
                          <td className="px-3 py-2">
                            {l.source === 'mxik' ? 'MXIK' : 'Davlat reestri'}
                          </td>
                          <td className="px-3 py-2">{statusBadge(l.status)}</td>
                          <td className="px-3 py-2 text-xs">
                            {new Date(l.started_at).toLocaleString('uz-UZ')}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {l.finished_at ? new Date(l.finished_at).toLocaleString('uz-UZ') : '—'}
                          </td>
                          <td className="px-3 py-2 text-right">{fmt(l.rows_fetched)}</td>
                          <td className="px-3 py-2 text-right">{fmt(l.rows_upserted)}</td>
                          <td
                            className="max-w-[320px] truncate px-3 py-2 text-xs"
                            title={l.error ?? ''}
                          >
                            {l.error ??
                              ((l.details as { file_name?: string } | null)?.file_name || '')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Davlat reestri Excel importi
// -----------------------------------------------------------------------------
function RegistryImportCard({
  last,
  onDone,
}: {
  last: DrugReferenceSyncLog | undefined;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [matrix, setMatrix] = useState<unknown[][] | null>(null);
  const [columns, setColumns] = useState<ColumnMap>({});
  const [headerRow, setHeaderRow] = useState(-1);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const parsed = useMemo(
    () => (matrix && headerRow >= 0 ? parseRegistryMatrix(matrix, columns, headerRow) : null),
    [matrix, columns, headerRow],
  );
  const header = parsed?.header ?? [];

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setReading(true);
    try {
      const m = await readSpreadsheetMatrix(f);
      const auto = parseRegistryMatrix(m);
      if (auto.headerRow < 0) {
        toast.error('Sarlavha qatori topilmadi: “Торговое наименование” ustuni kerak');
        return;
      }
      setFileName(f.name);
      setMatrix(m);
      setHeaderRow(auto.headerRow);
      setColumns(auto.columns);
    } catch (err) {
      toast.error(`Faylni o‘qib bo‘lmadi: ${(err as Error).message}`);
    } finally {
      setReading(false);
    }
  };

  const run = async () => {
    if (!parsed || parsed.rows.length === 0) return;
    if (
      !window.confirm(
        `${fmt(parsed.rows.length)} ta reestr qatori yuklanadi va katalogga moslanadi. Avvalgi reestr importi almashtiriladi. Davom etilsinmi?`,
      )
    )
      return;
    const importId = uuid();
    try {
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        setProgress(
          `Yuklanmoqda: ${fmt(Math.min(i + CHUNK, parsed.rows.length))} / ${fmt(parsed.rows.length)}`,
        );
        await api.admin.drugReference.registryImport({
          import_id: importId,
          rows: parsed.rows.slice(i, i + CHUNK),
        });
      }
      setProgress('Katalogga moslanmoqda…');
      const r = await api.admin.drugReference.registryActivate({
        import_id: importId,
        file_name: fileName,
      });
      toast.success(
        `Reestr yuklandi: ${fmt(r.rows)} qator · katalogda moslandi ${fmt(r.matched)} (amalda ${fmt(r.reg_active)}, muddati o‘tgan ${fmt(r.reg_inactive)})`,
      );
      setMatrix(null);
      setFileName('');
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
      await api.admin.drugReference.registryDiscard({ import_id: importId }).catch(() => null);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="font-semibold">Davlat reestri (uzpharm-control.uz)</div>
            <div className="text-muted-foreground max-w-2xl text-xs">
              Saytda reestrni oching → <b>Yuklab olish</b> (captcha) → Excel faylni shu yerga
              tashlang. Reestr katalogga moslanadi: prixodda “reestr muddati o‘tgan” ogohlantirishi
              va katalogdan qo‘shilgan dorining “retsept bilan” belgisi shundan keladi.
            </div>
            {last && (
              <div className="mt-1 flex items-center gap-2 text-xs">
                {statusBadge(last.status)}
                <span className="text-muted-foreground">
                  {new Date(last.started_at).toLocaleString('uz-UZ')} · {fmt(last.rows_fetched)}{' '}
                  qator · moslandi {fmt(last.rows_upserted)}
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={REGISTRY_URL} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1.5 h-4 w-4" /> Reestrni ochish
              </a>
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => void onFile(e)}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={reading || !!progress}>
              {reading ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-4 w-4" />
              )}
              Excel yuklash
            </Button>
          </div>
        </div>

        {parsed && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> <b>{fileName}</b> ·{' '}
              {fmt(parsed.rows.length)} qator
              {parsed.skipped > 0 && (
                <span className="text-muted-foreground">
                  · {fmt(parsed.skipped)} ta nomsiz qator tashlandi
                </span>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {REGISTRY_FIELDS.map((f) => (
                <label key={f.key} className="block space-y-1 text-xs">
                  <span className="text-muted-foreground font-medium">
                    {f.label}
                    {f.required ? ' *' : ''}
                  </span>
                  <select
                    className="border-input bg-background h-8 w-full rounded-md border px-2 text-sm"
                    value={columns[f.key] ?? ''}
                    onChange={(e) =>
                      setColumns((c) => {
                        const next: ColumnMap = { ...c };
                        const v = e.target.value;
                        if (v === '') delete next[f.key as RegistryField];
                        else next[f.key as RegistryField] = Number(v);
                        return next;
                      })
                    }
                  >
                    <option value="">— yo‘q —</option>
                    {header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `${i + 1}-ustun`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b text-left">
                  <tr>
                    <th className="px-2 py-1">Savdo nomi</th>
                    <th className="px-2 py-1">Ro‘yxat №</th>
                    <th className="px-2 py-1">Ishlab chiqaruvchi</th>
                    <th className="px-2 py-1">Mamlakat</th>
                    <th className="px-2 py-1">Holati</th>
                    <th className="px-2 py-1">Retsept</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-b last:border-b-0">
                      <td className="max-w-[320px] truncate px-2 py-1">{r.trade_name}</td>
                      <td className="px-2 py-1 font-mono">{r.reg_number ?? '—'}</td>
                      <td className="max-w-[200px] truncate px-2 py-1">{r.manufacturer ?? '—'}</td>
                      <td className="px-2 py-1">{r.country ?? '—'}</td>
                      <td className="px-2 py-1">
                        {r.is_active == null ? '—' : r.is_active ? 'amalda' : 'muddati o‘tgan'}
                      </td>
                      <td className="px-2 py-1">
                        {r.rx_required == null ? '—' : r.rx_required ? 'ha' : 'yo‘q'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void run()}
                disabled={
                  !!progress || columns.trade_name === undefined || parsed.rows.length === 0
                }
              >
                {progress ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                {progress ?? `Import qilish (${fmt(parsed.rows.length)})`}
              </Button>
              <Button variant="ghost" onClick={() => setMatrix(null)} disabled={!!progress}>
                Bekor qilish
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Katalogdan qidirish (tekshirish uchun)
// -----------------------------------------------------------------------------
function CatalogSearchCard() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const res = useQuery({
    queryKey: ['admin', 'drug-reference', 'search', term],
    queryFn: () => api.admin.drugReference.search(term, { limit: 50 }),
    enabled: term.trim().length >= 1,
  });
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="font-semibold">Katalogdan qidirish</div>
        <form
          className="flex max-w-xl gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(q.trim());
          }}
        >
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nomi, MNN, shtrix-kod yoki MXIK…"
            />
          </div>
          <Button type="submit" variant="outline">
            Qidirish
          </Button>
        </form>
        {res.isFetching ? (
          <LoadingState />
        ) : res.isError ? (
          <ErrorState message={(res.error as Error)?.message} />
        ) : term && (res.data ?? []).length === 0 ? (
          <div className="text-muted-foreground text-sm">Topilmadi</div>
        ) : (res.data ?? []).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-muted-foreground border-b text-left text-xs uppercase">
                <tr>
                  <th className="px-3 py-2">Nomi</th>
                  <th className="px-3 py-2">Ishlab chiqaruvchi</th>
                  <th className="px-3 py-2">Qadoq</th>
                  <th className="px-3 py-2">MXIK</th>
                  <th className="px-3 py-2">Shtrix-kod</th>
                  <th className="px-3 py-2">Reestr</th>
                </tr>
              </thead>
              <tbody>
                {(res.data ?? []).map((h) => (
                  <tr key={h.mxik_code} className="border-b align-top last:border-b-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {h.name}{' '}
                        {h.strength && <span className="text-muted-foreground">{h.strength}</span>}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {[KIND_LABEL[h.kind], h.form, h.generic_name, h.atc_code]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{h.manufacturer ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {h.pack_qty > 1 ? `${h.pack_qty} ${h.unit_name ?? 'dona'}` : '1'}
                      {h.blister_qty ? ` (blister ${h.blister_qty})` : ''}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{h.mxik_code}</td>
                    <td className="px-3 py-2 font-mono text-xs">{h.barcode ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {h.reg_active == null ? (
                        '—'
                      ) : h.reg_active ? (
                        <Badge variant="success">amalda</Badge>
                      ) : (
                        <Badge variant="warning">muddati o‘tgan</Badge>
                      )}
                      {h.rx_required ? <div className="text-rose-700">retsept</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
