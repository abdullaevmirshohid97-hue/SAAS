import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Wallet } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
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
// Mijoz-klinikalar (B2B) — dorixona sotadigan klinikalar, ularning shifokorlari
// va qarzi (pharmacy_clinic_ledger).
// =============================================================================
export type PharmClinic = {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  notes: string | null;
  debt_uzs: number;
  doctors: Array<{ id: string; full_name: string; phone: string | null }>;
};

export function ClinicsTab() {
  const qc = useQueryClient();
  const ph = usePharmacy();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PharmClinic | null>(null);
  const [payTarget, setPayTarget] = useState<PharmClinic | null>(null);
  const [doctorTarget, setDoctorTarget] = useState<PharmClinic | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy', 'clinics'],
    queryFn: () => api.pharmacy.listClinics(),
  });
  const clinics = (data ?? []) as PharmClinic[];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['pharmacy', 'clinics'] });

  const archiveClinic = useMutation({
    mutationFn: (id: string) => api.pharmacy.archiveClinic(id),
    onSuccess: () => {
      invalidate();
      toast.success('Arxivlandi');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const archiveDoctor = useMutation({
    mutationFn: (id: string) => api.pharmacy.archiveClinicDoctor(id),
    onSuccess: () => {
      invalidate();
      toast.success("Shifokor o'chirildi");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Mijoz klinikalar</h2>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> Klinika qo'shish
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Yuklanmoqda…</div>
      ) : clinics.length === 0 ? (
        <EmptyState
          title="Mijoz klinika yo'q"
          description="Dorixona sotadigan klinikalarni qo'shing"
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {clinics.map((c) => (
            <Card key={c.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{c.name}</div>
                    {c.contact_person && (
                      <div className="text-muted-foreground text-xs">{c.contact_person}</div>
                    )}
                    {c.phone && <div className="text-muted-foreground text-xs">{c.phone}</div>}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setEditing(c);
                        setFormOpen(true);
                      }}
                    >
                      Tahrir
                    </Button>
                    {ph.isAdmin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => {
                          if (window.confirm('Klinikani arxivlash?')) archiveClinic.mutate(c.id);
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
                    (c.debt_uzs > 0
                      ? 'bg-amber-50 text-amber-800'
                      : 'bg-muted/40 text-muted-foreground')
                  }
                >
                  <span>Qarzi</span>
                  <span className="font-semibold">{fmt(c.debt_uzs)} so'm</span>
                </div>
                {c.debt_uzs > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => setPayTarget(c)}
                  >
                    <Wallet className="mr-1 h-4 w-4" /> Qarz to'lash
                  </Button>
                )}

                <div className="border-t pt-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-muted-foreground text-xs font-medium">Shifokorlar</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => setDoctorTarget(c)}
                    >
                      <Plus className="mr-0.5 h-3 w-3" /> qo'shish
                    </Button>
                  </div>
                  {c.doctors.length === 0 ? (
                    <div className="text-muted-foreground text-xs">Shifokor yo'q</div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {c.doctors.map((d) => (
                        <span
                          key={d.id}
                          className="bg-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                        >
                          {d.full_name}
                          {ph.isAdmin && (
                            <button
                              className="text-muted-foreground hover:text-rose-600"
                              onClick={() => {
                                if (window.confirm(`${d.full_name} o'chirilsinmi?`))
                                  archiveDoctor.mutate(d.id);
                              }}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {formOpen && (
        <ClinicFormDialog
          initial={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={invalidate}
        />
      )}
      {payTarget && (
        <PayDebtDialog clinic={payTarget} onClose={() => setPayTarget(null)} onSaved={invalidate} />
      )}
      {doctorTarget && (
        <AddDoctorDialog
          clinic={doctorTarget}
          onClose={() => setDoctorTarget(null)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

function ClinicFormDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: PharmClinic | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [contact, setContact] = useState(initial?.contact_person ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const mut = useMutation({
    mutationFn: () => {
      const body = {
        name,
        contact_person: contact || undefined,
        phone: phone || undefined,
        notes: notes || undefined,
      };
      return initial
        ? api.pharmacy.updateClinic(initial.id, body)
        : api.pharmacy.createClinic(body);
    },
    onSuccess: () => {
      toast.success('Saqlandi');
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? 'Klinikani tahrirlash' : 'Yangi mijoz klinika'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <LineField label="Klinika nomi *">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </LineField>
          <LineField label="Mas'ul shaxs">
            <Input value={contact} onChange={(e) => setContact(e.target.value)} />
          </LineField>
          <LineField label="Telefon">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998..." />
          </LineField>
          <LineField label="Izoh">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </LineField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button disabled={!name || mut.isPending} onClick={() => mut.mutate()}>
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddDoctorDialog({
  clinic,
  onClose,
  onSaved,
}: {
  clinic: PharmClinic;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const mut = useMutation({
    mutationFn: () =>
      api.pharmacy.addClinicDoctor(clinic.id, { full_name: fullName, phone: phone || undefined }),
    onSuccess: () => {
      toast.success("Shifokor qo'shildi");
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{clinic.name} — shifokor qo'shish</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <LineField label="F.I.O. *">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
          </LineField>
          <LineField label="Telefon">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </LineField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button disabled={!fullName || mut.isPending} onClick={() => mut.mutate()}>
            Qo'shish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayDebtDialog({
  clinic,
  onClose,
  onSaved,
}: {
  clinic: PharmClinic;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(String(clinic.debt_uzs));
  const [method, setMethod] = useState('cash');
  const mut = useMutation({
    mutationFn: () =>
      api.pharmacy.payClinicDebt(clinic.id, {
        amount_uzs: Number(amount) || 0,
        payment_method: method,
      }),
    onSuccess: () => {
      toast.success("Qarz to'lovi qabul qilindi");
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{clinic.name} — qarz to'lash</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Joriy qarz: <b>{fmt(clinic.debt_uzs)}</b> so'm
          </div>
          <LineField label="To'lov summasi (so'm)">
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </LineField>
          <LineField label="To'lov turi">
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Naqd (kassaga)</SelectItem>
                <SelectItem value="card">Plastik</SelectItem>
                <SelectItem value="click">Click</SelectItem>
                <SelectItem value="payme">Payme</SelectItem>
                <SelectItem value="transfer">O'tkazma</SelectItem>
              </SelectContent>
            </Select>
          </LineField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button
            disabled={!amount || Number(amount) <= 0 || mut.isPending}
            onClick={() => mut.mutate()}
          >
            To'lash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
