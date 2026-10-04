import { useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { extractRows, pickSheet, readSpreadsheet } from '@/lib/pharmacy/excel-import';
import { errText, fmt } from './shared';

// =============================================================================
// Katalog importi — dorilar ro'yxatini (qoldiqsiz) Excel yoki CSV'dan yuklash.
// Sarlavha qatori va ustunlar avtomatik aniqlanadi (UZ/RU/EN nomlar).
// Qoldiq bilan kirim kerak bo'lsa — "Prixod" bo'limidagi Excel import.
// =============================================================================

type CatalogRow = {
  name: string;
  barcode?: string;
  manufacturer?: string;
  strength?: string;
  form?: string;
  price_uzs: number;
  cost_uzs?: number;
};

const TEMPLATE =
  'Nomi,Shtrix kod,Ishlab chiqaruvchi,Dozasi,Shakli,Sotuv narxi,Tannarx\n' +
  'Paracetamol 500mg,4780000001234,Pharmstandard,500mg,tabletka,5000,2500\n' +
  'Ibuprofen 200mg,,Acino,200mg,kapsula,8000,4000\n';

export function ImportCatalogTab() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<{
    inserted: number;
    updated: number;
    errors: Array<{ row: number; message: string }>;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const importMut = useMutation({
    mutationFn: () => api.pharmacy.importCsv(rows),
    onSuccess: (data) => {
      setResult(data);
      setRows([]);
      setFileName('');
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReading(true);
    setResult(null);
    try {
      const sheet = await readSpreadsheet(file);
      const picked = pickSheet(sheet.sheets);
      if (!picked) {
        toast.error("Faylda sarlavha topilmadi — kamida 'Nomi' va 'Narx' ustunlari bo'lsin");
        return;
      }
      const src = sheet.sheets[picked.index]!;
      const { rows: parsed } = extractRows(
        src.rows,
        picked.header.headerRow,
        picked.header.mapping,
      );
      const out: CatalogRow[] = [];
      let skip = 0;
      for (const r of parsed) {
        // Katalogda "Narx" odatda sotuv narxi: alohida sotuv ustuni bo'lsa o'sha,
        // bo'lmasa narx ustuni sotuv narxi deb olinadi.
        const price = Math.round(r.sale_price ?? r.cost ?? 0);
        if (!r.name || price <= 0) {
          skip++;
          continue;
        }
        out.push({
          name: r.name,
          barcode: r.barcode,
          manufacturer: r.manufacturer,
          strength: r.strength,
          form: r.form,
          price_uzs: price,
          cost_uzs: r.sale_price != null && r.cost != null ? Math.round(r.cost) : undefined,
        });
      }
      setRows(out);
      setSkipped(skip);
      setFileName(file.name);
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setReading(false);
    }
  };

  const downloadTemplate = () => {
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + TEMPLATE);
    a.download = 'dorilar_katalog_shablon.csv';
    a.click();
  };

  return (
    <div className="max-w-4xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Dorilar katalogini import qilish (Excel / CSV)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="mr-1 h-4 w-4" />
              Shablon yuklab olish
            </Button>
            <Button size="sm" disabled={reading} onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-4 w-4" />
              {reading ? "O'qilmoqda…" : 'Fayl tanlash (.xlsx, .xls, .csv)'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,text/csv"
              className="hidden"
              onChange={(e) => void handleFile(e)}
            />
          </div>

          {fileName && (
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              <span className="font-medium">{fileName}</span> — {rows.length} ta dori
              {skipped > 0 && (
                <span className="text-amber-600">
                  {' '}
                  · {skipped} ta qator tashlandi (nom yoki narx yo'q)
                </span>
              )}
            </p>
          )}

          {rows.length > 0 && (
            <div>
              <div className="overflow-x-auto rounded border text-xs">
                <table className="w-full">
                  <thead className="bg-muted/40">
                    <tr>
                      {[
                        'Nomi',
                        'Shtrix-kod',
                        'Ishlab chiqaruvchi',
                        'Dozasi',
                        'Shakli',
                        'Sotuv narxi',
                        'Tannarx',
                      ].map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.slice(0, 15).map((r, i) => (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="px-2 py-1.5 font-medium">{r.name}</td>
                        <td className="px-2 py-1.5 font-mono">{r.barcode ?? '—'}</td>
                        <td className="px-2 py-1.5">{r.manufacturer ?? '—'}</td>
                        <td className="px-2 py-1.5">{r.strength ?? '—'}</td>
                        <td className="px-2 py-1.5">{r.form ?? '—'}</td>
                        <td className="px-2 py-1.5">{fmt(r.price_uzs)}</td>
                        <td className="px-2 py-1.5">
                          {r.cost_uzs != null ? fmt(r.cost_uzs) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 15 && (
                <p className="text-muted-foreground mt-1 text-xs">
                  … va yana {rows.length - 15} ta
                </p>
              )}
              <Button
                className="mt-3 w-full"
                disabled={importMut.isPending}
                onClick={() => importMut.mutate()}
              >
                {importMut.isPending
                  ? 'Import qilinmoqda…'
                  : `${rows.length} ta dorini import qilish`}
              </Button>
            </div>
          )}

          {result && (
            <div className="space-y-2 rounded-md border p-4">
              <div className="text-sm font-medium text-emerald-700">Import yakunlandi</div>
              <div className="text-sm">
                Yangi: <strong>{result.inserted}</strong> ta · Yangilandi:{' '}
                <strong>{result.updated}</strong> ta
              </div>
              {result.errors.length > 0 && (
                <div className="space-y-1">
                  <div className="text-destructive text-sm font-medium">
                    {result.errors.length} ta xato:
                  </div>
                  {result.errors.slice(0, 50).map((e) => (
                    <div key={e.row} className="text-muted-foreground text-xs">
                      {e.row}-qator: {e.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="text-muted-foreground space-y-1 p-4 text-sm">
          <div className="text-foreground font-medium">Qanday ishlaydi</div>
          <div>
            · Sarlavha qatori istalgan joyda bo'lishi mumkin — avtomatik topiladi (ruscha/o'zbekcha
            nomlar).
          </div>
          <div>
            · Shtrix-kodi bazada bor dori yangilanadi, qolganlari yangi dori sifatida qo'shiladi.
          </div>
          <div>
            · Qoldiq bu yerda kiritilmaydi — kirim uchun "Prixod" bo'limida Excel faktura yuklang.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
