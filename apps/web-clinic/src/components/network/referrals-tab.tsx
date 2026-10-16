import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Search, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Badge, Button, Card, CardContent, Input, Textarea } from '@clary/ui-web';
import type { NetworkBranch, NetworkReferral } from '@clary/api-client';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { fmt, nameOf } from './shared';

const CAN_SEND = new Set(['clinic_owner', 'clinic_admin', 'doctor', 'receptionist', 'nurse']);
const STATUS: Record<string, string> = {
  pending: 'Kutilmoqda',
  received: 'Qabul qilindi',
  billed: "To'landi",
  completed: 'Bajarildi',
  canceled: 'Bekor',
};

type PatientHit = { id: string; full_name: string; phone: string | null };

/** Bemorni boshqa filialga yo'llash — u o'sha filial qabulxonasiga tushadi */
export function ReferralsTab({
  branches,
  activeClinicId,
}: {
  branches: NetworkBranch[];
  activeClinicId: string;
}) {
  const { role } = useAuth();
  const qc = useQueryClient();
  const others = branches.filter((b) => b.id !== activeClinicId);
  const [target, setTarget] = useState(others[0]?.id ?? '');
  const [q, setQ] = useState('');
  const [patient, setPatient] = useState<PatientHit | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [urgency, setUrgency] = useState<'routine' | 'urgent' | 'stat'>('routine');
  const [notes, setNotes] = useState('');

  const { data: hits = [] } = useQuery({
    queryKey: ['ref-patient-search', q],
    queryFn: async () => (await api.patients.list({ q, pageSize: 10 })).items as PatientHit[],
    enabled: q.trim().length >= 2 && !patient,
  });
  const { data: services = [] } = useQuery({
    queryKey: ['branch-services', target],
    queryFn: () => api.company.branchServices(target),
    enabled: !!target,
  });
  const { data: lists } = useQuery({
    queryKey: ['company-referrals'],
    queryFn: () => api.company.referrals(),
  });
  const create = useMutation({
    mutationFn: () =>
      api.company.createReferral({
        target_clinic_id: target,
        patient_id: patient!.id,
        target_service_id: serviceId || undefined,
        urgency,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast.success("Yo'llanma yuborildi — filial qabulxonasida ko'rinadi");
      setPatient(null);
      setQ('');
      setServiceId('');
      setNotes('');
      void qc.invalidateQueries({ queryKey: ['company-referrals'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? '—';

  return (
    <div className="space-y-4">
      {CAN_SEND.has(role) && others.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 font-semibold">
              <Send className="h-4 w-4" /> Boshqa filialga yo'llanma
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <span className="text-muted-foreground text-xs">Bemor</span>
                {patient ? (
                  <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span>
                      {patient.full_name}
                      {patient.phone && (
                        <span className="text-muted-foreground"> · {patient.phone}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="text-xs underline"
                      onClick={() => setPatient(null)}
                    >
                      o'zgartirish
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="text-muted-foreground absolute left-2 top-2.5 h-4 w-4" />
                    <Input
                      placeholder="Familiya, ism yoki telefon"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      className="pl-8"
                    />
                    {q.trim().length >= 2 && hits.length > 0 && (
                      <div className="bg-popover absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border shadow">
                        {hits.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setPatient(p)}
                            className="hover:bg-muted block w-full px-3 py-1.5 text-left text-sm"
                          >
                            {p.full_name}
                            {p.phone && <span className="text-muted-foreground"> · {p.phone}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground text-xs">Qaysi filialga</span>
                <select
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setServiceId('');
                  }}
                  className="bg-background h-9 w-full rounded-md border px-2 text-sm"
                >
                  {others.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.is_hq ? ' (HQ)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground text-xs">Xizmat (ixtiyoriy)</span>
                <select
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                  className="bg-background h-9 w-full rounded-md border px-2 text-sm"
                >
                  <option value="">— umumiy yo'llanma —</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {nameOf(s.name_i18n)} · {fmt(s.price_uzs)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground text-xs">Shoshilinchlik</span>
                <select
                  value={urgency}
                  onChange={(e) => setUrgency(e.target.value as 'routine' | 'urgent' | 'stat')}
                  className="bg-background h-9 w-full rounded-md border px-2 text-sm"
                >
                  <option value="routine">Odatiy</option>
                  <option value="urgent">Shoshilinch</option>
                  <option value="stat">Zudlik bilan</option>
                </select>
              </label>
            </div>
            <Textarea
              placeholder="Izoh / tashxis (ixtiyoriy)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
            <Button
              disabled={!patient || !target || create.isPending}
              onClick={() => create.mutate()}
            >
              <Send className="mr-1 h-4 w-4" /> Yuborish
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ReferralList
          title="Kelgan yo'llanmalar"
          icon={<ArrowDownLeft className="h-4 w-4 text-emerald-600" />}
          rows={lists?.incoming ?? []}
          branchLabel={(r) => `${branchName(r.source_clinic_id)} filialidan`}
        />
        <ReferralList
          title="Yuborilgan yo'llanmalar"
          icon={<ArrowUpRight className="h-4 w-4 text-sky-600" />}
          rows={lists?.outgoing ?? []}
          branchLabel={(r) => `→ ${branchName(r.clinic_id)}`}
        />
      </div>
    </div>
  );
}

function ReferralList({
  title,
  icon,
  rows,
  branchLabel,
}: {
  title: string;
  icon: ReactNode;
  rows: NetworkReferral[];
  branchLabel: (r: NetworkReferral) => string;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-2 font-semibold">
          {icon} {title}
        </div>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Hozircha yo'q.</p>
        ) : (
          <div className="divide-y">
            {rows.map((r) => (
              <div key={r.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.patient?.full_name ?? '—'}</span>
                  <Badge variant={r.status === 'pending' ? 'warning' : 'secondary'}>
                    {STATUS[r.status] ?? r.status}
                  </Badge>
                  {r.urgency !== 'routine' && <Badge variant="destructive">shoshilinch</Badge>}
                </div>
                <div className="text-muted-foreground text-xs">
                  {branchLabel(r)} · {r.service ? nameOf(r.service.name_i18n) : 'umumiy'} ·{' '}
                  {r.doctor?.full_name ?? ''} · {new Date(r.created_at).toLocaleString('uz-UZ')}
                </div>
                {r.notes && <div className="mt-0.5 text-xs">{r.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
