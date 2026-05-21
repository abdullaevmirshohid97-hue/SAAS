import { useState } from 'react';
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

type Printer = {
  id: string;
  name: string;
  connection_type: 'lan' | 'usb' | 'bluetooth';
  ip_address: string | null;
  port: number;
  paper_width_mm: 58 | 80;
  is_default: boolean;
  is_active: boolean;
  location: string | null;
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
  const [connectionType, setConnectionType] = useState<'lan' | 'usb' | 'bluetooth'>(
    initial?.connection_type ?? 'lan',
  );
  const [ipAddress, setIpAddress] = useState(initial?.ip_address ?? '');
  const [port, setPort] = useState(String(initial?.port ?? 9100));
  const [paperWidth, setPaperWidth] = useState<'58' | '80'>(
    String(initial?.paper_width_mm ?? 80) as '58' | '80',
  );
  const [isDefault, setIsDefault] = useState(initial?.is_default ?? false);
  const [location, setLocation] = useState(initial?.location ?? '');

  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        name,
        connection_type: connectionType,
        ip_address: connectionType === 'lan' ? ipAddress : undefined,
        port: Number(port) || 9100,
        paper_width_mm: Number(paperWidth) as 58 | 80,
        is_default: isDefault,
        location: location || undefined,
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

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nom *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Masalan: Qabulxona printer"
            />
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
            {connectionType !== 'lan' && (
              <p className="text-[11px] text-amber-700">
                USB/Bluetooth hozirda brauzer dialog'i bilan ishlaydi. Silent print
                faqat LAN'da.
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
            Asosiy printer sifatida belgilash
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
