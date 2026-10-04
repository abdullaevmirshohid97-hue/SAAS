import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
} from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import {
  FIELD_LABELS,
  detectHeader,
  extractRows,
  parseTsv,
  pickSheet,
  readSpreadsheet,
  type ColumnMapping,
  type ImportField,
  type ImportedRow,
} from '@/lib/pharmacy/excel-import';
import { errText, fmt } from './shared';

// =============================================================================
// Excel faktura → prixod qatorlari. Sarlavha va ustunlar avtomatik topiladi;
// foydalanuvchi faqat tekshiradi. Moslashuv firma bo'yicha eslab qolinadi —
// keyingi safar shu firmaning fakturasi 0 bosishda o'qiladi.
// =============================================================================

export type ImportSource = { kind: 'file'; file: File } | { kind: 'paste'; text: string };

export interface ImportOutcome {
  rows: ImportedRow[];
  fileName?: string;
  fileHash?: string;
  fileTotal: number | null;
}

type SavedMapping = { sheet?: string; headerRow?: number; columns?: ColumnMapping };

const FIELDS = Object.keys(FIELD_LABELS) as ImportField[];

function colName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function ImportDialog({
  source,
  supplierId,
  onClose,
  onImported,
}: {
  source: ImportSource;
  supplierId: string | null;
  onClose: () => void;
  onImported: (r: ImportOutcome) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [sheets, setSheets] = useState<Array<{ name: string; rows: unknown[][] }>>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fileMeta, setFileMeta] = useState<{ name?: string; hash?: string }>({});
  const [remember, setRemember] = useState(true);
  const [autoDetected, setAutoDetected] = useState<'profile' | 'auto' | 'manual'>('auto');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let sh: Array<{ name: string; rows: unknown[][] }>;
        if (source.kind === 'file') {
          const s = await readSpreadsheet(source.file);
          sh = s.sheets;
          if (alive) setFileMeta({ name: s.fileName, hash: s.fileHash });
        } else {
          sh = [{ name: 'Nusxa', rows: parseTsv(source.text) }];
        }
        if (!alive) return;
        if (sh.length === 0) {
          toast.error("Faylda ma'lumot topilmadi");
          onClose();
          return;
        }
        setSheets(sh);
        // 1) Firma profili
        let profile: SavedMapping | null = null;
        try {
          const p = await api.pharmacy.getImportProfile(supplierId ?? undefined);
          profile = (p?.mapping as SavedMapping | undefined) ?? null;
        } catch {
          profile = null;
        }
        const profSheet = profile?.sheet ? sh.findIndex((s) => s.name === profile!.sheet) : -1;
        if (profile?.columns && profile.columns.name !== undefined) {
          const idx = profSheet >= 0 ? profSheet : 0;
          const rows = sh[idx]!.rows;
          // Profil sarlavhasi shu faylga mos kelsa — o'sha; aks holda avtomatik
          const det = detectHeader(rows);
          const hr = det.confidence > 0 ? det.headerRow : (profile.headerRow ?? 0);
          setSheetIdx(idx);
          setHeaderRow(hr);
          setMapping(
            det.confidence >= Object.keys(profile.columns).length ? det.mapping : profile.columns,
          );
          setAutoDetected('profile');
        } else {
          const picked = pickSheet(sh);
          if (picked) {
            setSheetIdx(picked.index);
            setHeaderRow(picked.header.headerRow);
            setMapping(picked.header.mapping);
            setAutoDetected('auto');
          } else {
            setSheetIdx(0);
            setHeaderRow(source.kind === 'paste' ? -1 : 0);
            setMapping({});
            setAutoDetected('manual');
          }
        }
      } catch (e) {
        toast.error(`Faylni o'qib bo'lmadi: ${errText(e)}`);
        onClose();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = sheets[sheetIdx]?.rows ?? [];
  const width = useMemo(() => rows.slice(0, 60).reduce((a, r) => Math.max(a, r.length), 0), [rows]);
  const extracted = useMemo(
    () => (rows.length ? extractRows(rows, headerRow, mapping) : { rows: [], fileTotal: null }),
    [rows, headerRow, mapping],
  );
  const preview = rows.slice(Math.max(0, headerRow), Math.max(0, headerRow) + 9);
  const fieldOfCol = (col: number) => FIELDS.find((f) => mapping[f] === col) ?? '';

  const setCol = (col: number, field: ImportField | '') => {
    setMapping((m) => {
      const next: ColumnMapping = {};
      for (const f of FIELDS) if (m[f] !== undefined && m[f] !== col && f !== field) next[f] = m[f];
      if (field) next[field] = col;
      return next;
    });
    setAutoDetected('manual');
  };

  const missing: string[] = [];
  if (mapping.name === undefined) missing.push('Nomi');
  if (mapping.quantity === undefined) missing.push('Soni');
  if (mapping.cost === undefined && mapping.total === undefined) missing.push('Narxi yoki Summa');

  const sumRows = extracted.rows.reduce(
    (a, r) => a + (r.total ?? (r.cost ?? 0) * (r.quantity ?? 0)),
    0,
  );

  const proceed = () => {
    if (missing.length) return;
    if (remember) {
      void api.pharmacy
        .saveImportProfile({
          supplier_id: supplierId ?? undefined,
          mapping: { sheet: sheets[sheetIdx]?.name, headerRow, columns: mapping },
        })
        .catch(() => null);
    }
    onImported({
      rows: extracted.rows,
      fileName: fileMeta.name,
      fileHash: fileMeta.hash,
      fileTotal: extracted.fileTotal,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            {source.kind === 'file' ? source.file.name : 'Excel’dan nusxa'}
          </DialogTitle>
          <DialogDescription>
            {autoDetected === 'profile'
              ? 'Shu firma uchun saqlangan moslashuv qo‘llandi — tekshiring va davom eting.'
              : autoDetected === 'auto'
                ? 'Ustunlar avtomatik aniqlandi — tekshiring. Noto‘g‘ri bo‘lsa, ustun tepasidagi ro‘yxatdan tanlang.'
                : 'Ustunlarni belgilang: kamida Nomi, Soni va Narxi (yoki Summa).'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> O'qilmoqda…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3 text-sm">
              {sheets.length > 1 && (
                <label className="space-y-1">
                  <div className="text-muted-foreground text-[11px]">Varaq</div>
                  <select
                    className="border-input bg-background h-8 rounded-md border px-2 text-sm"
                    value={sheetIdx}
                    onChange={(e) => {
                      const i = Number(e.target.value);
                      setSheetIdx(i);
                      const det = detectHeader(sheets[i]!.rows);
                      setHeaderRow(det.headerRow);
                      setMapping(det.mapping);
                    }}
                  >
                    {sheets.map((s, i) => (
                      <option key={s.name + i} value={i}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="space-y-1">
                <div className="text-muted-foreground text-[11px]">Sarlavha qatori</div>
                <select
                  className="border-input bg-background h-8 rounded-md border px-2 text-sm"
                  value={headerRow}
                  onChange={(e) => setHeaderRow(Number(e.target.value))}
                >
                  <option value={-1}>Sarlavha yo'q</option>
                  {rows.slice(0, 60).map((_, i) => (
                    <option key={i} value={i}>
                      {i + 1}-qator
                    </option>
                  ))}
                </select>
              </label>
              <div className="bg-muted/40 rounded-md px-3 py-1.5">
                <b>{extracted.rows.length}</b> ta mahsulot · jami {fmt(Math.round(sumRows))} so'm
                {extracted.fileTotal != null && (
                  <span
                    className={cn(
                      'ml-2',
                      Math.abs(extracted.fileTotal - sumRows) >
                        Math.max(10, extracted.fileTotal * 0.005)
                        ? 'text-amber-700'
                        : 'text-emerald-700',
                    )}
                  >
                    (fakturada: {fmt(extracted.fileTotal)})
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto rounded border">
              <table className="text-xs">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="text-muted-foreground px-1 py-1">#</th>
                    {Array.from({ length: width }, (_, c) => (
                      <th key={c} className="min-w-[110px] px-1 py-1 text-left">
                        <div className="text-muted-foreground mb-0.5 text-[10px]">{colName(c)}</div>
                        <select
                          className={cn(
                            'h-7 w-full rounded border px-1 text-[11px]',
                            fieldOfCol(c) ? 'border-emerald-400 bg-emerald-50' : 'bg-background',
                          )}
                          value={fieldOfCol(c)}
                          onChange={(e) => setCol(c, e.target.value as ImportField | '')}
                        >
                          <option value="">—</option>
                          {FIELDS.map((f) => (
                            <option key={f} value={f}>
                              {FIELD_LABELS[f]}
                            </option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.map((r, i) => {
                    const rowNo = Math.max(0, headerRow) + i;
                    const isHeader = rowNo === headerRow;
                    return (
                      <tr key={rowNo} className={cn(isHeader && 'bg-sky-50 font-semibold')}>
                        <td className="text-muted-foreground px-1 py-1">{rowNo + 1}</td>
                        {Array.from({ length: width }, (_, c) => (
                          <td key={c} className="max-w-[220px] truncate px-1 py-1">
                            {r[c] instanceof Date
                              ? (r[c] as Date).toLocaleDateString('uz-UZ')
                              : String(r[c] ?? '')}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {extracted.rows.length > 0 && (
              <div className="text-muted-foreground text-xs">
                Birinchi qator: <b className="text-foreground">{extracted.rows[0]!.name}</b> · soni{' '}
                {extracted.rows[0]!.quantity ?? '—'} · narx {extracted.rows[0]!.cost ?? '—'}
                {extracted.rows[0]!.expiry ? ` · muddat ${extracted.rows[0]!.expiry}` : ''}
                {extracted.rows[0]!.batch ? ` · seriya ${extracted.rows[0]!.batch}` : ''}
              </div>
            )}

            {missing.length > 0 && (
              <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Belgilanmagan: {missing.join(', ')}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Bu moslashuvni {supplierId ? 'shu firma' : 'umumiy'} uchun eslab qolish
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button
            disabled={loading || missing.length > 0 || extracted.rows.length === 0}
            onClick={proceed}
          >
            {extracted.rows.length} ta qatorni yuklash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
