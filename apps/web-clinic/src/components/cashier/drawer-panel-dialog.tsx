import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banknote, ArrowDown, ArrowUp } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { EncashDialog } from '@/components/cashier/encash-dialog';

function fmt(n: number) {
  return Number(n ?? 0).toLocaleString('uz-UZ');
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('uz-UZ', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const REF_LABEL: Record<string, string> = {
  cash_payment: 'Naqd to\'lov',
  cash_refund: 'Vozvrat',
  encashment: 'Seyfga o\'tkazildi',
  cash_adjustment: 'Tuzatish',
  cash_expense: 'Rasxot',
};

/**
 * "Seyfga o'tmagan naqd" paneli — kassada (drawer) yig'ilgan, hali inkasatsiya
 * qilinmagan naqd pullar ro'yxati + "Hammasini seyfga olish" (inkasatsiya).
 * register: 'reception' (default) yoki 'inpatient'.
 */
export function DrawerPanelDialog({
  register,
  onClose,
}: {
  register?: string;
  onClose: () => void;
}) {
  const [encashOpen, setEncashOpen] = useState(false);

  const { data: coh, isLoading: cohLoading } = useQuery({
    queryKey: ['cashier', 'cash-on-hand', register ?? 'reception'],
    queryFn: () => api.cashier.cashOnHand(register),
    refetchInterval: 30_000,
  });
  const { data: entries, isLoading: entriesLoading } = useQuery({
    queryKey: ['cashier', 'cash-on-hand-entries', register ?? 'reception'],
    queryFn: () => api.cashier.cashOnHandEntries(register),
    refetchInterval: 30_000,
  });

  const total = coh?.cash_on_hand_uzs ?? 0;
  const list = entries ?? [];

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-amber-600" />
              Seyfga o'tmagan naqd
            </DialogTitle>
            <DialogDescription>
              Kassada yig'ilgan, hali seyfga o'tkazilmagan naqd pul. "Hammasini
              seyfga olish" bossangiz, butun summa inkasatsiya qilinib seyfga o'tadi.
            </DialogDescription>
          </DialogHeader>

          <Card className="border-amber-300 bg-amber-50/50">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Seyfga o'tmagan jami
                </div>
                <div
                  className={cn(
                    'font-mono text-3xl font-bold tabular-nums',
                    total > 0 ? 'text-amber-700' : 'text-muted-foreground',
                  )}
                >
                  {cohLoading ? '…' : fmt(total)} <span className="text-sm">so'm</span>
                </div>
              </div>
              <Button
                onClick={() => setEncashOpen(true)}
                disabled={total <= 0}
                className="gap-1.5"
              >
                <ArrowUp className="h-4 w-4" />
                Hammasini seyfga olish
              </Button>
            </CardContent>
          </Card>

          <div className="text-sm font-medium">Harakatlar ({list.length})</div>
          <div className="overflow-x-auto rounded-md border">
            {entriesLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
            ) : list.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Seyfga o'tmagan naqd yo'q
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Sana</th>
                    <th className="px-3 py-2 text-left font-medium">Turi</th>
                    <th className="px-3 py-2 text-left font-medium">Sabab / Izoh</th>
                    <th className="px-3 py-2 text-left font-medium">Kim</th>
                    <th className="px-3 py-2 text-right font-medium">Summa</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                        {fmtDate(e.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                            e.direction === 'in'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-rose-100 text-rose-700',
                          )}
                        >
                          {e.direction === 'in' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
                          {REF_LABEL[e.ref_type] ?? e.ref_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 max-w-[260px] truncate">{e.reason}</td>
                      <td className="px-3 py-2 text-xs">{e.author ?? '—'}</td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right font-mono font-semibold tabular-nums',
                          e.direction === 'in' ? 'text-emerald-700' : 'text-rose-700',
                        )}
                      >
                        {e.direction === 'in' ? '+' : '−'}{fmt(e.amount_uzs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Yopish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {encashOpen && (
        <EncashDialog
          register={register}
          defaultAmount={total > 0 ? total : undefined}
          defaultDestination="Seyf"
          onClose={() => setEncashOpen(false)}
        />
      )}
    </>
  );
}
