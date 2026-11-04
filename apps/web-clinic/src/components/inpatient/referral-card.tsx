import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from '@clary/ui-web';
import type { ReferralMoney, StayReferral, StayReferralPerson } from '@clary/api-client';
import { Handshake, Pencil, Phone } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { ReferralFields, referralError, type ReferralValue } from './referral-fields';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

// =============================================================================
// Statsionar bemor sahifasi — "Yo'llanma" kartasi: kim yo'llagan (shifokor,
// agent), foiz va (faqat admin) hisoblangan / to'langan ulush. Admin o'zgartiradi.
// =============================================================================
export function StayReferralCard({ stayId }: { stayId: string }) {
  const [editing, setEditing] = useState(false);
  const { data } = useQuery({
    queryKey: ['stay-referral', stayId],
    queryFn: () => api.inpatient.stayReferral(stayId),
    // Migratsiya hali qo'llanmagan bo'lsa karta shunchaki ko'rinmaydi.
    retry: false,
  });

  if (!data) return null;
  if (data.admission_channel === 'self' && !data.can_edit) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Handshake className="h-4 w-4" /> Yo‘llanma
        </CardTitle>
        {data.can_edit && (
          <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
            {data.admission_channel === 'self' ? 'Belgilash' : 'O‘zgartirish'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {data.admission_channel === 'self' ? (
          <div className="text-muted-foreground text-xs">O‘zi kelgan bemor</div>
        ) : (
          <>
            <PersonBlock
              title="Yo‘llagan shifokor"
              person={data.doctor}
              money={data.totals?.doctor}
            />
            <PersonBlock title="Agent" person={data.agent} money={data.totals?.agent} />
          </>
        )}
      </CardContent>
      {editing && (
        <EditReferralDialog stayId={stayId} current={data} onClose={() => setEditing(false)} />
      )}
    </Card>
  );
}

function PersonBlock({
  title,
  person,
  money,
}: {
  title: string;
  person: StayReferralPerson | null;
  money?: ReferralMoney;
}) {
  if (!person) return null;
  const phones = [person.phone, person.phone2].filter(Boolean).join(', ');
  return (
    <div className="space-y-1 rounded-md border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-muted-foreground text-[10px] uppercase">{title}</div>
        <Badge variant="secondary" className="text-[10px]">
          {person.percent}%
        </Badge>
      </div>
      <div className="font-medium">
        {person.name}
        {person.is_archived && (
          <span className="text-muted-foreground ml-1 text-xs">(arxivda)</span>
        )}
      </div>
      {(person.specialty || person.workplace) && (
        <div className="text-muted-foreground text-xs">
          {[person.specialty, person.workplace].filter(Boolean).join(' · ')}
        </div>
      )}
      {phones && (
        <div className="text-muted-foreground flex items-center gap-1 text-xs">
          <Phone className="h-3 w-3" /> {phones}
        </div>
      )}
      {money && (
        <div className="grid grid-cols-3 gap-1 border-t pt-1.5 text-center text-[11px]">
          <div>
            <div className="text-muted-foreground">Hisoblangan</div>
            <div className="font-semibold">{fmt(money.accrued_uzs)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">To‘langan</div>
            <div className="font-semibold text-emerald-700">{fmt(money.paid_uzs)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Qoldiq</div>
            <div className="font-semibold text-amber-700">{fmt(money.unpaid_uzs)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditReferralDialog({
  stayId,
  current,
  onClose,
}: {
  stayId: string;
  current: StayReferral;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState<ReferralValue>({
    channel: current.admission_channel,
    doctorId: current.doctor?.id ?? null,
    agentId: current.agent?.id ?? null,
  });
  // Bo'sh qoldirilsa: sherik o'zgarmagan — shu bemordagi foiz, yangi sherik —
  // kartadagi foiz (server hal qiladi).
  const [doctorPct, setDoctorPct] = useState(current.doctor ? String(current.doctor.percent) : '');
  const [agentPct, setAgentPct] = useState(current.agent ? String(current.agent.percent) : '');

  const onChange = (v: ReferralValue) => {
    if (v.doctorId !== value.doctorId) setDoctorPct('');
    if (v.agentId !== value.agentId) setAgentPct('');
    setValue(v);
  };

  const pct = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const doctorNum = pct(doctorPct);
  const agentNum = pct(agentPct);
  const pctInvalid = [doctorNum, agentNum].some(
    (n) => n !== undefined && (Number.isNaN(n) || n < 0 || n > 100),
  );

  const saveMut = useMutation({
    mutationFn: () =>
      api.inpatient.updateStayReferral(stayId, {
        admission_channel: value.channel,
        referring_doctor_id: value.doctorId,
        agent_id: value.agentId,
        referring_doctor_percent: value.doctorId ? doctorNum : undefined,
        agent_percent: value.agentId ? agentNum : undefined,
      }),
    onSuccess: (r) => {
      qc.setQueryData(['stay-referral', stayId], r);
      qc.invalidateQueries({ queryKey: ['inpatient-stays'] });
      qc.invalidateQueries({ queryKey: ['referral-summary'] });
      qc.invalidateQueries({ queryKey: ['referral-detail'] });
      toast.success('Yo‘llanma saqlandi');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const err = referralError(value);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Yo‘llanma (shifokor taklifi / agent)</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <ReferralFields value={value} onChange={onChange} hint={false} />
          {value.channel === 'referral' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {value.doctorId ? (
                <PercentInput
                  label="Shifokor foizi (shu bemor)"
                  value={doctorPct}
                  onChange={setDoctorPct}
                />
              ) : (
                <div />
              )}
              {value.agentId && (
                <PercentInput
                  label="Agent foizi (shu bemor)"
                  value={agentPct}
                  onChange={setAgentPct}
                />
              )}
            </div>
          )}
          <div className="text-muted-foreground rounded-md bg-amber-50 p-2 text-[11px] text-amber-900">
            Saqlanganda shu bemorning <b>to‘lanmagan</b> ulushi yangi ma‘lumot bilan qayta
            hisoblanadi. To‘lab bo‘lingan kunlar o‘zgarmaydi.
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button
            disabled={!!err || pctInvalid || saveMut.isPending}
            onClick={() => saveMut.mutate()}
          >
            {saveMut.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PercentInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="space-y-1 text-sm">
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      <Input
        type="number"
        min={0}
        max={100}
        step={0.5}
        placeholder="Kartadagi foiz"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
