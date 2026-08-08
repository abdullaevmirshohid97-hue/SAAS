import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Banknote,
  Loader2,
  Vault,
  AlertTriangle,
  Receipt,
  Wallet,
  ShieldAlert,
  Landmark,
  CreditCard,
} from 'lucide-react';
import { Badge, Card, CardContent, EmptyState, PageHeader, StatCard } from '@clary/ui-web';

import type { CashAuditPeriod } from '@clary/api-client';
import { api } from '@/lib/api';

// =============================================================================
// KASSA AUDITI — /cashier/audit
// =============================================================================
// "Seyfga o'tmagan naqd" kartasi bosilganda shu sahifa ochiladi. Maqsad —
// bitta jami raqamdan "bu pul QAYERDAN yig'ildi?" degan savolga to'liq javob:
//   1. Oylik taqsimot: kirim / inkasatsiya / rasxot / maosh va oy oxiridagi
//      qoldiq — qoldiq qaysi oyda qanchaga o'sgani ko'rinadi.
//   2. To'lov usuli: naqd / plastik / o'tkazma alohida.
//   3. Seyf: har bir kirim — qachon, qancha, kimning smenasida, SABABI.
//   4. Rasxot va maosh: kimga, qancha, kim yozgan.
// Raqamlar `cashOnHand`/`safeBalance` bilan AYNI manbadan — sahifa va kassa
// kartasi hech qachon ajralib ketmaydi.
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

const METHOD_LABEL: Record<string, string> = {
  cash: 'Naqd',
  card: 'Plastik',
  transfer: "O'tkazma",
  click: 'Click',
  payme: 'Payme',
  uzum: 'Uzum',
  humo: 'Humo',
  uzcard: 'Uzcard',
  insurance: "Sug'urta",
  mixed: 'Aralash',
  debt: 'Qarz',
  unknown: "Noma'lum",
};

const SOURCE_LABEL: Record<string, string> = { safe: 'Seyfdan', cash_drawer: 'Kassadan' };

function fmtDate(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function fmtDateTime(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('uz-UZ', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}
function fmtMonth(p: string): string {
  const [y, m] = p.split('-');
  const names = [
    'Yanvar',
    'Fevral',
    'Mart',
    'Aprel',
    'May',
    'Iyun',
    'Iyul',
    'Avgust',
    'Sentabr',
    'Oktabr',
    'Noyabr',
    'Dekabr',
  ];
  const i = Number(m) - 1;
  return names[i] ? `${names[i]} ${y}` : p;
}

/** Ustun sarlavhasi + qiymat; nol bo'lsa xira ko'rsatiladi (ko'z chalg'imasin). */
function Num({ v, tone }: { v: number; tone?: 'in' | 'out' }) {
  if (!v) return <span className="text-muted-foreground/40">—</span>;
  return (
    <span
      className={
        tone === 'in'
          ? 'font-medium text-emerald-600'
          : tone === 'out'
            ? 'font-medium text-rose-600'
            : 'font-medium'
      }
    >
      {fmt(v)}
    </span>
  );
}

type Tab = 'drawer' | 'safe' | 'bank' | 'expenses' | 'payroll';

const TABS: Array<{ id: Tab; label: string; icon: typeof Banknote }> = [
  { id: 'drawer', label: 'Naqd (kassa)', icon: Banknote },
  { id: 'safe', label: 'Seyf', icon: Vault },
  { id: 'bank', label: "Naqdsiz to'lov", icon: CreditCard },
  { id: 'expenses', label: 'Rasxotlar', icon: Receipt },
  { id: 'payroll', label: 'Maosh', icon: Wallet },
];

export function CashierAuditPage() {
  const [register, setRegister] = useState<'reception' | 'inpatient'>('reception');
  // Bo'lim URL'da saqlanadi: kassa kartasi → ?tab yo'q, seyf kartasi → ?tab=safe.
  // Shunda havolani ulashish ham, orqaga qaytish ham to'g'ri ishlaydi.
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'drawer';
  const setTab = (t: Tab) => setParams(t === 'drawer' ? {} : { tab: t }, { replace: true });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['cashier', 'audit', register],
    queryFn: () => api.cashier.cashAudit(register),
    refetchInterval: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-8 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
      </div>
    );
  }
  if (isError || !data) {
    // Ruxsat yo'qligi eng ko'p uchraydigan holat — buni alohida, tushunarli
    // qilib ko'rsatamiz (quruq "server xatosi" o'rniga).
    const msg = (error as Error)?.message ?? '';
    const forbidden = /403|forbidden|ruxsat/i.test(msg);
    return (
      <div className="mx-auto max-w-lg p-8">
        <EmptyState
          icon={<ShieldAlert className="h-8 w-8" />}
          title={forbidden ? 'Bu bo‘lim faqat rahbariyat uchun' : "Ma'lumot olinmadi"}
          description={
            forbidden
              ? 'Kassa auditida maosh summalari va seyf harakati ko‘rinadi, shuning uchun u faqat klinika egasi va adminiga ochiq.'
              : msg || 'Server xatosi'
          }
        />
        <div className="mt-4 text-center">
          <Link
            to="/cashier"
            className="hover:bg-accent inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm"
          >
            <ArrowLeft className="h-4 w-4" /> Kassaga qaytish
          </Link>
        </div>
      </div>
    );
  }

  const t = data.totals;
  const periods = data.periods;
  const last = periods[periods.length - 1];
  // Nazorat: oxirgi oy qoldig'i jami bilan mos kelishi SHART. Farq bo'lsa —
  // ma'lumotda muammo bor, uni yashirmaymiz.
  const drift = last ? Math.round(last.running_cash_uzs - t.cash_on_hand_uzs) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Kassa auditi"
        description="Seyfga o'tmagan naqd qayerdan yig'ilgan — davr, usul, smena va sabablar bo'yicha"
        breadcrumbs={[{ label: 'Kassa', href: '/cashier' }, { label: 'Audit' }]}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border p-0.5">
              {(['reception', 'inpatient'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRegister(r)}
                  className={`rounded-md px-3 py-1 text-xs transition-colors ${
                    register === r ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                  }`}
                >
                  {r === 'reception' ? 'Qabulxona' : 'Statsionar'}
                </button>
              ))}
            </div>
            <Link
              to="/cashier"
              className="hover:bg-accent inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm"
            >
              <ArrowLeft className="h-4 w-4" /> Kassa
            </Link>
          </div>
        }
      />

      {/* --- Asosiy raqamlar --- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Seyfga o'tmagan naqd"
          value={`${fmt(t.cash_on_hand_uzs)} so'm`}
          icon={<Banknote className="h-4 w-4" />}
          tone={t.cash_on_hand_uzs > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Seyfda"
          value={`${fmt(t.safe_balance_uzs)} so'm`}
          icon={<Vault className="h-4 w-4" />}
        />
        <StatCard
          label="Naqdsiz to'lovdagi pul"
          value={`${fmt(t.noncash_pending_uzs)} so'm`}
          hint="(plastik hamda o'tkazmadagi to'lovlar)"
          icon={<CreditCard className="h-4 w-4" />}
          tone={t.noncash_pending_uzs > 0 ? 'warning' : 'default'}
        />
        <StatCard label="Bankdagi pul" value={`${fmt(t.noncash_bank_uzs)} so'm`} />
      </div>

      {/* --- Bo'limlar --- */}
      <div className="flex flex-wrap gap-1 rounded-lg border p-1">
        {TABS.map((x) => {
          const Icon = x.icon;
          const active = tab === x.id;
          return (
            <button
              key={x.id}
              type="button"
              onClick={() => setTab(x.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {x.label}
            </button>
          );
        })}
      </div>

      {drift !== 0 && tab === 'drawer' && (
        <Card className="border-rose-300 bg-rose-50 dark:bg-rose-950/20">
          <CardContent className="flex items-start gap-3 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <div>
              <div className="font-semibold">Nomuvofiqlik aniqlandi</div>
              <p className="text-muted-foreground mt-1 text-xs">
                Oylik qoldiqlar yig'indisi ({fmt(last?.running_cash_uzs ?? 0)}) jami bilan (
                {fmt(t.cash_on_hand_uzs)}) mos kelmadi. Farq: <b>{fmt(drift)}</b> so'm. Bu
                ma'lumotda muammo borligini bildiradi — texnik yordamga murojaat qiling.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- 1. Davriy taqsimot (Kassa bo'limi) --- */}
      {tab === 'drawer' && (
        <Card>
          <CardContent className="p-0">
            <div className="border-b p-3">
              <div className="text-sm font-semibold">1. Oylik taqsimot — pul qanday yig'ildi</div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Har oy: naqd kirim − vozvrat − seyfga o'tkazma − rasxot − maosh = shu oy o'zgarishi.
                Oxirgi ustun — oy oxiridagi kassa qoldig'i.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b text-left">
                  <tr>
                    <th className="p-2.5">Oy</th>
                    <th className="p-2.5 text-right">Naqd kirim</th>
                    <th className="p-2.5 text-right">Vozvrat</th>
                    <th className="p-2.5 text-right">Seyfga</th>
                    <th className="p-2.5 text-right">Rasxot</th>
                    <th className="p-2.5 text-right">Maosh</th>
                    <th className="p-2.5 text-right">Tuzatish</th>
                    <th className="p-2.5 text-right">Oy o'zgarishi</th>
                    <th className="p-2.5 text-right">Qoldiq</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p: CashAuditPeriod) => (
                    <tr key={p.period} className="border-b last:border-0">
                      <td className="p-2.5 font-medium">{fmtMonth(p.period)}</td>
                      <td className="p-2.5 text-right tabular-nums">
                        <Num v={p.cash_in_uzs} tone="in" />
                      </td>
                      <td className="p-2.5 text-right tabular-nums">
                        <Num v={p.refunds_uzs} tone="out" />
                      </td>
                      <td className="p-2.5 text-right tabular-nums">
                        <Num v={p.encashed_uzs} tone="out" />
                      </td>
                      <td className="p-2.5 text-right tabular-nums">
                        <Num v={p.expenses_uzs} tone="out" />
                      </td>
                      <td className="p-2.5 text-right tabular-nums">
                        <Num v={p.payroll_uzs} tone="out" />
                      </td>
                      <td className="p-2.5 text-right tabular-nums">
                        <Num v={p.adjustments_uzs} />
                      </td>
                      <td className="p-2.5 text-right tabular-nums">
                        <span
                          className={p.net_cash_uzs >= 0 ? 'text-emerald-600' : 'text-rose-600'}
                        >
                          {p.net_cash_uzs >= 0 ? '+' : ''}
                          {fmt(p.net_cash_uzs)}
                        </span>
                      </td>
                      <td className="p-2.5 text-right font-semibold tabular-nums">
                        {fmt(p.running_cash_uzs)}
                      </td>
                    </tr>
                  ))}
                  {periods.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-muted-foreground p-6 text-center text-xs">
                        Ma'lumot yo'q
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- 2. To'lov usuli bo'yicha (Kassa bo'limi) --- */}
      {tab === 'drawer' && (
        <Card>
          <CardContent className="p-0">
            <div className="border-b p-3">
              <div className="text-sm font-semibold">2. To'lov usuli bo'yicha kirim</div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Butun davr. Faqat naqd kassa qoldig'iga tushadi — plastik va o'tkazma bankka boradi.
              </p>
            </div>
            <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.by_method.map((m) => (
                <div key={m.method} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {METHOD_LABEL[m.method] ?? m.method}
                    </span>
                    {m.method === 'cash' && <Badge variant="outline">kassaga</Badge>}
                  </div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{fmt(m.total_uzs)}</div>
                  <div className="text-muted-foreground text-xs">{m.count} ta to'lov</div>
                </div>
              ))}
              {data.by_method.length === 0 && (
                <div className="text-muted-foreground p-3 text-xs">Ma'lumot yo'q</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- 3. Seyf harakati (Seyf bo'limi) --- */}
      {tab === 'safe' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="p-0">
              <div className="border-b p-3">
                <div className="text-sm font-semibold">3. Seyfga kirim — qayerdan, qachon, kim</div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Jami: {fmt(t.safe_in_uzs)} so'm
                </p>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground bg-muted/40 sticky top-0 border-b text-left">
                    <tr>
                      <th className="p-2.5">Sana</th>
                      <th className="p-2.5">Turi</th>
                      <th className="p-2.5">Smena / kim</th>
                      <th className="p-2.5 text-right">Summa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.safe_in.map((s, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="p-2.5 text-xs">{fmtDateTime(s.date)}</td>
                        <td className="p-2.5">
                          <div className="text-xs">
                            {s.kind === 'encashment' ? 'Inkasatsiya' : "Qo'lda qo'shildi"}
                          </div>
                          {s.reason && (
                            <div className="text-muted-foreground text-[11px]">{s.reason}</div>
                          )}
                        </td>
                        <td className="text-muted-foreground p-2.5 text-xs">
                          {s.shift_operator ?? s.who ?? '—'}
                        </td>
                        <td className="p-2.5 text-right font-medium tabular-nums text-emerald-600">
                          {fmt(s.amount_uzs)}
                        </td>
                      </tr>
                    ))}
                    {data.safe_in.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-muted-foreground p-6 text-center text-xs">
                          Yozuv yo'q
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="border-b p-3">
                <div className="text-sm font-semibold">Seyfdan chiqim</div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Jami: {fmt(t.safe_out_uzs)} so'm
                </p>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground bg-muted/40 sticky top-0 border-b text-left">
                    <tr>
                      <th className="p-2.5">Sana</th>
                      <th className="p-2.5">Sabab</th>
                      <th className="p-2.5">Kim</th>
                      <th className="p-2.5 text-right">Summa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.safe_out.map((s, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="p-2.5 text-xs">{fmtDate(s.date)}</td>
                        <td className="p-2.5 text-xs">{s.reason ?? '—'}</td>
                        <td className="text-muted-foreground p-2.5 text-xs">{s.who ?? '—'}</td>
                        <td className="p-2.5 text-right font-medium tabular-nums text-rose-600">
                          {fmt(s.amount_uzs)}
                        </td>
                      </tr>
                    ))}
                    {data.safe_out.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-muted-foreground p-6 text-center text-xs">
                          Seyfdan chiqim yo'q
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* --- Naqdsiz (bank) bo'limi --- */}
      {tab === 'bank' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <div className="border-b p-3">
                <div className="text-sm font-semibold">Naqdsiz to'lovdagi pul — usul bo'yicha</div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Plastik va o'tkazmadagi to'lovlar. "Olinmagan" = pul hali seyfga ham, bankka ham
                  olinmagan. Kassa sahifasidagi "Naqdsiz pulni olish" tugmasi orqali yo'nalishni
                  tanlaysiz.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground border-b text-left">
                    <tr>
                      <th className="p-2.5">Usul</th>
                      <th className="p-2.5 text-right">To'lovlar</th>
                      <th className="p-2.5 text-right">Tushgan</th>
                      <th className="p-2.5 text-right">Olingan</th>
                      <th className="p-2.5 text-right">Olinmagan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.noncash_by_method.map((m) => (
                      <tr key={m.method} className="border-b last:border-0">
                        <td className="p-2.5 font-medium">{METHOD_LABEL[m.method] ?? m.method}</td>
                        <td className="text-muted-foreground p-2.5 text-right text-xs">
                          {m.count} ta
                        </td>
                        <td className="p-2.5 text-right tabular-nums">
                          <Num v={m.received_uzs} tone="in" />
                        </td>
                        <td className="p-2.5 text-right tabular-nums">
                          <Num v={m.settled_uzs} tone="out" />
                        </td>
                        <td className="p-2.5 text-right font-semibold tabular-nums">
                          {fmt(m.received_uzs - m.settled_uzs)}
                        </td>
                      </tr>
                    ))}
                    {data.noncash_by_method.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-muted-foreground p-6 text-center text-xs">
                          Naqdsiz to'lov yo'q
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="border-b p-3">
                <div className="text-sm font-semibold">
                  Olingan pullar — qayerga, qachon, qancha, kim
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Jami olingan: {fmt(t.noncash_settled_uzs)} so'm
                </p>
              </div>
              <div className="max-h-[420px] overflow-x-auto overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground bg-muted/40 sticky top-0 border-b text-left">
                    <tr>
                      <th className="p-2.5">Sana</th>
                      <th className="p-2.5">Qayerga</th>
                      <th className="p-2.5">Usul</th>
                      <th className="p-2.5">Bank</th>
                      <th className="p-2.5">Hujjat</th>
                      <th className="p-2.5">Kim</th>
                      <th className="p-2.5 text-right">Summa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.settlements.map((s) => (
                      <tr key={s.id} className="border-b last:border-0">
                        <td className="p-2.5 text-xs">{fmtDateTime(s.date)}</td>
                        <td className="p-2.5">
                          <Badge variant={s.destination === 'safe' ? 'secondary' : 'outline'}>
                            {s.destination === 'safe' ? 'Seyfga' : 'Bankka'}
                          </Badge>
                        </td>
                        <td className="p-2.5 text-xs">
                          {s.method ? (METHOD_LABEL[s.method] ?? s.method) : 'Aralash'}
                        </td>
                        <td className="p-2.5 text-xs">{s.bank_name ?? '—'}</td>
                        <td className="text-muted-foreground p-2.5 text-xs">
                          {s.reference ?? '—'}
                        </td>
                        <td className="text-muted-foreground p-2.5 text-xs">{s.who ?? '—'}</td>
                        <td className="p-2.5 text-right font-medium tabular-nums text-emerald-600">
                          {fmt(s.amount_uzs)}
                        </td>
                      </tr>
                    ))}
                    {data.settlements.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-muted-foreground p-6 text-center text-xs">
                          Hali bankka o'tkazma qayd etilmagan. Kassa sahifasidagi "Bankka o'tkazish"
                          tugmasi orqali qayd eting.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* --- 4. Rasxotlar (Rasxot bo'limi) --- */}
      {tab === 'expenses' && (
        <Card>
          <CardContent className="p-0">
            <div className="border-b p-3">
              <div className="text-sm font-semibold">4. Rasxotlar — nimaga, kim, qaysi smenada</div>
            </div>
            <div className="max-h-[420px] overflow-x-auto overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground bg-muted/40 sticky top-0 border-b text-left">
                  <tr>
                    <th className="p-2.5">Sana</th>
                    <th className="p-2.5">Kategoriya</th>
                    <th className="p-2.5">Izoh</th>
                    <th className="p-2.5">Usul</th>
                    <th className="p-2.5">Manba</th>
                    <th className="p-2.5">Kim / smena</th>
                    <th className="p-2.5 text-right">Summa</th>
                  </tr>
                </thead>
                <tbody>
                  {data.expenses.map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="p-2.5 text-xs">{fmtDate(e.date)}</td>
                      <td className="p-2.5 text-xs font-medium">{e.category}</td>
                      <td className="text-muted-foreground max-w-[260px] truncate p-2.5 text-xs">
                        {e.description ?? '—'}
                      </td>
                      <td className="p-2.5 text-xs">{METHOD_LABEL[e.method] ?? e.method}</td>
                      <td className="p-2.5 text-xs">{SOURCE_LABEL[e.source] ?? e.source}</td>
                      <td className="text-muted-foreground p-2.5 text-xs">
                        {e.who ?? '—'}
                        {e.shift_operator && ` · ${e.shift_operator}`}
                      </td>
                      <td className="p-2.5 text-right font-medium tabular-nums text-rose-600">
                        {fmt(e.amount_uzs)}
                      </td>
                    </tr>
                  ))}
                  {data.expenses.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-muted-foreground p-6 text-center text-xs">
                        Rasxot yo'q
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- 5. Maosh (Maosh bo'limi) --- */}
      {tab === 'payroll' && (
        <Card>
          <CardContent className="p-0">
            <div className="border-b p-3">
              <div className="text-sm font-semibold">
                5. Maosh to'lovlari — kimga, qancha, qaysi davr
              </div>
            </div>
            <div className="max-h-[420px] overflow-x-auto overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground bg-muted/40 sticky top-0 border-b text-left">
                  <tr>
                    <th className="p-2.5">Sana</th>
                    <th className="p-2.5">Xodim</th>
                    <th className="p-2.5">Davr</th>
                    <th className="p-2.5">Usul</th>
                    <th className="p-2.5">Manba</th>
                    <th className="p-2.5">To'lagan</th>
                    <th className="p-2.5 text-right">Summa</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payouts.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="p-2.5 text-xs">{fmtDate(p.date)}</td>
                      <td className="p-2.5 text-xs font-medium">{p.doctor ?? '—'}</td>
                      <td className="text-muted-foreground p-2.5 text-xs">
                        {p.period_label ?? '—'}
                      </td>
                      <td className="p-2.5 text-xs">{METHOD_LABEL[p.method] ?? p.method}</td>
                      <td className="p-2.5 text-xs">{SOURCE_LABEL[p.source] ?? p.source}</td>
                      <td className="text-muted-foreground p-2.5 text-xs">{p.who ?? '—'}</td>
                      <td className="p-2.5 text-right font-medium tabular-nums text-rose-600">
                        {fmt(p.amount_uzs)}
                      </td>
                    </tr>
                  ))}
                  {data.payouts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-muted-foreground p-6 text-center text-xs">
                        Maosh to'lovi yo'q
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
