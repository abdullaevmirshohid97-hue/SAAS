import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@clary/ui-web';

import { api } from '@/lib/api';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

/** Shifokorning 30 kunlik statistikasi (ish stoli va bosh sahifadan ochiladi). */
export function DoctorAnalyticsDialog({
  doctorId,
  doctorName,
  onClose,
}: {
  doctorId: string;
  doctorName: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['doctor-analytics', doctorId],
    queryFn: () => api.doctor.analytics(doctorId),
  });

  const maxDay = useMemo(
    () => Math.max(1, ...(data?.daily_patients ?? []).map((d) => d.count)),
    [data],
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{doctorName} — statistika (30 kun)</DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Qabullar" value={String(data.completed_appointments)} />
              <Stat label="Bemorlar" value={String(data.unique_patients)} />
              <Stat label="Qaytgan bemor" value={String(data.repeat_patients)} />
              <Stat label="Kuniga o'rtacha" value={String(data.avg_per_day)} />
            </div>
            <div className="bg-primary/5 rounded-md border px-3 py-2">
              <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
                30 kunlik tushum
              </div>
              <div className="text-xl font-bold">{fmt(data.income_uzs)} so&apos;m</div>
            </div>
            {data.daily_patients.length > 0 && (
              <div>
                <div className="text-muted-foreground mb-1 text-xs font-medium">
                  Kun bo&apos;yicha bemorlar
                </div>
                <div className="flex h-24 items-end gap-0.5">
                  {data.daily_patients.map((d) => (
                    <div
                      key={d.day}
                      className="bg-primary/70 flex-1 rounded-t"
                      style={{ height: `${(d.count / maxDay) * 100}%` }}
                      title={`${d.day}: ${d.count}`}
                    />
                  ))}
                </div>
              </div>
            )}
            {data.top_diagnoses.length > 0 && (
              <div>
                <div className="text-muted-foreground mb-1 text-xs font-medium">
                  Eng ko&apos;p tashxislar
                </div>
                <div className="space-y-1">
                  {data.top_diagnoses.map((d) => (
                    <div
                      key={d.code}
                      className="flex items-center justify-between rounded-md border px-2 py-1 text-xs"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="text-primary font-mono font-bold">{d.code}</span>
                        <span className="truncate">{d.text}</span>
                      </span>
                      <span className="font-semibold">{d.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Yopish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-md border px-2 py-1">
      <div className="text-muted-foreground text-[10px]">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
