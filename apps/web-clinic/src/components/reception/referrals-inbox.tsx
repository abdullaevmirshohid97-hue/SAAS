import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent } from '@clary/ui-web';
import { BedDouble, FlaskConical, Microscope, Receipt, Stethoscope } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

const ICONS = {
  diagnostic: Microscope,
  lab: FlaskConical,
  inpatient: BedDouble,
  service: Stethoscope,
  other: Stethoscope,
};

type ReferralRow = {
  id: string;
  patient_id: string;
  referral_kind: 'diagnostic' | 'lab' | 'service' | 'inpatient' | 'other';
  urgency: 'routine' | 'urgent' | 'stat';
  status: 'pending' | 'received' | 'billed' | 'completed' | 'canceled';
  clinical_indication: string | null;
  created_at: string;
  patient?: { id: string; full_name: string; phone?: string } | null;
  doctor?: { id: string; full_name: string } | null;
  service?: { id: string; name: string; price_uzs?: number } | null;
  diagnostic?: { id: string; name: string; price_uzs?: number } | null;
  lab?: { id: string; name: string; price_uzs?: number } | null;
};

export function ReferralsInbox({
  onDirect,
}: {
  onDirect: (ref: ReferralRow) => void;
}) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['reception-referrals', 'pending'],
    queryFn: () => api.referrals.list({ status: 'pending' }),
    refetchInterval: 30_000,
  });

  const receiveMut = useMutation({
    mutationFn: (id: string) => api.referrals.receive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reception-referrals'] }),
  });

  const list = ((data as ReferralRow[] | undefined) ?? []).slice(0, 8);
  if (list.length === 0) return null;

  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Shifokorlardan yo&lsquo;llanmalar</div>
          <Badge variant="secondary">{list.length}</Badge>
        </div>
        <div className="divide-y">
          {list.map((r) => {
            const Icon = ICONS[r.referral_kind] ?? Stethoscope;
            const name = r.diagnostic?.name ?? r.lab?.name ?? r.service?.name ?? r.referral_kind;
            return (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {r.patient?.full_name ?? '—'}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {name} • {r.doctor?.full_name ?? ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {r.urgency !== 'routine' && (
                    <Badge variant="destructive" className="text-[10px]">
                      {r.urgency}
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => {
                      receiveMut.mutate(r.id);
                      onDirect(r);
                      toast.success('Bemor qabulga yo\u2018naltirildi');
                    }}
                  >
                    <Receipt className="h-3 w-3" />
                    Chek
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
