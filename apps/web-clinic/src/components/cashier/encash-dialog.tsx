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
  register,
  availableCash,
}: {
  onClose: () => void;
  defaultAmount?: number;
  defaultDestination?: string;
  register?: string;
  /** Seyfga o'tmagan naqd — ortig'iga ogohlantirish (server qattiq bloklaydi). */
  availableCash?: number;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(defaultAmount && defaultAmount > 0 ? String(defaultAmount) : '');
  const [destination, setDestination] = useState(defaultDestination ?? 'Bank');
  const [notes, setNotes] = useState('');
  const [pin, setPin] = useState('');

  const mut = useMutation({
    // Inkassatsiya — naqd pul kassadan chiqadi; avval navbatchi PIN tasdiqlanadi
    // (vozvrat bilan bir xil himoya — ruxsatsiz pul chiqarilmasin).
    mutationFn: async () => {
      await api.shifts.verifyActivePin(pin);
      return api.cashier.encash({
        amount_uzs: Number.parseInt(amount, 10) || 0,
        destination,
        notes: notes || undefined,
        register,
      });
    },
    onSuccess: (data) => {
      toast.success(`${fmt(data.amount_uzs)} so'm ${data.destination}'ga o'tkazildi`);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'cashier' });
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'journal' });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Noto'g'ri PIN"),
  });

  const amountNum = Number.parseInt(amount, 10) || 0;
  const canSubmit = amountNum > 0 && destination.trim().length > 0 && pin.length >= 4;

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
            {typeof availableCash === 'number' && (
              <div
                className={
                  'text-xs ' +
                  (amountNum > availableCash ? 'font-medium text-rose-600' : 'text-muted-foreground')
                }
              >
                Seyfga o'tmagan naqd: {fmt(availableCash)} so'm
                {amountNum > availableCash && ' — bundan ko\'p (smena boshlang\'ich puli bo\'lmasa server rad etadi)'}
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

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Navbatchi PIN *</label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="••••"
              className="text-center font-mono tracking-[0.3em]"
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
