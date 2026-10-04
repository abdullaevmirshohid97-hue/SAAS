import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound,
  Laptop,
  Loader2,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  cn,
} from '@clary/ui-web';
import type { PharmacyDevice, PharmacyFiscalSettings, PharmacyOperator } from '@clary/api-client';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { getDeviceKey } from '@/lib/pharmacy/session';
import {
  DEFAULT_SCANNER_CONFIG,
  loadScannerConfig,
  saveScannerConfig,
  scannerHub,
  type ScanEvent,
  type ScannerConfig,
} from '@/lib/scanner/scanner';
import { SettingsPharmacyPrinterPage } from '@/pages/settings/pharmacy-printer';
import { SettingsThermalPrintersPage } from '@/pages/settings/thermal-printers';
import { usePharmacy } from './context';
import { LineField, errText, fmt } from './shared';

// =============================================================================
// Dorixona sozlamalari: skaner (har kompyuterda), printerlar, fiskal chek,
// operatorlar (PIN) va qurilmalar (alohida "Dorixona" kirishida).
// =============================================================================

type TabId = 'scanner' | 'printers' | 'fiscal' | 'operators' | 'devices';

export function PharmacySettingsTab() {
  const ph = usePharmacy();
  const tabs: Array<{ id: TabId; label: string; icon: typeof ScanLine; show: boolean }> = [
    { id: 'scanner', label: 'Skaner', icon: ScanLine, show: true },
    { id: 'printers', label: 'Printerlar', icon: Printer, show: true },
    { id: 'fiscal', label: 'Fiskal chek', icon: Receipt, show: true },
    {
      id: 'operators',
      label: 'Operatorlar (PIN)',
      icon: Users,
      show: ph.mode === 'workspace' && ph.isAdmin,
    },
    {
      id: 'devices',
      label: 'Qurilmalar',
      icon: Laptop,
      show: ph.mode === 'workspace' && ph.isAdmin,
    },
  ];
  const [tab, setTab] = useState<TabId>('scanner');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b">
        {tabs
          .filter((t) => t.show)
          .map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm',
                  tab === t.id
                    ? 'border-primary text-primary font-medium'
                    : 'text-muted-foreground border-transparent',
                )}
              >
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
      </div>
      {tab === 'scanner' && <ScannerSettings />}
      {tab === 'printers' &&
        (ph.mode === 'workspace' ? (
          <div className="space-y-6">
            <SettingsThermalPrintersPage />
            <SettingsPharmacyPrinterPage />
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
              Printerlar klinika sozlamalarida boshqariladi:
              <Button asChild size="sm" variant="outline">
                <Link to="/settings/thermal-printers">Termal printerlar</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/settings/pharmacy-printer">Dorixona cheki ko'rinishi</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      {tab === 'fiscal' && <FiscalSettings />}
      {tab === 'operators' && <OperatorsSettings />}
      {tab === 'devices' && <DevicesSettings />}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Skaner — model tanlash, sozlash va jonli sinov
// -----------------------------------------------------------------------------
const SCANNER_MODELS: Array<{
  id: string;
  label: string;
  hint: string;
  cfg: Partial<ScannerConfig>;
}> = [
  {
    id: 'usb-auto',
    label: 'USB skaner (har qanday, avtomatik)',
    hint: 'Honeywell, Zebra, Datalogic, Newland, Xprinter, Sunmi va boshqalar — klaviatura (HID) rejimida.',
    cfg: { maxGapMs: 35, minLength: 4, suffix: 'auto' },
  },
  {
    id: 'usb-enter',
    label: 'USB skaner, oxirida Enter',
    hint: 'Skaner kod oxirida Enter yuborsa — eng aniq rejim.',
    cfg: { maxGapMs: 35, minLength: 4, suffix: 'enter' },
  },
  {
    id: 'bt',
    label: 'Bluetooth / simsiz skaner',
    hint: 'Simsiz skanerlar belgilarni sekinroq yuboradi — oraliq kengroq.',
    cfg: { maxGapMs: 70, minLength: 4, suffix: 'auto' },
  },
  {
    id: 'tab',
    label: 'Oxirida Tab yuboradigan skaner',
    hint: 'Ba’zi skanerlar Enter o‘rniga Tab yuboradi.',
    cfg: { maxGapMs: 35, minLength: 4, suffix: 'tab' },
  },
  {
    id: 'slow',
    label: 'Sekin kompyuter / eski skaner',
    hint: 'Kodlar bo‘linib qolsa shuni tanlang.',
    cfg: { maxGapMs: 100, minLength: 4, suffix: 'auto' },
  },
];

const MODEL_KEY = 'clary.scanner.model';

function showRaw(s: string): string {
  return s.replace(/\u001d/g, '⟨GS⟩');
}

function ScannerSettings() {
  const [cfg, setCfg] = useState<ScannerConfig>(loadScannerConfig);
  const [model, setModel] = useState<string>(() => {
    try {
      return localStorage.getItem(MODEL_KEY) ?? 'usb-auto';
    } catch {
      return 'usb-auto';
    }
  });
  const [log, setLog] = useState<Array<ScanEvent & { found?: string | null }>>([]);

  useEffect(() => {
    scannerHub.start();
    return scannerHub.onAnyScan((e) => {
      setLog((l) => [{ ...e, found: undefined }, ...l].slice(0, 12));
      void api.pharmacy
        .lookup(e.raw)
        .then((r) =>
          setLog((l) =>
            l.map((x) => (x.at === e.at ? { ...x, found: r.medication?.name ?? null } : x)),
          ),
        )
        .catch(() => null);
    });
  }, []);

  const apply = (next: ScannerConfig, modelId = model) => {
    setCfg(next);
    saveScannerConfig(next);
    try {
      localStorage.setItem(MODEL_KEY, modelId);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Skaner modeli (shu kompyuter uchun)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="space-y-1.5">
            {SCANNER_MODELS.map((m) => (
              <label
                key={m.id}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-md border p-2',
                  model === m.id && 'border-primary bg-primary/5',
                )}
              >
                <input
                  type="radio"
                  className="mt-1"
                  checked={model === m.id}
                  onChange={() => {
                    setModel(m.id);
                    apply({ ...cfg, ...m.cfg, enabled: true }, m.id);
                  }}
                />
                <span>
                  <span className="font-medium">{m.label}</span>
                  <span className="text-muted-foreground block text-xs">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <LineField label="Belgilar oralig'i (ms)">
              <Input
                inputMode="numeric"
                value={String(cfg.maxGapMs)}
                onChange={(e) =>
                  apply({
                    ...cfg,
                    maxGapMs: Math.min(300, Math.max(10, Number(e.target.value) || 35)),
                  })
                }
              />
            </LineField>
            <LineField label="Eng qisqa kod">
              <Input
                inputMode="numeric"
                value={String(cfg.minLength)}
                onChange={(e) =>
                  apply({
                    ...cfg,
                    minLength: Math.min(20, Math.max(3, Number(e.target.value) || 4)),
                  })
                }
              />
            </LineField>
            <LineField label="Kod oxiri">
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-2"
                value={cfg.suffix}
                onChange={(e) =>
                  apply({ ...cfg, suffix: e.target.value as ScannerConfig['suffix'] })
                }
              >
                <option value="auto">Avtomatik</option>
                <option value="enter">Enter</option>
                <option value="tab">Tab</option>
              </select>
            </LineField>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={cfg.enabled}
              onChange={(e) => apply({ ...cfg, enabled: e.target.checked })}
            />
            Skaner yoqilgan
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => apply({ ...DEFAULT_SCANNER_CONFIG }, 'usb-auto')}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Standartga qaytarish
          </Button>
          <div className="bg-muted/40 text-muted-foreground rounded-md p-2 text-xs">
            Qo'llab-quvvatlanadi: EAN-13/8, UPC, Code128/39, QR, GS1 DataMatrix (GTIN + muddat +
            seriya). Kirill raskladka ta'sir qilmaydi. 2D kodlar uchun skaner "USB HID Keyboard"
            rejimida bo'lsin; DataMatrix'da GS (FNC1) belgisi yuborilishi tavsiya etiladi (bo'lmasa
            ham taxminan ajratiladi).
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sinov: istalgan kodni skanerlang</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {log.length === 0 ? (
            <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
              Qutidagi shtrix-kod yoki DataMatrix'ni skanerlang — natija shu yerda chiqadi.
            </div>
          ) : (
            log.map((e) => (
              <div key={e.at} className="rounded-md border p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary">{e.parsed.kind}</Badge>
                  <span className="text-muted-foreground">
                    {e.raw.length} belgi · {e.durationMs} ms · o'rtacha {e.avgGapMs} ms
                  </span>
                </div>
                <div className="mt-1 break-all font-mono">{showRaw(e.raw)}</div>
                <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-3">
                  {e.parsed.gtin && <span>GTIN: {e.parsed.gtin}</span>}
                  {e.parsed.expiry && <span>Muddat: {e.parsed.expiry}</span>}
                  {e.parsed.batch && <span>Seriya: {e.parsed.batch}</span>}
                  {e.parsed.serial && <span>S/N: {e.parsed.serial}</span>}
                  {e.parsed.ambiguous && (
                    <span className="text-amber-600">GS'siz — taxminiy ajratildi</span>
                  )}
                </div>
                <div className="mt-1">
                  {e.found === undefined ? (
                    <span className="text-muted-foreground">bazadan qidirilmoqda…</span>
                  ) : e.found ? (
                    <span className="text-emerald-700">✓ {e.found}</span>
                  ) : (
                    <span className="text-amber-700">Bazada bu kod yo'q</span>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Fiskal chek (onlayn-NKM)
// -----------------------------------------------------------------------------
const STATUS_CLS: Record<string, string> = {
  sent: 'bg-emerald-600',
  pending: 'bg-sky-600',
  failed: 'bg-rose-600',
  skipped: 'bg-slate-500',
};

function FiscalSettings() {
  const ph = usePharmacy();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('');
  const settingsQ = useQuery({
    queryKey: ['pharmacy', 'fiscal-settings'],
    queryFn: () => api.pharmacy.fiscal.settings(),
  });
  const receiptsQ = useQuery({
    queryKey: ['pharmacy', 'fiscal-receipts', status],
    queryFn: () => api.pharmacy.fiscal.receipts(status || undefined),
  });
  const [form, setForm] = useState<PharmacyFiscalSettings | null>(null);
  const [secret, setSecret] = useState('');
  useEffect(() => {
    if (settingsQ.data && !form) setForm(settingsQ.data);
  }, [settingsQ.data, form]);

  const save = useMutation({
    mutationFn: () =>
      api.pharmacy.fiscal.saveSettings({
        enabled: form!.enabled,
        provider: form!.provider,
        company_tin: form!.company_tin || null,
        company_name: form!.company_name || null,
        terminal_id: form!.terminal_id || null,
        endpoint_url: form!.endpoint_url || null,
        secret: secret || undefined,
        auto_send: form!.auto_send,
        block_without_mxik: form!.block_without_mxik,
        default_vat_percent: form!.default_vat_percent,
      }),
    onSuccess: (r) => {
      setForm(r);
      setSecret('');
      qc.invalidateQueries({ queryKey: ['pharmacy', 'fiscal-settings'] });
      toast.success('Fiskal sozlamalar saqlandi');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.pharmacy.fiscal.retry(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pharmacy', 'fiscal-receipts'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof PharmacyFiscalSettings>(k: K, v: PharmacyFiscalSettings[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));
  const readOnly = !ph.isAdmin;

  return (
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> Onlayn-NKM sozlamalari
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!form ? (
            <div className="text-muted-foreground">Yuklanmoqda…</div>
          ) : (
            <>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  disabled={readOnly}
                  checked={form.enabled}
                  onChange={(e) => set('enabled', e.target.checked)}
                />
                Fiskal chek yoqilgan
              </label>
              <LineField label="Provayder">
                <select
                  className="border-input bg-background h-9 w-full rounded-md border px-2"
                  disabled={readOnly}
                  value={form.provider}
                  onChange={(e) => set('provider', e.target.value as 'test' | 'http')}
                >
                  <option value="test">Sinov rejimi (haqiqiy chek emas)</option>
                  <option value="http">Fiskal operator API (HTTP)</option>
                </select>
              </LineField>
              <div className="grid grid-cols-2 gap-2">
                <LineField label="STIR (INN)">
                  <Input
                    disabled={readOnly}
                    value={form.company_tin ?? ''}
                    onChange={(e) => set('company_tin', e.target.value)}
                  />
                </LineField>
                <LineField label="Terminal (FM) ID">
                  <Input
                    disabled={readOnly}
                    value={form.terminal_id ?? ''}
                    onChange={(e) => set('terminal_id', e.target.value)}
                  />
                </LineField>
              </div>
              <LineField label="Korxona nomi">
                <Input
                  disabled={readOnly}
                  value={form.company_name ?? ''}
                  onChange={(e) => set('company_name', e.target.value)}
                />
              </LineField>
              {form.provider === 'http' && (
                <>
                  <LineField label="API manzili (https://…)">
                    <Input
                      disabled={readOnly}
                      value={form.endpoint_url ?? ''}
                      onChange={(e) => set('endpoint_url', e.target.value)}
                    />
                  </LineField>
                  <LineField
                    label={
                      form.has_secret
                        ? 'API kaliti (saqlangan — almashtirish uchun kiriting)'
                        : 'API kaliti'
                    }
                  >
                    <Input
                      type="password"
                      disabled={readOnly}
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder={form.has_secret ? '••••••••' : ''}
                    />
                  </LineField>
                </>
              )}
              <LineField label="Standart QQS %">
                <Input
                  disabled={readOnly}
                  inputMode="decimal"
                  value={String(form.default_vat_percent ?? 0)}
                  onChange={(e) =>
                    set(
                      'default_vat_percent',
                      Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                    )
                  }
                />
              </LineField>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  disabled={readOnly}
                  checked={form.auto_send}
                  onChange={(e) => set('auto_send', e.target.checked)}
                />
                Har sotuvda avtomatik yuborish
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  disabled={readOnly}
                  checked={form.block_without_mxik}
                  onChange={(e) => set('block_without_mxik', e.target.checked)}
                />
                MXIK kodi yo'q dorini sotishga ruxsat bermaslik
              </label>
              <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                Haqiqiy fiskal chek uchun fiskal operator (onlayn-NKM provayderi) bilan shartnoma va
                API kaliti kerak. Ungacha "Sinov rejimi"da chek oqimi tekshiriladi — soliqqa
                yuborilmaydi.
              </div>
              {!readOnly && (
                <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
                  {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Saqlash
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Fiskal cheklar navbati</CardTitle>
          <select
            className="border-input bg-background h-8 rounded-md border px-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Hammasi</option>
            <option value="failed">Xato</option>
            <option value="pending">Navbatda</option>
            <option value="sent">Yuborilgan</option>
            <option value="skipped">O'tkazib yuborilgan</option>
          </select>
        </CardHeader>
        <CardContent className="p-0">
          {receiptsQ.isLoading ? (
            <div className="text-muted-foreground p-4 text-sm">Yuklanmoqda…</div>
          ) : (receiptsQ.data ?? []).length === 0 ? (
            <div className="text-muted-foreground p-6 text-center text-sm">Chek yo'q</div>
          ) : (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-muted-foreground sticky top-0 text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left">Vaqt</th>
                    <th className="px-3 py-2 text-left">Turi</th>
                    <th className="px-3 py-2 text-right">Summa</th>
                    <th className="px-3 py-2 text-left">Holat</th>
                    <th className="px-3 py-2 text-left">Fiskal belgi</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(receiptsQ.data ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-xs">
                        {new Date(r.created_at).toLocaleString('uz-UZ')}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.kind === 'refund' ? 'Qaytarish' : 'Sotuv'}
                      </td>
                      <td className="px-3 py-2 text-right">{fmt(r.total_uzs)}</td>
                      <td className="px-3 py-2">
                        <Badge className={STATUS_CLS[r.status] ?? ''}>{r.status}</Badge>
                        {r.is_test && (
                          <span className="text-muted-foreground ml-1 text-[10px]">sinov</span>
                        )}
                        {r.last_error && (
                          <div
                            className="max-w-[260px] truncate text-[11px] text-rose-600"
                            title={r.last_error}
                          >
                            {r.last_error}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px]">{r.fiscal_sign ?? '—'}</td>
                      <td className="px-3 py-2 text-right">
                        {(r.status === 'failed' || r.status === 'pending') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={retry.isPending}
                            onClick={() => retry.mutate(r.id)}
                          >
                            Qayta
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Operatorlar — bitta Gmail, har kishiga alohida PIN (Admin / Kassa 1 / Kassa 2)
// -----------------------------------------------------------------------------
function OperatorsSettings() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PharmacyOperator | null>(null);
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy-ws', 'operators'],
    queryFn: () => api.pharmacyWs.operators(),
  });
  const toggle = useMutation({
    mutationFn: (o: PharmacyOperator) =>
      api.pharmacyWs.updateOperator(o.id, { is_active: !o.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pharmacy-ws'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const ops = data ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Operatorlar</CardTitle>
          <p className="text-muted-foreground text-xs">
            Har kassir o'z PIN kodi bilan kiradi. Kassaga biriktirilsa — sotuvlar o'sha kassa
            smenasiga yoziladi.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1 h-4 w-4" /> Operator
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="text-muted-foreground p-4 text-sm">Yuklanmoqda…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-muted-foreground text-xs">
              <tr>
                <th className="px-3 py-2 text-left">F.I.O.</th>
                <th className="px-3 py-2 text-left">Rol</th>
                <th className="px-3 py-2 text-left">Kassa</th>
                <th className="px-3 py-2 text-left">Huquqlar</th>
                <th className="px-3 py-2 text-left">Holat</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ops.map((o) => {
                const locked = o.pin_locked_until && new Date(o.pin_locked_until) > new Date();
                return (
                  <tr key={o.id} className={cn(!o.is_active && 'opacity-50')}>
                    <td className="px-3 py-2 font-medium">{o.full_name}</td>
                    <td className="px-3 py-2">
                      {o.role === 'admin' ? (
                        <Badge>Admin</Badge>
                      ) : (
                        <Badge variant="secondary">Kassir</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">{o.register_no ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {o.role === 'admin'
                        ? 'Hammasi'
                        : [
                            o.can_receive && 'prixod',
                            o.can_return && 'qaytarish',
                            o.can_discount && 'chegirma',
                          ]
                            .filter(Boolean)
                            .join(', ') || 'faqat sotuv'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {locked ? (
                        <span className="text-rose-600">PIN qulflangan</span>
                      ) : o.is_active ? (
                        <span className="text-emerald-700">Faol</span>
                      ) : (
                        'O‘chirilgan'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(o)}>
                        <UserCog className="mr-1 h-3.5 w-3.5" /> Tahrir
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate(o)}
                      >
                        {o.is_active ? "O'chirish" : 'Yoqish'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
      {(creating || editing) && (
        <OperatorDialog
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </Card>
  );
}

function OperatorDialog({
  initial,
  onClose,
}: {
  initial: PharmacyOperator | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.full_name ?? '');
  const [role, setRole] = useState<'admin' | 'cashier'>(initial?.role ?? 'cashier');
  const [reg, setReg] = useState<string>(
    initial?.register_no ? String(initial.register_no) : initial ? '' : '1',
  );
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [canReceive, setCanReceive] = useState(initial?.can_receive ?? false);
  const [canReturn, setCanReturn] = useState(initial?.can_return ?? false);
  const [canDiscount, setCanDiscount] = useState(initial?.can_discount ?? false);
  const pinOk = /^\d{4,6}$/.test(pin);
  const pinNeeded = !initial || pin.length > 0;
  const mut = useMutation({
    mutationFn: () => {
      const body = {
        full_name: name.trim(),
        role,
        register_no: reg ? Number(reg) : null,
        can_receive: canReceive,
        can_return: canReturn,
        can_discount: canDiscount,
      };
      return initial
        ? api.pharmacyWs.updateOperator(initial.id, { ...body, ...(pin ? { pin } : {}) })
        : api.pharmacyWs.createOperator({ ...body, pin });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy-ws'] });
      toast.success(initial ? 'Saqlandi' : "Operator qo'shildi");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-scanner="ignore">
        <DialogHeader>
          <DialogTitle>{initial ? 'Operatorni tahrirlash' : 'Yangi operator'}</DialogTitle>
          <DialogDescription>
            PIN — 4–6 raqam. Kassir PIN'ini faqat admin o'zgartiradi.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <LineField label="F.I.O. *">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </LineField>
          <div className="grid grid-cols-2 gap-2">
            <LineField label="Rol">
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'cashier')}
              >
                <option value="cashier">Kassir</option>
                <option value="admin">Admin</option>
              </select>
            </LineField>
            <LineField label="Kassa raqami">
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={reg}
                onChange={(e) => setReg(e.target.value)}
              >
                <option value="">Qurilma bo'yicha</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    Kassa {n}
                  </option>
                ))}
              </select>
            </LineField>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <LineField label={initial ? 'Yangi PIN (o‘zgartirish uchun)' : 'PIN *'}>
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </LineField>
            <LineField label="PIN (takror)">
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={pin2}
                onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </LineField>
          </div>
          {role === 'cashier' && (
            <div className="space-y-1.5 rounded-md border p-2 text-sm">
              <div className="text-muted-foreground text-xs">Qo'shimcha huquqlar</div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={canReceive}
                  onChange={(e) => setCanReceive(e.target.checked)}
                />{' '}
                Prixod qilish
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={canReturn}
                  onChange={(e) => setCanReturn(e.target.checked)}
                />{' '}
                Qaytarish
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={canDiscount}
                  onChange={(e) => setCanDiscount(e.target.checked)}
                />{' '}
                Chegirma berish
              </label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button
            disabled={!name.trim() || (pinNeeded && (!pinOk || pin !== pin2)) || mut.isPending}
            onClick={() => mut.mutate()}
          >
            <KeyRound className="mr-1 h-4 w-4" /> Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Qurilmalar — obunadagi limit (odatda 3: admin, kassa 1, kassa 2)
// -----------------------------------------------------------------------------
function DevicesSettings() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PharmacyDevice | null>(null);
  const statusQ = useQuery({
    queryKey: ['pharmacy-ws', 'status'],
    queryFn: () => api.pharmacyWs.status(),
  });
  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy-ws', 'devices'],
    queryFn: () => api.pharmacyWs.devices(),
  });
  const revoke = useMutation({
    mutationFn: (d: PharmacyDevice) =>
      d.is_revoked ? api.pharmacyWs.restoreDevice(d.id) : api.pharmacyWs.revokeDevice(d.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pharmacy-ws'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const thisDevice = statusQ.data?.device?.id ?? null;
  const devices = data ?? [];
  const active = devices.filter((d) => !d.is_revoked).length;
  const max = statusQ.data?.subscription.max_devices ?? 3;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Qurilmalar · {active}/{max}
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Bitta dorixona akkaunti bilan {max} tagacha kompyuter ishlaydi. Eskisini o'chirsangiz —
          yangisi ulanadi.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="text-muted-foreground p-4 text-sm">Yuklanmoqda…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-muted-foreground text-xs">
              <tr>
                <th className="px-3 py-2 text-left">Nomi</th>
                <th className="px-3 py-2 text-left">Kassa</th>
                <th className="px-3 py-2 text-left">Oxirgi faollik</th>
                <th className="px-3 py-2 text-left">Brauzer</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {devices.map((d) => (
                <tr key={d.id} className={cn(d.is_revoked && 'opacity-50')}>
                  <td className="px-3 py-2 font-medium">
                    {d.name}
                    {d.id === thisDevice && (
                      <Badge className="ml-1 bg-sky-600">shu kompyuter</Badge>
                    )}
                    {d.is_revoked && (
                      <span className="ml-1 text-xs text-rose-600">o'chirilgan</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{d.register_no ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {new Date(d.last_seen_at).toLocaleString('uz-UZ')}
                  </td>
                  <td
                    className="text-muted-foreground max-w-[240px] truncate px-3 py-2 text-xs"
                    title={d.user_agent ?? ''}
                  >
                    {d.user_agent ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>
                      Tahrir
                    </Button>
                    {d.id !== thisDevice && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className={d.is_revoked ? '' : 'text-rose-600'}
                        disabled={revoke.isPending}
                        onClick={() => {
                          if (d.is_revoked || window.confirm(`"${d.name}" qurilmasi uzilsinmi?`))
                            revoke.mutate(d);
                        }}
                      >
                        {d.is_revoked ? 'Tiklash' : 'Uzish'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="text-muted-foreground border-t px-3 py-2 text-[11px]">
          Shu kompyuter kaliti: <span className="font-mono">{getDeviceKey().slice(0, 8)}…</span>
        </div>
      </CardContent>
      {editing && <DeviceDialog device={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function DeviceDialog({ device, onClose }: { device: PharmacyDevice; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(device.name);
  const [reg, setReg] = useState(device.register_no ? String(device.register_no) : '');
  const mut = useMutation({
    mutationFn: () =>
      api.pharmacyWs.updateDevice(device.id, {
        name: name.trim(),
        register_no: reg ? Number(reg) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy-ws'] });
      toast.success('Saqlandi');
      onClose();
    },
    onError: (e: Error) => toast.error(errText(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Qurilma</DialogTitle>
        </DialogHeader>
        <LineField label="Nomi">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </LineField>
        <LineField label="Kassa raqami">
          <select
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            value={reg}
            onChange={(e) => setReg(e.target.value)}
          >
            <option value="">— (admin kompyuteri)</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                Kassa {n}
              </option>
            ))}
          </select>
        </LineField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button disabled={!name.trim() || mut.isPending} onClick={() => mut.mutate()}>
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
