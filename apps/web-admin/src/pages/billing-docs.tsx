import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  cn,
} from '@clary/ui-web';
import type { AdminContract, AdminInvoice, BillingSettings } from '@clary/api-client';
import {
  AlertTriangle,
  Ban,
  Check,
  FileSignature,
  FileText,
  Plus,
  Printer,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { contractHtml, invoiceHtml, offerHtml, openDoc, type DocLang } from '@/lib/billing-docs';

const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('uz-UZ');
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('uz-UZ') : '—';
const todayIso = () => new Date().toISOString().slice(0, 10);
/** Joriy oyning 1-sanasi — invoys davri odatda shundan boshlanadi. */
const monthStartIso = () => `${new Date().toISOString().slice(0, 7)}-01`;

type Tab = 'invoices' | 'contracts' | 'settings';

const INVOICE_STATUS: Record<string, { label: string; variant: string }> = {
  draft: { label: 'Qoralama', variant: 'secondary' },
  sent: { label: 'Yuborilgan', variant: 'outline' },
  paid: { label: "To'langan", variant: 'success' },
  void: { label: 'Bekor', variant: 'destructive' },
};
const CONTRACT_STATUS: Record<string, { label: string; variant: string }> = {
  draft: { label: 'Qoralama', variant: 'secondary' },
  sent: { label: 'Yuborilgan', variant: 'outline' },
  signed: { label: 'Imzolangan', variant: 'success' },
  terminated: { label: 'Bekor qilingan', variant: 'destructive' },
};

export function BillingDocsPage() {
  // Klinika kartasidan "Invoys"/"Shartnoma" bosilganda shu sahifa klinika
  // oldindan tanlangan va yaratish oynasi ochiq holda ochiladi.
  const [searchParams] = useSearchParams();
  const presetClinic = searchParams.get('clinic') ?? '';
  const autoNew = searchParams.get('new') === '1';
  const [tab, setTab] = useState<Tab>(
    searchParams.get('tab') === 'contracts'
      ? 'contracts'
      : searchParams.get('tab') === 'settings'
        ? 'settings'
        : 'invoices',
  );

  const { data: summary } = useQuery({
    queryKey: ['admin', 'billing', 'summary'],
    queryFn: () => api.admin.billingSummary(),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Hujjatlar</h1>
        <p className="text-muted-foreground text-sm">
          Obuna uchun hisob-faktura, 2 tomonlama shartnoma va ommaviy oferta. Hujjatlar
          rekvizitlarning o‘sha paytdagi nusxasi bilan muzlatiladi.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="To‘langan" value={`${fmt(summary?.paid_total_uzs)} so'm`} tone="success" />
        <Stat label="Kutilmoqda" value={`${fmt(summary?.awaiting_uzs)} so'm`} />
        <Stat
          label="Muddati o‘tgan"
          value={`${fmt(summary?.overdue_uzs)} so'm`}
          hint={summary?.overdue_count ? `${summary.overdue_count} ta invoys` : undefined}
          tone={summary?.overdue_count ? 'danger' : undefined}
        />
        <Stat label="Jami invoys" value={String(summary?.invoices_count ?? 0)} />
      </div>

      <div className="flex gap-1 border-b">
        {(
          [
            ['invoices', 'Invoyslar'],
            ['contracts', 'Shartnomalar'],
            ['settings', 'Rekvizitlar'],
          ] as Array<[Tab, string]>
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              'px-3 py-2 text-sm font-medium transition-colors',
              tab === k
                ? 'border-primary text-foreground border-b-2'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'invoices' && <InvoicesTab presetClinic={presetClinic} autoNew={autoNew} />}
      {tab === 'contracts' && <ContractsTab presetClinic={presetClinic} autoNew={autoNew} />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-muted-foreground text-[10px] uppercase tracking-wider">{label}</div>
        <div
          className={cn(
            'mt-1 font-mono text-lg font-bold tabular-nums',
            tone === 'success' && 'text-emerald-600',
            tone === 'danger' && 'text-rose-600',
          )}
        >
          {value}
        </div>
        {hint && <div className="text-muted-foreground mt-0.5 text-[11px]">{hint}</div>}
      </CardContent>
    </Card>
  );
}

// --- Klinika tanlash (ikkala dialogda ham ishlatiladi) ---------------------

function useClinics() {
  return useQuery({
    queryKey: ['admin', 'tenants', 'for-billing'],
    queryFn: () => api.admin.listTenants(),
    staleTime: 5 * 60_000,
  });
}

function ClinicSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useClinics();
  // O'chirilgan klinikaga hujjat yozilmasin.
  const rows = (data ?? []).filter((c) => !c.deleted_at);
  return (
    <select
      className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">— klinikani tanlang —</option>
      {rows.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

// =========================================================================
// INVOYSLAR
// =========================================================================

function InvoicesTab({ presetClinic, autoNew }: { presetClinic: string; autoNew: boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(autoNew);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'billing', 'invoices', status, presetClinic],
    queryFn: () =>
      api.admin.listInvoices({
        status: status || undefined,
        clinic_id: presetClinic || undefined,
      }),
  });
  const rows = (data ?? []) as AdminInvoice[];

  const actionMut = useMutation({
    mutationFn: ({
      id,
      action,
      body,
    }: {
      id: string;
      action: 'send' | 'pay' | 'void' | 'draft';
      body?: { payment_method?: string; reason?: string };
    }) => api.admin.invoiceAction(id, action, body ?? {}),
    onSuccess: () => {
      toast.success('Yangilandi');
      qc.invalidateQueries({ queryKey: ['admin', 'billing'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => api.admin.deleteInvoice(id),
    onSuccess: () => {
      toast.success('O‘chirildi');
      qc.invalidateQueries({ queryKey: ['admin', 'billing'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function print(inv: AdminInvoice, lang: DocLang) {
    try {
      openDoc(invoiceHtml(inv, lang));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Barcha holatlar</option>
          <option value="draft">Qoralama</option>
          <option value="sent">Yuborilgan</option>
          <option value="paid">To‘langan</option>
          <option value="void">Bekor</option>
        </select>
        <div className="flex-1" />
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Yangi invoys
        </Button>
      </div>

      {isLoading && <p className="text-muted-foreground text-sm">Yuklanmoqda…</p>}
      {!isLoading && rows.length === 0 && (
        <Card>
          <CardContent className="text-muted-foreground p-8 text-center text-sm">
            Hali invoys yaratilmagan. “Yangi invoys” bilan boshlang.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {rows.map((inv) => {
          const st = INVOICE_STATUS[inv.status] ?? INVOICE_STATUS.draft!;
          return (
            <Card key={inv.id} className={cn(inv.is_overdue && 'border-rose-300')}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-[180px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{inv.number}</span>
                    <Badge variant={st.variant as never}>{st.label}</Badge>
                    {inv.is_overdue && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {inv.days_late} kun kechikdi
                      </Badge>
                    )}
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    {inv.clinic?.name ?? '—'} · {fmtDate(inv.period_start)}—
                    {fmtDate(inv.period_end)} · muddat {fmtDate(inv.due_at)}
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono text-base font-bold tabular-nums">
                    {fmt(inv.total_uzs)}
                  </div>
                  <div className="text-muted-foreground text-[10px]">so‘m</div>
                </div>

                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={() => print(inv, 'uz')}>
                    <Printer className="mr-1 h-3.5 w-3.5" />
                    UZ
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => print(inv, 'ru')}>
                    <Printer className="mr-1 h-3.5 w-3.5" />
                    RU
                  </Button>
                  {inv.status === 'draft' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => actionMut.mutate({ id: inv.id, action: 'send' })}
                    >
                      <Send className="mr-1 h-3.5 w-3.5" />
                      Yuborildi
                    </Button>
                  )}
                  {(inv.status === 'sent' || inv.status === 'draft') && (
                    <Button
                      size="sm"
                      onClick={() =>
                        actionMut.mutate({
                          id: inv.id,
                          action: 'pay',
                          body: { payment_method: 'bank' },
                        })
                      }
                    >
                      <Check className="mr-1 h-3.5 w-3.5" />
                      To‘landi
                    </Button>
                  )}
                  {inv.status !== 'void' && inv.status !== 'paid' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const reason = window.prompt('Bekor qilish sababi:');
                        if (reason === null) return;
                        actionMut.mutate({ id: inv.id, action: 'void', body: { reason } });
                      }}
                    >
                      <Ban className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {inv.status === 'draft' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm(`${inv.number} o‘chirilsinmi?`)) delMut.mutate(inv.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {createOpen && (
        <CreateInvoiceDialog presetClinic={presetClinic} onClose={() => setCreateOpen(false)} />
      )}
    </div>
  );
}

function CreateInvoiceDialog({
  presetClinic,
  onClose,
}: {
  presetClinic?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['admin', 'billing', 'settings'],
    queryFn: () => api.admin.billingSettings(),
  });
  const { data: plans } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: () => api.admin.listPlans(),
  });

  const [clinicId, setClinicId] = useState(presetClinic ?? '');
  const [periodStart, setPeriodStart] = useState(monthStartIso());
  const [months, setMonths] = useState('1');
  const [planCode, setPlanCode] = useState('');
  const [discount, setDiscount] = useState('0');
  const [vat, setVat] = useState('');
  const [lang, setLang] = useState<DocLang>('uz');
  const [notes, setNotes] = useState('');

  // Rekvizitlardagi QQS — invoys ochilganda default sifatida qo'yiladi.
  useEffect(() => {
    if (settings && vat === '') setVat(String(settings.vat_percent ?? 0));
  }, [settings, vat]);

  const plan = (plans ?? []).find((p) => p.code === planCode);
  const monthly = Number(plan?.price_uzs ?? 0);
  const preview = useMemo(() => {
    const sub = monthly * (Number(months) || 0);
    const disc = Math.round((sub * (Number(discount) || 0)) / 100);
    const base = sub - disc;
    const v = Math.round((base * (Number(vat) || 0)) / 100);
    return { sub, disc, vat: v, total: base + v };
  }, [monthly, months, discount, vat]);

  const mut = useMutation({
    mutationFn: () =>
      api.admin.createInvoice({
        clinic_id: clinicId,
        period_start: periodStart,
        months: Number(months) || 1,
        plan_code: planCode || undefined,
        discount_percent: Number(discount) || 0,
        vat_percent: Number(vat) || 0,
        lang,
        notes: notes || undefined,
      }),
    onSuccess: (inv) => {
      toast.success(`${inv.number} yaratildi`);
      qc.invalidateQueries({ queryKey: ['admin', 'billing'] });
      onClose();
      try {
        openDoc(invoiceHtml(inv, lang));
      } catch {
        /* popup bloklangan bo'lsa ro'yxatdan chop etsa bo'ladi */
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const requisitesMissing = !settings?.bank_account || !settings?.tax_id;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Yangi hisob-faktura
          </DialogTitle>
          <DialogDescription>
            Tarif narxidan avtomatik satr yasaladi. Raqam serverda beriladi (CLARY-YYYY-NNNN).
          </DialogDescription>
        </DialogHeader>

        {requisitesMissing && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            Rekvizitlar to‘liq emas (STIR / hisob raqami). Invoys yaratiladi, lekin to‘lov
            rekvizitlari bloki chop etilmaydi — “Rekvizitlar” bo‘limini to‘ldiring.
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Klinika *</Label>
            <ClinicSelect value={clinicId} onChange={setClinicId} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Davr boshlanishi *</Label>
              <Input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Necha oy</Label>
              <Input
                type="number"
                min={1}
                max={36}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Tarif</Label>
            <select
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              value={planCode}
              onChange={(e) => setPlanCode(e.target.value)}
            >
              <option value="">— klinikaning joriy tarifi —</option>
              {(plans ?? []).map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} — {fmt(p.price_uzs)} so‘m/oy
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label>Chegirma %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>QQS %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={vat}
                onChange={(e) => setVat(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Til</Label>
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={lang}
                onChange={(e) => setLang(e.target.value as DocLang)}
              >
                <option value="uz">O‘zbek</option>
                <option value="ru">Rus</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Izoh (ixtiyoriy)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {planCode && (
            <div className="bg-muted/50 space-y-1 rounded-md p-3 text-xs">
              <Row label="Jami" value={fmt(preview.sub)} />
              {preview.disc > 0 && <Row label="Chegirma" value={`− ${fmt(preview.disc)}`} />}
              {preview.vat > 0 && <Row label="QQS" value={fmt(preview.vat)} />}
              <div className="border-t pt-1">
                <Row label="To‘lovga" value={`${fmt(preview.total)} so'm`} strong />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => mut.mutate()} disabled={!clinicId || mut.isPending}>
            Yaratish va chop etish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={strong ? 'font-semibold' : 'text-muted-foreground'}>{label}</span>
      <span className={cn('font-mono tabular-nums', strong && 'font-bold')}>{value}</span>
    </div>
  );
}

// =========================================================================
// SHARTNOMALAR
// =========================================================================

function ContractsTab({ presetClinic, autoNew }: { presetClinic: string; autoNew: boolean }) {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(autoNew);

  const { data: settings } = useQuery({
    queryKey: ['admin', 'billing', 'settings'],
    queryFn: () => api.admin.billingSettings(),
  });
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'billing', 'contracts', presetClinic],
    queryFn: () => api.admin.listContracts({ clinic_id: presetClinic || undefined }),
  });
  const rows = (data ?? []) as AdminContract[];

  const actionMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'send' | 'sign' | 'terminate' | 'draft' }) =>
      api.admin.contractAction(id, action),
    onSuccess: () => {
      toast.success('Yangilandi');
      qc.invalidateQueries({ queryKey: ['admin', 'billing'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => api.admin.deleteContract(id),
    onSuccess: () => {
      toast.success('O‘chirildi');
      qc.invalidateQueries({ queryKey: ['admin', 'billing'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function printDoc(fn: () => string) {
    try {
      openDoc(fn());
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-sm">Ommaviy oferta:</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => settings && printDoc(() => offerHtml(settings, 'uz'))}
          disabled={!settings}
        >
          <Printer className="mr-1 h-3.5 w-3.5" />
          UZ
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => settings && printDoc(() => offerHtml(settings, 'ru'))}
          disabled={!settings}
        >
          <Printer className="mr-1 h-3.5 w-3.5" />
          RU
        </Button>
        <div className="flex-1" />
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Yangi shartnoma
        </Button>
      </div>

      {isLoading && <p className="text-muted-foreground text-sm">Yuklanmoqda…</p>}
      {!isLoading && rows.length === 0 && (
        <Card>
          <CardContent className="text-muted-foreground p-8 text-center text-sm">
            Shartnoma yo‘q. Yangi mijoz uchun “Yangi shartnoma” bosing — rekvizitlari avtomatik
            to‘ldiriladi.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {rows.map((c) => {
          const st = CONTRACT_STATUS[c.status] ?? CONTRACT_STATUS.draft!;
          return (
            <Card key={c.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-[180px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{c.number}</span>
                    <Badge variant={st.variant as never}>{st.label}</Badge>
                    <Badge variant="outline">
                      {c.kind === 'offer' ? 'Oferta aksepti' : '2 tomonlama'}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    {c.clinic?.name ?? '—'} · {fmtDate(c.starts_on)}—{fmtDate(c.ends_on)} ·{' '}
                    {fmt(c.monthly_uzs)} so‘m/
                    {c.billing_period === 'yearly' ? 'yil' : 'oy'}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => printDoc(() => contractHtml(c, 'uz'))}
                  >
                    <Printer className="mr-1 h-3.5 w-3.5" />
                    UZ
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => printDoc(() => contractHtml(c, 'ru'))}
                  >
                    <Printer className="mr-1 h-3.5 w-3.5" />
                    RU
                  </Button>
                  {c.status === 'draft' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => actionMut.mutate({ id: c.id, action: 'send' })}
                    >
                      <Send className="mr-1 h-3.5 w-3.5" />
                      Yuborildi
                    </Button>
                  )}
                  {c.status !== 'signed' && c.status !== 'terminated' && (
                    <Button
                      size="sm"
                      onClick={() => actionMut.mutate({ id: c.id, action: 'sign' })}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" />
                      Imzolandi
                    </Button>
                  )}
                  {c.status === 'signed' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm('Shartnoma bekor qilinsinmi?'))
                          actionMut.mutate({ id: c.id, action: 'terminate' });
                      }}
                    >
                      <Ban className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {c.status === 'draft' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm(`${c.number} o‘chirilsinmi?`)) delMut.mutate(c.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {createOpen && (
        <CreateContractDialog presetClinic={presetClinic} onClose={() => setCreateOpen(false)} />
      )}
    </div>
  );
}

function CreateContractDialog({
  presetClinic,
  onClose,
}: {
  presetClinic?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: plans } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: () => api.admin.listPlans(),
  });

  const [clinicId, setClinicId] = useState(presetClinic ?? '');
  const [kind, setKind] = useState<'bilateral' | 'offer'>('bilateral');
  const [planCode, setPlanCode] = useState('');
  const [startsOn, setStartsOn] = useState(todayIso());
  const [endsOn, setEndsOn] = useState('');
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [lang, setLang] = useState<DocLang>('uz');

  const mut = useMutation({
    mutationFn: () =>
      api.admin.createContract({
        clinic_id: clinicId,
        kind,
        lang,
        plan_code: planCode || undefined,
        billing_period: billingPeriod,
        starts_on: startsOn,
        ends_on: endsOn || undefined,
      }),
    onSuccess: (c) => {
      toast.success(`${c.number} yaratildi`);
      qc.invalidateQueries({ queryKey: ['admin', 'billing'] });
      onClose();
      try {
        openDoc(contractHtml(c, lang));
      } catch {
        /* popup bloklangan — ro'yxatdan chop etsa bo'ladi */
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5" />
            Yangi shartnoma
          </DialogTitle>
          <DialogDescription>
            Muddat ko‘rsatilmasa — 1 yil, keyin avtomatik uzayadi (shartnoma 8.2-bandi).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Klinika *</Label>
            <ClinicSelect value={clinicId} onChange={setClinicId} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Turi</Label>
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value as 'bilateral' | 'offer')}
              >
                <option value="bilateral">2 tomonlama (imzolanadi)</option>
                <option value="offer">Oferta aksepti</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Til</Label>
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={lang}
                onChange={(e) => setLang(e.target.value as DocLang)}
              >
                <option value="uz">O‘zbek</option>
                <option value="ru">Rus</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Tarif</Label>
            <select
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              value={planCode}
              onChange={(e) => setPlanCode(e.target.value)}
            >
              <option value="">— klinikaning joriy tarifi —</option>
              {(plans ?? []).map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} — {fmt(p.price_uzs)} so‘m/oy
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label>Boshlanishi *</Label>
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Tugashi</Label>
              <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>To‘lov davri</Label>
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={billingPeriod}
                onChange={(e) => setBillingPeriod(e.target.value as 'monthly' | 'yearly')}
              >
                <option value="monthly">Oylik</option>
                <option value="yearly">Yillik</option>
              </select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => mut.mutate()} disabled={!clinicId || mut.isPending}>
            Yaratish va chop etish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =========================================================================
// REKVIZITLAR
// =========================================================================

const SETTING_FIELDS: Array<{ key: keyof BillingSettings; label: string; hint?: string }> = [
  { key: 'company_name', label: 'Brend nomi' },
  { key: 'legal_name', label: 'Yuridik nom', hint: 'MChJ "..." — hujjatda shu yoziladi' },
  { key: 'tax_id', label: 'STIR (INN)' },
  { key: 'oked', label: 'OKED' },
  { key: 'address', label: 'Yuridik manzil' },
  { key: 'phone', label: 'Telefon' },
  { key: 'email', label: 'E-pochta' },
  { key: 'website', label: 'Veb-sayt' },
  { key: 'bank_name', label: 'Bank nomi' },
  { key: 'bank_account', label: 'Hisob raqami' },
  { key: 'bank_mfo', label: 'MFO' },
  { key: 'director_name', label: 'Direktor F.I.O.' },
  { key: 'director_position', label: 'Lavozimi' },
  { key: 'offer_url', label: 'Oferta havolasi', hint: 'clary.uz/oferta' },
  { key: 'offer_version', label: 'Oferta tahriri' },
  { key: 'payment_note', label: 'To‘lov izohi', hint: 'Chekda qo‘shimcha ko‘rsatma' },
];

function SettingsTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin', 'billing', 'settings'],
    queryFn: () => api.admin.billingSettings(),
  });

  const [form, setForm] = useState<Record<string, string>>({});
  const [vat, setVat] = useState('0');
  const [prefix, setPrefix] = useState('CLARY');
  const [contractPrefix, setContractPrefix] = useState('CLARY-SH');
  const [dueDays, setDueDays] = useState('5');

  useEffect(() => {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const f of SETTING_FIELDS) next[f.key as string] = String(data[f.key] ?? '');
    setForm(next);
    setVat(String(data.vat_percent ?? 0));
    setPrefix(data.invoice_prefix ?? 'CLARY');
    setContractPrefix(data.contract_prefix ?? 'CLARY-SH');
    setDueDays(String(data.invoice_due_days ?? 5));
  }, [data]);

  const mut = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      for (const f of SETTING_FIELDS) {
        const v = form[f.key as string] ?? '';
        body[f.key as string] = v === '' ? null : v;
      }
      // company_name NOT NULL — bo'sh qoldirilsa default'ga qaytaramiz.
      if (!body['company_name']) body['company_name'] = 'Clary Care';
      body['vat_percent'] = Number(vat) || 0;
      body['invoice_prefix'] = prefix || 'CLARY';
      body['contract_prefix'] = contractPrefix || 'CLARY-SH';
      body['invoice_due_days'] = Number(dueDays) || 0;
      return api.admin.updateBillingSettings(body as Partial<BillingSettings>);
    },
    onSuccess: () => {
      toast.success('Rekvizitlar saqlandi');
      qc.invalidateQueries({ queryKey: ['admin', 'billing', 'settings'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <p className="text-muted-foreground text-xs">
          Bu ma’lumotlar invoys va shartnomada “Ijrochi” tomoni sifatida chiqadi. Hujjat
          yaratilganda ular <b>nusxalanadi</b> — keyin bu yerda o‘zgartirsangiz eski hujjatlar
          o‘zgarmaydi.
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          {SETTING_FIELDS.map((f) => (
            <div key={f.key as string} className="space-y-1.5">
              <Label>{f.label}</Label>
              <Input
                value={form[f.key as string] ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, [f.key as string]: e.target.value }))}
              />
              {f.hint && <p className="text-muted-foreground text-[11px]">{f.hint}</p>}
            </div>
          ))}
        </div>

        <div className="grid gap-3 border-t pt-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label>QQS % (default)</Label>
            <Input type="number" value={vat} onChange={(e) => setVat(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>To‘lov muddati (kun)</Label>
            <Input type="number" value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Invoys prefiksi</Label>
            <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Shartnoma prefiksi</Label>
            <Input value={contractPrefix} onChange={(e) => setContractPrefix(e.target.value)} />
          </div>
        </div>

        <Button onClick={() => mut.mutate()} disabled={mut.isPending} className="gap-1.5">
          <Save className="h-4 w-4" />
          Saqlash
        </Button>
      </CardContent>
    </Card>
  );
}
