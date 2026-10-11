import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  cn,
} from '@clary/ui-web';
import {
  BedDouble,
  Building2,
  ExternalLink,
  Phone,
  Search,
  Stethoscope,
  Users,
} from 'lucide-react';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { readQuickAdmit } from '@/lib/inpatient-quick-admit';
import { filterInpatients, stayDays, type FinderStay } from '@/lib/inpatient-finder';

// =============================================================================
// Qabulxona: yashil "Statsionardagilar" tugmasi (F2)
// =============================================================================
// Hozir statsionarda yotgan bemorni ismi (yoki telefoni, xona raqami) bo'yicha
// topib — qaysi bo'lim, qavat, xona va yotoqda ekanini ko'rsatadi.
// =============================================================================

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function InpatientFinderButton({ className }: { className?: string }) {
  const { can } = useAuth();
  const allowed = can('inpatient.view');
  const { data: stays } = useQuery({
    queryKey: ['inpatient-stays', 'admitted'],
    queryFn: () => api.inpatient.list({ status: 'admitted' }),
    enabled: allowed,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const list = (stays ?? []) as FinderStay[];
  const [open, setOpen] = useState(false);

  // F2 — istalgan joydan (input ichida ham)
  useEffect(() => {
    if (!allowed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2') return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allowed]);

  if (!allowed) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Statsionarda yotgan bemorni topish (F2)"
        className={cn(
          'inline-flex h-10 items-center gap-2 rounded-full bg-emerald-600 px-5 text-sm font-semibold text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 active:scale-[0.98]',
          className,
        )}
      >
        <Users className="h-4 w-4" />
        Statsionardagilar
        <span className="rounded bg-white/20 px-1.5 py-0.5 text-[11px] font-bold leading-none">
          F2
        </span>
        <span className="hidden text-xs font-normal text-white/80 sm:inline">
          · {list.length} bemor
        </span>
      </button>
      {open && <FinderDialog stays={list} onClose={() => setOpen(false)} />}
    </>
  );
}

function FinderDialog({ stays, onClose }: { stays: FinderStay[]; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ clinic?: { settings?: Record<string, unknown> } }>('/api/v1/auth/me'),
  });
  // Xona → bo'lim nomi (Sozlamalar > Klinika > Statsionarga tezkor qabul)
  const deptOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of readQuickAdmit(me?.clinic?.settings).departments) {
      for (const id of d.room_ids) m.set(id, d.name);
    }
    return m;
  }, [me]);
  const manyBuildings =
    new Set(stays.map((s) => (s.room?.building ?? '').trim().toLowerCase())).size > 1;

  const results = useMemo(() => filterInpatients(stays, q), [stays, q]);

  const openStay = (id: string) => {
    onClose();
    navigate(`/inpatient/stays/${id}`);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-emerald-600" />
            Statsionardagi bemorlar
            <span className="text-muted-foreground text-sm font-normal">· {stays.length}</span>
          </DialogTitle>
          <DialogDescription>
            Bemor ismini yozing — qaysi qavat, xona va yotoqda ekanini ko&lsquo;rasiz. Telefon yoki
            xona raqami bilan ham topiladi.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results.length === 1) openStay(results[0]!.id);
            }}
            placeholder="Bemor ismi, telefon yoki xona raqami…"
            className="h-11 pl-9 text-base"
          />
        </div>

        {results.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed py-10 text-center text-sm">
            {stays.length === 0
              ? 'Hozir statsionarda bemor yo‘q.'
              : `"${q}" — statsionarda bunday bemor topilmadi.`}
          </div>
        ) : (
          <div className="space-y-2">
            {results.map((s) => {
              const room = s.room;
              const dept = s.room_id ? deptOf.get(s.room_id) : undefined;
              const days = stayDays(s.admitted_at);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openStay(s.id)}
                  className="group flex w-full items-stretch gap-3 rounded-xl border p-3 text-left transition hover:border-emerald-400 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/20"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold">
                      {s.patient?.full_name ?? '—'}
                    </div>
                    <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                      {s.patient?.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {s.patient.phone}
                        </span>
                      )}
                      {s.doctor?.full_name && (
                        <span className="inline-flex items-center gap-1">
                          <Stethoscope className="h-3 w-3" /> {s.doctor.full_name}
                        </span>
                      )}
                      <span>
                        Yotqizilgan: {fmtDate(s.admitted_at)} · {days}-kun
                      </span>
                      {s.planned_discharge_at && (
                        <span>Chiqish: {fmtDate(s.planned_discharge_at)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end justify-center gap-0.5 text-right">
                    {room ? (
                      <>
                        <div className="flex items-center gap-1.5 text-lg font-bold text-emerald-700 dark:text-emerald-400">
                          <BedDouble className="h-4 w-4" />
                          {room.floor != null && room.floor !== 0
                            ? `${room.floor}-qavat · `
                            : ''}№ {room.number}
                        </div>
                        <div className="text-muted-foreground flex items-center gap-1 text-xs">
                          {(dept || (manyBuildings && room.building)) && (
                            <Building2 className="h-3 w-3" />
                          )}
                          {[
                            dept,
                            manyBuildings ? room.building : null,
                            s.bed_no ? `${s.bed_no}-yotoq` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || room.section}
                        </div>
                      </>
                    ) : (
                      <div className="text-muted-foreground text-sm">Xona belgilanmagan</div>
                    )}
                    <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px] opacity-0 transition group-hover:opacity-100">
                      Kartani ochish <ExternalLink className="h-3 w-3" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
