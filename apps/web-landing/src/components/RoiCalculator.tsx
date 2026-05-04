import { useMemo, useState } from 'react';

const UZS_PER_USD = 12_600;

function fmtUZS(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} mlrd`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} mln`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return Math.round(n).toLocaleString('uz-UZ');
}

function pickPlan(staff: number): { name: string; usd: number } {
  if (staff <= 2) return { name: '25PRO', usd: 25 };
  if (staff <= 10) return { name: '50PRO', usd: 50 };
  return { name: '120PRO', usd: 120 };
}

export function RoiCalculator() {
  const [patientsPerDay, setPatientsPerDay] = useState(40);
  const [avgCheckUzs, setAvgCheckUzs] = useState(180_000);
  const [staff, setStaff] = useState(5);
  const [adminHoursWeek, setAdminHoursWeek] = useState(15);

  const result = useMemo(() => {
    const workingDays = 26;

    // Time saved: 30% reduction in admin overhead, valued at ~50K UZS/h
    const hoursPerMonth = adminHoursWeek * 4.33;
    const timeSavedHours = hoursPerMonth * 0.3;
    const timeSavedUzs = timeSavedHours * 50_000;

    // Revenue uplift: 12% from fewer no-shows + faster intake
    const monthlyGross = patientsPerDay * workingDays * avgCheckUzs;
    const revenueUpliftUzs = monthlyGross * 0.12;

    // Loss prevented: 2% of monthly gross typically lost to manual cashier errors / lost paper
    const lossPreventedUzs = monthlyGross * 0.02;

    const totalSavingsUzs = timeSavedUzs + revenueUpliftUzs + lossPreventedUzs;

    const plan = pickPlan(staff);
    const planCostUzs = plan.usd * UZS_PER_USD;

    const netSavingsUzs = totalSavingsUzs - planCostUzs;
    const roiX = planCostUzs > 0 ? totalSavingsUzs / planCostUzs : 0;
    const paybackDays = totalSavingsUzs > 0 ? (planCostUzs / totalSavingsUzs) * 30 : 0;

    return {
      monthlyGross,
      timeSavedUzs,
      revenueUpliftUzs,
      lossPreventedUzs,
      totalSavingsUzs,
      planCostUzs,
      netSavingsUzs,
      roiX,
      paybackDays,
      plan,
    };
  }, [patientsPerDay, avgCheckUzs, staff, adminHoursWeek]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5 rounded-xl border bg-card p-6">
        <div>
          <h3 className="text-lg font-semibold">Klinikangiz haqida</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Realga yaqin raqamlar bilan ROI hisoblanmasini ko'ring
          </p>
        </div>

        <Field
          label="Kuniga bemorlar"
          value={patientsPerDay}
          min={5}
          max={300}
          step={5}
          unit="bemor"
          onChange={setPatientsPerDay}
        />

        <Field
          label="O'rtacha chek"
          value={avgCheckUzs}
          min={50_000}
          max={1_500_000}
          step={10_000}
          unit="UZS"
          format={(n) => fmtUZS(n)}
          onChange={setAvgCheckUzs}
        />

        <Field
          label="Xodimlar soni"
          value={staff}
          min={1}
          max={50}
          step={1}
          unit="xodim"
          onChange={setStaff}
        />

        <Field
          label="Hisobot/qog'ozga ketadigan vaqt (haftada)"
          value={adminHoursWeek}
          min={2}
          max={60}
          step={1}
          unit="soat"
          onChange={setAdminHoursWeek}
        />
      </div>

      <div className="space-y-4 rounded-xl border-2 border-[#2563EB] bg-gradient-to-br from-[#2563EB]/5 via-card to-card p-6 shadow-lg">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#2563EB] px-2.5 py-0.5 text-xs font-bold text-white">
            Sizga tavsiya
          </span>
          <span className="text-sm font-semibold">{result.plan.name} — ${result.plan.usd}/oy</span>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Oylik tejov
          </div>
          <div className="mt-1 text-4xl font-bold tracking-tight text-[#2563EB] sm:text-5xl">
            {fmtUZS(result.totalSavingsUzs)} <span className="text-2xl">UZS</span>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Yillik: {fmtUZS(result.totalSavingsUzs * 12)} UZS
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 border-y py-4">
          <Stat label="ROI" value={`${result.roiX.toFixed(0)}x`} accent="emerald" />
          <Stat
            label="Payback"
            value={result.paybackDays < 30 ? `${Math.round(result.paybackDays)} kun` : '—'}
            accent="blue"
          />
          <Stat label="Sof foyda/oy" value={fmtUZS(result.netSavingsUzs)} accent="amber" />
        </div>

        <ul className="space-y-2 text-sm">
          <Row label="Vaqt tejovi (30% admin overhead)" value={fmtUZS(result.timeSavedUzs)} />
          <Row label="Daromad o'sishi (12%)" value={fmtUZS(result.revenueUpliftUzs)} />
          <Row label="Yo'qotishlar oldi olinadi (2%)" value={fmtUZS(result.lossPreventedUzs)} />
          <Row label="Clary tarif" value={`-${fmtUZS(result.planCostUzs)}`} negative />
        </ul>

        <a
          href={`/signup?plan=${result.plan.name.toLowerCase()}`}
          className="block rounded-md bg-[#2563EB] px-4 py-3 text-center text-sm font-semibold text-white shadow hover:bg-[#1D4ED8]"
          onClick={() => {
            try {
              // @ts-expect-error PostHog optional
              window.posthog?.capture?.('roi_cta_clicked', {
                plan: result.plan.name,
                monthly_savings: result.totalSavingsUzs,
              });
            } catch {}
          }}
        >
          {result.plan.name} bilan boshlash &rarr;
        </a>
        <p className="text-center text-xs text-muted-foreground">
          Hisob taxminiy. Real natija klinikaga qarab farq qilishi mumkin.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  min,
  max,
  step,
  unit,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  format?: (n: number) => string;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-sm font-semibold tabular-nums">
          {format ? format(value) : value} <span className="text-xs text-muted-foreground">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#2563EB]"
        aria-label={label}
      />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: 'emerald' | 'blue' | 'amber' }) {
  const colors: Record<string, string> = {
    emerald: 'text-[#10B981]',
    blue: 'text-[#2563EB]',
    amber: 'text-[#F59E0B]',
  };
  return (
    <div className="text-center">
      <div className={`text-xl font-bold tabular-nums ${colors[accent]}`}>{value}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function Row({ label, value, negative = false }: { label: string; value: string; negative?: boolean }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${negative ? 'text-rose-600' : ''}`}>{value}</span>
    </li>
  );
}
