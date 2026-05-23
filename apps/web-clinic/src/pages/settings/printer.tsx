import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Printer, RotateCcw, Save, Settings as SettingsIcon } from 'lucide-react';
import { toast } from 'sonner';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { printPayslip } from '@/lib/payslip';
import {
  PAYSLIP_SECTION_LABELS,
  getPayslipSettings,
  resetPayslipSettings,
  savePayslipSettings,
  type PayslipSection,
  type PayslipSettings,
  type PayslipWidth,
} from '@/lib/payslip-settings';

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

      <PayslipSettingsCard />
    </div>
  );
}

// =============================================================================
// Payslip (Maosh varaqasi) sozlamalari — alohida card va modal
// =============================================================================
function PayslipSettingsCard() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<PayslipSettings>(() => getPayslipSettings());

  // Modal ochilganda fresh load (boshqa joydan o'zgartirilgan bo'lsa ham)
  useEffect(() => {
    if (open) setSettings(getPayslipSettings());
  }, [open]);

  const handleSave = () => {
    savePayslipSettings(settings);
    toast.success('Maosh varaqasi sozlamalari saqlandi');
    setOpen(false);
  };

  const handleReset = () => {
    const def = resetPayslipSettings();
    setSettings(def);
    toast.success("Standartga qaytarildi");
  };

  const handleTestPayslip = (format: PayslipWidth) => {
    // Avval saqlaymiz (foydalanuvchi sozlagani sinov chek'ga ta'sir qilsin)
    savePayslipSettings(settings);
    printPayslip(
      {
        clinic_name: 'Sinov klinika',
        clinic_address: 'Toshkent sh., Misol ko\'chasi 1',
        clinic_phone: '+998 90 123 45 67',
        employee_name: 'Mirshohid Test',
        employee_position: 'Shifokor',
        period_from: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          .toISOString().slice(0, 10),
        period_to: new Date().toISOString().slice(0, 10),
        commissions_uzs: 2_500_000,
        monthly_base_uzs: 5_000_000,
        bonuses_uzs: 300_000,
        advances_uzs: 1_000_000,
        penalties_uzs: 50_000,
        gross_uzs: 7_800_000,
        deductions_uzs: 1_050_000,
        net_uzs: 6_750_000,
        generated_at: new Date().toISOString(),
      },
      format,
    );
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            Maosh varaqasi (Payslip) sozlamalari
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Maosh varaqasini A4/PDF, 80mm yoki 58mm formatda chiqarish.
            Qaysi qatorlar ko'rinishini, sarlavhani va o'lchamni o'zingiz sozlaysiz.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setOpen(true)} className="gap-1.5">
              <SettingsIcon className="h-4 w-4" />
              Sozlash va sinash
            </Button>
            <div className="text-xs text-muted-foreground">
              Joriy: <strong>{settings.paper_width.toUpperCase()}</strong> •{' '}
              Sarlavha: <strong>{settings.title}</strong>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Maosh varaqasi sozlamalari</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Qog'oz o'lchami */}
            <div className="space-y-1.5">
              <Label>Standart qog'oz o'lchami</Label>
              <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
                {(
                  [
                    { v: 'a4', label: 'A4 (PDF)' },
                    { v: '80mm', label: '80mm termal' },
                    { v: '58mm', label: '58mm termal' },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.v}
                    type="button"
                    onClick={() => setSettings((s) => ({ ...s, paper_width: p.v }))}
                    className={
                      'rounded px-4 py-1.5 text-xs font-medium transition ' +
                      (settings.paper_width === p.v
                        ? 'bg-background shadow-sm'
                        : 'text-muted-foreground')
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Bu standart o'lcham. Hisob-kitob → Payslip tugmasini bosganda
                har bir formatni alohida tanlash mumkin.
              </p>
            </div>

            {/* Sarlavha */}
            <div className="space-y-1.5">
              <Label>Sarlavha matni</Label>
              <Input
                value={settings.title}
                onChange={(e) => setSettings((s) => ({ ...s, title: e.target.value }))}
                placeholder="Maosh varaqasi"
              />
            </div>

            {/* Termal font o'lchami */}
            <div className="space-y-1.5">
              <Label>Termal printer font o'lchami (px) — {settings.thermal_font_size}</Label>
              <Input
                type="range"
                min={9}
                max={16}
                value={settings.thermal_font_size}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, thermal_font_size: Number(e.target.value) }))
                }
              />
              <p className="text-[11px] text-muted-foreground">
                Faqat 58mm va 80mm termal formatga ta'sir qiladi. A4 alohida shrift.
              </p>
            </div>

            {/* Bo'limlar (qatorlar) toggle */}
            <div className="space-y-2">
              <Label>Chiqariladigan qatorlar (belgilanganlari ko'rinadi)</Label>
              <div className="grid grid-cols-1 gap-1.5 rounded-md border p-3 sm:grid-cols-2">
                {(Object.keys(PAYSLIP_SECTION_LABELS) as PayslipSection[]).map((key) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={settings.sections[key]}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          sections: { ...s.sections, [key]: e.target.checked },
                        }))
                      }
                    />
                    <span>{PAYSLIP_SECTION_LABELS[key]}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Footer izoh */}
            <div className="space-y-1.5">
              <Label>Pastki matn (footer)</Label>
              <Textarea
                value={settings.footer_note}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, footer_note: e.target.value }))
                }
                rows={2}
                placeholder="Clary Clinic CRM • Avtomatik hosil qilingan hujjat"
              />
            </div>

            {/* Sinov */}
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
              <div className="mb-2 text-xs font-semibold text-blue-900">
                Sinov chek (test ma'lumotlar bilan)
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleTestPayslip('a4')}
                  className="gap-1"
                >
                  <FileText className="h-3.5 w-3.5" /> A4 PDF
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleTestPayslip('80mm')}
                  className="gap-1"
                >
                  <Printer className="h-3.5 w-3.5" /> 80mm
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleTestPayslip('58mm')}
                  className="gap-1"
                >
                  <Printer className="h-3.5 w-3.5" /> 58mm
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={handleReset} className="gap-1.5">
              <RotateCcw className="h-4 w-4" />
              Standart
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Bekor
            </Button>
            <Button onClick={handleSave} className="gap-1.5">
              <Save className="h-4 w-4" />
              Saqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
