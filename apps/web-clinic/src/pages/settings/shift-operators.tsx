import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, Plus, ShieldAlert, Trash2, UserCog } from 'lucide-react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  PageHeader,
  cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';

interface Operator {
  id: string;
  full_name: string;
  phone?: string | null;
  role: string;
  color?: string | null;
  is_active: boolean;
  sort_order: number;
  pin_locked_until?: string | null;
}

const ROLES: Array<{ value: string; label: string; color: string }> = [
  { value: 'cashier', label: 'Kassir', color: '#2563eb' },
  { value: 'receptionist', label: 'Qabulxona', color: '#0891b2' },
  { value: 'manager', label: 'Menejer', color: '#7c3aed' },
  { value: 'admin', label: 'Admin', color: '#db2777' },
];

export function ShiftOperatorsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['shift-operators'],
    queryFn: () => api.shiftOperators.list(),
  });

  const [editTarget, setEditTarget] = useState<Operator | null>(null);
  const [creating, setCreating] = useState(false);
  const [pinTarget, setPinTarget] = useState<Operator | null>(null);

  const archiveMut = useMutation({
    mutationFn: (id: string) => api.shiftOperators.archive(id),
    onSuccess: () => {
      toast.success('Operator arxivlandi');
      qc.invalidateQueries({ queryKey: ['shift-operators'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const operators = ((data as Operator[] | undefined) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sozlamalar"
        title="Navbatchilar (PIN bilan)"
        description="Kassa va qabulxona navbatchilarini PIN-kod orqali autentifikatsiya qilamiz. PIN faqat Argon2id xesh shaklida saqlanadi."
        actions={
          <Button onClick={() => setCreating(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Navbatchi qo&lsquo;shish
          </Button>
        }
      />

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Yuklanmoqda…</div>
      ) : operators.length === 0 ? (
        <EmptyState
          title="Hali navbatchilar yo\u2018q"
          description="Birinchi navbatchini qo\u2018shing va unga PIN bering"
          action={<Button onClick={() => setCreating(true)}>Qo&lsquo;shish</Button>}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="p-3">Ism</th>
                  <th className="p-3">Rol</th>
                  <th className="p-3">Telefon</th>
                  <th className="p-3">Holat</th>
                  <th className="p-3 w-48" />
                </tr>
              </thead>
              <tbody>
                {operators.map((op) => (
                  <tr key={op.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                          style={{ backgroundColor: op.color ?? 'hsl(var(--primary))' }}
                        >
                          {op.full_name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="font-medium">{op.full_name}</div>
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge variant="secondary">{ROLES.find((r) => r.value === op.role)?.label ?? op.role}</Badge>
                    </td>
                    <td className="p-3 text-muted-foreground">{op.phone ?? '—'}</td>
                    <td className="p-3">
                      {op.pin_locked_until && new Date(op.pin_locked_until) > new Date() ? (
                        <Badge variant="destructive" className="gap-1">
                          <ShieldAlert className="h-3 w-3" /> PIN bloklangan
                        </Badge>
                      ) : op.is_active ? (
                        <Badge className="bg-success/15 text-success hover:bg-success/20">Faol</Badge>
                      ) : (
                        <Badge variant="outline">Nofaol</Badge>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setPinTarget(op)} className="gap-1">
                          <KeyRound className="h-3.5 w-3.5" /> PIN
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditTarget(op)} className="gap-1">
                          <UserCog className="h-3.5 w-3.5" /> Tahrir
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => archiveMut.mutate(op.id)} className="gap-1 text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {creating && <OperatorDialog onClose={() => setCreating(false)} />}
      {editTarget && <OperatorDialog operator={editTarget} onClose={() => setEditTarget(null)} />}
      {pinTarget && <PinDialog operator={pinTarget} onClose={() => setPinTarget(null)} />}
    </div>
  );
}

function OperatorDialog({ operator, onClose }: { operator?: Operator; onClose: () => void }) {
  const qc = useQueryClient();
  const [fullName, setFullName] = useState(operator?.full_name ?? '');
  const [phone, setPhone] = useState(operator?.phone ?? '');
  const [role, setRole] = useState(operator?.role ?? 'cashier');
  const [pin, setPin] = useState('');
  const [color, setColor] = useState(operator?.color ?? ROLES[0]!.color);

  const mut = useMutation({
    mutationFn: () => {
      if (operator) {
        return api.shiftOperators.update(operator.id, {
          full_name: fullName,
          phone: phone || undefined,
          role,
          color,
        });
      }
      return api.shiftOperators.create({
        full_name: fullName,
        phone: phone || undefined,
        role,
        color,
        pin,
      });
    },
    onSuccess: () => {
      toast.success(operator ? 'Yangilandi' : 'Qo\u2018shildi');
      qc.invalidateQueries({ queryKey: ['shift-operators'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isEdit = Boolean(operator);
  const valid = fullName.length >= 2 && role && (isEdit || pin.length >= 4);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Navbatchini tahrirlash' : 'Yangi navbatchi'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Navbatchi ma\u2018lumotlarini yangilang.' : 'PIN-kod Argon2id bilan xeshlanadi, hech qachon ochiq ko\u2018rinmaydi.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">To&lsquo;liq ism</label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ali Valiyev" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Telefon</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 ..." />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Rol</label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Rang</label>
            <div className="flex flex-wrap gap-2">
              {['#2563eb', '#0891b2', '#7c3aed', '#db2777', '#16a34a', '#ea580c', '#eab308', '#64748b'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn('h-8 w-8 rounded-full transition', color === c && 'ring-2 ring-offset-2 ring-foreground')}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          {!isEdit && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">PIN kod (4-8 raqam)</label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                className="text-center font-mono tracking-[0.3em]"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button disabled={!valid || mut.isPending} onClick={() => mut.mutate()} className="gap-1.5">
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PinDialog({ operator, onClose }: { operator: Operator; onClose: () => void }) {
  const [pin, setPin] = useState('');
  const mut = useMutation({
    mutationFn: () => api.shiftOperators.changePin(operator.id, pin),
    onSuccess: () => {
      toast.success('PIN yangilandi');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>PIN yangilash</DialogTitle>
          <DialogDescription>
            {operator.full_name} uchun yangi 4-8 raqamli PIN kiriting. Eski PIN darhol bekor qilinadi.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="text-center font-mono tracking-[0.3em]"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button disabled={pin.length < 4 || mut.isPending} onClick={() => mut.mutate()} className="gap-1.5">
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Yangilash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
