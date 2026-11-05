// Klinika obuna holati va tarif nomlari — barcha super-admin sahifalarida bir xil.

export type StatusTone = 'success' | 'info' | 'warning' | 'destructive' | 'secondary';

export const SUBSCRIPTION_STATUS: Record<
  string,
  { label: string; tone: StatusTone; hint: string }
> = {
  active: { label: 'Faol', tone: 'success', hint: 'Obuna to‘langan' },
  trialing: { label: 'Sinov', tone: 'info', hint: 'Bepul sinov muddati' },
  past_due: {
    label: 'Muddati o‘tgan',
    tone: 'warning',
    hint: 'To‘lov kechikkan — imtiyozli (grace) muddat',
  },
  unpaid: {
    label: 'Bloklangan',
    tone: 'destructive',
    hint: 'Obuna tugagan — klinika ilovaga kira olmaydi',
  },
  canceled: {
    label: 'Bekor qilingan',
    tone: 'destructive',
    hint: 'Obuna bekor — klinika ilovaga kira olmaydi',
  },
  suspended: { label: 'To‘xtatilgan', tone: 'destructive', hint: 'Super-admin to‘xtatgan' },
  paused: { label: 'Pauza', tone: 'secondary', hint: 'Obuna vaqtincha to‘xtatilgan' },
};

export function statusMeta(status: string | null | undefined, suspended = false) {
  const key = suspended ? 'suspended' : (status ?? '');
  return (
    SUBSCRIPTION_STATUS[key] ?? { label: status || '—', tone: 'secondary' as StatusTone, hint: '' }
  );
}

export const PLAN_LABELS: Record<string, string> = {
  demo: 'Demo',
  '25pro': 'Base',
  '50pro': 'Pro',
  '120pro': 'Enterprise',
};

export const planLabel = (code: string | null | undefined) =>
  code ? (PLAN_LABELS[code] ?? code) : '—';

export const fmtUzs = (n: number | null | undefined) =>
  `${Number(n ?? 0).toLocaleString('uz-UZ')} so‘m`;

export const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('uz-UZ') : '—';

/** "3 kun qoldi" / "bugun" / "5 kun oldin" */
export function relDays(s: string | null | undefined): string {
  if (!s) return '';
  const days = Math.round((new Date(s).getTime() - Date.now()) / 86_400_000);
  if (days === 0) return 'bugun';
  return days > 0 ? `${days} kun qoldi` : `${-days} kun oldin`;
}
