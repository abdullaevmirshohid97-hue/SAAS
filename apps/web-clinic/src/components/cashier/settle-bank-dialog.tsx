import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@clary/ui-web';
import { Landmark, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

// =============================================================================
// BANKKA O'TKAZISH — inkasatsiyaning naqdsiz muqobili
// =============================================================================
// Karta/o'tkazma pullari terminal orqali tushadi, keyin bank hisobiga keladi.
// Bu oyna o'sha "keldi" faktini qayd etadi: summa "Bankka o'tmagan" dan
// "Bankdagi pul" ga ko'chadi — xuddi naqdda inkasatsiya qilgandek.
// Server kutilayotgan summadan ortiqni qabul qilmaydi.
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

const METHODS = [
  { v: '', label: 'Barchasi (aralash)' },
  { v: 'card', label: 'Plastik karta' },
  { v: 'transfer', label: "O'tkazma" },
  { v: 'click', label: 'Click' },
  { v: 'payme', label: 'Payme' },
];

export function SettleBankDialog({
  onClose,
  pendingUzs,
  register,
}: {
  onClose: () => void;
  /** Bankka o'tmagan summa — ortig'iga ogohlantirish (server qattiq bloklaydi). */
  pendingUzs: number;
  register?: string;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(pendingUzs > 0 ? String(pendingUzs) : '');
  const [method, setMethod] = useState('');
  const [bankName, setBankName] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      api.cashier.settleToBank({
        amount_uzs: Number.parseInt(amount, 10) || 0,
        method: method || null,
        bank_name: bankName.trim() || undefined,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        register,
      }),
    onSuccess: (d) => {
      toast.success(`${fmt(d.amount_uzs)} so'm bankka o'tkazildi`);
      void qc.invalidateQueries({ queryKey: ['cashier'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const amountNum = Number.parseInt(amount, 10) || 0;
  const tooMuch = amountNum > pendingUzs;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="h-4 w-4" /> Bankka o'tkazish
          </DialogTitle>
          <DialogDescription>
            Karta va o'tkazma pullari bank hisobiga kelganini qayd etasiz. Summa "Bankka o'tmagan"
            dan "Bankdagi pul" ga ko'chadi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="bg-muted/50 rounded-md p-2.5 text-sm">
            Bankka o'tmagan: <b>{fmt(pendingUzs)}</b> so'm
          </div>

          <div>
            <Label>Summa</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1"
            />
            {amountNum > 0 && (
              <div
                className={`mt-1 text-xs ${tooMuch ? 'text-rose-600' : 'text-muted-foreground'}`}
              >
                {fmt(amountNum)} so'm
                {tooMuch && ' — kutilayotgan summadan ortiq, server rad etadi'}
              </div>
            )}
          </div>

          <div>
            <Label>Usul</Label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="border-input bg-background mt-1 h-9 w-full rounded-md border px-2 text-sm"
            >
              {METHODS.map((m) => (
                <option key={m.v} value={m.v}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Bank (ixtiyoriy)</Label>
              <Input
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="Masalan: Kapitalbank"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Hujjat № (ixtiyoriy)</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Ko'chirma raqami"
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label>Izoh (ixtiyoriy)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button
            disabled={amountNum <= 0 || tooMuch || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Landmark className="mr-1 h-3.5 w-3.5" />
            )}
            Bankka o'tkazish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
