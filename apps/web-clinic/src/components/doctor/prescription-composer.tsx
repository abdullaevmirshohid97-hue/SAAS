import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@clary/ui-web';
import { Loader2, Plus, Printer, Send, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import type { BlankSettings, ClinicInfo, PatientInfo } from '@/lib/a4-blank';
import { printPrescription } from '@/lib/prescription-print';

// Bu komponent doctor-console.tsx dan ko'chirildi. O'sha sahifa hech qayerdan
// ochilmasdi (router'da bor, lekin havola yo'q edi) — ya'ni ishlaydigan retsept
// va yo'llanma funksiyasi 1130 qator ichida ko'milib yotgan edi. Endi jonli
// /doctor sahifasidan chaqiriladi. Mantiq o'zgarmadi, faqat joyi.

const SLOT_PRESETS = ['06:00', '09:00', '12:00', '15:00', '18:00', '21:00'];

type Medication = {
  id: string;
  name: string;
  unit_price_uzs?: number | null;
  form?: string | null;
};

export function PrescriptionComposer({
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
      schedule_times: string[];
      days_count: number;
      assigned_nurse_id?: string;
    }>
  >([]);
  const [diagnosisCode, setDiagnosisCode] = useState('');
  const [diagnosisText, setDiagnosisText] = useState('');
  const [instructions, setInstructions] = useState('');
  const [medQuery, setMedQuery] = useState('');
  const [dispenseAtPharmacy, setDispenseAtPharmacy] = useState(false);

  const { data: meds } = useQuery({
    queryKey: ['meds-search', medQuery],
    queryFn: () => api.catalog.list('medications', { q: medQuery, page: 1, pageSize: 20 }),
    enabled: medQuery.length > 0,
  });

  // Blanka uchun: klinika rekvizitlari + sozlama, va bemor ma'lumoti.
  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      api.get<{
        clinic?: ClinicInfo & { document_settings?: BlankSettings };
        full_name?: string;
      }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });

  const { data: patient } = useQuery({
    queryKey: ['rx-patient', patientId],
    queryFn: () => api.get<PatientInfo>(`/api/v1/patients/${patientId}`),
    enabled: open && !!patientId,
    staleTime: 60_000,
  });

  const { data: nursesRaw } = useQuery({
    queryKey: ['rx-composer-nurses'],
    queryFn: () => api.staff.list(),
  });
  const nurses = (
    (nursesRaw as Array<{ id: string; full_name: string; role: string }> | undefined) ?? []
  ).filter((s) => s.role === 'nurse');

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
        schedule_times: [],
        days_count: 1,
      },
    ]);
    setMedQuery('');
  };
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const updateItem = (i: number, patch: Partial<(typeof items)[number]>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const toggleSlot = (i: number, slot: string) =>
    setItems((prev) =>
      prev.map((it, idx) => {
        if (idx !== i) return it;
        const has = it.schedule_times.includes(slot);
        return {
          ...it,
          schedule_times: has
            ? it.schedule_times.filter((s) => s !== slot)
            : [...it.schedule_times, slot].sort(),
        };
      }),
    );

  const createMut = useMutation({
    mutationFn: () =>
      api.prescriptions.create({
        patient_id: patientId,
        diagnosis_code: diagnosisCode || undefined,
        diagnosis_text: diagnosisText || undefined,
        instructions: instructions || undefined,
        sign: true,
        dispense_at_pharmacy: dispenseAtPharmacy,
        items: items.map((it) => ({
          medication_id: it.medication_id,
          medication_name_snapshot: it.medication_name_snapshot,
          dosage: it.dosage || undefined,
          frequency: it.frequency || undefined,
          duration: it.duration || undefined,
          quantity: it.quantity,
          unit_price_snapshot: it.unit_price_snapshot,
          schedule_times:
            it.schedule_times.length > 0 ? it.schedule_times.map((time) => ({ time })) : undefined,
          days_count: it.schedule_times.length > 0 ? it.days_count : undefined,
          assigned_nurse_id: it.assigned_nurse_id || undefined,
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
              <div className="text-muted-foreground text-xs font-medium">ICD-10</div>
              <Input value={diagnosisCode} onChange={(e) => setDiagnosisCode(e.target.value)} />
            </label>
            <label className="space-y-1">
              <div className="text-muted-foreground text-xs font-medium">Tashxis matni</div>
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
              <div className="bg-popover absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border shadow-lg">
                {((meds as { items?: Medication[] })?.items ?? []).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => addItem(m)}
                    className="hover:bg-accent flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                  >
                    <span>{m.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {m.unit_price_uzs ? `${m.unit_price_uzs.toLocaleString()} so‘m` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            {items.length === 0 && (
              <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
                Dori qidirip qo&lsquo;shing
              </div>
            )}
            {items.map((it, i) => (
              <div key={i} className="space-y-2 rounded-lg border p-2">
                <div className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-3 text-sm font-medium">
                    {it.medication_name_snapshot}
                  </div>
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
                    onChange={(e) =>
                      updateItem(i, { quantity: Math.max(1, Number(e.target.value)) })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="text-muted-foreground hover:text-destructive col-span-1 flex items-center justify-center"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                  <span className="text-muted-foreground text-xs font-medium">Vaqtlar:</span>
                  {SLOT_PRESETS.map((slot) => {
                    const active = it.schedule_times.includes(slot);
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => toggleSlot(i, slot)}
                        className={cn(
                          'rounded-full border px-2.5 py-0.5 font-mono text-xs transition',
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'hover:bg-accent',
                        )}
                      >
                        {slot}
                      </button>
                    );
                  })}
                  {it.schedule_times.length > 0 && (
                    <>
                      <span className="text-muted-foreground ml-2 text-xs font-medium">×</span>
                      <Input
                        className="h-7 w-16"
                        type="number"
                        min={1}
                        value={it.days_count}
                        onChange={(e) =>
                          updateItem(i, { days_count: Math.max(1, Number(e.target.value)) })
                        }
                      />
                      <span className="text-muted-foreground text-xs">kun</span>
                      <span className="text-muted-foreground ml-2 text-xs">
                        ⇒ {it.schedule_times.length * it.days_count} hamshira vazifasi
                      </span>
                      <select
                        className="bg-background ml-auto h-7 rounded-md border px-2 text-xs"
                        value={it.assigned_nurse_id ?? ''}
                        onChange={(e) =>
                          updateItem(i, { assigned_nurse_id: e.target.value || undefined })
                        }
                      >
                        <option value="">Hamshira: avto</option>
                        {nurses.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.full_name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <label className="space-y-1">
            <div className="text-muted-foreground text-xs font-medium">Ko&lsquo;rsatma</div>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dispenseAtPharmacy}
              onChange={(e) => setDispenseAtPharmacy(e.target.checked)}
              className="border-input h-4 w-4 rounded"
            />
            <span>Apteka&apos;da berilsin (apteka oynasiga avto-tushadi)</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <X className="mr-1 h-4 w-4" /> Bekor
          </Button>
          {/* Chop etish klinika blankasida — Sozlamalar > Blanka sozlamasi
              bilan (logotip, rekvizit, muhr). Saqlashdan oldin ham ishlaydi. */}
          <Button
            variant="outline"
            disabled={items.length === 0}
            onClick={() =>
              printPrescription(
                {
                  diagnosis_code: diagnosisCode || null,
                  diagnosis_text: diagnosisText || null,
                  instructions: instructions || null,
                  items,
                },
                {
                  clinic: me?.clinic ?? {},
                  settings: me?.clinic?.document_settings,
                  doctorName: me?.full_name ?? null,
                  patient: patient ?? undefined,
                },
              )
            }
          >
            <Printer className="mr-1 h-4 w-4" /> Chop etish
          </Button>
          <Button
            onClick={() => createMut.mutate()}
            disabled={items.length === 0 || createMut.isPending}
            className="gap-1"
          >
            {createMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Yaratish & imzolash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
