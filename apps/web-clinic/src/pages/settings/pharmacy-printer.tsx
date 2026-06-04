import { useState } from 'react';
import { Printer, RotateCcw, Save } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clary/ui-web';
import { toast } from 'sonner';

import {
  type ReceiptSettings,
  type ReceiptFontFamily,
  type ReceiptFontWeight,
  RECEIPT_FONT_FAMILY_LABELS,
  RECEIPT_FONT_FAMILY_CSS,
  RECEIPT_FONT_WEIGHT_CSS,
  getPharmacyReceiptSettings,
  setPharmacyReceiptSettings,
  hasPharmacyReceiptOverride,
  paymentReceiptHtml,
  printReceipt,
} from '@/lib/print-receipt';

// Chek harf qalinligi — 3 toifa: past / o'rta / yog'on.
const WEIGHT_OPTIONS: Array<{ value: ReceiptFontWeight; label: string }> = [
  { value: 'normal', label: 'Past' },
  { value: 'medium', label: "O'rta" },
  { value: 'bold', label: "Yog'on" },
];

// Dorixona chek printeri — ALOHIDA (lokal) profil. Sozlanmagan bo'lsa klinika
// (Sozlamalar > Chek printer) sozlamalariga tushadi. Termal/LAN printer umumiy —
// u "Termal printer" sahifasida boshqariladi; bu yerda dorixona cheki ko'rinishi.
export function SettingsPharmacyPrinterPage() {
  const [settings, setSettings] = useState<ReceiptSettings>(() => getPharmacyReceiptSettings());
  const [overridden, setOverridden] = useState(hasPharmacyReceiptOverride());

  function update<K extends keyof ReceiptSettings>(key: K, val: ReceiptSettings[K]) {
    setSettings((s) => ({ ...s, [key]: val }));
  }

  function handleSave() {
    setPharmacyReceiptSettings(settings);
    setOverridden(true);
    toast.success('Dorixona chek sozlamalari saqlandi');
  }

  function handleReset() {
    localStorage.removeItem('clary_receipt_settings_pharmacy');
    setSettings(getPharmacyReceiptSettings());
    setOverridden(false);
    toast.success('Klinika sozlamasiga qaytarildi');
  }

  function handleTestPrint() {
    printReceipt(
      paymentReceiptHtml({
        clinicName: settings.brand_name || 'DORIXONA',
        ticketNo: null,
        date: new Date().toLocaleString('uz-UZ', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        }),
        patientName: 'Dorixona mijozi',
        items: [
          { name: 'Paratsetamol 500mg', qty: 2, amount: 12000 },
          { name: 'Vitamin C', qty: 1, amount: 18000 },
        ],
        totalUzs: 30000,
        paidUzs: 30000,
        debtUzs: 0,
        paymentMethod: 'cash',
        transactionId: 'TEST-PHARM',
      }),
      settings,
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dorixona chek printeri</h1>
        <p className="text-sm text-muted-foreground">
          Dorixona savdosida chiqadigan chek ko‘rinishi (qog‘oz, shrift, brending).
          Sozlanmasa — klinika chek sozlamalari ishlatiladi.
          {overridden ? ' Hozir dorixona alohida profili faol.' : ' Hozir klinika sozlamasi ishlatilmoqda.'}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Qog‘oz va shrift</CardTitle></CardHeader>
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
                      (settings.paper_width === w ? 'bg-background shadow-sm' : 'text-muted-foreground')
                    }
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Shrift turi</Label>
              <Select
                value={settings.font_family}
                onValueChange={(v: ReceiptFontFamily) => update('font_family', v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(RECEIPT_FONT_FAMILY_LABELS) as Array<[ReceiptFontFamily, string]>).map(
                    ([k, label]) => (
                      <SelectItem key={k} value={k}>
                        <span style={{ fontFamily: RECEIPT_FONT_FAMILY_CSS[k] }}>{label}</span>
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Shrift o‘lchami (px) — {settings.font_size}</Label>
              <Input
                type="number"
                min={8}
                max={24}
                value={settings.font_size}
                onChange={(e) => update('font_size', Math.max(8, Math.min(24, Number(e.target.value) || 12)))}
              />
            </div>

            <div className="space-y-2">
              <Label>Harf qalinligi</Label>
              <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
                {WEIGHT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update('font_weight', opt.value)}
                    style={{ fontWeight: RECEIPT_FONT_WEIGHT_CSS[opt.value] }}
                    className={
                      'rounded px-4 py-2 text-sm transition ' +
                      (settings.font_weight === opt.value ? 'bg-background shadow-sm' : 'text-muted-foreground')
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Chekdagi barcha matnlar shu qalinlikda chiqadi.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Brending va izoh</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Brend nomi (chek sarlavhasi)</Label>
              <Input
                value={settings.brand_name ?? ''}
                onChange={(e) => update('brand_name', e.target.value || null)}
                placeholder="Masalan: SHIFO DORIXONA"
              />
            </div>
            <div className="space-y-2">
              <Label>Slogan</Label>
              <Input
                value={settings.slogan ?? ''}
                onChange={(e) => update('slogan', e.target.value || null)}
                placeholder="Ixtiyoriy"
              />
            </div>
            <div className="space-y-2">
              <Label>Pastki izoh (footer)</Label>
              <Input
                value={settings.footer_note ?? ''}
                onChange={(e) => update('footer_note', e.target.value || null)}
                placeholder="Rahmat! Sog'lik tilaymiz!"
              />
            </div>
            <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Termal/LAN printer qurilmasi <b>umumiy</b> — u “Termal printer (silent)”
              sahifasida sozlanadi. Bu yerda faqat dorixona cheki ko‘rinishi.
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSave} className="gap-1.5">
          <Save className="h-4 w-4" /> Saqlash
        </Button>
        <Button variant="outline" onClick={handleTestPrint} className="gap-1.5">
          <Printer className="h-4 w-4" /> Sinov chek
        </Button>
        {overridden && (
          <Button variant="ghost" onClick={handleReset} className="gap-1.5 text-muted-foreground">
            <RotateCcw className="h-4 w-4" /> Klinika sozlamasiga qaytarish
          </Button>
        )}
      </div>
    </div>
  );
}
