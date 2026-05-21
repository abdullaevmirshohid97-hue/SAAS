import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Save } from 'lucide-react';
import { toast } from 'sonner';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import {
  paymentReceiptHtml,
  printReceipt,
  setReceiptSettingsCache,
  type ReceiptSettings,
} from '@/lib/print-receipt';

const DEFAULTS: ReceiptSettings = {
  paper_width: '80mm',
  font_family: 'monospace',
  font_size: 12,
  font_weight: 'normal',
  brand_name: null,
  slogan: null,
  qr_text: null,
  qr_enabled: false,
  show_transaction_id: false,
  footer_note: "Rahmat! Sog'ligingizga shifo tilaymiz!",
};

export function SettingsPrinterPage() {
  const qc = useQueryClient();
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () =>
      api.get<{ clinic?: { name?: string; receipt_settings?: Partial<ReceiptSettings> } }>(
        '/api/v1/auth/me',
      ),
  });

  const serverSettings = useMemo<ReceiptSettings>(() => {
    const raw =
      (me as { clinic?: { receipt_settings?: Partial<ReceiptSettings> } } | undefined)?.clinic
        ?.receipt_settings ?? {};
    return { ...DEFAULTS, ...raw };
  }, [me]);

  const [settings, setSettings] = useState<ReceiptSettings>(serverSettings);

  // Server qiymatlari kelganda formani to'ldirish
  useEffect(() => {
    setSettings(serverSettings);
  }, [serverSettings]);

  const clinicName =
    (me as { clinic?: { name?: string } } | undefined)?.clinic?.name ?? 'Klinika';

  const saveMut = useMutation({
    mutationFn: () => api.patch<unknown>('/api/v1/auth/clinic/receipt-settings', settings),
    onSuccess: () => {
      toast.success('Saqlandi');
      setReceiptSettingsCache(settings);
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function update<K extends keyof ReceiptSettings>(key: K, val: ReceiptSettings[K]) {
    setSettings((s) => ({ ...s, [key]: val }));
  }

  // Sinov chop etish — joriy formdagi (saqlanmagan) sozlamalar bilan
  function handleTestPrint() {
    setReceiptSettingsCache(settings);
    printReceipt(
      paymentReceiptHtml({
        clinicName,
        ticketNo: '042',
        date: new Date().toLocaleString('uz-UZ', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        patientName: 'Test Bemor',
        items: [
          { name: 'Konsultatsiya', qty: 1, amount: 150000 },
          { name: 'Tahlil', qty: 1, amount: 80000 },
        ],
        totalUzs: 230000,
        paidUzs: 230000,
        debtUzs: 0,
        paymentMethod: 'cash',
        transactionId: 'TEST-12345678',
      }),
      settings,
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Chek printer</h1>
        <p className="text-sm text-muted-foreground">
          Chek qog‘ozi, shrift va brending sozlamalari. Qabulxonada va navbatda
          bu sozlamalar avtomatik qo‘llanadi.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Qog‘oz va shrift</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Qog‘oz kengligi</Label>
              <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
                {(['58mm', '80mm'] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => update('paper_width', w)}
                    className={
                      'rounded px-4 py-2 text-sm font-medium transition ' +
                      (settings.paper_width === w
                        ? 'bg-background shadow-sm'
                        : 'text-muted-foreground')
                    }
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Shrift turi</Label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { value: 'monospace', label: 'Monospace', font: 'monospace' },
                    { value: 'sans-serif', label: 'Sans-serif', font: 'sans-serif' },
                    { value: 'serif', label: 'Serif', font: 'serif' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => update('font_family', f.value)}
                    className={
                      'rounded-md border px-3 py-2 text-sm transition ' +
                      (settings.font_family === f.value
                        ? 'border-primary bg-primary/10 font-semibold'
                        : 'hover:bg-accent')
                    }
                    style={{ fontFamily: f.font }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Harf hajmi (px)</Label>
                <Input
                  type="number"
                  min={8}
                  max={24}
                  value={settings.font_size}
                  onChange={(e) =>
                    update('font_size', Math.max(8, Math.min(24, Number(e.target.value) || 12)))
                  }
                />
                <p className="text-[11px] text-muted-foreground">8 dan 24 gacha</p>
              </div>
              <div className="space-y-2">
                <Label>Harf qalinligi</Label>
                <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
                  {(
                    [
                      { value: 'normal', label: 'Ingichka' },
                      { value: 'bold', label: 'Qalin' },
                    ] as const
                  ).map((w) => (
                    <button
                      key={w.value}
                      type="button"
                      onClick={() => update('font_weight', w.value)}
                      className={
                        'rounded px-3 py-1.5 text-sm transition ' +
                        (settings.font_weight === w.value
                          ? 'bg-background shadow-sm'
                          : 'text-muted-foreground') +
                        (w.value === 'bold' ? ' font-bold' : '')
                      }
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Brending va izoh</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Brend nom (chek ustida)</Label>
              <Input
                placeholder="Masalan: CLARY KLINIKA"
                value={settings.brand_name ?? ''}
                onChange={(e) => update('brand_name', e.target.value || null)}
              />
            </div>
            <div className="space-y-2">
              <Label>Shior</Label>
              <Input
                placeholder="Masalan: Sog‘liq biz uchun muhim"
                value={settings.slogan ?? ''}
                onChange={(e) => update('slogan', e.target.value || null)}
              />
            </div>
            <div className="space-y-2">
              <Label>Pastdagi izoh (chek oxirida)</Label>
              <Textarea
                rows={2}
                placeholder="Rahmat! Sog‘ligingizga shifo tilaymiz!"
                value={settings.footer_note ?? ''}
                onChange={(e) => update('footer_note', e.target.value || null)}
              />
            </div>

            <div className="space-y-2 border-t pt-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.show_transaction_id}
                  onChange={(e) => update('show_transaction_id', e.target.checked)}
                />
                Tranzaksiya ID ko‘rsatish (texnik raqam)
              </label>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>QR kod</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.qr_enabled}
                onChange={(e) => update('qr_enabled', e.target.checked)}
              />
              QR kod ko‘rsatish
            </label>
            {settings.qr_enabled && (
              <div className="space-y-2">
                <Label>QR kod matni / havola</Label>
                <Input
                  placeholder="https://clary.uz yoki Telegram havola yoki @username"
                  value={settings.qr_text ?? ''}
                  onChange={(e) => update('qr_text', e.target.value || null)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Bemor QR kod orqali sizning sahifangizga, Telegram'ga yoki
                  Internet havolaga o‘tishi mumkin.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="gap-1.5"
        >
          <Save className="h-4 w-4" />
          {saveMut.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
        </Button>
        <Button variant="outline" onClick={handleTestPrint} className="gap-1.5">
          <Printer className="h-4 w-4" />
          Sinov chek (joriy sozlamalar)
        </Button>
      </div>
    </div>
  );
}
