import { useDeferredValue, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Barcode,
  History,
  Loader2,
  Pill,
  Plus,
  Printer,
  QrCode,
  Search,
  Tag,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@clary/ui-web';
import { formatStock, normalizeBarcode, packQty, unitLabel, unitPrice } from '@clary/utils';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { printBarcodeStickers, printPriceTags } from '@/lib/pharmacy/print';
import { useScanner } from '@/lib/scanner/use-scanner';
import { usePharmacy } from './context';
import { LineField, QrLabelModal, errText, fmt, uploadMedImage } from './shared';

// =============================================================================
// Ombor — dorilar katalogi: birliklar (qadoq/blister/dona), shtrix-kodlar,
// MXIK/QQS (fiskal chek), narx tarixi, narx yorliqlari.
// =============================================================================
export type MedFull = Awaited<ReturnType<typeof api.pharmacy.listMedicationsFull>>[number];

type StockFilter = 'all' | 'low' | 'out' | 'expiring' | 'no-barcode' | 'no-mxik';

const FILTERS: Array<{ id: StockFilter; label: string }> = [
  { id: 'all', label: 'Hammasi' },
  { id: 'low', label: 'Kam qolgan' },
  { id: 'out', label: 'Tugagan' },
  { id: 'expiring', label: 'Muddati yaqin (90 kun)' },
  { id: 'no-barcode', label: 'Shtrixsiz' },
  { id: 'no-mxik', label: "MXIK yo'q" },
];

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const d = new Date(date + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - Date.now()) / 86_400_000);
}

export function MedicationsTab() {
  const qc = useQueryClient();
  const ph = usePharmacy();
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q.trim());
  const [filter, setFilter] = useState<StockFilter>('all');
  const [editing, setEditing] = useState<MedFull | null>(null);
  const [creating, setCreating] = useState(false);
  const [barcodesFor, setBarcodesFor] = useState<MedFull | null>(null);
  const [historyFor, setHistoryFor] = useState<MedFull | null>(null);
  const [packFor, setPackFor] = useState<MedFull | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qrMed, setQrMed] = useState<{
    name: string;
    barcode: string;
    price_uzs: number;
    strength?: string;
  } | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['pharmacy', 'meds-full', dq],
    queryFn: () => api.pharmacy.listMedicationsFull(dq || undefined),
    placeholderData: (prev) => prev,
  });
  const all = useMemo(() => data ?? [], [data]);

  const meds = useMemo(() => {
    return all.filter((m) => {
      switch (filter) {
        case 'low':
          return m.qty_in_stock > 0 && m.qty_in_stock <= (m.reorder_level ?? 0);
        case 'out':
          return m.qty_in_stock <= 0;
        case 'expiring': {
          const d = daysUntil(m.earliest_expiry);
          return d != null && d <= 90 && m.qty_in_stock > 0;
        }
        case 'no-barcode':
          return !m.barcode && m.barcodes_count === 0;
        case 'no-mxik':
          return !m.mxik_code;
        default:
          return true;
      }
    });
  }, [all, filter]);

  // Skaner: kod o'qilsa shu dori topiladi (qidiruvga yoziladi)
  useScanner((e) => setQ(e.parsed.gtin ?? e.parsed.code));

  const archiveMut = useMutation({
    mutationFn: (id: string) => api.pharmacy.archiveMedication(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      toast.success('Arxivlandi');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allVisibleSelected = meds.length > 0 && meds.every((m) => selected.has(m.id));
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allVisibleSelected) meds.forEach((m) => n.delete(m.id));
      else meds.forEach((m) => n.add(m.id));
      return n;
    });

  const printTags = async () => {
    const chosen = all.filter((m) => selected.has(m.id));
    if (chosen.length === 0) return;
    try {
      await printPriceTags(
        chosen.map((m) => {
          const kind = packQty(m) > 1 ? 'pack' : 'unit';
          return {
            name: m.name,
            strength: m.strength,
            price: unitPrice(m, kind),
            unitText: unitLabel(kind, m),
            barcode: m.barcode,
          };
        }),
        ph.clinicName,
      );
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const canEdit = ph.isAdmin;
  const canCreate = ph.canReceive || ph.isAdmin;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative min-w-[220px] max-w-md flex-1">
          <Search className="text-muted-foreground absolute left-2 top-2.5 h-4 w-4" />
          <Input
            className="pl-8"
            placeholder="Nomi, xalqaro nomi, shtrix-kod… (skaner ham ishlaydi)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {isFetching && (
            <Loader2 className="text-muted-foreground absolute right-2 top-2.5 h-4 w-4 animate-spin" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.size > 0 && (
            <Button variant="outline" onClick={() => void printTags()}>
              <Tag className="mr-1 h-4 w-4" /> Narx yorlig'i ({selected.size})
            </Button>
          )}
          {canCreate && (
            <Button
              onClick={() => {
                setEditing(null);
                setCreating(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Dori qo'shish
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              filter === f.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'hover:bg-muted',
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="text-muted-foreground ml-auto self-center text-xs">
          {meds.length} ta dori
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-muted-foreground p-6 text-sm">Yuklanmoqda…</div>
          ) : meds.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Dori topilmadi"
                description="Qidiruvni o'zgartiring yoki yangi dori qo'shing"
              />
            </div>
          ) : (
            <div className="max-h-[calc(100vh-260px)] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-muted-foreground sticky top-0 z-10 text-xs backdrop-blur">
                  <tr>
                    <th className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAll}
                        aria-label="Hammasi"
                      />
                    </th>
                    <th className="px-3 py-2 text-left">Nomi</th>
                    <th className="px-3 py-2 text-left">Ishlab chiqaruvchi</th>
                    <th className="px-3 py-2 text-right">Narx</th>
                    {ph.canSeeCost && <th className="px-3 py-2 text-right">Tannarx</th>}
                    <th className="px-3 py-2 text-right">Qoldiq</th>
                    <th className="px-3 py-2 text-left">Muddat</th>
                    <th className="px-3 py-2 text-left">Shtrix / MXIK</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {meds.map((m) => {
                    const low = m.qty_in_stock <= (m.reorder_level ?? 0);
                    const pq = packQty(m);
                    const exp = daysUntil(m.earliest_expiry);
                    const unsellable = m.qty_in_stock - m.qty_sellable;
                    return (
                      <tr
                        key={m.id}
                        className={cn('hover:bg-muted/30', selected.has(m.id) && 'bg-primary/5')}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selected.has(m.id)}
                            onChange={() => toggle(m.id)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {m.image_url ? (
                              <img
                                src={m.image_url}
                                alt=""
                                className="h-8 w-8 rounded object-cover"
                              />
                            ) : (
                              <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded">
                                <Pill className="text-muted-foreground h-4 w-4" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="font-medium">
                                {m.name}
                                {m.requires_prescription && (
                                  <Badge variant="outline" className="ml-1 text-[10px]">
                                    Rx
                                  </Badge>
                                )}
                              </div>
                              <div className="text-muted-foreground text-[11px]">
                                {[m.strength, m.form, m.generic_name, m.category_name]
                                  .filter(Boolean)
                                  .join(' · ')}
                                {pq > 1 && (
                                  <span className="ml-1 rounded bg-sky-50 px-1 text-sky-700">
                                    1 qadoq = {pq} {unitLabel('unit', m)}
                                    {m.sell_by_unit ? ' · donalab' : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2">{m.manufacturer ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {pq > 1 ? (
                            <>
                              <div className="font-medium">{fmt(unitPrice(m, 'pack'))}</div>
                              <div className="text-muted-foreground text-[11px]">
                                {fmt(m.price_uzs)} / {unitLabel('unit', m)}
                              </div>
                            </>
                          ) : (
                            fmt(m.price_uzs)
                          )}
                        </td>
                        {ph.canSeeCost && (
                          <td className="text-muted-foreground px-3 py-2 text-right">
                            {m.cost_uzs != null ? fmt(m.cost_uzs) : '—'}
                          </td>
                        )}
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <span className={low ? 'font-semibold text-amber-600' : ''}>
                            {formatStock(m.qty_in_stock, m)}
                          </span>
                          {unsellable > 0 && (
                            <div className="text-[11px] text-rose-600">
                              {formatStock(unsellable, m)} muddati o'tgan
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          {m.earliest_expiry ? (
                            <span
                              className={cn(
                                exp != null && exp < 0
                                  ? 'text-rose-600'
                                  : exp != null && exp <= 90
                                    ? 'text-amber-600'
                                    : 'text-muted-foreground',
                              )}
                            >
                              {m.earliest_expiry}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div className="font-mono">{m.barcode ?? '—'}</div>
                          <div className="text-muted-foreground">
                            {m.barcodes_count > 1 ? `+${m.barcodes_count - 1} kod · ` : ''}
                            {m.mxik_code ? (
                              `MXIK ${m.mxik_code}`
                            ) : (
                              <span className="text-amber-600">MXIK yo'q</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-0.5">
                            {canEdit && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setEditing(m);
                                  setCreating(true);
                                }}
                              >
                                Tahrir
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="Shtrix-kodlar"
                              onClick={() => setBarcodesFor(m)}
                            >
                              <Barcode className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="Narx tarixi"
                              onClick={() => setHistoryFor(m)}
                            >
                              <History className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="QR yorliq"
                              onClick={() =>
                                setQrMed({
                                  name: m.name,
                                  barcode: m.barcode || m.id,
                                  price_uzs: m.price_uzs,
                                  strength: m.strength ?? undefined,
                                })
                              }
                            >
                              <QrCode className="h-3.5 w-3.5" />
                            </Button>
                            {ph.isAdmin && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                title="Arxivlash"
                                onClick={() => {
                                  if (window.confirm(`${m.name} arxivlansinmi?`))
                                    archiveMut.mutate(m.id);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {creating && (
        <MedicationFormDialog
          initial={editing}
          onPackSize={editing && canEdit ? () => setPackFor(editing) : undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      {barcodesFor && <BarcodesDialog med={barcodesFor} onClose={() => setBarcodesFor(null)} />}
      {historyFor && <PriceHistoryDialog med={historyFor} onClose={() => setHistoryFor(null)} />}
      {packFor && <PackSizeDialog med={packFor} onClose={() => setPackFor(null)} />}
      <QrLabelModal open={!!qrMed} med={qrMed} onClose={() => setQrMed(null)} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Dori anketasi (yangi / tahrir)
// -----------------------------------------------------------------------------
const UNIT_NAMES = [
  'dona',
  'tabletka',
  'kapsula',
  'ampula',
  'flakon',
  'paket',
  'shisha',
  'tuba',
  'sham',
];
const VAT_OPTIONS = [
  { v: 'none', l: 'QQSsiz' },
  { v: '0', l: '0%' },
  { v: '12', l: '12%' },
];

export function MedicationFormDialog({
  initial,
  preset,
  onClose,
  onSaved,
  onPackSize,
}: {
  initial: MedFull | null;
  /** Yangi dori uchun oldindan to'ldirish (masalan, skanerdan noma'lum kod). */
  preset?: { name?: string; barcode?: string; manufacturer?: string; mxik_code?: string };
  onClose: () => void;
  onSaved?: (id: string) => void;
  onPackSize?: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? preset?.name ?? '');
  const [genericName, setGenericName] = useState(initial?.generic_name ?? '');
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '');
  const [manufacturer, setManufacturer] = useState(
    initial?.manufacturer ?? preset?.manufacturer ?? '',
  );
  const [strength, setStrength] = useState(initial?.strength ?? '');
  const [form, setForm] = useState(initial?.form ?? '');
  const [barcode, setBarcode] = useState(initial?.barcode ?? preset?.barcode ?? '');
  const [price, setPrice] = useState(String(initial?.price_uzs ?? ''));
  const [cost, setCost] = useState(initial?.cost_uzs != null ? String(initial.cost_uzs) : '');
  const [reorder, setReorder] = useState(
    initial?.reorder_level != null ? String(initial.reorder_level) : '',
  );
  const [rx, setRx] = useState(initial?.requires_prescription ?? false);
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? '');
  const [uploading, setUploading] = useState(false);
  // Birliklar
  const [pack, setPack] = useState(String(initial?.pack_qty ?? 1));
  const [blister, setBlister] = useState(
    initial?.blister_qty != null ? String(initial.blister_qty) : '',
  );
  const [unitName, setUnitName] = useState(initial?.unit_name ?? '');
  const [packPrice, setPackPrice] = useState(
    initial?.pack_price_uzs != null ? String(initial.pack_price_uzs) : '',
  );
  const [blisterPrice, setBlisterPrice] = useState(
    initial?.blister_price_uzs != null ? String(initial.blister_price_uzs) : '',
  );
  const [sellByUnit, setSellByUnit] = useState(initial?.sell_by_unit ?? false);
  // Fiskal
  const [mxik, setMxik] = useState(initial?.mxik_code ?? preset?.mxik_code ?? '');
  const [packageCode, setPackageCode] = useState(initial?.package_code ?? '');
  const [vat, setVat] = useState(
    initial?.vat_percent != null ? String(initial.vat_percent) : 'none',
  );

  // Skaner: dialog ochiq bo'lsa kod shtrix maydoniga tushadi
  useScanner((e) => setBarcode(e.parsed.gtin ?? e.parsed.code), { priority: 10 });

  const { data: cats } = useQuery({
    queryKey: ['pharmacy', 'med-cats'],
    queryFn: () => api.pharmacy.listMedCategories(),
  });

  const pq = isEdit ? (initial?.pack_qty ?? 1) : Math.max(1, Math.floor(Number(pack) || 1));
  const priceN = Number(price) || 0;
  const autoPack = priceN * pq;

  const saveMut = useMutation({
    mutationFn: () => {
      const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v) || 0)));
      const body: Record<string, unknown> = {
        name: name.trim(),
        generic_name: genericName.trim() || null,
        category_id: categoryId || null,
        manufacturer: manufacturer.trim() || undefined,
        strength: strength.trim() || undefined,
        form: form.trim() || undefined,
        barcode: barcode.trim() ? normalizeBarcode(barcode.trim()) : undefined,
        price_uzs: Math.max(0, Math.round(priceN)),
        cost_uzs: num(cost),
        reorder_level: num(reorder),
        requires_prescription: rx,
        image_url: imageUrl || null,
        blister_qty: num(blister) || null,
        unit_name: unitName.trim() || null,
        pack_price_uzs: pq > 1 ? num(packPrice) : null,
        blister_price_uzs: num(blister) ? num(blisterPrice) : null,
        sell_by_unit: pq > 1 ? sellByUnit : false,
        mxik_code: mxik.trim() || null,
        package_code: packageCode.trim() || null,
        vat_percent: vat === 'none' ? null : Number(vat),
      };
      if (!isEdit) body.pack_qty = pq;
      return isEdit && initial
        ? api.pharmacy.updateMedication(initial.id, body)
        : api.pharmacy.createMedication(body);
    },
    onSuccess: (res) => {
      toast.success(isEdit ? 'Yangilandi' : "Qo'shildi");
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      onSaved?.(((res as { id?: string } | null)?.id ?? initial?.id ?? '') as string);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addCategory = async () => {
    const nm = window.prompt('Yangi kategoriya nomi:');
    if (!nm) return;
    try {
      const c = await api.pharmacy.createMedCategory({ name: nm });
      await qc.invalidateQueries({ queryKey: ['pharmacy', 'med-cats'] });
      setCategoryId(c.id);
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const handleImage = async (file?: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      setImageUrl(await uploadMedImage(file));
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setUploading(false);
    }
  };

  const uname = unitName.trim() || 'dona';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Dorini tahrirlash' : 'Yangi dori'}</DialogTitle>
          <DialogDescription>
            Shtrix-kodni skaner bilan ham o'qitish mumkin — maydonga o'zi tushadi.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <section className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <LineField label="Savdo nomi *">
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </LineField>
            </div>
            <LineField label="Xalqaro nomi (INN)">
              <Input
                value={genericName}
                onChange={(e) => setGenericName(e.target.value)}
                placeholder="paracetamol"
              />
            </LineField>
            <LineField label="Dozasi">
              <Input
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                placeholder="500 mg"
              />
            </LineField>
            <LineField label="Shakli">
              <Input
                value={form}
                onChange={(e) => setForm(e.target.value)}
                placeholder="tabletka"
              />
            </LineField>
            <LineField label="Ishlab chiqaruvchi">
              <Input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
            </LineField>
            <LineField label="Asosiy shtrix-kod">
              <Input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="EAN-13 / DataMatrix"
                className="font-mono"
              />
            </LineField>
            <LineField label="Kategoriya">
              <div className="flex gap-1">
                <Select
                  value={categoryId || 'none'}
                  onValueChange={(v) => setCategoryId(v === 'none' ? '' : v)}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {(cats ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  title="Yangi kategoriya"
                  onClick={() => void addCategory()}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </LineField>
            <LineField label="Rasm">
              <div className="flex items-center gap-2">
                {imageUrl && <img src={imageUrl} alt="" className="h-9 w-9 rounded object-cover" />}
                <label className="bg-card hover:bg-accent inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1.5 text-xs">
                  <Upload className="h-3 w-3" />{' '}
                  {uploading ? 'Yuklanmoqda…' : imageUrl ? "O'zgartirish" : 'Yuklash'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void handleImage(e.target.files?.[0])}
                  />
                </label>
              </div>
            </LineField>
          </section>

          <section className="rounded-lg border p-3">
            <div className="mb-2 text-sm font-semibold">Birliklar va narx</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <LineField label="Eng kichik birlik">
                <Input
                  list="clary-unit-names"
                  value={unitName}
                  onChange={(e) => setUnitName(e.target.value)}
                  placeholder="dona"
                />
                <datalist id="clary-unit-names">
                  {UNIT_NAMES.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </LineField>
              <LineField label={`1 qadoqda (${uname})`}>
                {isEdit ? (
                  <div className="flex items-center gap-1">
                    <Input value={String(pq)} disabled className="w-20" />
                    {onPackSize && (
                      <Button type="button" variant="outline" size="sm" onClick={onPackSize}>
                        O'zgartirish
                      </Button>
                    )}
                  </div>
                ) : (
                  <Input
                    type="number"
                    min={1}
                    value={pack}
                    onChange={(e) => setPack(e.target.value)}
                  />
                )}
              </LineField>
              <LineField label={`1 blisterda (${uname})`}>
                <Input
                  type="number"
                  min={1}
                  value={blister}
                  onChange={(e) => setBlister(e.target.value)}
                  placeholder="—"
                  disabled={pq <= 1}
                />
              </LineField>
              <LineField label="Min. qoldiq (dona)">
                <Input
                  type="number"
                  min={0}
                  value={reorder}
                  onChange={(e) => setReorder(e.target.value)}
                />
              </LineField>
              <LineField label={`1 ${uname} narxi (so'm) *`}>
                <Input
                  type="number"
                  min={0}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </LineField>
              <LineField label="Qadoq narxi (so'm)">
                <Input
                  type="number"
                  min={0}
                  value={packPrice}
                  onChange={(e) => setPackPrice(e.target.value)}
                  placeholder={pq > 1 ? `avto: ${fmt(autoPack)}` : '—'}
                  disabled={pq <= 1}
                />
              </LineField>
              <LineField label="Blister narxi (so'm)">
                <Input
                  type="number"
                  min={0}
                  value={blisterPrice}
                  onChange={(e) => setBlisterPrice(e.target.value)}
                  placeholder={
                    Number(blister) > 0 ? `avto: ${fmt(Math.round(priceN * Number(blister)))}` : '—'
                  }
                  disabled={pq <= 1 || !(Number(blister) > 0)}
                />
              </LineField>
              <LineField label={`Tannarx (1 ${uname})`}>
                <Input
                  type="number"
                  min={0}
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                />
              </LineField>
            </div>
            <label className={cn('mt-2 flex items-center gap-2 text-sm', pq <= 1 && 'opacity-50')}>
              <input
                type="checkbox"
                className="h-4 w-4"
                disabled={pq <= 1}
                checked={sellByUnit && pq > 1}
                onChange={(e) => setSellByUnit(e.target.checked)}
              />
              Donalab sotish mumkin (qadoqni ochib — blister / {uname})
            </label>
            {!isEdit && (
              <div className="bg-muted/40 text-muted-foreground mt-2 rounded-md px-3 py-2 text-[11px]">
                Ombor eng kichik birlikda ({uname}) yuritiladi. Qoldiq Prixod orqali to'ldiriladi.
              </div>
            )}
          </section>

          <section className="rounded-lg border p-3">
            <div className="mb-2 text-sm font-semibold">Fiskal chek (onlayn-NKM)</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <LineField label="MXIK (IKPU) kodi">
                <Input
                  value={mxik}
                  onChange={(e) => setMxik(e.target.value)}
                  placeholder="17 xonali"
                  className="font-mono"
                />
              </LineField>
              <LineField label="O'lchov/qadoq kodi">
                <Input
                  value={packageCode}
                  onChange={(e) => setPackageCode(e.target.value)}
                  className="font-mono"
                />
              </LineField>
              <LineField label="QQS">
                <Select value={vat} onValueChange={setVat}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VAT_OPTIONS.map((o) => (
                      <SelectItem key={o.v} value={o.v}>
                        {o.l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </LineField>
            </div>
          </section>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rx}
              onChange={(e) => setRx(e.target.checked)}
              className="h-4 w-4"
            />
            Retsept talab qiladi (Rx)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button disabled={!name.trim() || saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? 'Saqlanmoqda…' : isEdit ? 'Saqlash' : "Qo'shish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Qadoqdagi donalar sonini o'zgartirish (qoldiqni qayta hisoblash bilan)
// -----------------------------------------------------------------------------
function PackSizeDialog({ med, onClose }: { med: MedFull; onClose: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(String(med.pack_qty > 1 ? med.pack_qty : 10));
  const [convert, setConvert] = useState(med.pack_qty <= 1);
  const n = Math.max(1, Math.floor(Number(value) || 1));
  const mut = useMutation({
    mutationFn: () => api.pharmacy.setPackSize(med.id, { pack_qty: n, convert_stock: convert }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      toast.success(r.converted ? `Qoldiq donaga o'tkazildi (×${n})` : 'Saqlandi');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{med.name} — qadoq hajmi</DialogTitle>
          <DialogDescription>
            Hozir: 1 qadoq = {med.pack_qty} dona. Qoldiq: {fmt(med.qty_in_stock)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <LineField label="1 qadoqdagi donalar soni">
            <Input
              type="number"
              min={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
          </LineField>
          <label className="flex items-start gap-2 rounded-md border p-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={convert}
              onChange={(e) => setConvert(e.target.checked)}
            />
            <span>
              Hozirgi qoldiq <b>qadoqda</b> hisoblangan — donaga o'tkazilsin
              <span className="text-muted-foreground block text-xs">
                Masalan, 5 qadoq → {5 * n} dona. Partiyalar, tannarx va narx ham shunga moslanadi.
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()}>
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Shtrix-kodlar: bir dorida bir nechta kod (turli ishlab chiqaruvchi qadoqlari,
// firma kodi, ichki EAN-13). Skaner bilan qo'shiladi.
// -----------------------------------------------------------------------------
const KIND_LABEL: Record<string, string> = {
  manufacturer: 'Ishlab chiqaruvchi',
  internal: 'Ichki (Clary)',
  supplier: 'Firma kodi',
};

function BarcodesDialog({ med, onClose }: { med: MedFull; onClose: () => void }) {
  const qc = useQueryClient();
  const ph = usePharmacy();
  const [code, setCode] = useState('');
  const { data, refetch, isLoading } = useQuery({
    queryKey: ['pharmacy', 'barcodes', med.id],
    queryFn: () => api.pharmacy.listBarcodes(med.id),
  });
  const refresh = () => {
    void refetch();
    qc.invalidateQueries({ queryKey: ['pharmacy', 'meds-full'] });
    qc.invalidateQueries({ queryKey: ['pharmacy', 'pos-catalog'] });
  };
  const add = useMutation({
    mutationFn: (c: string) => api.pharmacy.addBarcode(med.id, { code: c }),
    onSuccess: (r) => {
      toast.success(r.existed ? 'Bu kod allaqachon shu dorida' : "Kod qo'shildi");
      setCode('');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const internal = useMutation({
    mutationFn: () => api.pharmacy.internalBarcode(med.id),
    onSuccess: (r) => {
      toast.success(`Ichki kod: ${r.ean13}`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.pharmacy.removeBarcode(med.id, id),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  useScanner((e) => add.mutate(e.raw), { priority: 10 });

  const codes = data ?? [];
  const canAdd = ph.canReceive || ph.isAdmin;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{med.name} — shtrix-kodlar</DialogTitle>
          <DialogDescription>
            Skanerda o'qiting — kod avtomatik qo'shiladi. DataMatrix'dan faqat GTIN olinadi.
          </DialogDescription>
        </DialogHeader>
        {canAdd && (
          <div className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Kodni kiriting yoki skanerlang"
              className="font-mono"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.trim()) add.mutate(code.trim());
              }}
            />
            <Button
              disabled={!code.trim() || add.isPending}
              onClick={() => add.mutate(code.trim())}
            >
              Qo'shish
            </Button>
          </div>
        )}
        <div className="max-h-[40vh] divide-y overflow-y-auto rounded border">
          {isLoading ? (
            <div className="text-muted-foreground p-4 text-sm">Yuklanmoqda…</div>
          ) : codes.length === 0 ? (
            <div className="text-muted-foreground p-4 text-center text-sm">Kod yo'q</div>
          ) : (
            codes.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-mono">{c.code}</div>
                  <div className="text-muted-foreground text-[11px]">
                    {KIND_LABEL[c.kind] ?? c.kind}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Stiker chop etish"
                    onClick={() =>
                      void printBarcodeStickers([
                        { name: med.name, code: c.code.replace(/^0(\d{13})$/, '$1') },
                      ]).catch((e) => toast.error(errText(e)))
                    }
                  >
                    <Printer className="h-3.5 w-3.5" />
                  </Button>
                  {ph.isAdmin && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => {
                        if (window.confirm(`${c.code} o'chirilsinmi?`)) remove.mutate(c.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          {canAdd ? (
            <Button
              variant="outline"
              disabled={internal.isPending}
              onClick={() => internal.mutate()}
            >
              <Barcode className="mr-1 h-4 w-4" /> Ichki EAN-13 yaratish
            </Button>
          ) : (
            <span />
          )}
          <Button variant="outline" onClick={onClose}>
            Yopish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Narx tarixi
// -----------------------------------------------------------------------------
const SOURCE_LABEL: Record<string, string> = {
  manual: "Qo'lda",
  receipt: 'Prixod',
  receipt_void: 'Prixod bekor',
  pack_convert: 'Qadoq hajmi',
  import: 'Import',
};

function PriceHistoryDialog({ med, onClose }: { med: MedFull; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy', 'price-history', med.id],
    queryFn: () => api.pharmacy.priceHistory(med.id),
  });
  const rows = data ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{med.name} — narx tarixi</DialogTitle>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-y-auto rounded border">
          {isLoading ? (
            <div className="text-muted-foreground p-4 text-sm">Yuklanmoqda…</div>
          ) : rows.length === 0 ? (
            <div className="text-muted-foreground p-6 text-center text-sm">O'zgarish yo'q</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-muted-foreground sticky top-0 text-xs">
                <tr>
                  <th className="px-2 py-1.5 text-left">Sana</th>
                  <th className="px-2 py-1.5 text-right">Dona narxi</th>
                  <th className="px-2 py-1.5 text-right">Qadoq narxi</th>
                  <th className="px-2 py-1.5 text-left">Manba</th>
                  <th className="px-2 py-1.5 text-left">Kim</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">
                      {new Date(r.created_at).toLocaleString('uz-UZ')}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <span className="text-muted-foreground">{fmt(r.old_price_uzs)}</span> →{' '}
                      <b>{fmt(r.new_price_uzs)}</b>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {r.old_pack_price_uzs != null || r.new_pack_price_uzs != null ? (
                        <>
                          <span className="text-muted-foreground">{fmt(r.old_pack_price_uzs)}</span>{' '}
                          → <b>{fmt(r.new_pack_price_uzs)}</b>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-1.5">{SOURCE_LABEL[r.source] ?? r.source}</td>
                    <td className="text-muted-foreground px-2 py-1.5">
                      {r.changer?.full_name ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Yopish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
