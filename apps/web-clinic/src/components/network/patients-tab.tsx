import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitMerge, Users } from 'lucide-react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  EmptyState,
  Skeleton,
} from '@clary/ui-web';
import type { NetworkDuplicateGroup } from '@clary/api-client';

import { api } from '@/lib/api';

/**
 * Bemor dublikatlari (telefon + F.I.Sh. yoki PINFL bir xil) — tarmoq
 * rahbariyati butun tarmoq bo'yicha, filial rahbari o'z filiali bo'yicha.
 * Birlashtirishda hamma yozuvlar (to'lov, tahlil, statsionar, qarz...)
 * asosiy kartaga o'tadi; ikkinchi karta arxivlanadi.
 */
export function PatientsTab() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['company-duplicates'],
    queryFn: () => api.company.duplicates(),
  });
  if (isLoading) return <Skeleton className="h-40" />;
  if (data.length === 0) {
    return (
      <EmptyState
        title="Dublikat topilmadi"
        description="Telefon va F.I.Sh. (yoki PINFL) bir xil bo'lgan bemor kartalari yo'q."
      />
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {data.length} ta guruh. Asosiy kartani tanlang — qolganlari unga birlashtiriladi (qaytarib
        bo'lmaydi).
      </p>
      {data.map((g) => (
        <DuplicateGroup key={g.dup_key} group={g} />
      ))}
    </div>
  );
}

function DuplicateGroup({ group }: { group: NetworkDuplicateGroup }) {
  const qc = useQueryClient();
  // Standart asosiy — eng ko'p tashrifli karta
  const best = [...group.items].sort((a, b) => b.visits - a.visits)[0]!;
  const [keep, setKeep] = useState(best.id);
  const [drop, setDrop] = useState<string | null>(null);
  const merge = useMutation({
    mutationFn: (dropId: string) => api.company.mergePatients(keep, dropId),
    onSuccess: (r) => {
      const moved = Object.values(r.moved ?? {}).reduce((s, n) => s + n, 0);
      toast.success(`Birlashtirildi — ${moved} ta yozuv ko'chdi`);
      void qc.invalidateQueries({ queryKey: ['company-duplicates'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const keepItem = group.items.find((i) => i.id === keep);
  const dropItem = group.items.find((i) => i.id === drop);

  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
          <Users className="h-3.5 w-3.5" />
          {group.dup_key.startsWith('pinfl:') ? 'Bir xil PINFL' : 'Bir xil telefon va F.I.Sh.'}
        </div>
        <div className="divide-y">
          {group.items.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={keep === p.id} onChange={() => setKeep(p.id)} />
                <span className="font-medium">{p.full_name}</span>
              </label>
              {keep === p.id && <Badge variant="success">asosiy</Badge>}
              <span className="text-muted-foreground text-xs">
                {p.clinic_name} · {p.phone ?? '—'}
                {p.dob ? ` · ${p.dob}` : ''} · {p.visits} tashrif · ochilgan{' '}
                {new Date(p.created_at).toLocaleDateString('uz-UZ')}
              </span>
              {keep !== p.id && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={merge.isPending}
                  onClick={() => setDrop(p.id)}
                >
                  <GitMerge className="mr-1 h-3.5 w-3.5" /> Asosiyga birlashtirish
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
      <ConfirmDialog
        open={!!drop}
        onOpenChange={(o) => !o && setDrop(null)}
        title="Bemor kartalarini birlashtirish"
        description={`"${dropItem?.full_name}" (${dropItem?.clinic_name}) kartasidagi BARCHA yozuvlar "${keepItem?.full_name}" (${keepItem?.clinic_name}) kartasiga o'tadi. Bu amalni qaytarib bo'lmaydi.`}
        confirmLabel="Birlashtirish"
        destructive
        loading={merge.isPending}
        onConfirm={() => {
          if (drop) merge.mutate(drop);
          setDrop(null);
        }}
      />
    </Card>
  );
}
