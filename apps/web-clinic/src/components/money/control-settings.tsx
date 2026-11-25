import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@clary/ui-web';

import { api } from '@/lib/api';

// =============================================================================
// NAZORAT (A3/A4) — rahbar sozlaydi:
//   • shu summadan katta rasxot/vozvratni FAQAT rahbar kiritadi (kassir 403);
//   • shu summadan katta rasxot/vozvrat Telegram'da "🔴 KATTA" bo'lib keladi.
// Yopilgan smenadagi chek o'zgarishi har doim Telegram'ga xabar qilinadi.
// =============================================================================

type Settings = {
  expense_approval_limit_uzs?: number;
  refund_approval_limit_uzs?: number;
  alert_large_amount_uzs?: number;
};

const toNum = (s: string) => Math.max(0, Math.round(Number(s.replace(/\s/g, '')) || 0));

export function ControlSettingsCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ clinic?: { settings?: Settings } }>('/api/v1/auth/me'),
    staleTime: 60_000,
  });
  const s = data?.clinic?.settings ?? {};
  const [expense, setExpense] = useState('');
  const [refund, setRefund] = useState('');
  const [alert, setAlert] = useState('');

  useEffect(() => {
    setExpense(s.expense_approval_limit_uzs ? String(s.expense_approval_limit_uzs) : '');
    setRefund(s.refund_approval_limit_uzs ? String(s.refund_approval_limit_uzs) : '');
    setAlert(s.alert_large_amount_uzs ? String(s.alert_large_amount_uzs) : '');
  }, [s.expense_approval_limit_uzs, s.refund_approval_limit_uzs, s.alert_large_amount_uzs]);

  const save = useMutation({
    mutationFn: () =>
      api.patch('/api/v1/auth/clinic/settings', {
        expense_approval_limit_uzs: toNum(expense),
        refund_approval_limit_uzs: toNum(refund),
        alert_large_amount_uzs: toNum(alert),
      }),
    onSuccess: () => {
      toast.success('Nazorat sozlamalari saqlandi');
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" /> Nazorat
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <span className="text-muted-foreground text-xs">
              Rasxot: shundan kattasini faqat rahbar kiritadi
            </span>
            <Input
              inputMode="numeric"
              placeholder="0 — cheklov yo‘q"
              value={expense}
              onChange={(e) => setExpense(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-xs">
              Vozvrat: shundan kattasini faqat rahbar qiladi
            </span>
            <Input
              inputMode="numeric"
              placeholder="0 — cheklov yo‘q"
              value={refund}
              onChange={(e) => setRefund(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-xs">
              Telegram'da "🔴 KATTA" belgisi (so‘m)
            </span>
            <Input
              inputMode="numeric"
              placeholder="1 000 000"
              value={alert}
              onChange={(e) => setAlert(e.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            Yopilgan smenadagi chekni o‘zgartirish faqat rahbarga ruxsat va har safar Telegram'ga
            xabar beriladi.
          </p>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
