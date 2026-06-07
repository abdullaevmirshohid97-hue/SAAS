import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banknote } from 'lucide-react';
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
  return Number(n ?? 0).toLocaleString('uz-UZ');
}

const DESTINATIONS = ['Bank', 'Seyf', 'Inkassator', 'Boshqa'];

export function EncashDialog({
  onClose,
  defaultAmount,
  defaultDestination,
}: {
  onClose: () => void;
  defaultAmount?: number;
  defaultDestination?: string;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(defaultAmount && defaultAmount > 0 ? String(defaultAmount) : '');
  const [destination, setDestination] = useState(defaultDestination ?? 'Bank');
  const [notes, setNotes] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      api.cashier.encash({
        amount_uzs: Number.parseInt(amount, 10) || 0,
        destination,
        notes: notes || undefined,
      }),
    onSuccess: (data) => {
      toast.success(`${fmt(data.amount_uzs)} so'm ${data.destination}'ga o'tkazildi`);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'cashier' });
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'journal' });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const amountNum = Number.parseInt(amount, 10) || 0;
  const canSubmit = amountNum > 0 && destination.trim().length > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-amber-600" />
            Inkasatsiya (pulni olib chiqish)
          </DialogTitle>
          <DialogDescription>
            Kassadagi naqd pulni bank yoki seyfga o'tkazish. Bu amal smena
            yopilganda kutilgan kassa qoldigini kamaytiradi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Summa (so'm)
            </label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="500 000"
              className="text-lg font-mono"
            />
            {amountNum > 0 && (
              <div className="text-xs text-muted-foreground">
                {fmt(amountNum)} so'm
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Qaerga</label>
            <Select value={destination} onValueChange={setDestination}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DESTINATIONS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Izoh (ixtiyoriy)
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Masalan: Inkassator №123 oldi"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
          <Button onClick={() => mut.mutate()} disabled={!canSubmit || mut.isPending}>
            O'tkazish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
