import { useEffect, useMemo, useState } from 'react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@clary/ui-web';
import {
  BedDouble,
  CheckCircle2,
  FileText,
  FlaskConical,
  Loader2,
  Microscope,
  PhoneIncoming,
  Pill,
  Plus,
  Send,
  Stethoscope,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';

type QueueRow = {
  id: string;
  ticket_code: string | null;
  ticket_color: string | null;
  status: 'waiting' | 'called' | 'serving' | 'served' | 'left';
  patient_id: string;
  doctor_id: string | null;
  patient?: { id: string; full_name: string; phone?: string } | null;
};

type Medication = { id: string; name: string; unit_price_uzs?: number | null; form?: string | null };
type DiagnosticType = { id: string; name: string; price_uzs: number };
type LabTest = { id: string; name: string; price_uzs: number };
type Room = { id: string; name: string };

type SoapDraft = {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  diagnosis_code: string;
  diagnosis_text: string;
};

const EMPTY_SOAP: SoapDraft = {
  subjective: '',
  objective: '',
  assessment: '',
  plan: '',
  diagnosis_code: '',
  diagnosis_text: '',
};

export function DoctorConsolePage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const doctorId = user?.id ?? null;

  const { data: kanban } = useQuery({
    queryKey: ['doctor-kanban', doctorId],
    queryFn: () => api.queues.kanban(),
    refetchInterval: 15_000,
    enabled: !!doctorId,
  });

  useEffect(() => {
    const ch = supabase
      .channel('doc-queue')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'queues' },
        () => qc.invalidateQueries({ queryKey: ['doctor-kanban'] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const myRows = useMemo(() => {
    if (!kanban || !doctorId) return { waiting: [] as QueueRow[], called: [] as QueueRow[], serving: [] as QueueRow[] };
    const filter = (key: string) =>
      (((kanban.by_status?.[key] ?? []) as QueueRow[]) || []).filter((r) => r.doctor_id === doctorId);
    return {
      waiting: filter('waiting'),
      called: filter('called'),
      serving: filter('serving'),
    };
  }, [kanban, doctorId]);

  const current = myRows.serving[0] ?? myRows.called[0] ?? null;

  const callNextMut = useMutation({
    mutationFn: () => api.queues.callNext(doctorId ?? undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doctor-kanban'] }),
    onError: () => toast.error('Navbatda bemor yo\u2018q'),
  });
  const acceptMut = useMutation({
    mutationFn: (id: string) => api.queues.accept(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doctor-kanban'] }),
  });
  const completeMut = useMutation({
    mutationFn: (id: string) => api.queues.complete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor-kanban'] });
      toast.success('Qabul yakunlandi');
    },
  });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shifokor oynasi</h1>
          <p className="text-sm text-muted-foreground">Sizning navbatingiz va bemor qabuli</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <Stethoscope className="h-3.5 w-3.5" /> {myRows.waiting.length} kutmoqda
          </Badge>
          <Badge variant="default" className="gap-1">
            <PhoneIncoming className="h-3.5 w-3.5" /> {myRows.called.length} chaqirilgan
          </Badge>
          <Button size="sm" onClick={() => callNextMut.mutate()} disabled={callNextMut.isPending || !doctorId}>
            {callNextMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PhoneIncoming className="mr-1 h-4 w-4" />}
            Keyingisini chaqirish
          </Button>
        </div>
      </header>

      {!current ? (
        <EmptyState
          title="Qabul qilinadigan bemor yo'q"
          description="Navbatda bemor paydo bo'lgach, shu yerda ko'rinadi."
        />
      ) : (
        <PatientInConsultation
          row={current}
          onAccept={() => acceptMut.mutate(current.id)}
          onComplete={() => completeMut.mutate(current.id)}
        />
      )}

      {myRows.waiting.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="text-sm font-semibold">Mening navbatim</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
              {myRows.waiting.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border bg-card px-3 py-2 text-sm"
                  style={{ borderLeft: `3px solid ${r.ticket_color ?? '#64748b'}` }}
                >
                  <div className="font-mono font-bold" style={{ color: r.ticket_color ?? '#64748b' }}>
                    {r.ticket_code}
                  </div>
                  <div className="truncate">{r.patient?.full_name ?? '—'}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PatientInConsultation({
  row,
  onAccept,
  onComplete,
}: {
  row: QueueRow;
  onAccept: () => void;
  onComplete: () => void;
}) {
  const qc = useQueryClient();
  const [soap, setSoap] = useState<SoapDraft>(EMPTY_SOAP);
  const [showRx, setShowRx] = useState(false);
  const [showRef, setShowRef] = useState(false);

  const patientId = row.patient_id;

  const { data: prescriptions } = useQuery({
    queryKey: ['pt-rx', patientId],
    queryFn: () => api.prescriptions.list({ patient_id: patientId }),
    enabled: !!patientId,
  });
  const { data: referrals } = useQuery({
    queryKey: ['pt-ref', patientId],
    queryFn: () => api.referrals.list({ patient_id: patientId }),
    enabled: !!patientId,
  });

  return (
    <>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-1"
          style={{ borderLeft: `4px solid ${row.ticket_color ?? '#2563eb'}` }}
        >
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start justify-between">
              <div>
                <div
                  className="font-mono text-3xl font-black"
                  style={{ color: row.ticket_color ?? '#2563eb' }}
                >
                  {row.ticket_code ?? '—'}
                </div>
                <div className="mt-1 text-lg font-semibold">{row.patient?.full_name ?? '—'}</div>
                {row.patient?.phone && (
                  <div className="text-sm text-muted-foreground">{row.patient.phone}</div>
                )}
              </div>
              <Badge
                variant={row.status === 'serving' ? 'default' : 'secondary'}
                className="capitalize"
              >
                {row.status}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {row.status === 'called' && (
                <Button size="sm" className="gap-1" onClick={onAccept}>
                  <UserCheck className="h-3.5 w-3.5" /> Qabul qilish
                </Button>
              )}
              {row.status === 'serving' && (
                <Button size="sm" className="gap-1" onClick={onComplete}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Qabulni yakunlash
                </Button>
              )}
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowRx(true)}>
                <Pill className="h-3.5 w-3.5" /> Retsept
              </Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowRef(true)}>
                <FileText className="h-3.5 w-3.5" /> Yo&lsquo;llanma
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">SOAP yozuvi</div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  toast.info('SOAP yozuvini saqlash (backend integratsiya keyingi bosqichda)');
                  qc.invalidateQueries({ queryKey: ['pt-rx', patientId] });
                }}
              >
                Saqlash
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Field label="Subjektiv (S)" value={soap.subjective} onChange={(v) => setSoap({ ...soap, subjective: v })} />
              <Field label="Obyektiv (O)" value={soap.objective} onChange={(v) => setSoap({ ...soap, objective: v })} />
              <Field
                label="Baho / Tashxis (A)"
                value={soap.assessment}
                onChange={(v) => setSoap({ ...soap, assessment: v })}
              />
              <Field label="Reja (P)" value={soap.plan} onChange={(v) => setSoap({ ...soap, plan: v })} />
              <Field
                label="ICD-10"
                value={soap.diagnosis_code}
                onChange={(v) => setSoap({ ...soap, diagnosis_code: v })}
                rows={1}
              />
              <Field
                label="Tashxis matni"
                value={soap.diagnosis_text}
                onChange={(v) => setSoap({ ...soap, diagnosis_text: v })}
                rows={1}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Retseptlar</div>
              <Button size="sm" variant="outline" onClick={() => setShowRx(true)} className="gap-1">
                <Plus className="h-3.5 w-3.5" /> Yangi retsept
              </Button>
            </div>
            <RxList items={(prescriptions as unknown[]) ?? []} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Yo&lsquo;llanmalar</div>
              <Button size="sm" variant="outline" onClick={() => setShowRef(true)} className="gap-1">
                <Plus className="h-3.5 w-3.5" /> Yangi yo&lsquo;llanma
              </Button>
            </div>
            <RefList items={(referrals as unknown[]) ?? []} />
          </CardContent>
        </Card>
      </div>

      <PrescriptionComposer open={showRx} onClose={() => setShowRx(false)} patientId={patientId} />
      <ReferralComposer open={showRef} onClose={() => setShowRef(false)} patientId={patientId} />
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <label className="space-y-1 text-sm">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}

function RxList({ items }: { items: unknown[] }) {
  if (!items || items.length === 0)
    return <div className="py-6 text-center text-xs text-muted-foreground">Retsept yo&lsquo;q</div>;
  const typed = items as Array<{
    id: string;
    rx_number?: string;
    status: string;
    total_estimated_uzs: number;
    created_at: string;
    items?: Array<{ medication_name_snapshot: string; quantity: number }>;
  }>;
  return (
    <ul className="divide-y">
      {typed.slice(0, 5).map((rx) => (
        <li key={rx.id} className="py-2 text-sm">
          <div className="flex items-center justify-between">
            <div className="font-mono text-xs">{rx.rx_number ?? rx.id.slice(0, 8)}</div>
            <Badge variant={rx.status === 'dispensed' ? 'default' : 'secondary'} className="text-[10px]">
              {rx.status}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {(rx.items ?? []).map((it) => `${it.medication_name_snapshot} ×${it.quantity}`).join(', ')}
          </div>
        </li>
      ))}
    </ul>
  );
}

function RefList({ items }: { items: unknown[] }) {
  if (!items || items.length === 0)
    return <div className="py-6 text-center text-xs text-muted-foreground">Yo&lsquo;llanma yo&lsquo;q</div>;
  const typed = items as Array<{
    id: string;
    referral_kind: string;
    status: string;
    urgency: string;
    created_at: string;
    diagnostic?: { name: string } | null;
    lab?: { name: string } | null;
    service?: { name: string } | null;
  }>;
  const iconFor = (k: string) => {
    if (k === 'diagnostic') return Microscope;
    if (k === 'lab') return FlaskConical;
    if (k === 'inpatient') return BedDouble;
    return Stethoscope;
  };
  return (
    <ul className="divide-y">
      {typed.slice(0, 5).map((r) => {
        const Icon = iconFor(r.referral_kind);
        const title = r.diagnostic?.name ?? r.lab?.name ?? r.service?.name ?? r.referral_kind;
        return (
          <li key={r.id} className="flex items-start justify-between gap-3 py-2">
            <div className="flex items-start gap-2">
              <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-sm">{title}</div>
                <div className="text-[11px] text-muted-foreground">
                  {r.urgency} • {new Date(r.created_at).toLocaleString()}
                </div>
              </div>
            </div>
            <Badge variant={r.status === 'completed' ? 'default' : 'secondary'} className="text-[10px]">
              {r.status}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

function PrescriptionComposer({
  open,
  onClose,
  patientId,
}: {
  open: boolean;
  onClose: () => void;
  patientId: string;
}) {
  const qc = useQueryClient();
  const [items, setItems] = useState<
    Array<{
      medication_id?: string;
      medication_name_snapshot: string;
      dosage: string;
      frequency: string;
      duration: string;
      quantity: number;
      unit_price_snapshot?: number;
    }>
  >([]);
  const [diagnosisCode, setDiagnosisCode] = useState('');
  const [diagnosisText, setDiagnosisText] = useState('');
  const [instructions, setInstructions] = useState('');
  const [medQuery, setMedQuery] = useState('');

  const { data: meds } = useQuery({
    queryKey: ['meds-search', medQuery],
    queryFn: () => api.catalog.list('medications', { q: medQuery, page: 1, pageSize: 20 }),
    enabled: medQuery.length > 0,
  });

  const addItem = (m: Medication) => {
    setItems((prev) => [
      ...prev,
      {
        medication_id: m.id,
        medication_name_snapshot: m.name,
        dosage: '',
        frequency: '',
        duration: '',
        quantity: 1,
        unit_price_snapshot: m.unit_price_uzs ?? 0,
      },
    ]);
    setMedQuery('');
  };

  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const updateItem = (i: number, patch: Partial<(typeof items)[number]>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const createMut = useMutation({
    mutationFn: () =>
      api.prescriptions.create({
        patient_id: patientId,
        diagnosis_code: diagnosisCode || undefined,
        diagnosis_text: diagnosisText || undefined,
        instructions: instructions || undefined,
        sign: true,
        items: items.map((it) => ({
          medication_id: it.medication_id,
          medication_name_snapshot: it.medication_name_snapshot,
          dosage: it.dosage || undefined,
          frequency: it.frequency || undefined,
          duration: it.duration || undefined,
          quantity: it.quantity,
          unit_price_snapshot: it.unit_price_snapshot,
        })),
      }),
    onSuccess: () => {
      toast.success('Retsept yaratildi');
      qc.invalidateQueries({ queryKey: ['pt-rx', patientId] });
      onClose();
      setItems([]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Yangi retsept</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">ICD-10</div>
              <Input value={diagnosisCode} onChange={(e) => setDiagnosisCode(e.target.value)} />
            </label>
            <label className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Tashxis matni</div>
              <Input value={diagnosisText} onChange={(e) => setDiagnosisText(e.target.value)} />
            </label>
          </div>

          <div className="relative">
            <Input
              placeholder="Dori qidirish..."
              value={medQuery}
              onChange={(e) => setMedQuery(e.target.value)}
            />
            {medQuery.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-lg">
                {((meds as { items?: Medication[] })?.items ?? []).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => addItem(m)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span>{m.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {m.unit_price_uzs ? `${m.unit_price_uzs.toLocaleString()} so\u2018m` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            {items.length === 0 && (
              <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                Dori qidirip qo&lsquo;shing
              </div>
            )}
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2 rounded-lg border p-2">
                <div className="col-span-3 text-sm font-medium">{it.medication_name_snapshot}</div>
                <Input
                  className="col-span-2"
                  placeholder="Doza"
                  value={it.dosage}
                  onChange={(e) => updateItem(i, { dosage: e.target.value })}
                />
                <Input
                  className="col-span-2"
                  placeholder="Chastota"
                  value={it.frequency}
                  onChange={(e) => updateItem(i, { frequency: e.target.value })}
                />
                <Input
                  className="col-span-2"
                  placeholder="Muddat"
                  value={it.duration}
                  onChange={(e) => updateItem(i, { duration: e.target.value })}
                />
                <Input
                  className="col-span-2"
                  type="number"
                  min={1}
                  value={it.quantity}
                  onChange={(e) => updateItem(i, { quantity: Math.max(1, Number(e.target.value)) })}
                />
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  className="col-span-1 flex items-center justify-center text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <label className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Ko&lsquo;rsatma</div>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <X className="mr-1 h-4 w-4" /> Bekor
          </Button>
          <Button
            onClick={() => createMut.mutate()}
            disabled={items.length === 0 || createMut.isPending}
            className="gap-1"
          >
            {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Yaratish & imzolash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReferralComposer({
  open,
  onClose,
  patientId,
}: {
  open: boolean;
  onClose: () => void;
  patientId: string;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'diagnostic' | 'lab' | 'service' | 'inpatient'>('diagnostic');
  const [urgency, setUrgency] = useState<'routine' | 'urgent' | 'stat'>('routine');
  const [targetId, setTargetId] = useState<string>('');
  const [indication, setIndication] = useState('');

  const { data: diagnostics } = useQuery({
    queryKey: ['diag-types'],
    queryFn: () => api.catalog.list('diagnostic_types', { pageSize: 100 }),
    enabled: kind === 'diagnostic',
  });
  const { data: labTests } = useQuery({
    queryKey: ['lab-tests-list'],
    queryFn: () => api.catalog.list('lab_tests', { pageSize: 100 }),
    enabled: kind === 'lab',
  });
  const { data: rooms } = useQuery({
    queryKey: ['rooms-list'],
    queryFn: () => api.catalog.list('rooms', { pageSize: 100 }),
    enabled: kind === 'inpatient',
  });
  const { data: services } = useQuery({
    queryKey: ['services-list-refs'],
    queryFn: () => api.catalog.list('services', { pageSize: 100 }),
    enabled: kind === 'service',
  });

  const options: Array<{ id: string; label: string }> = useMemo(() => {
    if (kind === 'diagnostic')
      return (((diagnostics as { items?: DiagnosticType[] })?.items ?? []) as DiagnosticType[]).map((x) => ({
        id: x.id,
        label: x.name,
      }));
    if (kind === 'lab')
      return (((labTests as { items?: LabTest[] })?.items ?? []) as LabTest[]).map((x) => ({
        id: x.id,
        label: x.name,
      }));
    if (kind === 'inpatient')
      return (((rooms as { items?: Room[] })?.items ?? []) as Room[]).map((x) => ({
        id: x.id,
        label: x.name,
      }));
    return (((services as { items?: Array<{ id: string; name: string }> })?.items ?? []) as Array<{
      id: string;
      name: string;
    }>).map((x) => ({ id: x.id, label: x.name }));
  }, [kind, diagnostics, labTests, rooms, services]);

  const createMut = useMutation({
    mutationFn: () =>
      api.referrals.create({
        patient_id: patientId,
        referral_kind: kind,
        target_diagnostic_type_id: kind === 'diagnostic' ? targetId : undefined,
        target_lab_test_id: kind === 'lab' ? targetId : undefined,
        target_service_id: kind === 'service' ? targetId : undefined,
        target_room_id: kind === 'inpatient' ? targetId : undefined,
        urgency,
        clinical_indication: indication || undefined,
      }),
    onSuccess: () => {
      toast.success('Yo\u2018llanma yaratildi');
      qc.invalidateQueries({ queryKey: ['pt-ref', patientId] });
      onClose();
      setTargetId('');
      setIndication('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const kinds: Array<{ value: typeof kind; label: string; icon: typeof Microscope }> = [
    { value: 'diagnostic', label: 'Diagnostika', icon: Microscope },
    { value: 'lab', label: 'Laboratoriya', icon: FlaskConical },
    { value: 'service', label: 'Xizmat', icon: Stethoscope },
    { value: 'inpatient', label: 'Statsionar', icon: BedDouble },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yangi yo&lsquo;llanma</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {kinds.map((k) => {
              const Icon = k.icon;
              return (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => {
                    setKind(k.value);
                    setTargetId('');
                  }}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium transition',
                    kind === k.value ? 'border-primary bg-primary/10' : 'hover:bg-accent',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {k.label}
                </button>
              );
            })}
          </div>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger>
              <SelectValue placeholder="Tanlang..." />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={urgency} onValueChange={(v: 'routine' | 'urgent' | 'stat') => setUrgency(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="routine">Oddiy</SelectItem>
              <SelectItem value="urgent">Shoshilinch</SelectItem>
              <SelectItem value="stat">STAT</SelectItem>
            </SelectContent>
          </Select>
          <textarea
            placeholder="Klinik asos..."
            value={indication}
            onChange={(e) => setIndication(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => createMut.mutate()} disabled={!targetId || createMut.isPending}>
            {createMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Yaratish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
