import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  FileClock,
  FileSpreadsheet,
  Link2,
  Loader2,
  PackagePlus,
  PencilLine,
  Plus,
  Save,
  ScanLine,
  Settings2,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { Badge, Button, Card, Input, cn } from '@clary/ui-web';
import type { PharmacyCatalogItem, PharmacyImportMatch } from '@clary/api-client';
import { markupPercentOf, type ParsedScan } from '@clary/utils';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { buildCatalogIndex, findByScan } from '@/lib/pharmacy/catalog-search';
import { parseDate, parseNumber, type ImportedRow } from '@/lib/pharmacy/excel-import';
import { printPriceTags } from '@/lib/pharmacy/print';
import {
  DEFAULT_POLICY,
  currentSale,
  emptyLine,
  lineBaseQty,
  lineCostTotal,
  lineFactor,
  lineIssues,
  lineSale,
  receiptTotals,
  toApiItem,
  type MatchKind,
  type ReceiptLine,
  type ReceiptMed,
  type ReceiptPolicy,
} from '@/lib/pharmacy/receipt-math';
import { useScanner } from '@/lib/scanner/use-scanner';
import { usePharmacy } from './context';
import { MedicationFormDialog } from './medications';
import { DraftsDialog, MedPickerDialog } from './receipt-dialogs';
import { ImportDialog, type ImportOutcome, type ImportSource } from './receipt-import';
import { LineField, errText, fmt, permText } from './shared';
import { SupplierFormDialog } from './suppliers';

// =============================================================================
// Prixod 2.0 — bitta Excel fayl bilan kirim
// =============================================================================
//  1) Firma tanlanadi → Excel faktura yuklanadi (yoki Excel'dan nusxa → Ctrl+V).
//  2) Ustunlar avtomatik topiladi, dorilar bazaga moslanadi: shtrix-kod →
//     "firmadagi nom" xotirasi → MXIK → aniq nom. Qolganlari — bir bosishda
//     tanlash yoki yangi dori sifatida yaratish.
//  3) Ixtiyoriy: "Tekshirish" rejimida qutilarni skanerlab sanash.
//  4) "Omborga kirim" — bitta tranzaksiya, ikki marta yozilmaydi (idempotent).
// Qoralama har o'zgarishda shu kompyuterda saqlanadi; serverga ham saqlash mumkin.
// =============================================================================

type Header = {
  supplierId: string;
  receiptNo: string;
  invoiceDate: string;
  receivedAt: string;
  paid: string;
  payMethod: string;
  notes: string;
};

type DraftState = {
  v: 2;
  header: Header;
  lines: ReceiptLine[];
  idemKey: string;
  source: 'manual' | 'excel' | 'scan';
  fileName?: string;
  fileHash?: string;
  fileTotal?: number | null;
  serverDraftId?: string | null;
  verify?: boolean;
};

type Settings = ReceiptPolicy & { defaultMarkup: number };

const LOCAL_KEY = 'clary.pharmacy.receipt.v2';
const SETTINGS_KEY = 'clary.pharmacy.receipt.settings';

const today = () => new Date().toLocaleDateString('en-CA');

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

function blankState(): DraftState {
  return {
    v: 2,
    header: {
      supplierId: '',
      receiptNo: '',
      invoiceDate: '',
      receivedAt: today(),
      paid: '',
      payMethod: 'transfer',
      notes: '',
    },
    lines: [],
    idemKey: uuid(),
    source: 'manual',
    serverDraftId: null,
    verify: false,
  };
}

function loadState(): DraftState {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return blankState();
    const s = JSON.parse(raw) as DraftState;
    return s && s.v === 2 && Array.isArray(s.lines) ? s : blankState();
  } catch {
    return blankState();
  }
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return {
      ...DEFAULT_POLICY,
      defaultMarkup: 20,
      ...(raw ? (JSON.parse(raw) as Partial<Settings>) : {}),
    };
  } catch {
    return { ...DEFAULT_POLICY, defaultMarkup: 20 };
  }
}

type MedLike = Pick<
  PharmacyCatalogItem,
  | 'medication_id'
  | 'name'
  | 'strength'
  | 'pack_qty'
  | 'price_uzs'
  | 'pack_price_uzs'
  | 'unit_name'
  | 'manufacturer'
>;

function toReceiptMed(m: MedLike): ReceiptMed {
  return {
    id: m.medication_id,
    name: m.name,
    strength: m.strength ?? null,
    pack_qty: Math.max(1, Number(m.pack_qty) || 1),
    price_uzs: Number(m.price_uzs) || 0,
    pack_price_uzs: m.pack_price_uzs ?? null,
    unit_name: m.unit_name ?? null,
    manufacturer: m.manufacturer ?? null,
  };
}

/** Joriy narx tannarxdan past bo'lmasa — narx o'zgarmaydi (kutilmagan qimmatlashuv yo'q). */
function suggestSale(l: ReceiptLine): number | null {
  if (l.sale != null && l.sale > 0) return l.sale;
  const cur = currentSale(l);
  if (cur != null && cur > 0 && l.cost > 0 && cur >= l.cost) return cur;
  return null;
}

function linkMed(l: ReceiptLine, med: ReceiptMed, match: MatchKind): ReceiptLine {
  const next: ReceiptLine = {
    ...l,
    med,
    medication_id: med.id,
    match,
    new_med: null,
    unit_kind: med.pack_qty > 1 ? l.unit_kind : 'unit',
  };
  // Boshqa doriga bog'langanda narx qaytadan taklif qilinadi (eski dori narxi qolmasin)
  return { ...next, sale: suggestSale({ ...next, sale: null }) };
}

const MATCH_LABEL: Record<string, { text: string; cls: string }> = {
  barcode: { text: 'shtrix', cls: 'bg-emerald-50 text-emerald-700' },
  alias: { text: 'xotira', cls: 'bg-emerald-50 text-emerald-700' },
  mxik: { text: 'MXIK', cls: 'bg-emerald-50 text-emerald-700' },
  name: { text: 'nom', cls: 'bg-emerald-50 text-emerald-700' },
  manual: { text: 'qo‘lda', cls: 'bg-sky-50 text-sky-700' },
  new: { text: 'yangi', cls: 'bg-violet-50 text-violet-700' },
};

const COLS = ['qty', 'cost', 'markup', 'sale', 'batch', 'expiry'] as const;
type Col = (typeof COLS)[number];

function focusCell(row: number, col: Col) {
  const el = document.querySelector<HTMLInputElement>(`[data-rcell="${row}:${col}"]`);
  if (el) {
    el.focus();
    el.select();
  }
}

function navKeys(row: number, col: Col) {
  return (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      focusCell(row + 1, col);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusCell(row - 1, col);
    }
  };
}

let audioCtx: AudioContext | null = null;
function beep(ok: boolean) {
  try {
    audioCtx ??= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.value = ok ? 1400 : 320;
    g.gain.value = 0.04;
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + (ok ? 0.06 : 0.25));
  } catch {
    /* ovozsiz */
  }
}

export function ReceiptTab() {
  const ph = usePharmacy();
  const qc = useQueryClient();
  const [st, setSt] = useState<DraftState>(loadState);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [importSource, setImportSource] = useState<ImportSource | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ key: string | null } | null>(null);
  // Yangi dori — Ombordagi forma (nomi qidiruvdan oldindan to'ldiriladi)
  const [medForm, setMedForm] = useState<{ name: string } | null>(null);
  const [unknown, setUnknown] = useState<ParsedScan | null>(null);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [duplicates, setDuplicates] = useState<
    Array<{
      id: string;
      receipt_no: string | null;
      received_at: string;
      total_cost_uzs: number;
      reason: string;
    }>
  >([]);
  const [posted, setPosted] = useState<{
    count: number;
    total: number;
    tags: Parameters<typeof printPriceTags>[0];
  } | null>(null);
  const [bulkMarkup, setBulkMarkup] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const policy: ReceiptPolicy = settings;

  // Avtosaqlash (shu kompyuter)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (st.lines.length === 0 && !st.header.supplierId && !st.header.receiptNo)
          localStorage.removeItem(LOCAL_KEY);
        else localStorage.setItem(LOCAL_KEY, JSON.stringify(st));
      } catch {
        /* to'lgan */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [st]);
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  const suppliersQ = useQuery({
    queryKey: ['pharmacy', 'suppliers'],
    queryFn: () => api.pharmacy.listSuppliers(),
  });
  const catalogQ = useQuery({
    queryKey: ['pharmacy', 'pos-catalog'],
    queryFn: () => api.pharmacy.posCatalog(),
    staleTime: 30_000,
  });
  const index = useMemo(() => buildCatalogIndex(catalogQ.data?.items ?? []), [catalogQ.data]);
  const suppliers = suppliersQ.data ?? [];
  const supplier = suppliers.find((s) => s.id === st.header.supplierId) ?? null;

  const setHeader = (patch: Partial<Header>) =>
    setSt((s) => ({ ...s, header: { ...s.header, ...patch } }));
  const updateLine = useCallback(
    (key: string, patch: Partial<ReceiptLine> | ((l: ReceiptLine) => ReceiptLine)) =>
      setSt((s) => ({
        ...s,
        lines: s.lines.map((l) =>
          l.key === key ? (typeof patch === 'function' ? patch(l) : { ...l, ...patch }) : l,
        ),
      })),
    [],
  );
  const removeLine = (key: string) =>
    setSt((s) => ({ ...s, lines: s.lines.filter((l) => l.key !== key) }));

  const lines = st.lines;
  const totals = receiptTotals(lines, policy);
  const issuesByKey = useMemo(() => {
    const m = new Map<string, ReturnType<typeof lineIssues>>();
    for (const l of lines) m.set(l.key, lineIssues(l, policy));
    return m;
  }, [lines, policy]);
  const errorCount = [...issuesByKey.values()].filter((x) =>
    x.some((i) => i.level === 'error'),
  ).length;
  const warnCount = [...issuesByKey.values()].filter(
    (x) => !x.some((i) => i.level === 'error') && x.some((i) => i.level === 'warn'),
  ).length;
  const unlinked = lines.filter((l) => !l.medication_id);
  const creatable = unlinked.filter(
    (l) => l.match !== 'suggested' && l.new_med && l.new_med.name.trim(),
  );
  const suggested = unlinked.filter((l) => l.match === 'suggested');
  const paidN = Math.max(0, Math.round(parseNumber(st.header.paid) ?? 0));

  // ---------------------------------------------------------------------------
  // Excel import → moslash
  // ---------------------------------------------------------------------------
  const buildLine = (r: ImportedRow, m: PharmacyImportMatch | undefined): ReceiptLine => {
    const item = m?.medication_id ? index.byId.get(m.medication_id) : undefined;
    const cand =
      !item && m?.candidates?.[0] && m.candidates[0].score >= 0.55 ? m.candidates[0] : null;
    const base = emptyLine({
      source_name: [r.name, r.strength].filter(Boolean).join(' '),
      source_row: r.row,
      medication_id: item ? item.medication_id : null,
      med: item ? toReceiptMed(item) : null,
      match: item ? ((m!.method ?? 'name') as MatchKind) : cand ? 'suggested' : null,
      score: m?.score ?? cand?.score ?? null,
      candidates: m?.candidates ?? [],
      unit_kind: r.unit_kind ?? 'pack',
      qty: r.quantity ?? 0,
      cost: Math.max(0, r.cost ?? 0),
      markup: settings.defaultMarkup,
      sale: r.sale_price != null && r.sale_price > 0 ? Math.round(r.sale_price) : null,
      batch_no: r.batch ?? '',
      expiry: r.expiry ?? '',
      mfg_date: r.mfg_date ?? '',
      manufacturer: r.manufacturer ?? '',
      gtin: r.barcode ?? '',
      mxik: r.mxik ?? '',
      last: m?.last ?? null,
      file_total: r.total ?? null,
      new_med: item
        ? null
        : {
            name: r.name,
            strength: r.strength,
            form: r.form,
            manufacturer: r.manufacturer,
            barcode: r.barcode,
            mxik_code: r.mxik,
            pack_qty: 1,
          },
    });
    if (base.med && base.med.pack_qty <= 1) base.unit_kind = 'unit';
    return { ...base, sale: suggestSale(base) };
  };

  const onImported = async (out: ImportOutcome) => {
    setImportSource(null);
    setBusy('Dorilar bazaga moslanmoqda…');
    try {
      const reqRows = out.rows.map((r, i) => ({
        idx: i,
        name: r.name.slice(0, 400),
        strength: r.strength?.slice(0, 100),
        barcode: r.barcode?.slice(0, 200),
        mxik: r.mxik?.slice(0, 40),
      }));
      const matches: PharmacyImportMatch[] = [];
      for (let i = 0; i < reqRows.length; i += 1000) {
        matches.push(
          ...(await api.pharmacy.importMatch({
            supplier_id: st.header.supplierId || undefined,
            rows: reqRows.slice(i, i + 1000),
          })),
        );
      }
      const byIdx = new Map(matches.map((m) => [m.idx, m]));
      const newLines = out.rows.map((r, i) => buildLine(r, byIdx.get(i)));
      setSt((s) => ({
        ...s,
        lines: [...s.lines, ...newLines],
        source: 'excel',
        fileName: out.fileName ?? s.fileName,
        fileHash: out.fileHash ?? s.fileHash,
        fileTotal: out.fileTotal ?? s.fileTotal ?? null,
      }));
      const matched = newLines.filter((l) => l.medication_id).length;
      toast.success(
        `${newLines.length} qator yuklandi: ${matched} tasi bazaga moslandi` +
          (newLines.length - matched ? `, ${newLines.length - matched} tasini tekshiring` : ''),
      );
      if (st.header.supplierId || out.fileHash) {
        const dup = await api.pharmacy
          .duplicateCheck({
            supplier_id: st.header.supplierId || undefined,
            receipt_no: st.header.receiptNo || undefined,
            file_hash: out.fileHash,
          })
          .catch(() => ({ duplicates: [] }));
        setDuplicates(dup.duplicates);
      }
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };

  // Excel'dan nusxa (Ctrl+V) — kursor katakda bo'lmasa
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text.includes('\t') && text.includes('\n')) {
        e.preventDefault();
        setImportSource({ kind: 'paste', text });
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.info("Bufer bo'sh — Excel'da qatorlarni belgilab Ctrl+C bosing");
        return;
      }
      setImportSource({ kind: 'paste', text });
    } catch {
      toast.info("Excel'da qatorlarni nusxalang va shu sahifada Ctrl+V bosing");
    }
  };

  // ---------------------------------------------------------------------------
  // Skaner: qo'shish yoki tekshirish (sanash)
  // ---------------------------------------------------------------------------
  const addScannedLine = async (item: MedLike, p: ParsedScan) => {
    const med = toReceiptMed(item);
    const draft = emptyLine({
      source_name: med.name,
      medication_id: med.id,
      med,
      match: 'barcode',
      unit_kind: med.pack_qty > 1 ? 'pack' : 'unit',
      qty: st.verify ? 0 : 1,
      checked: st.verify ? 1 : undefined,
      serials: p.serial ? [p.serial] : undefined,
      markup: settings.defaultMarkup,
      batch_no: p.batch ?? '',
      expiry: p.expiry ?? '',
      gtin: p.gtin ?? '',
    });
    setSt((s) => ({
      ...s,
      lines: [...s.lines, draft],
      source: s.source === 'manual' ? 'scan' : s.source,
    }));
    // Oxirgi kirim tannarxi — avtomatik
    try {
      const [m] = await api.pharmacy.importMatch({
        supplier_id: st.header.supplierId || undefined,
        rows: [{ idx: 0, name: med.name, barcode: p.gtin ?? p.code }],
      });
      if (m?.last) {
        updateLine(draft.key, (l) => {
          const cost = l.cost > 0 ? l.cost : Math.round(m.last!.unit_cost_uzs * lineFactor(l));
          const next = { ...l, last: m.last, cost };
          return { ...next, sale: suggestSale(next) };
        });
      }
    } catch {
      /* tannarx qo'lda */
    }
    setTimeout(() => focusCell(st.lines.length, st.verify ? 'qty' : 'cost'), 50);
  };

  const onScan = async (p: ParsedScan) => {
    if (p.kind === 'clary-sale' || p.kind === 'url') {
      toast.info('Bu dori kodi emas');
      return;
    }
    let item: MedLike | null = findByScan(index, p);
    if (!item) {
      try {
        const r = await api.pharmacy.lookup(p.raw);
        item = (r.medication as MedLike | null) ?? null;
      } catch {
        item = null;
      }
    }
    if (!item) {
      beep(false);
      setUnknown(p);
      return;
    }
    beep(true);
    const medId = item.medication_id;
    const sameBatch = (l: ReceiptLine) => !p.batch || !l.batch_no || l.batch_no === p.batch;
    const hit = st.lines.find((l) => l.medication_id === medId && sameBatch(l));
    if (st.verify) {
      if (hit) {
        if (p.serial && hit.serials?.includes(p.serial)) {
          toast.warning('Bu quti allaqachon sanalgan (seriya raqami bir xil)');
          return;
        }
        updateLine(hit.key, (l) => ({
          ...l,
          checked: (l.checked ?? 0) + 1,
          serials: p.serial ? [...(l.serials ?? []), p.serial] : l.serials,
          batch_no: l.batch_no || p.batch || '',
          expiry: l.expiry || p.expiry || '',
        }));
      } else {
        toast.warning(`${item.name} — fakturada yo'q`);
        await addScannedLine(item, p);
      }
      return;
    }
    if (hit) {
      updateLine(hit.key, (l) => ({
        ...l,
        qty: l.qty + (l.unit_kind === 'pack' ? 1 : Math.max(1, l.med?.pack_qty ?? 1)),
        batch_no: l.batch_no || p.batch || '',
        expiry: l.expiry || p.expiry || '',
        gtin: l.gtin || p.gtin || '',
      }));
      return;
    }
    await addScannedLine(item, p);
  };

  useScanner((e) => void onScan(e.parsed), {
    enabled:
      !importSource && !picker && !unknown && !draftsOpen && !newSupplierOpen && !busy && !medForm,
  });

  // ---------------------------------------------------------------------------
  // Qo'lda: bazadagi dorini qatorga qo'shish yoki yangi dorini Ombordagi
  // formaning o'zi bilan kiritish (saqlangach qatorga avtomatik tushadi)
  // ---------------------------------------------------------------------------
  const addPickedLine = (item: PharmacyCatalogItem, match: MatchKind = 'manual') => {
    const med = toReceiptMed(item);
    const l = emptyLine({
      source_name: med.name,
      medication_id: med.id,
      med,
      match,
      unit_kind: med.pack_qty > 1 ? 'pack' : 'unit',
      qty: 1,
      markup: settings.defaultMarkup,
    });
    const row = lines.length;
    setSt((s) => ({ ...s, lines: [...s.lines, l] }));
    setTimeout(() => focusCell(row, 'qty'), 50);
  };

  const onNewMedSaved = async (id: string) => {
    const r = await catalogQ.refetch();
    const item = r.data?.items.find((i) => i.medication_id === id);
    if (item) {
      addPickedLine(item, 'new');
      toast.success(`${item.name} prixodga qo'shildi — soni va tannarxini kiriting`);
    } else {
      toast.info("Dori bazaga qo'shildi — ro'yxatdan tanlang");
      setPicker({ key: null });
    }
  };

  // ---------------------------------------------------------------------------
  // Yangi dorilarni yaratish (bog'lanmagan qatorlar). Qaytaradi: dorilar
  // bog'langan qatorlar (xato bo'lsa null) — kirim shu bilan davom etadi.
  // ---------------------------------------------------------------------------
  const createNew = async (): Promise<ReceiptLine[] | null> => {
    if (creatable.length === 0) return lines;
    setBusy(`${creatable.length} ta yangi dori yaratilmoqda…`);
    try {
      const items = creatable.map((l) => {
        const pack = Math.max(1, l.new_med?.pack_qty ?? 1);
        const sale = lineSale(l, policy);
        return {
          name: l.new_med!.name.trim().slice(0, 300),
          strength: l.new_med!.strength?.slice(0, 100) || undefined,
          form: l.new_med!.form?.slice(0, 100) || undefined,
          manufacturer: (l.new_med!.manufacturer || l.manufacturer || undefined)?.slice(0, 200),
          barcode: (l.new_med!.barcode || l.gtin || undefined)?.slice(0, 64),
          mxik_code: (l.new_med!.mxik_code || l.mxik || undefined)?.slice(0, 32),
          pack_qty: pack,
          price_uzs: l.unit_kind === 'pack' && pack > 1 ? Math.round(sale / pack) : sale,
        };
      });
      const res = await api.pharmacy.bulkCreateMedications({ items });
      const failed: string[] = [];
      const linked = new Map<string, ReceiptLine>();
      creatable.forEach((l, i) => {
        const created = res.created.find((c) => c.index === i);
        if (!created?.id) {
          failed.push(`${l.new_med?.name}: ${created?.error ?? 'xato'}`);
          return;
        }
        const it = items[i]!;
        linked.set(l.key, {
          ...l,
          medication_id: created.id,
          match: 'new' as MatchKind,
          med: {
            id: created.id,
            name: it.name,
            strength: it.strength ?? null,
            pack_qty: it.pack_qty,
            price_uzs: 0,
            pack_price_uzs: null,
            unit_name: null,
            manufacturer: it.manufacturer ?? null,
          },
        });
      });
      setSt((s) => ({ ...s, lines: s.lines.map((l) => linked.get(l.key) ?? l) }));
      void catalogQ.refetch();
      if (failed.length) {
        toast.error(`Yaratilmadi: ${failed.slice(0, 3).join('; ')}`);
        return null;
      }
      toast.success(`${items.length} ta yangi dori bazaga qo'shildi`);
      return lines.map((l) => linked.get(l.key) ?? l);
    } catch (e) {
      toast.error(permText(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Kirim
  // ---------------------------------------------------------------------------
  const postMut = useMutation({
    mutationFn: (ready: ReceiptLine[]) => {
      const h = st.header;
      return api.pharmacy.receipt({
        idempotency_key: st.idemKey,
        supplier_id: h.supplierId || undefined,
        receipt_no: h.receiptNo.trim() || undefined,
        invoice_date: h.invoiceDate || undefined,
        received_at: h.receivedAt ? new Date(`${h.receivedAt}T12:00:00`).toISOString() : undefined,
        paid_uzs: paidN || undefined,
        payment_method: paidN ? h.payMethod : undefined,
        notes: h.notes.trim() || undefined,
        source: st.source,
        file_name: st.fileName,
        file_hash: st.fileHash,
        expected_total_uzs: st.fileTotal != null ? Math.round(st.fileTotal) : undefined,
        items: ready.filter((l) => l.qty > 0).map((l) => toApiItem(l, policy)),
      });
    },
    onSuccess: (res, ready) => {
      const tags = ready
        .filter((l) => l.med)
        .map((l) => {
          const pack = l.med!.pack_qty;
          const sale = lineSale(l, policy);
          const isPack = l.unit_kind === 'pack' && pack > 1;
          return {
            name: l.med!.name,
            strength: l.med!.strength,
            price: sale,
            unitText: isPack ? 'qadoq' : (l.med!.unit_name ?? 'dona'),
            barcode: l.gtin || index.byId.get(l.med!.id)?.barcode || null,
          };
        });
      if (st.serverDraftId) void api.pharmacy.deleteDraft(st.serverDraftId).catch(() => null);
      setPosted({ count: ready.length, total: totals.cost_total, tags });
      setSt(blankState());
      setDuplicates([]);
      setExpanded(new Set());
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      toast.success(
        res.duplicate ? 'Bu prixod avval saqlangan — takror yozilmadi' : 'Omborga kirim qilindi',
      );
    },
    onError: (e: Error) => toast.error(permText(e)),
  });

  const post = async () => {
    if (lines.length === 0 || busy || postMut.isPending) return;
    if (errorCount > 0) {
      toast.error(`${errorCount} qatorda xato bor — avval tuzating`);
      const first = lines.find((l) => issuesByKey.get(l.key)?.some((i) => i.level === 'error'));
      if (first) document.getElementById(`rline-${first.key}`)?.scrollIntoView({ block: 'center' });
      return;
    }
    const diff = st.fileTotal != null ? Math.round(st.fileTotal) - totals.cost_total : 0;
    const parts = [
      `Pozitsiya: ${lines.length}`,
      `Jami tannarx: ${fmt(totals.cost_total)} so'm`,
      ...(st.fileTotal != null && Math.abs(diff) > 10
        ? [`⚠ Fakturadagi jami: ${fmt(st.fileTotal)} (farq ${fmt(diff)})`]
        : []),
      ...(creatable.length ? [`➕ Yangi dori bazaga qo'shiladi: ${creatable.length} ta`] : []),
      ...(warnCount ? [`⚠ Ogohlantirishli qatorlar: ${warnCount}`] : []),
      ...(supplier
        ? [`Firma: ${supplier.name} · qarz +${fmt(Math.max(0, totals.cost_total - paidN))}`]
        : []),
      '',
      'Omborga kirim qilinsinmi?',
    ];
    if (!window.confirm(parts.join('\n'))) return;
    // Qo'lda kiritilgan yangi dorilar avval bazaga qo'shiladi, keyin kirim
    const ready = await createNew();
    if (!ready) return;
    postMut.mutate(ready);
  };

  // Ctrl+S — kirim
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void post();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const saveServerDraft = async () => {
    const title = [supplier?.name, st.header.receiptNo && `№ ${st.header.receiptNo}`, st.fileName]
      .filter(Boolean)
      .join(' · ');
    try {
      const body = {
        title: title || undefined,
        payload: st as unknown as Record<string, unknown>,
        lines_count: lines.length,
      };
      if (st.serverDraftId) await api.pharmacy.saveDraft(st.serverDraftId, body);
      else {
        const r = await api.pharmacy.createDraft(body);
        setSt((s) => ({ ...s, serverDraftId: r.id }));
      }
      qc.invalidateQueries({ queryKey: ['pharmacy', 'receipt-drafts'] });
      toast.success('Qoralama serverga saqlandi');
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const reset = () => {
    if (lines.length && !window.confirm('Kiritilgan prixod tozalansinmi?')) return;
    setSt(blankState());
    setDuplicates([]);
    setExpanded(new Set());
  };

  const pickerLine = picker?.key ? lines.find((l) => l.key === picker.key) : null;

  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-3">
      {posted && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> Kirim saqlandi: {posted.count} pozitsiya ·{' '}
            {fmt(posted.total)} so'm
          </span>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void printPriceTags(posted.tags, ph.clinicName).catch((e) =>
                  toast.error(errText(e)),
                )
              }
            >
              <Tag className="mr-1 h-4 w-4" /> Narx yorliqlari ({posted.tags.length})
            </Button>
            <button
              className="opacity-70 hover:opacity-100"
              onClick={() => setPosted(null)}
              aria-label="Yopish"
            >
              <X className="h-4 w-4" />
            </button>
          </span>
        </div>
      )}

      {/* ---------------- Sarlavha ---------------- */}
      <Card className="p-3">
        <div className="grid gap-2 md:grid-cols-[minmax(220px,2fr)_1fr_1fr_1fr]">
          <LineField label="Yetkazib beruvchi firma">
            <div className="flex gap-1">
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={st.header.supplierId}
                onChange={(e) => setHeader({ supplierId: e.target.value })}
              >
                <option value="">— Firma tanlang —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.debt_uzs > 0 ? ` (qarz ${fmt(s.debt_uzs)})` : ''}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="icon"
                title="Yangi firma"
                onClick={() => setNewSupplierOpen(true)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </LineField>
          <LineField label="Faktura №">
            <Input
              value={st.header.receiptNo}
              onChange={(e) => setHeader({ receiptNo: e.target.value })}
            />
          </LineField>
          <LineField label="Faktura sanasi">
            <Input
              type="date"
              value={st.header.invoiceDate}
              onChange={(e) => setHeader({ invoiceDate: e.target.value })}
            />
          </LineField>
          <LineField label="Qabul qilingan sana">
            <Input
              type="date"
              value={st.header.receivedAt}
              max={today()}
              onChange={(e) => setHeader({ receivedAt: e.target.value })}
            />
          </LineField>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) setImportSource({ kind: 'file', file: f });
            }}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel faktura
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void pasteFromClipboard()}
            disabled={!!busy}
          >
            <ClipboardPaste className="mr-1 h-4 w-4" /> Nusxadan (Ctrl+V)
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPicker({ key: null })}
            disabled={!!busy}
            title="Bazadagi dorini qidirib qo'shish (topilmasa — yangi sifatida kiritiladi)"
          >
            <Plus className="mr-1 h-4 w-4" /> Dori qo'shish
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMedForm({ name: '' })}
            disabled={!!busy}
            title="Bazada yo'q dorini qo'lda kiritish: nomi, dozasi, qadoq, tannarx, narx, muddat"
          >
            <PencilLine className="mr-1 h-4 w-4" /> Yangi dori (qo'lda)
          </Button>
          <Button
            size="sm"
            variant={st.verify ? 'default' : 'outline'}
            onClick={() => setSt((s) => ({ ...s, verify: !s.verify }))}
            title="Qutilarni skanerlab fakturadagi soni bilan solishtirish"
          >
            <ScanLine className="mr-1 h-4 w-4" /> Tekshirish{st.verify ? ' (yoqiq)' : ''}
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraftsOpen(true)}>
              <FileClock className="mr-1 h-4 w-4" /> Qoralamalar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={lines.length === 0}
              onClick={() => void saveServerDraft()}
            >
              <Save className="mr-1 h-4 w-4" /> Serverga saqlash
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowSettings((v) => !v)}>
              <Settings2 className="mr-1 h-4 w-4" /> Sozlama
            </Button>
            {lines.length > 0 && (
              <Button size="sm" variant="ghost" className="text-rose-600" onClick={reset}>
                <Trash2 className="mr-1 h-4 w-4" /> Tozalash
              </Button>
            )}
          </div>
        </div>

        {showSettings && (
          <div className="bg-muted/30 mt-3 grid gap-3 rounded-md border p-3 text-sm md:grid-cols-4">
            <LineField label="Standart ustama %">
              <Input
                inputMode="decimal"
                value={String(settings.defaultMarkup)}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    defaultMarkup: Math.max(0, parseNumber(e.target.value) ?? 0),
                  }))
                }
              />
            </LineField>
            <LineField label="Narxni yaxlitlash">
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-2"
                value={settings.rounding}
                onChange={(e) => setSettings((s) => ({ ...s, rounding: Number(e.target.value) }))}
              >
                {[1, 100, 500, 1000].map((v) => (
                  <option key={v} value={v}>
                    {v === 1 ? 'Yaxlitlamaslik' : `${fmt(v)} so'mgacha`}
                  </option>
                ))}
              </select>
            </LineField>
            <label className="flex items-center gap-2 self-end pb-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={settings.keepHigher}
                onChange={(e) => setSettings((s) => ({ ...s, keepHigher: e.target.checked }))}
              />
              Yangi narx pastroq bo'lsa — eskisi qolsin
            </label>
            <label className="flex items-center gap-2 self-end pb-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={settings.requireExpiry}
                onChange={(e) => setSettings((s) => ({ ...s, requireExpiry: e.target.checked }))}
              />
              Yaroqlilik muddati majburiy
            </label>
          </div>
        )}

        {st.fileName && (
          <div className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" /> {st.fileName}
            {st.fileTotal != null && <> · fakturadagi jami {fmt(st.fileTotal)} so'm</>}
          </div>
        )}
      </Card>

      {duplicates.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4" /> Bu faktura avval kiritilgan bo'lishi mumkin:
          </div>
          {duplicates.map((d) => (
            <div key={d.id} className="text-xs">
              {new Date(d.received_at).toLocaleDateString('uz-UZ')} · № {d.receipt_no ?? '—'} ·{' '}
              {fmt(d.total_cost_uzs)} so'm ·{' '}
              {d.reason === 'file' ? 'aynan shu fayl' : 'shu faktura raqami'}
            </div>
          ))}
        </div>
      )}

      {busy && (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> {busy}
        </div>
      )}

      {(suggested.length > 0 || unlinked.length > 0) && lines.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <Link2 className="h-4 w-4" />
          {unlinked.length > creatable.length &&
            `${unlinked.length - creatable.length} qator bazaga bog'lanmagan. `}
          {creatable.length > 0 &&
            `${creatable.length} ta yangi dori — "Omborga kirim" bosilganda bazaga qo'shiladi.`}
          {suggested.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setSt((s) => ({
                  ...s,
                  lines: s.lines.map((l) => {
                    if (l.match !== 'suggested' || !l.candidates?.[0]) return l;
                    const it = index.byId.get(l.candidates[0].id);
                    return it ? linkMed(l, toReceiptMed(it), 'manual') : l;
                  }),
                }))
              }
            >
              <CheckCircle2 className="mr-1 h-4 w-4" /> O'xshashlarni tasdiqlash ({suggested.length}
              )
            </Button>
          )}
          {creatable.length > 0 && (
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void createNew()}>
              <Sparkles className="mr-1 h-4 w-4" /> Yangi dori sifatida yaratish ({creatable.length}
              )
            </Button>
          )}
        </div>
      )}

      {/* ---------------- Jadval ---------------- */}
      <Card className="overflow-hidden">
        {lines.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 p-10 text-center text-sm">
            <PackagePlus className="h-10 w-10 opacity-40" />
            <div>
              <b className="text-foreground">Excel faktura</b> yuklang, Excel'dan nusxalab{' '}
              <b>Ctrl+V</b> bosing, qutilarni skanerlang yoki dorini qo'lda kiriting.
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => setPicker({ key: null })}>
                <Plus className="mr-1 h-4 w-4" /> Bazadagi dori
              </Button>
              <Button size="sm" onClick={() => setMedForm({ name: '' })}>
                <PencilLine className="mr-1 h-4 w-4" /> Yangi dori (qo'lda)
              </Button>
            </div>
            <div className="text-xs">
              Skaner DataMatrix'dagi seriya va muddatni o'zi to'ldiradi.
            </div>
          </div>
        ) : (
          <div className="max-h-[calc(100vh-330px)] min-h-[260px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/70 text-muted-foreground sticky top-0 z-10 text-[11px] uppercase backdrop-blur">
                <tr>
                  <th className="w-8 px-2 py-2 text-left">#</th>
                  <th className="min-w-[240px] px-2 py-2 text-left">Dori</th>
                  <th className="px-2 py-2 text-left">Birlik</th>
                  <th className="w-20 px-2 py-2 text-right">Soni</th>
                  {st.verify && <th className="w-20 px-2 py-2 text-right">Sanaldi</th>}
                  <th className="w-28 px-2 py-2 text-right">Tannarx</th>
                  <th className="w-28 px-2 py-2 text-right">Summa</th>
                  <th className="w-16 px-2 py-2 text-right">Ustama</th>
                  <th className="w-32 px-2 py-2 text-right">Sotuv narxi</th>
                  <th className="w-28 px-2 py-2 text-left">Seriya</th>
                  <th className="w-28 px-2 py-2 text-left">Muddat</th>
                  <th className="w-16 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lines.map((l, i) => (
                  <ReceiptRow
                    key={l.key}
                    line={l}
                    row={i}
                    policy={policy}
                    verify={!!st.verify}
                    issues={issuesByKey.get(l.key) ?? []}
                    expanded={expanded.has(l.key)}
                    index={index}
                    onToggle={() =>
                      setExpanded((s) => {
                        const n = new Set(s);
                        if (n.has(l.key)) n.delete(l.key);
                        else n.add(l.key);
                        return n;
                      })
                    }
                    onChange={(patch) => updateLine(l.key, patch)}
                    onRemove={() => removeLine(l.key)}
                    onPick={() => setPicker({ key: l.key })}
                    onLink={(med) => updateLine(l.key, (x) => linkMed(x, med, 'manual'))}
                    onMarkNew={() =>
                      updateLine(l.key, (x) => ({
                        ...x,
                        match: 'new',
                        new_med: x.new_med ?? { name: x.source_name, pack_qty: 1 },
                      }))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------------- Jami va kirim ---------------- */}
      {lines.length > 0 && (
        <Card className="sticky bottom-2 z-10 p-3 shadow-lg">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
              <div>
                <div className="text-muted-foreground text-[11px]">Pozitsiya / dona</div>
                <div className="font-semibold">
                  {totals.positions} / {fmt(totals.base_qty)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[11px]">Jami tannarx</div>
                <div className="text-lg font-bold tabular-nums">{fmt(totals.cost_total)}</div>
                {st.fileTotal != null &&
                  Math.abs(Math.round(st.fileTotal) - totals.cost_total) > 10 && (
                    <div className="text-[11px] text-amber-700">fakturada {fmt(st.fileTotal)}</div>
                  )}
              </div>
              <div>
                <div className="text-muted-foreground text-[11px]">Sotuv qiymati / foyda</div>
                <div className="font-semibold tabular-nums">
                  {fmt(totals.sale_total)}{' '}
                  <span className="text-emerald-700">/ {fmt(totals.profit)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {errorCount > 0 && <Badge className="bg-rose-600">{errorCount} xato</Badge>}
                {warnCount > 0 && <Badge className="bg-amber-500">{warnCount} ogohlantirish</Badge>}
                {errorCount === 0 && warnCount === 0 && (
                  <Badge className="bg-emerald-600">Tayyor</Badge>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex items-end gap-1">
                <LineField label="Hammasiga ustama %">
                  <Input
                    className="h-9 w-20"
                    inputMode="decimal"
                    value={bulkMarkup}
                    onChange={(e) => setBulkMarkup(e.target.value)}
                  />
                </LineField>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9"
                  disabled={bulkMarkup.trim() === ''}
                  onClick={() => {
                    const mk = Math.max(0, parseNumber(bulkMarkup) ?? 0);
                    setSt((s) => ({
                      ...s,
                      lines: s.lines.map((l) => ({ ...l, markup: mk, sale: null })),
                    }));
                    setBulkMarkup('');
                  }}
                >
                  Qo'llash
                </Button>
              </div>
              <LineField label="Firmaga to'landi">
                <div className="flex gap-1">
                  <Input
                    className="h-9 w-32"
                    inputMode="numeric"
                    value={st.header.paid}
                    onChange={(e) => setHeader({ paid: e.target.value })}
                    placeholder="0"
                  />
                  <select
                    className="border-input bg-background h-9 rounded-md border px-1 text-xs"
                    value={st.header.payMethod}
                    onChange={(e) => setHeader({ payMethod: e.target.value })}
                  >
                    <option value="transfer">O'tkazma</option>
                    <option value="cash">Naqd</option>
                    <option value="card">Karta</option>
                    <option value="click">Click</option>
                  </select>
                </div>
              </LineField>
              <LineField label="Izoh">
                <Input
                  className="h-9 w-40"
                  value={st.header.notes}
                  onChange={(e) => setHeader({ notes: e.target.value })}
                />
              </LineField>
              <Button
                className="h-10 min-w-[200px]"
                disabled={postMut.isPending || lines.length === 0 || !!busy}
                onClick={() => void post()}
              >
                {postMut.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <PackagePlus className="mr-1.5 h-4 w-4" />
                )}
                Omborga kirim (Ctrl+S)
              </Button>
            </div>
          </div>
          {supplier && (
            <div className="text-muted-foreground mt-1 text-[11px]">
              {supplier.name}: kirimdan keyin qarz{' '}
              {fmt(Math.max(0, supplier.debt_uzs + totals.cost_total - paidN))} so'm bo'ladi
            </div>
          )}
        </Card>
      )}

      {importSource && (
        <ImportDialog
          source={importSource}
          supplierId={st.header.supplierId || null}
          onClose={() => setImportSource(null)}
          onImported={(o) => void onImported(o)}
        />
      )}

      {picker && (
        <MedPickerDialog
          title={
            pickerLine ? `Bog'lash: ${pickerLine.source_name || 'qator'}` : "Prixodga dori qo'shish"
          }
          description={
            pickerLine ? 'Fakturadagi nom bazadagi qaysi dori? Tanlov eslab qolinadi.' : undefined
          }
          index={index}
          initialQuery={pickerLine?.source_name ?? ''}
          candidates={pickerLine?.candidates}
          onClose={() => setPicker(null)}
          onCreateNew={(query) => {
            if (pickerLine) {
              updateLine(pickerLine.key, (x) => ({
                ...x,
                match: 'new',
                new_med: x.new_med ?? { name: query || x.source_name, pack_qty: 1 },
              }));
              setExpanded((s) => new Set(s).add(pickerLine.key));
            } else {
              setMedForm({ name: query });
            }
            setPicker(null);
          }}
          onPick={(item) => {
            if (pickerLine) {
              updateLine(pickerLine.key, (x) => linkMed(x, toReceiptMed(item), 'manual'));
            } else {
              addPickedLine(item);
            }
            setPicker(null);
          }}
        />
      )}

      {medForm && (
        <MedicationFormDialog
          initial={null}
          preset={{ name: medForm.name }}
          onClose={() => setMedForm(null)}
          onSaved={(id) => void onNewMedSaved(id)}
        />
      )}

      {unknown && (
        <MedPickerDialog
          title={`Kod topilmadi: ${unknown.gtin ?? unknown.code}`}
          description="Bu qadoq qaysi dori? Tanlang — kod doriga biriktiriladi. Yoki yangi dori sifatida qo'shing."
          index={index}
          onClose={() => setUnknown(null)}
          onCreateNew={(query) => {
            const p = unknown;
            const l = emptyLine({
              source_name: query,
              match: 'new',
              unit_kind: 'pack',
              qty: st.verify ? 0 : 1,
              checked: st.verify ? 1 : undefined,
              markup: settings.defaultMarkup,
              batch_no: p.batch ?? '',
              expiry: p.expiry ?? '',
              gtin: p.gtin ?? p.code,
              new_med: { name: query, barcode: p.gtin ?? p.code, pack_qty: 1 },
            });
            setSt((s) => ({
              ...s,
              lines: [...s.lines, l],
              source: s.source === 'manual' ? 'scan' : s.source,
            }));
            setExpanded((s) => new Set(s).add(l.key));
            setUnknown(null);
          }}
          onPick={(item) => {
            const p = unknown;
            setUnknown(null);
            void api.pharmacy
              .addBarcode(item.medication_id, { code: p.gtin ?? p.raw })
              .then(() => {
                toast.success(`Kod ${item.name} ga biriktirildi`);
                void catalogQ.refetch();
              })
              .catch((e) => toast.error(errText(e)));
            void addScannedLine(item, p);
          }}
        />
      )}

      {draftsOpen && (
        <DraftsDialog
          currentId={st.serverDraftId ?? null}
          onClose={() => setDraftsOpen(false)}
          onLoad={(d) => {
            if (lines.length && !window.confirm('Hozirgi prixod o‘rniga qoralama ochilsinmi?'))
              return;
            const payload = d.payload as unknown as DraftState;
            if (!payload || payload.v !== 2 || !Array.isArray(payload.lines)) {
              toast.error("Qoralama formati noto'g'ri");
              return;
            }
            setSt({ ...payload, serverDraftId: d.id });
            setDraftsOpen(false);
            toast.success('Qoralama ochildi');
          }}
        />
      )}

      {newSupplierOpen && (
        <SupplierFormDialog
          initial={null}
          onClose={() => setNewSupplierOpen(false)}
          onSaved={(id) => {
            if (id) setHeader({ supplierId: id });
          }}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Jadval qatori
// -----------------------------------------------------------------------------
function NumCell({
  value,
  onChange,
  cell,
  className,
  placeholder,
  onKeyDown,
}: {
  value: number;
  onChange: (n: number) => void;
  cell: string;
  className?: string;
  placeholder?: string;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      data-rcell={cell}
      inputMode="decimal"
      className={cn(
        'border-input focus:border-primary h-8 w-full rounded border bg-transparent px-1.5 text-right text-sm tabular-nums outline-none',
        className,
      )}
      value={draft ?? (value ? fmt(value) : '')}
      placeholder={placeholder}
      onFocus={(e) => {
        setDraft(value ? String(value) : '');
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(Math.max(0, parseNumber(e.target.value) ?? 0));
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={onKeyDown}
    />
  );
}

function ReceiptRow({
  line: l,
  row,
  policy,
  verify,
  issues,
  expanded,
  index,
  onToggle,
  onChange,
  onRemove,
  onPick,
  onLink,
  onMarkNew,
}: {
  line: ReceiptLine;
  row: number;
  policy: ReceiptPolicy;
  verify: boolean;
  issues: ReturnType<typeof lineIssues>;
  expanded: boolean;
  index: ReturnType<typeof buildCatalogIndex>;
  onToggle: () => void;
  onChange: (patch: Partial<ReceiptLine> | ((l: ReceiptLine) => ReceiptLine)) => void;
  onRemove: () => void;
  onPick: () => void;
  onLink: (med: ReceiptMed) => void;
  onMarkNew: () => void;
}) {
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  const pack = Math.max(1, l.med?.pack_qty ?? l.new_med?.pack_qty ?? 1);
  const sale = lineSale(l, policy);
  const cur = currentSale(l);
  const autoSale = l.sale == null || l.sale <= 0;
  const mk = l.cost > 0 ? markupPercentOf(l.cost, sale) : l.markup;
  const cand = l.match === 'suggested' ? l.candidates?.[0] : null;
  const candItem = cand ? index.byId.get(cand.id) : undefined;
  const [expDraft, setExpDraft] = useState<string | null>(null);
  const tag = l.match ? MATCH_LABEL[l.match] : undefined;

  return (
    <>
      <tr
        id={`rline-${l.key}`}
        className={cn(
          errors.length ? 'bg-rose-50/60' : warns.length ? 'bg-amber-50/40' : '',
          'align-top',
        )}
      >
        <td className="text-muted-foreground px-2 py-1.5 text-xs">{l.source_row ?? row + 1}</td>
        <td className="px-2 py-1.5">
          {l.med ? (
            <div className="min-w-0">
              <button
                className="hover:text-primary block max-w-[320px] truncate text-left font-medium"
                onClick={onPick}
                title="Boshqa doriga bog'lash"
              >
                {l.med.name}{' '}
                {l.med.strength && (
                  <span className="text-muted-foreground font-normal">{l.med.strength}</span>
                )}
              </button>
              <div className="flex items-center gap-1 text-[11px]">
                {tag && <span className={cn('rounded px-1', tag.cls)}>{tag.text}</span>}
                {l.source_name && l.source_name !== l.med.name && (
                  <span
                    className="text-muted-foreground max-w-[260px] truncate"
                    title={l.source_name}
                  >
                    ← {l.source_name}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div
                className="max-w-[320px] truncate font-medium text-amber-800"
                title={l.source_name}
              >
                {l.new_med?.name || l.source_name || 'Yangi dori (nomini kiriting)'}
              </div>
              {cand && candItem ? (
                <div className="flex flex-wrap items-center gap-1 text-[11px]">
                  <span className="text-muted-foreground">O'xshash:</span>
                  <button
                    className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 hover:bg-amber-200"
                    onClick={() => onLink(toReceiptMedFromItem(candItem))}
                  >
                    ✓ {cand.name} {cand.strength ?? ''} ({Math.round(cand.score * 100)}%)
                  </button>
                  <button className="text-primary underline" onClick={onPick}>
                    boshqa
                  </button>
                  <button className="text-violet-700 underline" onClick={onMarkNew}>
                    yangi
                  </button>
                </div>
              ) : (
                <div className="flex gap-2 text-[11px]">
                  <button className="text-primary underline" onClick={onPick}>
                    Bazadan tanlash
                  </button>
                  {l.match !== 'new' ? (
                    <button className="text-violet-700 underline" onClick={onMarkNew}>
                      Yangi dori
                    </button>
                  ) : (
                    <span className="rounded bg-violet-50 px-1 text-violet-700">
                      yangi — yaratiladi
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </td>
        <td className="px-2 py-1.5">
          {pack > 1 ? (
            <select
              className="border-input h-8 rounded border bg-transparent px-1 text-xs"
              value={l.unit_kind}
              onChange={(e) =>
                onChange((x) => {
                  const n = { ...x, unit_kind: e.target.value as 'pack' | 'unit', sale: null };
                  return { ...n, sale: suggestSale(n) };
                })
              }
            >
              <option value="pack">qadoq (×{pack})</option>
              <option value="unit">{l.med?.unit_name ?? 'dona'}</option>
            </select>
          ) : (
            <span className="text-muted-foreground text-xs">{l.med?.unit_name ?? 'dona'}</span>
          )}
        </td>
        <td className="px-2 py-1.5">
          <NumCell
            cell={`${row}:qty`}
            value={l.qty}
            onChange={(n) => onChange({ qty: n })}
            onKeyDown={navKeys(row, 'qty')}
          />
          {pack > 1 && l.unit_kind === 'pack' && l.qty > 0 && (
            <div className="text-muted-foreground mt-0.5 text-right text-[10px]">
              = {fmt(lineBaseQty(l))} dona
            </div>
          )}
        </td>
        {verify && (
          <td className="px-2 py-1.5 text-right">
            <span
              className={cn(
                'inline-block min-w-[40px] rounded px-1.5 py-1 text-xs font-semibold',
                l.checked == null
                  ? 'bg-muted text-muted-foreground'
                  : l.checked === l.qty
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800',
              )}
            >
              {l.checked ?? 0}
            </span>
          </td>
        )}
        <td className="px-2 py-1.5">
          <NumCell
            cell={`${row}:cost`}
            value={l.cost}
            onChange={(n) => onChange({ cost: n })}
            onKeyDown={navKeys(row, 'cost')}
          />
          {l.last && l.medication_id && (
            <div
              className="text-muted-foreground mt-0.5 text-right text-[10px]"
              title={`Oxirgi kirim: ${new Date(l.last.at).toLocaleDateString('uz-UZ')}`}
            >
              oldin {fmt(Math.round(l.last.unit_cost_uzs * (l.unit_kind === 'pack' ? pack : 1)))}
            </div>
          )}
        </td>
        <td className="px-2 py-1.5 text-right text-sm tabular-nums">
          {fmt(lineCostTotal(l))}
          {l.file_total != null &&
            Math.abs(l.file_total - lineCostTotal(l)) > Math.max(10, l.file_total * 0.005) && (
              <div className="text-[10px] text-amber-700">fayl: {fmt(l.file_total)}</div>
            )}
        </td>
        <td className="px-2 py-1.5">
          <NumCell
            cell={`${row}:markup`}
            value={Math.round(mk * 10) / 10}
            onChange={(n) => onChange({ markup: n, sale: null })}
            onKeyDown={navKeys(row, 'markup')}
            className={cn(!autoSale && 'text-muted-foreground')}
          />
        </td>
        <td className="px-2 py-1.5">
          <NumCell
            cell={`${row}:sale`}
            value={sale}
            onChange={(n) => onChange({ sale: n > 0 ? n : null })}
            onKeyDown={navKeys(row, 'sale')}
            className={cn(
              'font-semibold',
              l.cost > 0 && sale < l.cost && 'border-rose-400 text-rose-700',
            )}
          />
          {cur != null && cur > 0 && cur !== sale && (
            <div
              className={cn(
                'mt-0.5 text-right text-[10px]',
                sale > cur ? 'text-rose-600' : 'text-emerald-700',
              )}
            >
              hozir {fmt(cur)} {sale > cur ? '↑' : '↓'}
            </div>
          )}
        </td>
        <td className="px-2 py-1.5">
          <input
            data-rcell={`${row}:batch`}
            className="border-input focus:border-primary h-8 w-full rounded border bg-transparent px-1.5 font-mono text-xs outline-none"
            value={l.batch_no}
            onChange={(e) => onChange({ batch_no: e.target.value })}
            onKeyDown={navKeys(row, 'batch')}
          />
        </td>
        <td className="px-2 py-1.5">
          <input
            data-rcell={`${row}:expiry`}
            className="border-input focus:border-primary h-8 w-full rounded border bg-transparent px-1.5 text-xs outline-none"
            placeholder="12.2027"
            value={expDraft ?? l.expiry}
            onFocus={(e) => {
              setExpDraft(l.expiry);
              e.currentTarget.select();
            }}
            onChange={(e) => setExpDraft(e.target.value)}
            onBlur={() => {
              if (expDraft != null) {
                const d = expDraft.trim() === '' ? '' : (parseDate(expDraft) ?? l.expiry);
                if (expDraft.trim() !== '' && !parseDate(expDraft))
                  toast.error("Sana noto'g'ri: masalan 12.2027 yoki 31.12.2027");
                onChange({ expiry: d });
              }
              setExpDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp')
                (e.target as HTMLInputElement).blur();
              navKeys(row, 'expiry')(e);
            }}
          />
        </td>
        <td className="px-2 py-1.5">
          <div className="flex items-center justify-end gap-0.5">
            {issues.length > 0 && (
              <span title={issues.map((i) => i.text).join('\n')}>
                <AlertTriangle
                  className={cn('h-4 w-4', errors.length ? 'text-rose-600' : 'text-amber-500')}
                />
              </span>
            )}
            <button
              className="text-muted-foreground hover:text-foreground p-0.5"
              onClick={onToggle}
              title="Batafsil"
            >
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')}
              />
            </button>
            <button
              className="text-muted-foreground p-0.5 hover:text-rose-600"
              onClick={onRemove}
              title="O'chirish"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </td>
      </tr>
      {(expanded || errors.length > 0) && (
        <tr className={cn(errors.length ? 'bg-rose-50/60' : 'bg-muted/20')}>
          <td />
          <td colSpan={verify ? 11 : 10} className="px-2 pb-2">
            {issues.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {issues.map((i, k) => (
                  <span
                    key={k}
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[11px]',
                      i.level === 'error'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800',
                    )}
                  >
                    {i.text}
                  </span>
                ))}
                {verify && l.checked != null && l.checked !== l.qty && (
                  <button
                    className="text-primary text-[11px] underline"
                    onClick={() => onChange({ qty: l.checked ?? 0 })}
                  >
                    Sanalganini olish ({l.checked})
                  </button>
                )}
              </div>
            )}
            {expanded && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                {!l.medication_id && l.new_med && (
                  <>
                    <LineField label="Yangi dori nomi *">
                      <Input
                        id={`newmed-${l.key}`}
                        className={cn('h-8', !l.new_med.name.trim() && 'border-rose-400')}
                        placeholder="Masalan: Paratsetamol 500 mg"
                        value={l.new_med.name}
                        onChange={(e) =>
                          onChange((x) => ({
                            ...x,
                            new_med: { ...x.new_med!, name: e.target.value },
                          }))
                        }
                      />
                    </LineField>
                    <LineField label="Dozasi">
                      <Input
                        className="h-8"
                        value={l.new_med.strength ?? ''}
                        onChange={(e) =>
                          onChange((x) => ({
                            ...x,
                            new_med: { ...x.new_med!, strength: e.target.value },
                          }))
                        }
                      />
                    </LineField>
                    <LineField label="Shakli">
                      <Input
                        className="h-8"
                        value={l.new_med.form ?? ''}
                        onChange={(e) =>
                          onChange((x) => ({
                            ...x,
                            new_med: { ...x.new_med!, form: e.target.value },
                          }))
                        }
                      />
                    </LineField>
                    <LineField label="1 qadoqda (dona)">
                      <Input
                        className="h-8"
                        inputMode="numeric"
                        value={String(l.new_med.pack_qty ?? 1)}
                        onChange={(e) =>
                          onChange((x) => ({
                            ...x,
                            new_med: {
                              ...x.new_med!,
                              pack_qty: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                            },
                          }))
                        }
                      />
                    </LineField>
                  </>
                )}
                <LineField label="Ishlab chiqaruvchi">
                  <Input
                    className="h-8"
                    value={l.manufacturer}
                    onChange={(e) => onChange({ manufacturer: e.target.value })}
                  />
                </LineField>
                <LineField label="Ishlab chiqarilgan">
                  <Input
                    className="h-8"
                    type="date"
                    value={l.mfg_date}
                    onChange={(e) => onChange({ mfg_date: e.target.value })}
                  />
                </LineField>
                <LineField label="Shtrix (GTIN)">
                  <Input
                    className="h-8 font-mono"
                    value={l.gtin}
                    onChange={(e) => onChange({ gtin: e.target.value })}
                  />
                </LineField>
                <LineField label="MXIK">
                  <Input
                    className="h-8 font-mono"
                    value={l.mxik}
                    onChange={(e) => onChange({ mxik: e.target.value })}
                  />
                </LineField>
                <LineField
                  label={`Doktor ulushi (${l.doctor_share_kind === 'percent' ? '%' : "so'm"})`}
                >
                  <div className="flex gap-1">
                    <Input
                      className="h-8"
                      inputMode="decimal"
                      value={l.doctor_share_value ? String(l.doctor_share_value) : ''}
                      onChange={(e) =>
                        onChange({
                          doctor_share_value: Math.max(0, parseNumber(e.target.value) ?? 0),
                        })
                      }
                    />
                    <select
                      className="border-input h-8 rounded border bg-transparent px-1 text-xs"
                      value={l.doctor_share_kind}
                      onChange={(e) =>
                        onChange({ doctor_share_kind: e.target.value as 'percent' | 'bonus' })
                      }
                    >
                      <option value="percent">%</option>
                      <option value="bonus">so'm</option>
                    </select>
                  </div>
                </LineField>
                {!autoSale && (
                  <div className="flex items-end">
                    <button
                      className="text-primary text-xs underline"
                      onClick={() => onChange({ sale: null })}
                    >
                      Narxni ustamadan hisoblash
                    </button>
                  </div>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function toReceiptMedFromItem(it: PharmacyCatalogItem): ReceiptMed {
  return toReceiptMed(it);
}
