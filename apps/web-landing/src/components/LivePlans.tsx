import { useState, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';

import {
  CORE_COUNT,
  fmtUzs,
  limitText,
  PAYMENT_METHOD_LABELS,
  planCards,
  yearlyDiscount,
  type PlanCard,
  type PublicPlan,
  type PublicPlans,
} from '../lib/plans';
import { useLivePlans } from '../lib/use-live-plans';
import { ModuleIcon } from './ModuleIcon';

// =============================================================================
// Tariflar — super-admin tarif muharriridan JONLI.
// Sahifa build vaqtidagi ma'lumot bilan chiziladi (SEO, JS'siz ko'rish), so'ng
// brauzer GET /public/plans dan yangisini oladi: super-admin tarif tarkibini,
// narxini yoki limitini o'zgartirsa sayt qayta qurilishini kutmasdan ko'rinadi.
// =============================================================================

const ok = <Check className="mx-auto h-4 w-4 text-[#10B981]" />;
const no = <Minus className="text-muted-foreground/40 mx-auto h-4 w-4" />;
const tick = <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#10B981]" />;

// ── Narxlar sahifasi: oylik/yillik + kartochkalar ──────────────────────────
export function PricingCards({
  initial,
  fallback,
}: {
  initial: PublicPlans | null;
  /** API build vaqtida ham javob bermagan bo'lsa (CMS narxlari bilan). */
  fallback: PlanCard[];
}) {
  const pub = useLivePlans(initial);
  const [period, setPeriod] = useState<'monthly' | 'annual'>('monthly');
  const cards = pub && pub.plans.length > 0 ? planCards(pub) : fallback;
  const discount = yearlyDiscount(cards);

  const choose = (p: 'monthly' | 'annual') => {
    setPeriod(p);
    try {
      (
        window as unknown as { posthog?: { capture?: (e: string, d: object) => void } }
      ).posthog?.capture?.('pricing_period_toggled', { period: p });
    } catch {
      /* e'tiborsiz */
    }
  };
  const btn = (active: boolean) =>
    `rounded-full px-5 py-2 text-sm font-semibold transition ${
      active ? 'bg-[#2563EB] text-white' : 'text-muted-foreground hover:text-foreground'
    }`;

  return (
    <>
      <div className="mt-10 flex justify-center">
        <div className="bg-card inline-flex rounded-full border p-1 shadow-sm">
          <button
            type="button"
            className={btn(period === 'monthly')}
            onClick={() => choose('monthly')}
          >
            Oylik
          </button>
          <button
            type="button"
            className={btn(period === 'annual')}
            onClick={() => choose('annual')}
          >
            Yillik{' '}
            {discount > 0 && (
              <span className="ml-1 rounded-full bg-[#10B981]/10 px-2 py-0.5 text-[10px] font-bold text-[#10B981]">
                −{discount}%
              </span>
            )}
          </button>
        </div>
      </div>

      <div
        className={`mx-auto mt-12 grid max-w-7xl grid-cols-1 gap-6 md:grid-cols-2 ${
          cards.length >= 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3'
        }`}
      >
        {cards.map((p) => (
          <div
            key={p.code}
            className={`bg-card relative flex flex-col rounded-2xl border p-6 transition ${
              p.featured ? 'border-[#2563EB] shadow-xl ring-2 ring-[#2563EB]/20' : 'card-hover'
            }`}
          >
            {p.badge && (
              <div
                className={`absolute -top-3 left-6 rounded-full px-3 py-0.5 text-[11px] font-bold ${
                  p.featured ? 'bg-[#2563EB] text-white' : 'bg-card text-muted-foreground border'
                }`}
              >
                {p.badge}
              </div>
            )}
            <div className="text-muted-foreground text-sm font-semibold uppercase tracking-wider">
              {p.name}
            </div>
            {p.description && <p className="text-muted-foreground mt-1 text-sm">{p.description}</p>}
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-4xl font-bold tracking-tight">
                {fmtUzs(period === 'annual' ? p.annualMonthly : p.monthly)}
              </span>
              {p.monthly > 0 && <span className="text-muted-foreground text-sm">so'm/oy</span>}
            </div>
            {p.monthly > 0 ? (
              period === 'annual' && (
                <div className="text-muted-foreground mt-1 text-xs">
                  Yiliga {fmtUzs(p.annualTotal)} so'm
                </div>
              )
            ) : (
              <div className="text-muted-foreground mt-1 text-xs">
                3 kunlik demo, keyin tarif tanlaysiz
              </div>
            )}
            <ul className="mt-6 flex-1 space-y-2.5 text-sm">
              <li className="flex items-start gap-2">
                {tick}
                <span>
                  {p.staff} xodim · {p.devices} qurilma
                </span>
              </li>
              {p.modulesCount != null && (
                <li className="flex items-start gap-2">
                  {tick}
                  <span>{p.modulesCount} modul</span>
                </li>
              )}
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  {tick}
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <a
              href={`/signup?plan=${p.code}`}
              className={`mt-7 block rounded-lg px-4 py-3 text-center text-sm font-semibold transition ${
                p.featured ? 'bg-[#2563EB] text-white hover:bg-[#1D4ED8]' : 'hover:bg-accent border'
              }`}
            >
              {p.monthly === 0 ? 'Bepul boshlash' : '30 kun bepul sinash'} &rarr;
            </a>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Narxlar sahifasi: "Har bir tarifga nima kiradi" matritsasi ─────────────
export function PlanMatrix({ initial }: { initial: PublicPlans | null }) {
  const pub = useLivePlans(initial);
  if (!pub || pub.plans.length === 0) return null;
  const plans = pub.plans;
  const row = (label: string, cell: (p: PublicPlan) => ReactNode) => (
    <tr key={label} className="border-t">
      <td className="px-4 py-2.5">{label}</td>
      {plans.map((p) => (
        <td key={p.code} className="px-3 py-2.5 text-center text-xs">
          {cell(p)}
        </td>
      ))}
    </tr>
  );
  const head = (label: string) => (
    <tr key={`h-${label}`} className="bg-muted/30">
      <td
        colSpan={99}
        className="text-muted-foreground px-4 py-2 text-xs font-semibold uppercase tracking-wide"
      >
        {label}
      </td>
    </tr>
  );
  const yes = (v: boolean) => (v ? ok : no);

  return (
    <section className="bg-muted/20 py-16">
      <div className="container mx-auto max-w-6xl px-4">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2563EB]">
            Batafsil
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Har bir tarifga nima kiradi
          </h2>
          <p className="text-muted-foreground mt-3">
            Qabulxona, bemorlar bazasi, navbat, kassa, jurnal va xodimlar — har bir tarifda bor.
          </p>
        </div>
        <div className="bg-card mt-10 overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-card sticky top-0">
              <tr className="border-b">
                <th className="px-4 py-3 text-left font-semibold">Imkoniyat</th>
                {plans.map((p) => (
                  <th key={p.code} className="px-3 py-3 text-center font-semibold">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {head('Limitlar')}
              {row('Xodimlar', (p) => limitText(p.limits.max_staff))}
              {row('Qurilmalar', (p) => limitText(p.limits.max_devices))}
              {pub.groups.map((g) => {
                const list = pub.modules.filter((m) => m.group === g.key);
                if (list.length === 0) return null;
                return [
                  head(g.label),
                  ...list.map((m) => (
                    <tr key={m.key} className="border-t">
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <ModuleIcon name={m.key} className="h-4 w-4 text-[#2563EB]" /> {m.label}
                        </span>
                      </td>
                      {plans.map((p) => (
                        <td key={p.code} className="px-3 py-2.5">
                          {yes(p.modules.includes(m.key))}
                        </td>
                      ))}
                    </tr>
                  )),
                ];
              })}
              {head("Jurnal va to'lovlar")}
              {row("To'lov turlari", (p) =>
                p.payments.methods
                  ? p.payments.methods.map((k) => PAYMENT_METHOD_LABELS[k] ?? k).join(', ')
                  : 'Hammasi',
              )}
              {row('Jurnal tarixi', (p) =>
                p.journal.history_days ? `${p.journal.history_days} kun` : 'Cheksiz',
              )}
              {row('Jurnalni tahrirlash', (p) => yes(p.journal.allow_edit))}
              {row("O'chirish / bekor qilish", (p) => yes(p.journal.allow_delete))}
              {row('Eksport (CSV)', (p) => yes(p.journal.allow_export))}
              {row('Maxsus rollar', (p) => yes(p.roles.custom_roles))}
              {row('Windows ilovasi', (p) => yes(p.devices.clients.desktop !== false))}
              {row('Mobil ilova', (p) => yes(p.devices.clients.mobile !== false))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground mt-4 text-center text-xs">
          Klinikangizga alohida tarkib yoki narx kerakmi?{' '}
          <a href="/contact" className="text-[#2563EB] hover:underline">
            Bog'laning
          </a>{' '}
          — individual kelishuv tuzamiz.
        </p>
      </div>
    </section>
  );
}

// ── Bosh sahifa: qisqa tarif kartochkalari ─────────────────────────────────
export function HomePlans({ initial }: { initial: PublicPlans | null }) {
  const pub = useLivePlans(initial);
  const plans = (pub?.plans ?? []).filter((p) => p.code !== 'demo');
  if (plans.length === 0) return null;
  return (
    <section className="bg-muted/20 py-20">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2563EB]">
            Tariflar
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Klinikangiz hajmiga mos
          </h2>
          <p className="text-muted-foreground mt-4">
            Narxlar so'mda, yashirin to'lovsiz. Istalgan vaqt tarifni o'zgartirish mumkin.
          </p>
        </div>
        <div
          className={`mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-5 md:grid-cols-2 ${
            plans.length >= 3 ? 'lg:grid-cols-3' : ''
          }`}
        >
          {plans.map((p, i) => {
            const featured = plans.length >= 3 && i === Math.floor(plans.length / 2);
            return (
              <div
                key={p.code}
                className={`bg-card relative flex flex-col rounded-2xl border p-6 ${
                  featured ? 'border-[#2563EB] shadow-xl ring-2 ring-[#2563EB]/20' : 'card-hover'
                }`}
              >
                {featured && (
                  <span className="absolute -top-3 left-6 rounded-full bg-[#2563EB] px-3 py-0.5 text-xs font-semibold text-white">
                    Ko'p tanlanadi
                  </span>
                )}
                <h3 className="text-lg font-semibold">{p.name}</h3>
                {p.description && (
                  <p className="text-muted-foreground mt-1 text-sm">{p.description}</p>
                )}
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">{fmtUzs(p.price_uzs)}</span>
                  <span className="text-muted-foreground text-sm">so'm / oy</span>
                </div>
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  <li className="flex gap-2">
                    {tick} {p.limits.max_staff ?? 'Cheksiz'} xodim,{' '}
                    {p.limits.max_devices ?? 'cheksiz'} qurilma
                  </li>
                  <li className="flex gap-2">
                    {tick} {p.modules.length + CORE_COUNT} modul
                  </li>
                  {p.highlights.slice(0, 5).map((h) => (
                    <li key={h} className="flex gap-2">
                      {tick} {h}
                    </li>
                  ))}
                </ul>
                <a
                  href={`/signup?plan=${p.code}`}
                  className={`mt-6 block rounded-lg px-4 py-2.5 text-center text-sm font-semibold ${
                    featured
                      ? 'bg-[#2563EB] text-white hover:bg-[#1D4ED8]'
                      : 'hover:bg-accent border'
                  }`}
                >
                  30 kun bepul sinash
                </a>
              </div>
            );
          })}
        </div>
        <p className="mt-8 text-center">
          <a href="/pricing" className="text-sm font-medium text-[#2563EB] hover:underline">
            Tariflarni batafsil taqqoslash &rarr;
          </a>
        </p>
      </div>
    </section>
  );
}
