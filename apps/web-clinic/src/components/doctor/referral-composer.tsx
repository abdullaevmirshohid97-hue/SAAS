import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@clary/ui-web';
import { BedDouble, FlaskConical, Loader2, Microscope, Stethoscope } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

// Bu komponent doctor-console.tsx dan ko'chirildi. O'sha sahifa hech qayerdan
// ochilmasdi (router'da bor, lekin havola yo'q edi) — ya'ni ishlaydigan retsept
// va yo'llanma funksiyasi 1130 qator ichida ko'milib yotgan edi. Endi jonli
// /doctor sahifasidan chaqiriladi. Mantiq o'zgarmadi, faqat joyi.

type DiagnosticType = { id: string; name: string; price_uzs: number };
type LabTest = { id: string; name: string; price_uzs: number };
type Room = { id: string; name: string };

export function ReferralComposer({
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

  const options = useMemo(() => {
    if (kind === 'diagnostic')
      return (((diagnostics as { items?: DiagnosticType[] })?.items ?? []) as DiagnosticType[]).map(
        (x) => ({ id: x.id, label: x.name }),
      );
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
    return (
      ((services as { items?: Array<{ id: string; name: string }> })?.items ?? []) as Array<{
        id: string;
        name: string;
      }>
    ).map((x) => ({ id: x.id, label: x.name }));
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
      toast.success('Yo‘llanma yaratildi');
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
          <Select
            value={urgency}
            onValueChange={(v: 'routine' | 'urgent' | 'stat') => setUrgency(v)}
          >
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
            className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm"
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

// ── Specialist inbox: target_doctor_id = me ──────────────────────────────
