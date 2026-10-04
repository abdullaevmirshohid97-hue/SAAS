import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Wallet } from 'lucide-react';
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
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { usePharmacy } from './context';
import { LineField, fmt } from './shared';

// =============================================================================
// Yetkazib beruvchi firmalar + oldi-berdi (qarz / to'lov) daftari
// =============================================================================
export type Supplier = {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  tax_id?: string | null;
  debt_uzs: number;
};

export function SuppliersTab() {
  const qc = useQueryClient();
  const ph = usePharmacy();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [ledgerTarget, setLedgerTarget] = useState<Supplier | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy', 'suppliers'],
    queryFn: () => api.pharmacy.listSuppliers(),
  });
  const suppliers = (data ?? []) as Supplier[];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['pharmacy'] });

  const archive = useMutation({
    mutationFn: (id: string) => api.pharmacy.archiveSupplier(id),
    onSuccess: () => {
      invalidate();
      toast.success('Arxivlandi');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalDebt = suppliers.reduce((a, s) => a + Math.max(0, s.debt_uzs), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Yetkazib beruvchi firmalar</h2>
          <p className="text-muted-foreground text-sm">
            Firma anketasi va oldi-berdi (qarz/to'lov) tarixi
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
            Jami qarzimiz: <b>{fmt(totalDebt)}</b> so'm
          </div>
          {ph.canReceive && (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Firma qo'shish
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Yuklanmoqda…</div>
      ) : suppliers.length === 0 ? (
        <EmptyState title="Firma yo'q" description="Dori yetkazib beruvchi firmalarni qo'shing" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((s) => (
            <Card key={s.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{s.name}</div>
                    {s.contact_person && (
                      <div className="text-muted-foreground text-xs">{s.contact_person}</div>
                    )}
                    {s.phone && <div className="text-muted-foreground text-xs">{s.phone}</div>}
                    {s.tax_id && (
                      <div className="text-muted-foreground text-xs">STIR: {s.tax_id}</div>
                    )}
                    {s.address && <div className="text-muted-foreground text-xs">{s.address}</div>}
                  </div>
                  <div className="flex gap-1">
                    {ph.canReceive && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          setEditing(s);
                          setFormOpen(true);
                        }}
                      >
                        Tahrir
                      </Button>
                    )}
                    {ph.isAdmin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => {
                          if (window.confirm('Firmani arxivlash?')) archive.mutate(s.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                <div
                  className={
                    'flex items-center justify-between rounded-md px-2 py-1.5 text-sm ' +
                    (s.debt_uzs > 0
                      ? 'bg-amber-50 text-amber-800'
                      : s.debt_uzs < 0
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-muted/40 text-muted-foreground')
                  }
                >
                  <span>{s.debt_uzs >= 0 ? 'Bizning qarz' : 'Avans (oldindan)'}</span>
                  <span className="font-semibold">{fmt(Math.abs(s.debt_uzs))} so'm</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => setLedgerTarget(s)}
                >
                  <Wallet className="mr-1 h-4 w-4" /> Oldi-berdi
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {formOpen && (
        <SupplierFormDialog
          initial={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={() => invalidate()}
        />
      )}
      {ledgerTarget && (
        <SupplierLedgerDialog
          supplier={ledgerTarget}
          onClose={() => setLedgerTarget(null)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

/** Firma anketasi — yangi yoki tahrir. `onSaved` yangi firma id bilan chaqiriladi. */
export function SupplierFormDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Supplier | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name ?? '');
  const [contact, setContact] = useState(initial?.contact_person ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [taxId, setTaxId] = useState(initial?.tax_id ?? '');
  const mut = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        contact_person: contact || undefined,
        phone: phone || undefined,
        address: address || undefined,
        tax_id: taxId || undefined,
      };
      return initial
        ? api.pharmacy.updateSupplier(initial.id, body)
        : api.pharmacy.createSupplier(body);
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['pharmacy', 'suppliers'] });
      toast.success(initial ? 'Saqlandi' : 'Firma qo‘shildi');
      onSaved((res as { id: string }).id ?? initial?.id ?? '');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? 'Firmani tahrirlash' : 'Yangi firma'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <LineField label="Firma nomi *">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Masalan: Dori-Darmon"
              autoFocus
            />
          </LineField>
          <LineField label="STIR (INN)">
            <Input
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="9 xonali"
            />
          </LineField>
          <LineField label="Olib keluvchi / ishchi (F.I.O.)">
            <Input value={contact} onChange={(e) => setContact(e.target.value)} />
          </LineField>
          <LineField label="Telefon">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998..." />
          </LineField>
          <LineField label="Firma manzili">
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Shahar, ko'cha..."
            />
          </LineField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button disabled={!name.trim() || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? 'Saqlanmoqda…' : initial ? 'Saqlash' : 'Qo‘shish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ENTRY_KIND_LABEL: Record<string, string> = {
  purchase: 'Prixot (qarz)',
  payment: 'To‘lov (pul berdim)',
  debt: 'Qarz',
  adjustment: 'Tuzatish',
};
const PAY_METHODS = [
  { v: 'cash', l: 'Naqd (kassadan)' },
  { v: 'click', l: 'Click/Karta' },
  { v: 'transfer', l: "O'tkazma" },
];

function SupplierLedgerDialog({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const ph = usePharmacy();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'payment' | 'debt' | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [invoice, setInvoice] = useState('');
  const [occurred, setOccurred] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [entryNotes, setEntryNotes] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['pharmacy', 'supplier-ledger', supplier.id, from, to, q],
    queryFn: () =>
      api.pharmacy.supplierLedger(supplier.id, {
        from: from || undefined,
        to: to || undefined,
        q: q || undefined,
      }),
  });
  const balance = data?.balance ?? supplier.debt_uzs;
  const entries = data?.entries ?? [];

  const reset = () => {
    setKind(null);
    setAmount('');
    setMethod('cash');
    setInvoice('');
    setEntryNotes('');
    setOccurred(new Date().toLocaleDateString('en-CA'));
  };
  const add = useMutation({
    mutationFn: () =>
      api.pharmacy.addSupplierEntry(supplier.id, {
        entry_kind: kind!,
        amount_uzs: Number(amount) || 0,
        payment_method: method || undefined,
        invoice_no: invoice || undefined,
        occurred_at: occurred || undefined,
        notes: entryNotes || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      void refetch();
      onSaved();
      toast.success(kind === 'payment' ? "To'lov yozildi" : "Qarz qo'shildi");
      reset();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{supplier.name} — oldi-berdi</DialogTitle>
          <DialogDescription>
            Qarz/to'lov tarixi, faktura va sana bo'yicha qidirish
          </DialogDescription>
        </DialogHeader>

        <div
          className={
            'flex items-center justify-between rounded-md px-3 py-2 text-sm ' +
            (balance > 0
              ? 'bg-amber-50 text-amber-800'
              : balance < 0
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-muted/40')
          }
        >
          <span>{balance >= 0 ? 'Joriy qarzimiz' : 'Avans (oldindan to‘langan)'}</span>
          <span className="text-base font-semibold">{fmt(Math.abs(balance))} so'm</span>
        </div>

        {ph.isAdmin &&
          (kind === null ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setKind('payment')}>
                <Wallet className="mr-1 h-4 w-4" /> Pul berdim
              </Button>
              <Button size="sm" variant="outline" onClick={() => setKind('debt')}>
                <Plus className="mr-1 h-4 w-4" /> Qarz qo'shish
              </Button>
            </div>
          ) : (
            <div className="bg-muted/20 space-y-3 rounded-md border p-3">
              <div className="text-sm font-medium">
                {kind === 'payment' ? "Pul berdim (to'lov)" : "Qarz qo'shish"}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <LineField label="Summa (so'm) *">
                  <Input
                    type="number"
                    min={0}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    autoFocus
                  />
                </LineField>
                <LineField label="Sana">
                  <Input
                    type="date"
                    value={occurred}
                    onChange={(e) => setOccurred(e.target.value)}
                  />
                </LineField>
                {kind === 'payment' && (
                  <LineField label="To'lov turi">
                    <Select value={method} onValueChange={setMethod}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAY_METHODS.map((m) => (
                          <SelectItem key={m.v} value={m.v}>
                            {m.l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </LineField>
                )}
                <LineField label="Faktura raqami">
                  <Input
                    value={invoice}
                    onChange={(e) => setInvoice(e.target.value)}
                    placeholder="№..."
                  />
                </LineField>
              </div>
              <LineField label="Izoh">
                <Input value={entryNotes} onChange={(e) => setEntryNotes(e.target.value)} />
              </LineField>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={reset}>
                  Bekor
                </Button>
                <Button
                  size="sm"
                  disabled={!amount || Number(amount) <= 0 || add.isPending}
                  onClick={() => add.mutate()}
                >
                  {add.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
                </Button>
              </div>
            </div>
          ))}

        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.5fr_auto]">
          <LineField label="Dan (sana)">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </LineField>
          <LineField label="Gacha (sana)">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </LineField>
          <LineField label="Faktura qidirish">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Faktura №" />
          </LineField>
          <div className="flex items-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFrom('');
                setTo('');
                setQ('');
              }}
            >
              Tozalash
            </Button>
          </div>
        </div>

        <div className="max-h-[40vh] overflow-y-auto rounded border">
          {isLoading ? (
            <div className="text-muted-foreground p-4 text-sm">Yuklanmoqda…</div>
          ) : entries.length === 0 ? (
            <div className="text-muted-foreground p-6 text-center text-sm">Yozuv yo'q</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-muted-foreground sticky top-0 text-xs">
                <tr>
                  <th className="px-2 py-1.5 text-left">Sana</th>
                  <th className="px-2 py-1.5 text-left">Turi</th>
                  <th className="px-2 py-1.5 text-right">Summa</th>
                  <th className="px-2 py-1.5 text-left">To'lov</th>
                  <th className="px-2 py-1.5 text-left">Faktura</th>
                  <th className="px-2 py-1.5 text-left">Izoh</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entries.map((e) => {
                  const pos = e.amount_uzs >= 0;
                  return (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap px-2 py-1.5">{e.occurred_at}</td>
                      <td className="px-2 py-1.5">
                        {ENTRY_KIND_LABEL[e.entry_kind] ?? e.entry_kind}
                      </td>
                      <td
                        className={
                          'px-2 py-1.5 text-right font-medium ' +
                          (pos ? 'text-amber-700' : 'text-emerald-700')
                        }
                      >
                        {pos ? '+' : '−'}
                        {fmt(Math.abs(e.amount_uzs))}
                      </td>
                      <td className="px-2 py-1.5">
                        {e.payment_method
                          ? (PAY_METHODS.find((m) => m.v === e.payment_method)?.l ??
                            e.payment_method)
                          : '—'}
                      </td>
                      <td className="px-2 py-1.5">{e.invoice_no ?? '—'}</td>
                      <td className="text-muted-foreground px-2 py-1.5">{e.notes ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Yopish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
