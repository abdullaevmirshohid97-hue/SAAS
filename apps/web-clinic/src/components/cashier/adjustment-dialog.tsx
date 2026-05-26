import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clary/ui-web';

import { api } from '@/lib/api';

function fmt(n: number) {
  return Math.abs(n).toLocaleString('uz-UZ');
}

type AdjustmentType = 'cash_correction' | 'patient_balance_correction';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Naqd' },
  { value: 'card', label: 'Karta' },
  { value: 'humo', label: 'Humo' },
  { value: 'uzcard', label: 'Uzcard' },
  { value: 'click', label: 'Click' },
  { value: 'payme', label: 'Payme' },
];

export function AdjustmentDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<AdjustmentType>('cash_correction');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'plus' | 'minus'>('plus');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [reason, setReason] = useState('');

  const amountNum = Number.parseInt(amount, 10) || 0;
  const signedAmount = direction === 'plus' ? amountNum : -amountNum;

  const mut = useMutation({
    mutationFn: () =>
      api.cashier.adjustment({
        type,
        amount_uzs: signedAmount,
        payment_method: paymentMethod,
        reason,
      }),
    onSuccess: () => {
      toast.success('Tuzatish kiritildi va audit log saqlandi');
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'cashier' });
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'journal' });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit =
    amountNum > 0 &&
    reason.trim().length >= 10 &&
    paymentMethod.length > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-amber-600" />
            Manual tuzatish kiritish
          </DialogTitle>
          <DialogDescription>
            Faqat admin. Audit log to'liq yoziladi (kim, qachon, qancha,
            sabab). O'ylab qaror qabul qiling.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-amber-300 bg-amber-50/50 p-2 text-xs text-amber-900">
            <div className="flex gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Bu amal hisobotlarda alohida 'adjustment' kind sifatida ko'rinadi.
                Cancel/undo yo'q.
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Tuzatish turi</label>
            <Select value={type} onValueChange={(v) => setType(v as AdjustmentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash_correction">Kassa tuzatish (umumiy)</SelectItem>
                <SelectItem value="patient_balance_correction">
                  Bemor balansi tuzatish
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Yo'nalish</label>
            <div className="flex gap-1 rounded-md border p-0.5">
              <button
                type="button"
                onClick={() => setDirection('plus')}
                className={`flex-1 rounded px-3 py-1 text-xs font-medium transition ${
                  direction === 'plus' ? 'bg-emerald-100 text-emerald-800' : 'hover:bg-accent/50'
                }`}
              >
                + Qo'shish (kirim)
              </button>
              <button
                type="button"
                onClick={() => setDirection('minus')}
                className={`flex-1 rounded px-3 py-1 text-xs font-medium transition ${
                  direction === 'minus' ? 'bg-rose-100 text-rose-800' : 'hover:bg-accent/50'
                }`}
              >
                − Ayirish (chiqim)
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Summa (so'm)</label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="50000"
              className="text-lg font-mono"
            />
            {amountNum > 0 && (
              <div className={`text-xs font-semibold ${direction === 'plus' ? 'text-emerald-700' : 'text-rose-700'}`}>
                {direction === 'plus' ? '+' : '−'}{fmt(amountNum)} so'm
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">To'lov usuli</label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Sabab (majburiy, kamida 10 belgi)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Masalan: kassir 50 000 so'mni Click sifatida yozgan, aslida Naqd edi"
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
            <div className="text-[10px] text-muted-foreground">
              {reason.trim().length} / 10 (min)
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
          <Button
            variant="default"
            onClick={() => mut.mutate()}
            disabled={!canSubmit || mut.isPending}
          >
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
