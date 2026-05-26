import { useQuery } from '@tanstack/react-query';
import { Wallet, Archive } from 'lucide-react';
import { cn } from '@clary/ui-web';

import { api } from '@/lib/api';

export type CashierSource = 'cash_drawer' | 'safe';

function fmt(n: number) {
  return Number(n ?? 0).toLocaleString('uz-UZ');
}

// Reusable pul manbai tanlash radio. Refund, expense, deposit-withdraw
// va boshqa chiqim amallarda foydalaniladi. Seyf balansi ko'rsatiladi —
// agar yetmasa, foydalanuvchi 'kassa' ni tanlaydi.
export function SourcePicker({
  value,
  onChange,
  amount,
}: {
  value: CashierSource;
  onChange: (v: CashierSource) => void;
  amount?: number;
}) {
  const { data: safe } = useQuery({
    queryKey: ['cashier', 'safe-balance'],
    queryFn: () => api.cashier.safeBalance(),
    refetchInterval: 60_000,
  });

  const safeBalance = safe?.safe_balance_uzs ?? 0;
  const enoughInSafe = amount == null || safeBalance >= amount;

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        Pul qayerdan olinsin?
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange('cash_drawer')}
          className={cn(
            'flex flex-col items-start gap-1 rounded-md border-2 p-3 text-left transition',
            value === 'cash_drawer'
              ? 'border-emerald-500 bg-emerald-50/50'
              : 'border-muted hover:border-muted-foreground/30',
          )}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wallet className="h-4 w-4 text-emerald-600" />
            Bugungi tushum
          </div>
          <div className="text-[10px] text-muted-foreground">
            Kassadan (bugungi tx'lardan)
          </div>
        </button>

        <button
          type="button"
          onClick={() => onChange('safe')}
          className={cn(
            'flex flex-col items-start gap-1 rounded-md border-2 p-3 text-left transition',
            value === 'safe'
              ? 'border-amber-500 bg-amber-50/50'
              : 'border-muted hover:border-muted-foreground/30',
            !enoughInSafe && 'opacity-60',
          )}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Archive className="h-4 w-4 text-amber-600" />
            Seyf
          </div>
          <div className="text-[10px] text-muted-foreground">
            Mavjud: {fmt(safeBalance)} so'm
          </div>
        </button>
      </div>
      {value === 'safe' && !enoughInSafe && amount && (
        <div className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800">
          Seyfda yetarli pul yo'q. Mavjud {fmt(safeBalance)} so'm, kerak{' '}
          {fmt(amount)} so'm.
        </div>
      )}
    </div>
  );
}
