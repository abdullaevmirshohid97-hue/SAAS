import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
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
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@clary/ui-web';
import {
  Activity,
  ArrowRightLeft,
  BedDouble,
  CheckCircle2,
  CircleDollarSign,
  LogOut,
  Plus,
  UserPlus,
  Utensils,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '@/lib/api';

type Room = {
  id: string;
  number: string;
  floor: number | null;
  section: string | null;
  capacity: number;
  daily_price_uzs: number | null;
  status: string;
  type: string | null;
  includes_meals: boolean;
  notes: string | null;
  occupants: Array<{
    id: string;
    bed_no: string | null;
    patient: { id: string; full_name: string } | null;
    admitted_at: string;
  }>;
  occupied: number;
  vacancy: number;
};

type Stay = {
  id: string;
  patient_id: string;
  room_id: string | null;
  bed_no: string | null;
  admitted_at: string;
  discharged_at: string | null;
  status: string;
  planned_discharge_at: string | null;
  admission_reason: string | null;
  patient?: { id: string; full_name: string; phone?: string };
  room?: { id: string; number: string; section: string | null; floor: number | null; daily_price_uzs: number | null };
  doctor?: { id: string; full_name: string };
};

export function InpatientPage() {
  const [admitOpen, setAdmitOpen] = useState(false);
  const [preferredRoomId, setPreferredRoomId] = useState<string | null>(null);
  const navigate = useNavigate();

  const { data: map, isLoading } = useQuery({
    queryKey: ['inpatient-room-map'],
    queryFn: () => api.inpatient.roomMap(),
    refetchInterval: 30_000,
  });

  const { data: stays } = useQuery({
    queryKey: ['inpatient-stays', 'admitted'],
    queryFn: () => api.inpatient.list({ status: 'admitted' }),
  });

  const totalRooms = (map?.floors ?? []).reduce((a, f) => a + f.rooms.length, 0);
  const totalCapacity = (map?.floors ?? []).reduce(
    (a, f) => a + f.rooms.reduce((s, r) => s + r.capacity, 0),
    0,
  );
  const totalOccupied = (map?.floors ?? []).reduce(
    (a, f) => a + f.rooms.reduce((s, r) => s + r.occupied, 0),
    0,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Statsionar"
        title="Bemorlar va xonalar"
        description="Xonalar xaritasi, qabul, davolash jadvali va bemor hisobi."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <BedDouble className="h-3.5 w-3.5" />
              {totalOccupied}/{totalCapacity} band
            </Badge>
            <Button size="sm" onClick={() => setAdmitOpen(true)}>
              <UserPlus className="mr-1 h-4 w-4" />
              Yangi qabul
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="h-40 animate-pulse" />
            </Card>
          ))}
        </div>
      ) : totalRooms === 0 ? (
        <EmptyState
          title="Xonalar sozlanmagan"
          description="Sozlamalar \u2192 Xonalar bo'limidan xonalarni qo'shing (bino, qavat, sig'im)."
          action={
            <Link to="/settings/catalog/rooms">
              <Button>
                <Plus className="mr-1 h-4 w-4" /> Xona qo&lsquo;shish
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {(map?.floors ?? []).map((f) => (
            <Card key={f.floor}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {f.floor === 0 ? 'Asosiy qavat' : `${f.floor}-qavat`}
                  </h3>
                  <span className="text-xs text-muted-foreground">{f.rooms.length} xona</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {f.rooms.map((r) => (
                    <RoomTile
                      key={r.id}
                      room={r}
                      onAdmit={() => {
                        setPreferredRoomId(r.id);
                        setAdmitOpen(true);
                      }}
                      onSelect={(stayId) => navigate(`/inpatient/stays/${stayId}`)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {((stays as Stay[] | undefined) ?? []).length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <h3 className="text-sm font-semibold">Faol bemorlar</h3>
            <div className="divide-y">
              {(stays as Stay[]).map((s) => (
                <StayRow key={s.id} stay={s} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <AdmitDialog
        open={admitOpen}
        onClose={() => {
          setAdmitOpen(false);
          setPreferredRoomId(null);
        }}
        preferredRoomId={preferredRoomId}
      />
    </div>
  );
}

function RoomTile({
  room,
  onAdmit,
  onSelect,
}: {
  room: Room;
  onAdmit: () => void;
  onSelect: (stayId: string) => void;
}) {
  const full = room.vacancy === 0;
  const utilization = room.capacity > 0 ? (room.occupied / room.capacity) * 100 : 0;
  return (
    <div
      className={cn(
        'group flex min-h-[120px] flex-col justify-between rounded-xl border bg-card p-3 transition',
        full ? 'border-destructive/40 bg-destructive/5' : 'hover:border-primary/40 hover:shadow-sm',
      )}
    >
      <div>
        <div className="flex items-center justify-between">
          <div className="font-semibold">№ {room.number}</div>
          {room.includes_meals && <Utensils className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
        {room.section && (
          <div className="truncate text-xs text-muted-foreground">{room.section}</div>
        )}
        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <BedDouble className="h-3 w-3" /> {room.occupied}/{room.capacity}
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full transition-all',
              utilization >= 100 ? 'bg-destructive' : utilization >= 75 ? 'bg-warning' : 'bg-success',
            )}
            style={{ width: `${Math.min(100, utilization)}%` }}
          />
        </div>
      </div>

      <div className="mt-2 space-y-1">
        {room.occupants.slice(0, 2).map((o) => (
          <button
            key={o.id}
            onClick={() => onSelect(o.id)}
            className="block w-full truncate rounded bg-accent/40 px-1.5 py-0.5 text-left text-[11px] hover:bg-accent"
          >
            {o.patient?.full_name ?? '—'}
          </button>
        ))}
        {room.occupants.length > 2 && (
          <div className="text-[10px] text-muted-foreground">+{room.occupants.length - 2} yana</div>
        )}
        {!full && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-full gap-1 text-[10px]"
            onClick={onAdmit}
          >
            <Plus className="h-3 w-3" />
            Qabul
          </Button>
        )}
      </div>
    </div>
  );
}

function StayRow({ stay }: { stay: Stay }) {
  const qc = useQueryClient();
  const [showDischarge, setShowDischarge] = useState(false);
  const [showLedger, setShowLedger] = useState(false);

  const { data: ledger } = useQuery({
    queryKey: ['inp-ledger', stay.patient_id],
    queryFn: () => api.inpatient.ledger(stay.patient_id),
    enabled: showLedger,
  });

  const dischargeMut = useMutation({
    mutationFn: (summary?: string) => api.inpatient.discharge(stay.id, summary),
    onSuccess: () => {
      toast.success('Bemor chiqarildi');
      qc.invalidateQueries({ queryKey: ['inpatient-room-map'] });
      qc.invalidateQueries({ queryKey: ['inpatient-stays'] });
      setShowDischarge(false);
    },
  });

  const days = Math.max(
    1,
    Math.round((Date.now() - new Date(stay.admitted_at).getTime()) / 86_400_000),
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate font-medium">{stay.patient?.full_name ?? '—'}</div>
          {stay.room && (
            <Badge variant="outline" className="text-[10px]">
              № {stay.room.number}
              {stay.bed_no ? ` / ${stay.bed_no}` : ''}
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {days} kun • {new Date(stay.admitted_at).toLocaleDateString()} •{' '}
          {stay.doctor?.full_name ?? 'Shifokor tayinlanmagan'}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => setShowLedger(true)}>
          <Wallet className="h-3.5 w-3.5" />
          Hisob
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1">
          <Activity className="h-3.5 w-3.5" />
          Jadval
        </Button>
        <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setShowDischarge(true)}>
          <LogOut className="h-3.5 w-3.5" />
          Chiqarish
        </Button>
      </div>

      <Dialog open={showDischarge} onOpenChange={setShowDischarge}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Statsionardan chiqarish</DialogTitle>
          </DialogHeader>
          <DischargeForm
            onSubmit={(summary) => dischargeMut.mutate(summary)}
            pending={dischargeMut.isPending}
            onCancel={() => setShowDischarge(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showLedger} onOpenChange={setShowLedger}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{stay.patient?.full_name ?? 'Bemor'} — hisob</DialogTitle>
          </DialogHeader>
          <LedgerPanel
            patientId={stay.patient_id}
            stayId={stay.id}
            balance={ledger?.balance ?? 0}
            entries={(ledger?.entries as LedgerEntry[] | undefined) ?? []}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DischargeForm({
  onSubmit,
  onCancel,
  pending,
}: {
  onSubmit: (summary?: string) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [summary, setSummary] = useState('');
  return (
    <div className="space-y-3">
      <label className="space-y-1 text-sm">
        <div className="text-xs font-medium text-muted-foreground">Chiqarish xulosasi</div>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={5}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        />
      </label>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Bekor
        </Button>
        <Button onClick={() => onSubmit(summary || undefined)} disabled={pending}>
          <CheckCircle2 className="mr-1 h-4 w-4" />
          Tasdiqlash
        </Button>
      </DialogFooter>
    </div>
  );
}

type LedgerEntry = {
  id: string;
  entry_kind: 'deposit' | 'charge' | 'refund' | 'adjustment';
  amount_uzs: number;
  description: string | null;
  created_at: string;
};

function LedgerPanel({
  patientId,
  stayId,
  balance,
  entries,
}: {
  patientId: string;
  stayId: string;
  balance: number;
  entries: LedgerEntry[];
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<'deposit' | 'charge' | 'refund' | 'adjustment'>('deposit');
  const [description, setDescription] = useState('');

  const addMut = useMutation({
    mutationFn: () =>
      api.inpatient.addLedger({
        patient_id: patientId,
        stay_id: stayId,
        entry_kind: kind,
        amount_uzs: Math.abs(Number(amount) || 0),
        description: description || undefined,
      }),
    onSuccess: () => {
      toast.success('Hisobga yozildi');
      setAmount('');
      setDescription('');
      qc.invalidateQueries({ queryKey: ['inp-ledger', patientId] });
    },
  });

  const sign = (kind: string) => (kind === 'charge' ? '-' : '+');

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-muted/30 p-4 text-center">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Joriy qoldiq</div>
        <div
          className={cn(
            'mt-1 text-3xl font-bold tabular-nums',
            balance < 0 ? 'text-destructive' : 'text-success',
          )}
        >
          {balance.toLocaleString()} so&lsquo;m
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={kind} onValueChange={(v: typeof kind) => setKind(v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="deposit">Depozit (+)</SelectItem>
            <SelectItem value="charge">Xarajat (\u2212)</SelectItem>
            <SelectItem value="refund">Qaytarish (+)</SelectItem>
            <SelectItem value="adjustment">Tuzatish</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          placeholder="Miqdor (so'm)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <Input
        placeholder="Izoh (ixtiyoriy)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Button
        className="w-full gap-1"
        onClick={() => addMut.mutate()}
        disabled={!amount || addMut.isPending}
      >
        <CircleDollarSign className="h-4 w-4" />
        Yozish
      </Button>

      <div className="space-y-1 border-t pt-3">
        <div className="text-xs font-semibold text-muted-foreground">Oxirgi yozuvlar</div>
        {entries.length === 0 && (
          <div className="py-4 text-center text-xs text-muted-foreground">Yozuvlar yo&lsquo;q</div>
        )}
        <ul className="max-h-60 divide-y overflow-auto">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-1.5 text-sm">
              <div>
                <div className="text-xs font-medium capitalize">{e.entry_kind}</div>
                {e.description && (
                  <div className="text-[11px] text-muted-foreground">{e.description}</div>
                )}
              </div>
              <div
                className={cn(
                  'font-mono text-sm font-semibold tabular-nums',
                  e.amount_uzs < 0 ? 'text-destructive' : 'text-success',
                )}
              >
                {sign(e.entry_kind)}
                {Math.abs(e.amount_uzs).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type Patient = { id: string; full_name: string };

function AdmitDialog({
  open,
  onClose,
  preferredRoomId,
}: {
  open: boolean;
  onClose: () => void;
  preferredRoomId: string | null;
}) {
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState('');
  const [patientQuery, setPatientQuery] = useState('');
  const [roomId, setRoomId] = useState<string>(preferredRoomId ?? '');
  const [bedNo, setBedNo] = useState('');
  const [doctorId, setDoctorId] = useState<string>('');
  const [admissionReason, setAdmissionReason] = useState('');
  const [deposit, setDeposit] = useState('');

  useMemo(() => {
    if (preferredRoomId) setRoomId(preferredRoomId);
  }, [preferredRoomId]);

  const { data: rooms } = useQuery({
    queryKey: ['rooms-available'],
    queryFn: () => api.catalog.list('rooms', { pageSize: 200 }),
    enabled: open,
  });
  const { data: doctors } = useQuery({
    queryKey: ['doctors-for-admit'],
    queryFn: () => api.doctors.list(),
    enabled: open,
  });
  const { data: patientsRes } = useQuery({
    queryKey: ['patients-search-adm', patientQuery],
    queryFn: () => api.patients.list({ q: patientQuery, pageSize: 10 }),
    enabled: open && patientQuery.length > 1,
  });

  const admitMut = useMutation({
    mutationFn: () =>
      api.inpatient.admit({
        patient_id: patientId,
        room_id: roomId || undefined,
        bed_no: bedNo || undefined,
        attending_doctor_id: doctorId || undefined,
        admission_reason: admissionReason || undefined,
        initial_deposit_uzs: deposit ? Number(deposit) : undefined,
      }),
    onSuccess: () => {
      toast.success('Bemor statsionarga qabul qilindi');
      qc.invalidateQueries({ queryKey: ['inpatient-room-map'] });
      qc.invalidateQueries({ queryKey: ['inpatient-stays'] });
      resetAndClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetAndClose = () => {
    setPatientId('');
    setPatientQuery('');
    setRoomId('');
    setBedNo('');
    setDoctorId('');
    setAdmissionReason('');
    setDeposit('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? resetAndClose() : null)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Statsionarga qabul</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="space-y-1 text-sm">
            <div className="text-xs font-medium text-muted-foreground">Bemorni qidirish</div>
            <Input
              placeholder="Ism familyasi..."
              value={patientQuery}
              onChange={(e) => setPatientQuery(e.target.value)}
            />
            {patientQuery.length > 1 && (
              <div className="max-h-40 overflow-auto rounded-md border">
                {(((patientsRes as { items?: Patient[] })?.items ?? []) as Patient[]).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPatientId(p.id);
                      setPatientQuery(p.full_name);
                    }}
                    className={cn(
                      'block w-full px-3 py-1.5 text-left text-sm hover:bg-accent',
                      p.id === patientId ? 'bg-primary/10 text-primary' : '',
                    )}
                  >
                    {p.full_name}
                  </button>
                ))}
              </div>
            )}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <div className="text-xs font-medium text-muted-foreground">Xona</div>
              <Select value={roomId} onValueChange={setRoomId}>
                <SelectTrigger>
                  <SelectValue placeholder="Tanlang..." />
                </SelectTrigger>
                <SelectContent>
                  {(((rooms as { items?: Array<{ id: string; number: string; section: string | null }> })?.items ?? []) as Array<{
                    id: string;
                    number: string;
                    section: string | null;
                  }>).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      № {r.number}
                      {r.section ? ` • ${r.section}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <div className="text-xs font-medium text-muted-foreground">Yotoq № (ixtiyoriy)</div>
              <Input value={bedNo} onChange={(e) => setBedNo(e.target.value)} />
            </label>
          </div>

          <label className="space-y-1 text-sm">
            <div className="text-xs font-medium text-muted-foreground">Shifokor</div>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder="Tanlang..." />
              </SelectTrigger>
              <SelectContent>
                {(((doctors as Array<{ id: string; full_name: string }>) ?? [])).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="space-y-1 text-sm">
            <div className="text-xs font-medium text-muted-foreground">Qabul sababi</div>
            <textarea
              value={admissionReason}
              onChange={(e) => setAdmissionReason(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
          </label>

          <label className="space-y-1 text-sm">
            <div className="text-xs font-medium text-muted-foreground">Boshlang&lsquo;ich depozit</div>
            <Input
              type="number"
              placeholder="0"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose}>
            <X className="mr-1 h-4 w-4" />
            Bekor
          </Button>
          <Button
            onClick={() => admitMut.mutate()}
            disabled={!patientId || admitMut.isPending}
            className="gap-1"
          >
            <ArrowRightLeft className="h-4 w-4" />
            Qabul qilish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
