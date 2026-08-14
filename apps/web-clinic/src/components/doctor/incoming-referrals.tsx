import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent } from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';

// Bu komponent doctor-console.tsx dan ko'chirildi. O'sha sahifa hech qayerdan
// ochilmasdi (router'da bor, lekin havola yo'q edi) — ya'ni ishlaydigan retsept
// va yo'llanma funksiyasi 1130 qator ichida ko'milib yotgan edi. Endi jonli
// /doctor sahifasidan chaqiriladi. Mantiq o'zgarmadi, faqat joyi.

export function IncomingReferrals({ doctorId }: { doctorId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['doc-incoming-refs', doctorId],
    queryFn: () => api.referrals.list({ target_doctor_id: doctorId, status: 'pending' }),
    refetchInterval: 30_000,
  });
  const receiveMut = useMutation({
    mutationFn: (id: string) => api.referrals.receive(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doc-incoming-refs', doctorId] });
      toast.success('Yo‘llanma qabul qilindi');
    },
  });
  const items = (data ?? []) as Array<{
    id: string;
    patient?: { full_name?: string | null } | null;
    target_specialty?: string | null;
    clinical_indication?: string | null;
    urgency?: string | null;
    created_at?: string;
  }>;
  if (items.length === 0) return null;
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="text-sm font-semibold">Menga kelgan yo&apos;llanmalar ({items.length})</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {items.map((r) => (
            <div key={r.id} className="bg-card space-y-1 rounded-lg border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate font-medium">{r.patient?.full_name ?? '—'}</div>
                {r.urgency && r.urgency !== 'routine' && (
                  <Badge
                    variant={r.urgency === 'stat' ? 'destructive' : 'default'}
                    className="text-[10px]"
                  >
                    {r.urgency}
                  </Badge>
                )}
              </div>
              {r.target_specialty && (
                <div className="text-muted-foreground text-[11px]">{r.target_specialty}</div>
              )}
              {r.clinical_indication && (
                <div className="line-clamp-2 text-xs">{r.clinical_indication}</div>
              )}
              <Button
                size="sm"
                className="w-full"
                onClick={() => receiveMut.mutate(r.id)}
                disabled={receiveMut.isPending}
              >
                Qabul qilish
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
