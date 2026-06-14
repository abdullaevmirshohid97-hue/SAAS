import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Input,
  Label,
} from '@clary/ui-web';
import { CheckCircle2, Pencil, Plus, Printer, Send, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { isTauri } from '@/lib/platform';
import { PRINTER_PRESETS, getPresetByKey } from '@/lib/printer-presets';

type Printer = {
  id: string;
  name: string;
  connection_type: 'lan' | 'usb' | 'bluetooth';
  ip_address: string | null;
  port: number;
  usb_vendor_id: string | null;
  usb_product_id: string | null;
  bt_mac: string | null;
  bt_name: string | null;
  paper_width_mm: 58 | 80;
  is_default: boolean;
  is_active: boolean;
  location: string | null;
  has_cutter: boolean;
  has_cash_drawer: boolean;
  purpose: 'receipt' | 'queue' | 'report' | 'label';
  preset_key: string | null;
  encoding: 'CP1251' | 'UTF-8' | 'CP866';
};

export function SettingsThermalPrintersPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Printer | 'new' | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['thermal-printers'],
    queryFn: () => api.printers.list(),
  });
  const printers = (data ?? []) as Printer[];

  const removeMut = useMutation({
    mutationFn: (id: string) => api.printers.remove(id),
    onSuccess: () => {
      toast.success("O'chirildi");
      qc.invalidateQueries({ queryKey: ['thermal-printers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testMut = useMutation({
    mutationFn: (id: string) =>
      api.printers.print({
        printer_id: id,
        kind: 'other',
        content: {
          header: 'TEST CHEK',
          title: 'Printer sinovi',
          lines: [
            { text: 'Bu sinov chek', align: 'center' as const },
            { text: new Date().toLocaleString('uz-UZ'), align: 'center' as const },
          ],
          footer: 'Sinov muvaffaqiyatli',
          cut: true,
        },
      }),
    onSuccess: () => toast.success("Sinov chek yuborildi"),
    onError: (e: Error) => toast.error(`Sinov xato: ${e.message}`),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Termal printerlar</h1>
          <p className="text-sm text-muted-foreground">
            LAN (tarmoq) printer sozlangan bo'lsa, chek <strong>dialog'siz</strong> darhol
            chiqadi. Aks holda brauzer print oynasi ochiladi.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus className="mr-1.5 h-4 w-4" />
          Yangi printer
        </Button>
      </div>

      {isTauri() && <DesktopPrinterCard />}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Yuklanmoqda...</div>
          ) : printers.length === 0 ? (
            <div className="space-y-3 p-8 text-center">
              <Printer className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <div className="text-sm font-medium">Printer sozlanmagan</div>
              <p className="text-xs text-muted-foreground">
                Hozir chek chiqarganda brauzer dialog so'raydi. Tarmoqdagi
                printerni qo'shsangiz, chek darhol chop etiladi.
              </p>
              <Button onClick={() => setEditing('new')}>
                <Plus className="mr-1.5 h-4 w-4" />
                Birinchi printer qo'shish
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {printers.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-4 p-4 hover:bg-accent/30"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg border bg-muted/30 p-2">
                      <Printer className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        {p.is_default && (
                          <Badge variant="success" className="gap-1 text-[10px]">
                            <Star className="h-2.5 w-2.5" /> Default
                          </Badge>
                        )}
                        {!p.is_active && (
                          <Badge variant="destructive" className="text-[10px]">
                            O'chirilgan
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p.connection_type.toUpperCase()}
                        {p.ip_address && ` · ${p.ip_address}:${p.port}`}
                        {' · '}
                        {p.paper_width_mm}mm
                        {p.location && ` · ${p.location}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => testMut.mutate(p.id)}
                      disabled={testMut.isPending}
                      title="Sinov chek yuborish"
                    >
                      <Send className="mr-1 h-3.5 w-3.5" />
                      Sinov
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setEditing(p)}
                      title="Tahrirlash"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-rose-600"
                      onClick={() => {
                        if (window.confirm(`"${p.name}" printerni o'chirmoqchimisiz?`)) {
                          removeMut.mutate(p.id);
                        }
                      }}
                      title="O'chirish"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Foydali maslahat */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="space-y-2 p-4 text-sm text-blue-900">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="h-4 w-4" />
            Qanday ishlaydi
          </div>
          <ul className="ml-6 list-disc space-y-1 text-xs">
            <li>
              <strong>LAN (Wi-Fi/tarmoq) printer</strong> — printer'ning IP manzili va
              port'ini kiriting (default 9100). Chek darhol chop etiladi, dialog
              ko'rinmaydi.
            </li>
            <li>
              <strong>USB printer</strong> — hozirda brauzer dialog'i orqali ishlaydi.
              Silent chop etish uchun keyingi versiyada agent dasturi qo'shiladi.
            </li>
            <li>
              <strong>Default printer</strong> — bir nechta printer bo'lsa, default
              ishlatiladi. Tahrirlashda belgilang.
            </li>
            <li>
              Mos modellar: <em>Xprinter XP-58 / XP-80, Epson TM-T20, GP-58, GP-80</em> va
              ESC/POS protokolini qo'llab-quvvatlovchi har qanday printer.
            </li>
          </ul>
        </CardContent>
      </Card>

      {editing && (
        <PrinterFormDialog
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['thermal-printers'] });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// Desktop (Tauri) — tizim/USB printerni tanlash. Tanlangan nom localStorage'da
// saqlanadi va `printReceiptHybrid` undan to'g'ridan-to'g'ri (silent) chop etadi.
const DESKTOP_PRINTER_KEY = 'clary.desktop.printer';

function DesktopPrinterCard() {
  const [printers, setPrinters] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      setSelected(localStorage.getItem(DESKTOP_PRINTER_KEY) ?? '');
    } catch {
      /* ignore */
    }
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const list = await invoke<string[]>('list_printers');
        setPrinters(list ?? []);
      } catch (e) {
        console.warn('[printers] list_printers failed:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function save(name: string) {
    setSelected(name);
    try {
      localStorage.setItem(DESKTOP_PRINTER_KEY, name);
    } catch {
      /* ignore */
    }
    toast.success(name ? `Desktop printer: ${name}` : 'Desktop printer tozalandi');
  }

  async function testPrint() {
    if (!selected) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('print_thermal', {
        printerName: selected,
        paperWidth: localStorage.getItem('clary_receipt_width') ?? '80mm',
        content: {
          header: 'CLARY',
          title: 'Sinov cheki',
          lines: [{ text: 'Desktop silent print ✓', align: 'center' }],
          footer: 'Sinov muvaffaqiyatli',
          cut: true,
        },
      });
      toast.success('Sinov chek yuborildi (dialogsiz)');
    } catch (e) {
      toast.error(`Sinov xato: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2 font-semibold">
          <Printer className="h-4 w-4 text-primary" />
          Desktop printer (silent, dialogsiz)
        </div>
        <p className="text-xs text-muted-foreground">
          Desktop ilovada USB/Windows printerga to‘g‘ridan-to‘g‘ri chop etiladi —
          brauzer dialogi <strong>ko‘rinmaydi</strong>. Quyidan printerni tanlang.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selected}
            onChange={(e) => save(e.target.value)}
            disabled={loading}
            className="h-9 min-w-[16rem] rounded-md border bg-background px-3 text-sm"
          >
            <option value="">— Tanlanmagan (brauzer/LAN) —</option>
            {printers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" disabled={!selected} onClick={testPrint}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Sinov
          </Button>
        </div>
        {loading && <div className="text-xs text-muted-foreground">Printerlar yuklanmoqda…</div>}
      </CardContent>
    </Card>
  );
}

function PrinterFormDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Printer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [presetKey, setPresetKey] = useState(initial?.preset_key ?? '');
  const [connectionType, setConnectionType] = useState<'lan' | 'usb' | 'bluetooth'>(
    initial?.connection_type ?? 'lan',
  );
  const [ipAddress, setIpAddress] = useState(initial?.ip_address ?? '');
  const [port, setPort] = useState(String(initial?.port ?? 9100));
  const [usbVid, setUsbVid] = useState(initial?.usb_vendor_id ?? '');
  const [usbPid, setUsbPid] = useState(initial?.usb_product_id ?? '');
  const [btMac, setBtMac] = useState(initial?.bt_mac ?? '');
  const [paperWidth, setPaperWidth] = useState<'58' | '80'>(
    String(initial?.paper_width_mm ?? 80) as '58' | '80',
  );
  const [isDefault, setIsDefault] = useState(initial?.is_default ?? false);
  const [location, setLocation] = useState(initial?.location ?? '');
  const [hasCutter, setHasCutter] = useState(initial?.has_cutter ?? false);
  const [hasCashDrawer, setHasCashDrawer] = useState(initial?.has_cash_drawer ?? false);
  const [purpose, setPurpose] = useState<'receipt' | 'queue' | 'report' | 'label'>(
    initial?.purpose ?? 'receipt',
  );
  const [encoding, setEncoding] = useState<'CP1251' | 'UTF-8' | 'CP866'>(
    initial?.encoding ?? 'CP1251',
  );

  // Preset tanlanganda forma maydonlarini avtomatik to'ldirish.
  const applyPreset = (key: string) => {
    setPresetKey(key);
    const p = getPresetByKey(key);
    if (!p) return;
    if (!name) setName(`${p.brand} ${p.model}`);
    setPaperWidth(String(p.paper_width_mm) as '58' | '80');
    setHasCutter(p.has_cutter);
    setEncoding(p.encoding);
    setConnectionType(p.recommended_connection);
    if (p.usb_vendor_id) setUsbVid(p.usb_vendor_id);
    if (p.usb_product_id) setUsbPid(p.usb_product_id);
  };

  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        name,
        connection_type: connectionType,
        ip_address: connectionType === 'lan' ? ipAddress : undefined,
        port: Number(port) || 9100,
        usb_vendor_id: connectionType === 'usb' ? usbVid || undefined : undefined,
        usb_product_id: connectionType === 'usb' ? usbPid || undefined : undefined,
        bt_mac: connectionType === 'bluetooth' ? btMac || undefined : undefined,
        paper_width_mm: Number(paperWidth) as 58 | 80,
        is_default: isDefault,
        location: location || undefined,
        has_cutter: hasCutter,
        has_cash_drawer: hasCashDrawer,
        purpose,
        preset_key: presetKey || undefined,
        encoding,
      };
      return initial
        ? api.printers.update(initial.id, body)
        : api.printers.create(body);
    },
    onSuccess: () => {
      toast.success(initial ? "Saqlandi" : "Qo'shildi");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? 'Printer tahrir' : 'Yangi printer'}</DialogTitle>
          <DialogDescription>
            Tarmoq printer'ining IP manzili va port'ini kiriting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>Preset (tezkor tanlov)</Label>
            <select
              value={presetKey}
              onChange={(e) => applyPreset(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="">— Tanlanmagan (qo‘lda sozlash) —</option>
              <optgroup label="Tavsiya etilgan">
                {PRINTER_PRESETS.filter((p) => p.recommended).map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.brand} {p.model} ({p.paper_width_mm}mm)
                  </option>
                ))}
              </optgroup>
              <optgroup label="Boshqa">
                {PRINTER_PRESETS.filter((p) => !p.recommended).map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.brand} {p.model} ({p.paper_width_mm}mm)
                  </option>
                ))}
              </optgroup>
            </select>
            {presetKey && (
              <p className="text-[11px] text-muted-foreground">
                {getPresetByKey(presetKey)?.notes}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Nom *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Masalan: Qabulxona printer"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Maqsad</Label>
            <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
              {(
                [
                  { v: 'receipt', label: 'Chek' },
                  { v: 'queue', label: 'Navbat' },
                  { v: 'report', label: 'Hisobot' },
                  { v: 'label', label: 'Yorliq' },
                ] as const
              ).map((t) => (
                <button
                  key={t.v}
                  type="button"
                  onClick={() => setPurpose(t.v)}
                  className={
                    'rounded px-3 py-1.5 text-xs font-medium transition ' +
                    (purpose === t.v ? 'bg-background shadow-sm' : 'text-muted-foreground')
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Har maqsad uchun klinikada faqat bitta default printer bo‘ladi.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Ulanish turi</Label>
            <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
              {(
                [
                  { v: 'lan', label: 'LAN (Tarmoq)' },
                  { v: 'usb', label: 'USB' },
                  { v: 'bluetooth', label: 'Bluetooth' },
                ] as const
              ).map((t) => (
                <button
                  key={t.v}
                  type="button"
                  onClick={() => setConnectionType(t.v)}
                  className={
                    'rounded px-3 py-1.5 text-xs font-medium transition ' +
                    (connectionType === t.v
                      ? 'bg-background shadow-sm'
                      : 'text-muted-foreground')
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
            {connectionType === 'lan' && (
              <p className="text-[11px] text-emerald-700">
                ✓ Tarmoq (LAN/WiFi) printer — eng barqaror, server orqali silent print ishlaydi.
              </p>
            )}
            {connectionType === 'usb' && (
              <p className="text-[11px] text-amber-700">
                USB silent print uchun desktop ilova kerak (keyingi versiya). Hozir saqlanadi, lekin brauzer dialog'i bilan ishlaydi.
              </p>
            )}
            {connectionType === 'bluetooth' && (
              <p className="text-[11px] text-amber-700">
                Bluetooth ishlaydi, lekin sekin va uzilib qolishi mumkin. Desktop ilova kelishini kuting.
              </p>
            )}
          </div>

          {connectionType === 'lan' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>IP manzili *</Label>
                <Input
                  value={ipAddress}
                  onChange={(e) => setIpAddress(e.target.value)}
                  placeholder="192.168.1.100"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Port</Label>
                <Input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="9100"
                />
              </div>
            </div>
          )}

          {connectionType === 'usb' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>USB Vendor ID</Label>
                <Input
                  value={usbVid}
                  onChange={(e) => setUsbVid(e.target.value)}
                  placeholder="04b8"
                />
              </div>
              <div className="space-y-1.5">
                <Label>USB Product ID</Label>
                <Input
                  value={usbPid}
                  onChange={(e) => setUsbPid(e.target.value)}
                  placeholder="0e15"
                />
              </div>
            </div>
          )}

          {connectionType === 'bluetooth' && (
            <div className="space-y-1.5">
              <Label>Bluetooth MAC manzili</Label>
              <Input
                value={btMac}
                onChange={(e) => setBtMac(e.target.value)}
                placeholder="AA:BB:CC:DD:EE:FF"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Qog'oz kengligi</Label>
            <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
              {(['58', '80'] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setPaperWidth(w)}
                  className={
                    'rounded px-4 py-1.5 text-xs font-medium transition ' +
                    (paperWidth === w
                      ? 'bg-background shadow-sm'
                      : 'text-muted-foreground')
                  }
                >
                  {w}mm
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Kodlash (encoding)</Label>
            <select
              value={encoding}
              onChange={(e) => setEncoding(e.target.value as typeof encoding)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="CP1251">CP1251 — Kirill (tavsiya)</option>
              <option value="UTF-8">UTF-8 — Zamonaviy printerlar</option>
              <option value="CP866">CP866 — Eski DOS</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="inline-flex items-center gap-2 text-sm rounded-md border px-2 py-1.5">
              <input
                type="checkbox"
                checked={hasCutter}
                onChange={(e) => setHasCutter(e.target.checked)}
              />
              Avtomatik kesuvchi
            </label>
            <label className="inline-flex items-center gap-2 text-sm rounded-md border px-2 py-1.5">
              <input
                type="checkbox"
                checked={hasCashDrawer}
                onChange={(e) => setHasCashDrawer(e.target.checked)}
              />
              Kassa qutisi (cash drawer)
            </label>
          </div>

          <div className="space-y-1.5">
            <Label>Joylashuv (ixtiyoriy)</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Masalan: Qabulxona stoli"
            />
          </div>

          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            Asosiy printer sifatida belgilash ({purpose})
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor
          </Button>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={!name || (connectionType === 'lan' && !ipAddress) || saveMut.isPending}
          >
            {saveMut.isPending ? 'Saqlanmoqda...' : 'Saqlash'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
