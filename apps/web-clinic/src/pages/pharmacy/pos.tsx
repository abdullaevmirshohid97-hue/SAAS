import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  formatStock,
  parseScan,
  unitLabel,
  unitPrice,
  type ParsedScan,
  type UnitKind,
} from '@clary/utils';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import {
  addToCart,
  cartSubtotal,
  linePrice,
  lineTotal,
  maxQtyFor,
  refreshMeds,
  removeLine,
  setLineQty,
  setLineUnit,
  type CartLine,
  type CartMed,
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
import { ReceiptChoiceDialog, errText, fmt } from './shared';
import { OpenShiftCard } from './shifts';

// =============================================================================
// Kassa (POS) 2.0
// =============================================================================
//  * Katalog bir marta yuklanadi — qidiruv va skaner brauzerda (< 50 ms).
//  * Har qanday skaner: EAN/UPC, Code128, QR, GS1 DataMatrix (muddat/seriya).
//    Muddati o'tgan qadoq skanerlansa — sotilmaydi. Chek QR'i → sotuv sahifasi.
//  * Qadoq / blister / dona bo'lib sotish (dori sozlamasida ruxsat bo'lsa).
//  * Klaviatura: F2 qidiruv · ↑↓ Enter qo'shish · "3*para" 3 dona · +/− son ·
//    Del o'chirish · F8 kutishga · F9 to'lov.
//  * Idempotent: bir savat ikki marta sotilmaydi (tarmoq takrori, ikki bosish).
// =============================================================================

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
  const overLines = lines.filter((l) => l.qty > maxQtyFor(lines, l) || l.qty < 1);
  const itemsCount = lines.reduce((a, l) => a + l.qty, 0);

  // ---------------------------------------------------------------------------
  // Savatga qo'shish
  // ---------------------------------------------------------------------------
  const addMed = useCallback(
    (
      med: CartMed,
      opts: { qty?: number; unit_kind?: UnitKind; preferred_batch_no?: string | null } = {},
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
    enabled: !payOpen && !unknownScan && !newMedBarcode && !gateOpen,
  });

  // ---------------------------------------------------------------------------
  // Savat amallari
  // ---------------------------------------------------------------------------
  const selected = lines.find((l) => l.key === selectedKey) ?? lines[lines.length - 1] ?? null;
  const changeQty = (key: string, qty: number) => commit(setLineQty(linesRef.current, key, qty));
  const changeUnit = (key: string, kind: UnitKind) =>
    commit(setLineUnit(linesRef.current, key, kind));
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
      if (payOpen || unknownScan || newMedBarcode || pendingPrint || gateOpen) return;
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
      const text = searchText.trim();
      if (!text) return;
      if (looksLikeCode(text) && (results.length === 0 || findByScan(index, text))) {
        void handleScan(parseScan(text));
        setQ('');
        return;
      }
      const m = results[hl];
      if (m && addMed(m, { qty: prefixQty })) setQ('');
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

  return (
    <div className="grid gap-3 lg:h-[calc(100vh-150px)] lg:min-h-[560px] lg:grid-cols-[minmax(0,1fr)_460px]">
      {/* ---------------- Chap: qidiruv va natijalar ---------------- */}
      <Card className="flex min-h-[420px] flex-col overflow-hidden">
        <div className="space-y-2 border-b p-3">
          <div className="relative">
            <Search className="text-muted-foreground absolute left-3 top-3 h-5 w-5" />
            <Input
              ref={searchRef}
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Dori nomi, xalqaro nomi yoki kod… (F2)  ·  3*para — 3 dona"
              className="h-11 pl-10 text-base"
            />
            {q && (
              <button
                className="text-muted-foreground hover:text-foreground absolute right-3 top-3"
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
            <span>↑↓ Enter — qo'shish</span>
            <span>+/− son · Del o'chirish</span>
            <span>F8 kutish · F9 to'lov</span>
            <button
              className="hover:text-foreground ml-auto inline-flex items-center gap-1"
              onClick={() => void catalogQ.refetch()}
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
            <PosHint index={index} />
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
                  onPick={(kind) => {
                    if (addMed(m, { qty: prefixQty, unit_kind: kind })) setQ('');
                    focusSearch();
                  }}
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
                        <span className="ml-2 shrink-0 font-semibold">
                          {fmt(cartSubtotal(p.lines))}
                        </span>
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

        {/* Qatorlar */}
        <div className="flex-1 overflow-y-auto">
          {lines.length === 0 ? (
            <div className="text-muted-foreground flex h-full min-h-[160px] flex-col items-center justify-center gap-2 p-6 text-center text-sm">
              <ScanLine className="h-8 w-8 opacity-40" />
              Skanerlang yoki chapdan dori tanlang
            </div>
          ) : (
            <div className="divide-y">
              {lines.map((l) => (
                <CartRow
                  key={l.key}
                  line={l}
                  max={maxQtyFor(lines, l)}
                  selected={selected?.key === l.key}
                  onSelect={() => setSelectedKey(l.key)}
                  onQty={(n) => changeQty(l.key, n)}
                  onUnit={(k) => changeUnit(l.key, k)}
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
              emas
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
              <div className="text-3xl font-bold tabular-nums">{fmt(subtotal)}</div>
            </div>
          </div>
          <Button
            className="h-12 w-full text-base"
            disabled={lines.length === 0 || overLines.length > 0 || saleMut.isPending}
            onClick={openPay}
          >
            To'lash · {fmt(subtotal)} so'm (F9)
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

      <PaymentDialog
        open={payOpen}
        subtotal={subtotal}
        canDiscount={ph.canDiscount}
        b2bClinicName={b2bClinic?.name ?? null}
        busy={saleMut.isPending}
        onClose={() => {
          setPayOpen(false);
          focusSearch();
        }}
        onConfirm={(p) => saleMut.mutate(p)}
      />

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
// Savat qatori
// -----------------------------------------------------------------------------
function CartRow({
  line,
  max,
  selected,
  onSelect,
  onQty,
  onUnit,
  onRemove,
}: {
  line: CartLine;
  max: number;
  selected: boolean;
  onSelect: () => void;
  onQty: (n: number) => void;
  onUnit: (k: UnitKind) => void;
  onRemove: () => void;
}) {
  const kinds = allowedUnitKinds(line.med);
  const over = line.qty > max;
  const exp = expiryInfo(line.med.earliest_sellable_expiry);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div
      onClick={onSelect}
      className={cn(
        'px-3 py-2',
        selected && 'bg-primary/5 border-l-primary border-l-2',
        over && 'bg-rose-50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
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
            {[line.med.strength, line.med.form].filter(Boolean).join(' · ')}
            {line.preferred_batch_no && (
              <span className="ml-1 font-mono">· seriya {line.preferred_batch_no}</span>
            )}
            {exp && exp.days <= 60 && (
              <span className="ml-1 text-amber-600">· muddat {exp.text}</span>
            )}
          </div>
        </div>
        <button
          className="text-muted-foreground shrink-0 hover:text-rose-600"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="O'chirish"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {kinds.length > 1 && (
            <div className="flex overflow-hidden rounded border text-[11px]">
              {kinds.map((k) => (
                <button
                  key={k}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnit(k);
                  }}
                  className={cn(
                    'px-1.5 py-0.5',
                    line.unit_kind === k ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                  )}
                >
                  {unitLabel(k, line.med)}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center">
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                onQty(Math.max(1, line.qty - 1));
              }}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <Input
              value={draft ?? String(line.qty)}
              inputMode="numeric"
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => {
                setDraft(String(line.qty));
                e.currentTarget.select();
              }}
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
              onBlur={() => {
                if (draft != null) onQty(Math.max(1, Number(draft) || 1));
                setDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              className={cn(
                'mx-1 h-7 w-14 px-1 text-center text-sm tabular-nums',
                over && 'border-rose-400',
              )}
            />
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7"
              disabled={line.qty >= max}
              onClick={(e) => {
                e.stopPropagation();
                onQty(line.qty + 1);
              }}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          {kinds.length <= 1 && (
            <span className="text-muted-foreground text-[11px]">
              {unitLabel(line.unit_kind, line.med)}
            </span>
          )}
        </div>
        <div className="text-right">
          <div className="text-muted-foreground text-[11px]">
            {fmt(linePrice(line))} × {line.qty}
          </div>
          <div className="font-semibold tabular-nums">{fmt(lineTotal(line))}</div>
        </div>
      </div>
      {over && (
        <div className="mt-1 text-[11px] text-rose-700">
          Qoldiq: {max} {unitLabel(line.unit_kind, line.med)} gacha
        </div>
      )}
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
