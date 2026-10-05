import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  Clock,
  ExternalLink,
  Minus,
  PauseCircle,
  Plus,
  Printer,
  RefreshCw,
  ScanLine,
  Search,
  ShoppingCart,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  cn,
} from '@clary/ui-web';
import type { PharmacyCatalogItem, PharmacySaleDetail } from '@clary/api-client';
import {
  allowedUnitKinds,
  defaultUnitKind,
  formatStock,
  parseScan,
  unitLabel,
  unitPrice,
  type ParsedScan,
  type UnitKind,
} from '@clary/utils';
import type { PharmacyQuickButton } from '@clary/api-client';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import {
  addToCart,
  cartDiscount,
  cartSubtotal,
  lineDiscount,
  lineNet,
  linePrice,
  lineTotal,
  maxQtyFor,
  refreshMeds,
  removeLine,
  roomFor,
  setLineQty,
  stripDiscounts,
  updateLine,
  type CartLine,
  type CartMed,
  type DiscountKind,
} from '@/lib/pharmacy/cart';
import {
  buildCatalogIndex,
  findByScan,
  searchCatalog,
  type CatalogIndex,
} from '@/lib/pharmacy/catalog-search';
import {
  PAY_LABEL,
  RECEIPT_MODE_LABELS,
  printSale,
  readReceiptMode,
  saveReceiptMode,
  type ReceiptMode,
} from '@/lib/pharmacy/print';
import { useScanner } from '@/lib/scanner/use-scanner';
import { usePharmacy } from './context';
import { MedicationFormDialog } from './medications';
import { PaymentDialog, type PaymentResult } from './pos-payment';
import { QtyDialog, type QtyRequest, type QtyResult } from './qty-dialog';
import { QUICK_HOTKEYS, QuickGrid, buttonUnit, useQuickButtons } from './quick-buttons';
import { ReceiptChoiceDialog, errText, fmt } from './shared';
import { OpenShiftCard } from './shifts';

// =============================================================================
// Sotuv oynasi (POS) 2.0
// =============================================================================
//  * Katalog bir marta yuklanadi — qidiruv va skaner brauzerda (< 50 ms).
//  * Dori tanlansa (qidiruv / tezkor tugma) — miqdor oynasi: qoldiq, narx,
//    son, chegirma. Skaner esa oynasiz, darhol +1 qo'shadi.
//  * Tezkor tugmalar (Sozlamalar → Tezkor tugmalar), Alt+1…9.
//  * Har qanday skaner: EAN/UPC, Code128, QR, GS1 DataMatrix (muddat/seriya).
//    Muddati o'tgan qadoq skanerlansa — sotilmaydi. Chek QR'i → sotuv sahifasi.
//  * Qadoq / blister / dona bo'lib sotish (dori sozlamasida ruxsat bo'lsa).
//  * Klaviatura: F2 qidiruv · ↑↓ Enter tanlash · "3*para" 3 dona · +/− son ·
//    Del o'chirish · F8 kutishga · F9 to'lov.
//  * Qator chegirmalari serverga jami chegirma (discount_uzs) bo'lib ketadi.
//  * Idempotent: bir savat ikki marta sotilmaydi (tarmoq takrori, ikki bosish).
// =============================================================================

const netOf = (lines: CartLine[]) => cartSubtotal(lines) - cartDiscount(lines);

const CART_KEY = 'clary.pharmacy.cart';
const PARKED_KEY = 'clary.pharmacy.parked';

type ParkedCart = {
  id: string;
  at: number;
  lines: CartLine[];
  b2bClinicId: string;
  b2bDoctorId: string;
};

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

function readJson<T>(storage: Storage | undefined, key: string, fallback: T): T {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(storage: Storage | undefined, key: string, value: unknown) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* to'lgan yoki yopiq — savat baribir xotirada */
  }
}

const safeSession = (): Storage | undefined => {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};
const safeLocal = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/** "3*para", "3x para", "3 × para" → 3 dona. */
function parseQtyPrefix(q: string): { qty: number; text: string } {
  const m = /^\s*(\d{1,4})\s*[*xх×]\s*(.*)$/i.exec(q);
  if (m && Number(m[1]) > 0) return { qty: Number(m[1]), text: m[2] ?? '' };
  return { qty: 1, text: q };
}

const looksLikeCode = (s: string) =>
  /^[0-9]{8,14}$/.test(s) || s.includes('\u001d') || /^\(?01\)?\d{14}/.test(s);

const todayIso = () => new Date().toLocaleDateString('en-CA');

/** Qisqa ovozli signal (skaner: topildi / topilmadi). */
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
    /* ovozsiz qurilma */
  }
}

function expiryInfo(date: string | null | undefined): { days: number; text: string } | null {
  if (!date) return null;
  const d = new Date(date + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.floor((d.getTime() - Date.now()) / 86_400_000);
  return { days, text: date };
}

export function PosTab() {
  const ph = usePharmacy();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const shiftQ = useQuery({
    queryKey: ['pharmacy', 'shift-current'],
    queryFn: () => api.pharmacy.shifts.current(),
    staleTime: 15_000,
  });
  const catalogQ = useQuery({
    queryKey: ['pharmacy', 'pos-catalog'],
    queryFn: () => api.pharmacy.posCatalog(),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
  const index = useMemo(() => buildCatalogIndex(catalogQ.data?.items ?? []), [catalogQ.data]);

  const [lines, setLines] = useState<CartLine[]>(() =>
    readJson<CartLine[]>(safeSession(), CART_KEY, []),
  );
  const linesRef = useRef(lines);
  const commit = useCallback((next: CartLine[]) => {
    linesRef.current = next;
    setLines(next);
    writeJson(safeSession(), CART_KEY, next);
  }, []);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const [b2bOpen, setB2bOpen] = useState(false);
  const [b2bClinicId, setB2bClinicId] = useState('');
  const [b2bDoctorId, setB2bDoctorId] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [idemKey, setIdemKey] = useState(uuid);
  const [unknownScan, setUnknownScan] = useState<ParsedScan | null>(null);
  const [newMedBarcode, setNewMedBarcode] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<PharmacySaleDetail | null>(null);
  const [pendingPrint, setPendingPrint] = useState<PharmacySaleDetail | null>(null);
  const [receiptMode, setReceiptMode] = useState<ReceiptMode>(readReceiptMode);
  const [parked, setParked] = useState<ParkedCart[]>(() =>
    readJson<ParkedCart[]>(safeLocal(), PARKED_KEY, []),
  );
  const [parkedOpen, setParkedOpen] = useState(false);
  const [pick, setPick] = useState<QtyRequest | null>(null);
  const quickQ = useQuickButtons();
  const quick = quickQ.data?.buttons ?? [];
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const focusSearch = useCallback(() => {
    setTimeout(() => searchRef.current?.focus(), 0);
  }, []);

  // Katalog yangilansa savatdagi narx/qoldiq ham yangilanadi
  useEffect(() => {
    if (!catalogQ.data || linesRef.current.length === 0) return;
    commit(refreshMeds(linesRef.current, index.byId as Map<string, CartMed>));
  }, [index, catalogQ.data, commit]);

  // Chegirma ruxsati yo'q operator (masalan, qulflab almashilgan) — qator
  // chegirmalari olib tashlanadi, aks holda server sotuvni rad etadi.
  useEffect(() => {
    if (ph.canDiscount) return;
    const clean = stripDiscounts(lines);
    if (clean !== lines) commit(clean);
  }, [ph.canDiscount, lines, commit]);

  const clinicsQ = useQuery({
    queryKey: ['pharmacy', 'clinics'],
    queryFn: () => api.pharmacy.listClinics(),
    enabled: b2bOpen || !!b2bClinicId,
  });
  const b2bClinic = (clinicsQ.data ?? []).find((c) => c.id === b2bClinicId) ?? null;

  const { qty: prefixQty, text: searchText } = parseQtyPrefix(q);
  const results = useMemo(() => searchCatalog(index, searchText, 40), [index, searchText]);
  useEffect(() => setHl(0), [searchText]);
  useEffect(() => {
    resultsRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${hl}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [hl]);

  const subtotal = cartSubtotal(lines);
  const lineDisc = cartDiscount(lines);
  const net = subtotal - lineDisc;
  const overLines = lines.filter((l) => l.qty > maxQtyFor(lines, l) || l.qty < 1);
  const itemsCount = lines.reduce((a, l) => a + l.qty, 0);

  // ---------------------------------------------------------------------------
  // Savatga qo'shish
  // ---------------------------------------------------------------------------
  const addMed = useCallback(
    (
      med: CartMed,
      opts: {
        qty?: number;
        unit_kind?: UnitKind;
        preferred_batch_no?: string | null;
        disc_kind?: DiscountKind;
        disc_value?: number;
      } = {},
    ) => {
      if (med.qty_sellable <= 0) {
        toast.error(`${med.name}: sotiladigan qoldiq yo'q`);
        beep(false);
        return false;
      }
      const res = addToCart(linesRef.current, med, opts);
      if (res.added === 0) {
        toast.error(`${med.name}: qoldiq tugadi (${formatStock(med.qty_sellable, med)})`);
        beep(false);
        return false;
      }
      commit(res.lines);
      setSelectedKey(res.key);
      const want = Math.max(1, opts.qty ?? 1);
      if (res.added < want) toast.warning(`Qoldiq yetarli emas — ${res.added} ta qo'shildi`);
      if (med.requires_prescription) toast.info(`${med.name} — retsept bo'yicha beriladigan dori`);
      beep(true);
      return true;
    },
    [commit],
  );

  // ---------------------------------------------------------------------------
  // Miqdor oynasi
  // ---------------------------------------------------------------------------
  /** Dori tanlandi (qidiruv / tezkor tugma): savatda bo'lsa — o'sha qator tahrirlanadi. */
  const openPick = useCallback(
    (med: CartMed, opts: { unit_kind?: UnitKind; qty?: number } = {}) => {
      if (med.qty_sellable <= 0) {
        toast.error(`${med.name}: sotiladigan qoldiq yo'q`);
        beep(false);
        return;
      }
      const kinds = allowedUnitKinds(med);
      const kind =
        opts.unit_kind && kinds.includes(opts.unit_kind) ? opts.unit_kind : defaultUnitKind(med);
      const want = Math.max(1, opts.qty ?? 1);
      const { existing } = roomFor(linesRef.current, med, kind);
      setPick(
        existing
          ? {
              med,
              lineKey: existing.key,
              unit_kind: kind,
              qty: existing.qty + want,
              disc_kind: existing.disc_kind,
              disc_value: existing.disc_value,
              wasQty: existing.qty,
            }
          : { med, unit_kind: kind, qty: want },
      );
    },
    [],
  );

  const editLine = useCallback((l: CartLine) => {
    setSelectedKey(l.key);
    setPick({
      med: l.med,
      lineKey: l.key,
      unit_kind: l.unit_kind,
      qty: l.qty,
      disc_kind: l.disc_kind,
      disc_value: l.disc_value,
    });
  }, []);

  const closePick = () => {
    setPick(null);
    focusSearch();
  };

  const confirmPick = (r: QtyResult) => {
    const req = pick;
    if (!req) return;
    if (req.lineKey && linesRef.current.some((l) => l.key === req.lineKey)) {
      commit(updateLine(linesRef.current, req.lineKey, r));
      setSelectedKey(req.lineKey);
      beep(true);
    } else if (!addMed(req.med, r)) {
      return;
    }
    setPick(null);
    setQ('');
    focusSearch();
  };

  const pressQuick = (b: PharmacyQuickButton, med: CartMed) => {
    const kind = buttonUnit(b, med);
    if (quickQ.data?.instant) {
      addMed(med, { qty: b.qty, unit_kind: kind });
      focusSearch();
    } else {
      openPick(med, { unit_kind: kind, qty: b.qty });
    }
  };

  const handleScan = useCallback(
    async (parsed: ParsedScan) => {
      if (parsed.kind === 'clary-sale' && parsed.saleId) {
        navigate(ph.salePath(parsed.saleId));
        return;
      }
      if (parsed.kind === 'url') {
        toast.info('Bu QR — havola, dori kodi emas');
        beep(false);
        return;
      }
      if (parsed.expiry && parsed.expiry < todayIso()) {
        toast.error(`Bu qadoqning muddati o'tgan (${parsed.expiry}) — sotish mumkin emas`);
        beep(false);
        return;
      }
      const batch = parsed.batch ?? null;
      const local = findByScan(index, parsed);
      if (local) {
        addMed(local, { preferred_batch_no: batch });
        if (parsed.expiry) {
          const e = expiryInfo(parsed.expiry);
          if (e && e.days <= 30)
            toast.warning(`Diqqat: bu qadoq muddati ${e.days} kundan keyin tugaydi`);
        }
        return;
      }
      // Katalog eski bo'lishi mumkin (boshqa kassada hozirgina qo'shilgan) — serverdan
      try {
        const r = await api.pharmacy.lookup(parsed.raw);
        if (r.medication) {
          addMed(r.medication as CartMed, { preferred_batch_no: batch });
          void catalogQ.refetch();
          return;
        }
      } catch {
        /* tarmoq xatosi — pastda noma'lum kod */
      }
      beep(false);
      setUnknownScan(parsed);
    },
    [index, addMed, navigate, ph, catalogQ],
  );

  const gateOpen = !!shiftQ.data?.required && !shiftQ.data?.shift;
  useScanner((e) => void handleScan(e.parsed), {
    enabled: !payOpen && !unknownScan && !newMedBarcode && !gateOpen && !pick,
  });

  // ---------------------------------------------------------------------------
  // Savat amallari
  // ---------------------------------------------------------------------------
  const selected = lines.find((l) => l.key === selectedKey) ?? lines[lines.length - 1] ?? null;
  const changeQty = (key: string, qty: number) => commit(setLineQty(linesRef.current, key, qty));
  const remove = (key: string) => {
    const next = removeLine(linesRef.current, key);
    commit(next);
    if (selectedKey === key) setSelectedKey(next[next.length - 1]?.key ?? null);
  };
  const clearCart = () => {
    commit([]);
    setB2bClinicId('');
    setB2bDoctorId('');
    setIdemKey(uuid());
  };

  const park = () => {
    if (linesRef.current.length === 0) return;
    const next = [
      { id: uuid(), at: Date.now(), lines: linesRef.current, b2bClinicId, b2bDoctorId },
      ...parked,
    ].slice(0, 8);
    setParked(next);
    writeJson(safeLocal(), PARKED_KEY, next);
    clearCart();
    toast.success('Savat kutishga qo‘yildi (F8)');
    focusSearch();
  };
  const unpark = (p: ParkedCart) => {
    let rest = parked.filter((x) => x.id !== p.id);
    // Hozirgi savat bo'sh bo'lmasa — u kutishga o'tadi (almashtirish)
    if (linesRef.current.length > 0) {
      rest = [
        { id: uuid(), at: Date.now(), lines: linesRef.current, b2bClinicId, b2bDoctorId },
        ...rest,
      ].slice(0, 8);
    }
    setParked(rest);
    writeJson(safeLocal(), PARKED_KEY, rest);
    commit(refreshMeds(p.lines, index.byId as Map<string, CartMed>));
    setB2bClinicId(p.b2bClinicId);
    setB2bDoctorId(p.b2bDoctorId);
    setIdemKey(uuid());
    setParkedOpen(false);
    focusSearch();
  };

  const openPay = () => {
    if (linesRef.current.length === 0) {
      toast.info("Savat bo'sh");
      return;
    }
    if (overLines.length > 0) {
      toast.error('Ba’zi qatorlarda qoldiq yetarli emas — sonini tuzating');
      return;
    }
    setPayOpen(true);
  };

  // ---------------------------------------------------------------------------
  // Sotuv
  // ---------------------------------------------------------------------------
  const saleMut = useMutation({
    mutationFn: (p: PaymentResult) =>
      api.pharmacy.createSale({
        idempotency_key: idemKey,
        pharmacy_clinic_id: b2bClinicId || undefined,
        pharmacy_doctor_id: b2bDoctorId || undefined,
        items: linesRef.current.map((l) => ({
          medication_id: l.med.medication_id,
          quantity: l.qty,
          unit_kind: l.unit_kind,
          preferred_batch_no: l.preferred_batch_no || undefined,
        })),
        payment_method: p.legs.length === 0 && p.debt > 0 ? 'debt' : (p.legs[0]?.method ?? 'cash'),
        payments: p.legs.map((l) => ({ method: l.method, amount_uzs: l.amount })),
        debt_uzs: p.debt,
        discount_uzs: p.discount,
        received_cash_uzs: p.receivedCash,
        change_uzs: p.change,
        notes: p.notes,
      }),
    onSuccess: (sale, p) => {
      clearCart();
      setPayOpen(false);
      setB2bOpen(false);
      setLastSale(sale);
      setSelectedKey(null);
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      if (sale.duplicate) toast.info('Bu savat avval sotilgan — takror yozilmadi');
      else if (p.change && p.change > 0) toast.success(`Sotildi · Qaytim: ${fmt(p.change)} so'm`);
      else toast.success('Sotuv yakunlandi');
      if (sale.fiscal?.status === 'failed') {
        toast.warning('Fiskal chek yuborilmadi — navbatda qayta uriniladi');
      }
      if (receiptMode === 'ask') setPendingPrint(sale);
      else
        void printSale(sale, receiptMode, ph.clinicName).catch((e) =>
          toast.error(`Chek chiqmadi: ${errText(e)}`),
        );
      focusSearch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---------------------------------------------------------------------------
  // Klaviatura
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (payOpen || unknownScan || newMedBarcode || pendingPrint || gateOpen || pick) return;
      // Alt+1…9 — tezkor tugmalar (e.code: klaviatura raskladkasiga bog'liq emas)
      if (e.altKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code)) {
        const i = Number(e.code.slice(5)) - 1;
        const b = i < QUICK_HOTKEYS ? quick[i] : undefined;
        const med = b ? index.byId.get(b.medication_id) : undefined;
        if (b && med) {
          e.preventDefault();
          pressQuick(b, med);
        }
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === 'F9' || (e.key === 'Enter' && e.ctrlKey)) {
        e.preventDefault();
        openPay();
      } else if (e.key === 'F8') {
        e.preventDefault();
        park();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHl((h) => Math.min(Math.max(0, results.length - 1), h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHl((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey) return; // Ctrl+Enter — to'lov (umumiy tinglovchida)
      const text = searchText.trim();
      if (!text) {
        // Qidiruv bo'sh — tanlangan savat qatorini oynada ochish
        if (!q && selected) editLine(selected);
        return;
      }
      if (looksLikeCode(text) && (results.length === 0 || findByScan(index, text))) {
        void handleScan(parseScan(text));
        setQ('');
        return;
      }
      const m = results[hl];
      if (m) openPick(m, { qty: prefixQty });
    } else if (e.key === 'Escape') {
      setQ('');
    } else if (!q && selected && (e.key === '+' || e.key === '-')) {
      e.preventDefault();
      changeQty(selected.key, selected.qty + (e.key === '+' ? 1 : -1) || 1);
    } else if (!q && selected && e.key === 'Delete') {
      e.preventDefault();
      remove(selected.key);
    }
  };

  // ---------------------------------------------------------------------------
  if (gateOpen && shiftQ.data) {
    return (
      <OpenShiftCard registerNo={shiftQ.data.register_no} onOpened={() => void shiftQ.refetch()} />
    );
  }

  const shift = shiftQ.data?.shift ?? null;
  const quickByIdReady = !!catalogQ.data;

  return (
    <div className="flex flex-col gap-2 lg:h-[calc(100vh-150px)] lg:min-h-[560px]">
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(460px,42%)]">
        {/* ---------------- Chap: qidiruv, natijalar, tezkor tugmalar ---------------- */}
        <Card className="flex min-h-[420px] flex-col overflow-hidden">
          <div className="space-y-1.5 border-b p-3">
            <div className="relative">
              <Search className="text-muted-foreground absolute left-3 top-3.5 h-5 w-5" />
              <Input
                ref={searchRef}
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Dori nomi, xalqaro nomi yoki shtrix-kod… (F2)"
                className="h-12 pl-10 text-lg"
              />
              {q && (
                <button
                  className="text-muted-foreground hover:text-foreground absolute right-3 top-3.5"
                  onClick={() => {
                    setQ('');
                    focusSearch();
                  }}
                  aria-label="Tozalash"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <span className="inline-flex items-center gap-1">
                <ScanLine className="h-3.5 w-3.5" /> Skaner tayyor — istalgan joyda o'qiting
              </span>
              <span>"3*para" — 3 ta</span>
              <button
                className="hover:text-foreground ml-auto inline-flex items-center gap-1"
                onClick={() => {
                  void catalogQ.refetch();
                  void quickQ.refetch();
                }}
                title="Katalogni yangilash"
              >
                <RefreshCw className={cn('h-3 w-3', catalogQ.isFetching && 'animate-spin')} />
                {catalogQ.data ? `${catalogQ.data.items.length} dori` : 'yuklanmoqda…'}
              </button>
            </div>
          </div>

          <div ref={resultsRef} className="flex-1 overflow-y-auto">
            {catalogQ.isLoading ? (
              <div className="text-muted-foreground p-6 text-sm">Katalog yuklanmoqda…</div>
            ) : catalogQ.isError ? (
              <div className="p-6 text-sm text-rose-600">
                Katalog yuklanmadi: {errText(catalogQ.error)}{' '}
                <button className="underline" onClick={() => void catalogQ.refetch()}>
                  qayta urinish
                </button>
              </div>
            ) : !searchText.trim() ? (
              <div className="space-y-4 p-3">
                {quick.length > 0 && quickByIdReady ? (
                  <div className="space-y-2">
                    <div className="text-muted-foreground flex items-center justify-between text-xs">
                      <span className="text-foreground inline-flex items-center gap-1 font-medium">
                        <Zap className="h-3.5 w-3.5 text-amber-500" /> Tezkor tugmalar
                      </span>
                      {ph.isAdmin && (
                        <Link to={`${ph.path('settings')}?tab=quick`} className="hover:underline">
                          Sozlash
                        </Link>
                      )}
                    </div>
                    <QuickGrid buttons={quick} byId={index.byId} onPress={pressQuick} />
                  </div>
                ) : (
                  !quickQ.isLoading && (
                    <div className="text-muted-foreground flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-xs">
                      <Zap className="h-4 w-4 text-amber-500" />
                      Tez-tez sotiladigan dorilar uchun tezkor tugmalar qo'shing.
                      {ph.isAdmin ? (
                        <Link
                          to={`${ph.path('settings')}?tab=quick`}
                          className="text-primary font-medium hover:underline"
                        >
                          Sozlamalar → Tezkor tugmalar
                        </Link>
                      ) : (
                        <span>(admin Sozlamalarda qo'shadi)</span>
                      )}
                    </div>
                  )
                )}
                <PosHint index={index} />
              </div>
            ) : results.length === 0 ? (
              <div className="text-muted-foreground p-6 text-center text-sm">
                "{searchText}" topilmadi. Kirill/lotin farqi yo'q — boshqacha yozib ko'ring.
              </div>
            ) : (
              <div className="divide-y">
                {results.map((m, i) => (
                  <ResultRow
                    key={m.medication_id}
                    m={m}
                    idx={i}
                    active={i === hl}
                    onHover={() => setHl(i)}
                    onPick={(kind) => openPick(m, { qty: prefixQty, unit_kind: kind })}
                  />
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* ---------------- O'ng: savat va to'lov ---------------- */}
        <Card className="flex min-h-[420px] flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <ShoppingCart className="text-primary h-4 w-4" />
              <span className="font-semibold">Savat</span>
              {lines.length > 0 && (
                <Badge variant="secondary">
                  {lines.length} xil · {itemsCount} birlik
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {parked.length > 0 && (
                <div className="relative">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => setParkedOpen((v) => !v)}
                  >
                    <Clock className="mr-1 h-3.5 w-3.5" /> Kutishda ({parked.length})
                  </Button>
                  {parkedOpen && (
                    <div className="bg-popover absolute right-0 top-8 z-20 w-72 rounded-md border p-1 shadow-lg">
                      {parked.map((p) => (
                        <button
                          key={p.id}
                          className="hover:bg-muted flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs"
                          onClick={() => unpark(p)}
                        >
                          <span className="truncate">
                            {new Date(p.at).toLocaleTimeString('uz-UZ', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}{' '}
                            · {p.lines.map((l) => l.med.name).join(', ')}
                          </span>
                          <span className="ml-2 shrink-0 font-semibold">{fmt(netOf(p.lines))}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={lines.length === 0}
                onClick={park}
                title="Kutishga qo'yish (F8)"
              >
                <PauseCircle className="mr-1 h-3.5 w-3.5" /> Kutish
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-rose-600"
                disabled={lines.length === 0}
                title="Savatni tozalash"
                onClick={() => {
                  if (window.confirm('Savat tozalansinmi?')) clearCart();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Mijoz klinika (B2B) */}
          <div className="border-b px-3 py-2">
            <button
              className="flex w-full items-center justify-between text-left text-xs"
              onClick={() => setB2bOpen((v) => !v)}
            >
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="text-muted-foreground h-3.5 w-3.5" />
                Mijoz: <b>{b2bClinic?.name ?? 'Oddiy xaridor'}</b>
                {b2bClinic && b2bDoctorId && (
                  <span className="text-muted-foreground">
                    · {b2bClinic.doctors.find((d) => d.id === b2bDoctorId)?.full_name}
                  </span>
                )}
              </span>
              <ChevronDown
                className={cn('h-3.5 w-3.5 transition-transform', b2bOpen && 'rotate-180')}
              />
            </button>
            {b2bOpen && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <select
                  className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                  value={b2bClinicId}
                  onChange={(e) => {
                    setB2bClinicId(e.target.value);
                    setB2bDoctorId('');
                  }}
                >
                  <option value="">Oddiy xaridor</option>
                  {(clinicsQ.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.debt_uzs > 0 ? ` (qarz ${fmt(c.debt_uzs)})` : ''}
                    </option>
                  ))}
                </select>
                <select
                  className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                  value={b2bDoctorId}
                  disabled={!b2bClinic}
                  onChange={(e) => setB2bDoctorId(e.target.value)}
                >
                  <option value="">{b2bClinic ? 'Shifokor (ixtiyoriy)' : 'Avval klinika'}</option>
                  {(b2bClinic?.doctors ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Qatorlar (jadval) */}
          {lines.length > 0 && (
            <div
              className={cn(
                CART_GRID,
                'text-muted-foreground border-b py-1 text-[10px] uppercase tracking-wide',
              )}
            >
              <span>№</span>
              <span>Dori</span>
              <span className="text-center">Son</span>
              <span className="text-right">Summa</span>
              <span />
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {lines.length === 0 ? (
              <div className="text-muted-foreground flex h-full min-h-[160px] flex-col items-center justify-center gap-2 p-6 text-center text-sm">
                <ScanLine className="h-8 w-8 opacity-40" />
                Skanerlang, dori nomini yozing yoki tezkor tugmani bosing
              </div>
            ) : (
              <div className="divide-y">
                {lines.map((l, i) => (
                  <CartRow
                    key={l.key}
                    no={i + 1}
                    line={l}
                    max={maxQtyFor(lines, l)}
                    selected={selected?.key === l.key}
                    onOpen={() => editLine(l)}
                    onQty={(n) => changeQty(l.key, n)}
                    onRemove={() => remove(l.key)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Jami va to'lov */}
          <div className="bg-muted/30 space-y-2 border-t p-3">
            {lastSale && (
              <div className="bg-background flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs">
                <span className="truncate">
                  Oxirgi: <b>{fmt(lastSale.total_uzs)}</b> ·{' '}
                  {PAY_LABEL[lastSale.payment_method] ?? lastSale.payment_method}
                  {lastSale.change_uzs ? ` · qaytim ${fmt(lastSale.change_uzs)}` : ''}
                  {lastSale.fiscal ? ` · fiskal: ${lastSale.fiscal.status}` : ''}
                </span>
                <span className="flex shrink-0 gap-1">
                  <button
                    className="hover:text-primary"
                    title="Chekni qayta chiqarish"
                    onClick={() =>
                      void printSale(
                        lastSale,
                        receiptMode === 'a4' ? 'a4' : 'thermal',
                        ph.clinicName,
                        { copy: true },
                      ).catch((e) => toast.error(errText(e)))
                    }
                  >
                    <Printer className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="hover:text-primary"
                    title="Sotuvni ochish"
                    onClick={() => navigate(ph.salePath(lastSale.id))}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
            )}
            {overLines.length > 0 && (
              <div className="flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">
                <AlertTriangle className="h-3.5 w-3.5" /> {overLines.length} qatorda qoldiq yetarli
                emas — qatorni bosib sonini tuzating
              </div>
            )}
            {lineDisc > 0 && (
              <div className="space-y-0.5 text-sm">
                <div className="text-muted-foreground flex justify-between">
                  <span>Oraliq summa</span>
                  <span className="tabular-nums">{fmt(subtotal)}</span>
                </div>
                <div className="flex justify-between text-emerald-700">
                  <span>Chegirma</span>
                  <span className="tabular-nums">−{fmt(lineDisc)}</span>
                </div>
              </div>
            )}
            <div className="flex items-end justify-between">
              <div className="text-muted-foreground text-xs">
                {shift ? (
                  <>
                    Kassa {shift.register_no} · smena{' '}
                    {new Date(shift.opened_at).toLocaleTimeString('uz-UZ', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </>
                ) : (
                  'Kassa smenasiz'
                )}
                {ph.operator && <> · {ph.operator.full_name}</>}
              </div>
              <div className="text-right">
                <div className="text-muted-foreground text-xs">Jami</div>
                <div className="text-3xl font-bold tabular-nums">{fmt(net)}</div>
              </div>
            </div>
            <Button
              className="h-14 w-full text-lg font-semibold"
              disabled={lines.length === 0 || overLines.length > 0 || saleMut.isPending}
              onClick={openPay}
            >
              To'lash · {fmt(net)} so'm (F9)
            </Button>
            <div className="text-muted-foreground flex items-center justify-between text-[11px]">
              <span>Chek: {RECEIPT_MODE_LABELS[receiptMode]}</span>
              <select
                className="bg-transparent text-[11px] underline"
                value={receiptMode}
                onChange={(e) => {
                  const m = e.target.value as ReceiptMode;
                  saveReceiptMode(m);
                  setReceiptMode(m);
                }}
              >
                {(Object.keys(RECEIPT_MODE_LABELS) as ReceiptMode[]).map((m) => (
                  <option key={m} value={m}>
                    {RECEIPT_MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>
      </div>

      {/* Klaviatura yordami */}
      <div className="text-muted-foreground bg-muted/30 hidden flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-1.5 text-[11px] lg:flex">
        {HOTKEYS.map(([k, l]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <kbd className="bg-background rounded border px-1 font-mono text-[10px]">{k}</kbd> {l}
          </span>
        ))}
      </div>

      <PaymentDialog
        open={payOpen}
        subtotal={subtotal}
        lineDiscount={lineDisc}
        canDiscount={ph.canDiscount}
        b2bClinicName={b2bClinic?.name ?? null}
        busy={saleMut.isPending}
        onClose={() => {
          setPayOpen(false);
          focusSearch();
        }}
        onConfirm={(p) => saleMut.mutate(p)}
      />

      {pick && (
        <QtyDialog
          key={`${pick.med.medication_id}-${pick.lineKey ?? 'new'}`}
          req={pick}
          lines={lines}
          canDiscount={ph.canDiscount}
          isSameMed={(s) => findByScan(index, s)?.medication_id === pick.med.medication_id}
          onClose={closePick}
          onConfirm={confirmPick}
          onRemove={
            pick.lineKey
              ? () => {
                  remove(pick.lineKey!);
                  closePick();
                }
              : undefined
          }
        />
      )}

      <ReceiptChoiceDialog
        open={!!pendingPrint}
        summary={pendingPrint ? `Jami ${fmt(pendingPrint.total_uzs)} so'm` : ''}
        onClose={() => {
          setPendingPrint(null);
          focusSearch();
        }}
        onPick={(m, remember) => {
          const sale = pendingPrint;
          setPendingPrint(null);
          if (remember) {
            saveReceiptMode(m);
            setReceiptMode(m);
          }
          if (sale && m !== 'none') {
            void printSale(sale, m, ph.clinicName).catch((e) =>
              toast.error(`Chek chiqmadi: ${errText(e)}`),
            );
          }
          focusSearch();
        }}
      />

      {unknownScan && (
        <UnknownCodeDialog
          scan={unknownScan}
          index={index}
          canAttach={ph.canReceive || ph.isAdmin}
          onClose={() => {
            setUnknownScan(null);
            focusSearch();
          }}
          onAttached={(med) => {
            setUnknownScan(null);
            void catalogQ.refetch();
            addMed(med, { preferred_batch_no: unknownScan.batch ?? null });
            focusSearch();
          }}
          onCreateNew={() => {
            setNewMedBarcode(unknownScan.gtin ?? unknownScan.code);
            setUnknownScan(null);
          }}
        />
      )}
      {newMedBarcode && (
        <MedicationFormDialog
          initial={null}
          preset={{ barcode: newMedBarcode }}
          onClose={() => {
            setNewMedBarcode(null);
            focusSearch();
          }}
          onSaved={() => {
            toast.info("Dori qo'shildi. Sotish uchun avval prixod qiling.");
            void catalogQ.refetch();
          }}
        />
      )}
    </div>
  );
}

const HOTKEYS: Array<[string, string]> = [
  ['F2', 'qidiruv'],
  ['↑↓ Enter', 'tanlash'],
  [`Alt+1…${QUICK_HOTKEYS}`, 'tezkor tugma'],
  ['+/−', 'son'],
  ['Enter', 'qatorni ochish'],
  ['Del', "o'chirish"],
  ['F8', 'kutish'],
  ['F9', "to'lov"],
];

/** Savat jadvali ustunlari: № · dori · son · summa · ✕ */
const CART_GRID =
  'grid grid-cols-[20px_minmax(0,1fr)_auto_minmax(72px,auto)_18px] items-center gap-x-2 px-3';

// -----------------------------------------------------------------------------
// Natija qatori: dori + birlik tugmalari (qadoq / blister / dona)
// -----------------------------------------------------------------------------
function ResultRow({
  m,
  idx,
  active,
  onHover,
  onPick,
}: {
  m: PharmacyCatalogItem;
  idx: number;
  active: boolean;
  onHover: () => void;
  onPick: (kind?: UnitKind) => void;
}) {
  const kinds = allowedUnitKinds(m);
  const out = m.qty_sellable <= 0;
  const low = !out && m.qty_sellable <= (m.reorder_level ?? 0);
  const exp = expiryInfo(m.earliest_sellable_expiry);
  return (
    <div
      data-idx={idx}
      onMouseEnter={onHover}
      onClick={() => !out && onPick()}
      className={cn(
        'flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 transition-colors',
        active && 'bg-primary/10',
        out && 'cursor-not-allowed opacity-50',
      )}
    >
      <div className="min-w-0">
        <div className="truncate font-medium">
          {m.name}
          {m.requires_prescription && (
            <Badge variant="outline" className="ml-1 text-[10px]">
              Rx
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground truncate text-xs">
          {[m.strength, m.form, m.manufacturer, m.generic_name].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {kinds.length > 1 ? (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            {kinds.map((k) => (
              <button
                key={k}
                disabled={out}
                onClick={() => onPick(k)}
                className="hover:border-primary hover:bg-primary/5 rounded border px-1.5 py-0.5 text-right text-[11px] leading-tight"
              >
                <div className="font-semibold">{fmt(unitPrice(m, k))}</div>
                <div className="text-muted-foreground">{unitLabel(k, m)}</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-right">
            <div className="font-semibold tabular-nums">
              {fmt(unitPrice(m, kinds[0] ?? 'unit'))}
            </div>
            <div className="text-muted-foreground text-[11px]">
              {unitLabel(kinds[0] ?? 'unit', m)}
            </div>
          </div>
        )}
        <div className="w-24 text-right text-[11px]">
          <div
            className={cn(
              'font-medium',
              out ? 'text-rose-600' : low ? 'text-amber-600' : 'text-emerald-700',
            )}
          >
            {out ? 'Tugagan' : formatStock(m.qty_sellable, m)}
          </div>
          {exp && !out && (
            <div className={cn(exp.days <= 90 ? 'text-amber-600' : 'text-muted-foreground')}>
              {exp.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Savat qatori (jadval): bosilsa — miqdor oynasi (son, birlik, chegirma)
// -----------------------------------------------------------------------------
function CartRow({
  no,
  line,
  max,
  selected,
  onOpen,
  onQty,
  onRemove,
}: {
  no: number;
  line: CartLine;
  max: number;
  selected: boolean;
  onOpen: () => void;
  onQty: (n: number) => void;
  onRemove: () => void;
}) {
  const over = line.qty > max;
  const exp = expiryInfo(line.med.earliest_sellable_expiry);
  const disc = lineDiscount(line);
  const unit = unitLabel(line.unit_kind, line.med);
  return (
    <div
      onClick={onOpen}
      title="Bosing — son, birlik, chegirma"
      className={cn(
        CART_GRID,
        'hover:bg-muted/40 cursor-pointer py-2',
        selected && 'bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]',
        over && 'bg-rose-50 hover:bg-rose-50',
      )}
    >
      <span className="text-muted-foreground text-xs tabular-nums">{no}</span>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          {line.med.name}
          {line.med.requires_prescription && (
            <Badge variant="outline" className="ml-1 text-[10px]">
              Rx
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground truncate text-[11px]">
          {fmt(linePrice(line))} / {unit}
          {line.preferred_batch_no && (
            <span className="ml-1 font-mono">· seriya {line.preferred_batch_no}</span>
          )}
          {exp && exp.days <= 60 && (
            <span className="ml-1 text-amber-600">· muddat {exp.text}</span>
          )}
          {disc > 0 && (
            <span className="ml-1 text-emerald-700">
              · chegirma −{fmt(disc)}
              {line.disc_kind === 'pct' ? ` (${line.disc_value}%)` : ''}
            </span>
          )}
        </div>
        {over && (
          <div className="text-[11px] font-medium text-rose-700">
            Qoldiq: {max} {unit} gacha
          </div>
        )}
      </div>
      <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7"
          disabled={line.qty <= 1}
          onClick={() => onQty(Math.max(1, line.qty - 1))}
          aria-label="Kamaytirish"
        >
          <Minus className="h-3 w-3" />
        </Button>
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            'hover:bg-muted mx-1 h-7 min-w-[64px] rounded border px-1.5 text-sm font-semibold tabular-nums',
            over && 'border-rose-400 text-rose-700',
          )}
        >
          {line.qty} <span className="text-muted-foreground text-[10px] font-normal">{unit}</span>
        </button>
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7"
          disabled={line.qty >= max}
          onClick={() => onQty(line.qty + 1)}
          aria-label="Ko'paytirish"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      <div className="text-right">
        {disc > 0 && (
          <div className="text-muted-foreground text-[11px] tabular-nums line-through">
            {fmt(lineTotal(line))}
          </div>
        )}
        <div className="font-semibold tabular-nums">{fmt(lineNet(line))}</div>
      </div>
      <button
        className="text-muted-foreground hover:text-rose-600"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label="O'chirish"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Bo'sh qidiruvda: yordam + tugayotgan dorilar
// -----------------------------------------------------------------------------
function PosHint({ index }: { index: CatalogIndex }) {
  const low = useMemo(
    () =>
      index.items
        .filter((m) => m.qty_sellable > 0 && m.qty_sellable <= (m.reorder_level ?? 0))
        .slice(0, 8),
    [index],
  );
  return (
    <div className="space-y-4 p-6 text-sm">
      <div className="text-muted-foreground space-y-1">
        <div className="text-foreground font-medium">Tez sotish</div>
        <div>
          · Skaner bilan o'qiting — dori savatga o'zi tushadi (kursor qayerda bo'lishidan qat'i
          nazar).
        </div>
        <div>
          · Dori nomini yozib tanlang (bosing yoki Enter) — oynada son, qoldiq, narx va chegirma.
        </div>
        <div>· Savatdagi qatorni bosing — sonini, birligini yoki chegirmasini o'zgartirasiz.</div>
        <div>
          · DataMatrix'dagi seriya va muddat hisobga olinadi; muddati o'tgan qadoq sotilmaydi.
        </div>
        <div>· Chekdagi QR'ni o'qitsangiz — o'sha sotuv ochiladi (qaytarish uchun).</div>
        <div>· Nom yozing: kirillcha ham bo'ladi ("парацетамол" = "paracetamol").</div>
      </div>
      {low.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-amber-700">Tugayotgan dorilar</div>
          <div className="flex flex-wrap gap-1">
            {low.map((m) => (
              <span
                key={m.medication_id}
                className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800"
              >
                {m.name} · {formatStock(m.qty_sellable, m)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Noma'lum kod: mavjud doriga biriktirish yoki yangi dori
// -----------------------------------------------------------------------------
function UnknownCodeDialog({
  scan,
  index,
  canAttach,
  onClose,
  onAttached,
  onCreateNew,
}: {
  scan: ParsedScan;
  index: CatalogIndex;
  canAttach: boolean;
  onClose: () => void;
  onAttached: (med: CartMed) => void;
  onCreateNew: () => void;
}) {
  const [q, setQ] = useState('');
  const results = useMemo(() => searchCatalog(index, q, 12), [index, q]);
  const attach = useMutation({
    mutationFn: (med: PharmacyCatalogItem) =>
      api.pharmacy.addBarcode(med.medication_id, { code: scan.gtin ?? scan.raw }).then(() => med),
    onSuccess: (med) => {
      toast.success(`Kod ${med.name} ga biriktirildi`);
      onAttached(med);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Kod topilmadi</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{scan.gtin ?? scan.code}</span>
            {scan.expiry && <> · muddat {scan.expiry}</>}
            {scan.batch && <> · seriya {scan.batch}</>}
          </DialogDescription>
        </DialogHeader>
        {canAttach ? (
          <div className="space-y-2">
            <div className="text-muted-foreground text-xs">
              Bu qadoq bazadagi qaysi dori? Tanlang — kod shu doriga biriktiriladi va keyingi safar
              darhol topiladi.
            </div>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Dori nomini yozing…"
              autoFocus
            />
            <div className="max-h-[40vh] divide-y overflow-y-auto rounded border">
              {results.length === 0 ? (
                <div className="text-muted-foreground p-3 text-center text-xs">
                  {q ? 'Topilmadi' : 'Nomini yozing'}
                </div>
              ) : (
                results.map((m) => (
                  <button
                    key={m.medication_id}
                    disabled={attach.isPending}
                    onClick={() => attach.mutate(m)}
                    className="hover:bg-muted flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{m.name}</span>
                      <span className="text-muted-foreground block truncate text-[11px]">
                        {[m.strength, m.form, m.manufacturer].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="text-muted-foreground ml-2 shrink-0 text-xs">
                      {formatStock(m.qty_sellable, m)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            Kodni doriga biriktirish uchun prixod huquqi kerak. Administratorga murojaat qiling.
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          {canAttach ? (
            <Button variant="outline" onClick={onCreateNew}>
              <Plus className="mr-1 h-4 w-4" /> Yangi dori sifatida
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ghost" onClick={onClose}>
            Yopish (Esc)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
