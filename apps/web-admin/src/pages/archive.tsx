import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input } from '@clary/ui-web';
import { Lock, RotateCcw, Trash2, Archive as ArchiveIcon, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

// =============================================================================
// Arxiv moduli — arxivga o'tkazilgan (soft-delete) klinikalar. Kirish PIN: 4020
// (o'zgarmas, hech kim almashtirolmaydi). Ma'lumot saqlanadi → qaytarish yoki
// butunlay o'chirish. Backend SuperAdminGuard + 4020 kod bilan himoyalangan.
// =============================================================================
const ARCHIVE_PIN = '4020';
const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const fmtDate = (s: string) =>
  new Date(s).toLocaleString('uz-UZ', { dateStyle: 'medium', timeStyle: 'short' });

type ArchivedClinic = {
  id: string;
  name: string;
  current_plan: string | null;
  deleted_at: string;
  created_at: string;
  patients: number;
  transactions: number;
};

export function ArchivePage() {
  const [pin, setPin] = useState('');
  const [unlocked, setUnlocked] = useState(false);

  const tryUnlock = () => {
    if (pin.trim() === ARCHIVE_PIN) {
      setUnlocked(true);
    } else {
      toast.error("PIN noto'g'ri");
      setPin('');
    }
  };

  if (!unlocked) {
    return (
      <div className="mx-auto mt-16 max-w-sm space-y-4 rounded-xl border bg-card p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Arxiv moduli</h2>
          <p className="text-sm text-muted-foreground">Kirish uchun PIN kodni kiriting</p>
        </div>
        <Input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') tryUnlock();
          }}
          placeholder="PIN"
          className="text-center text-lg tracking-widest"
          autoFocus
        />
        <Button className="w-full" onClick={tryUnlock}>
          Kirish
        </Button>
      </div>
    );
  }

  return <ArchiveList />;
}

function ArchiveList() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<ArchivedClinic[]>({
    queryKey: ['archived-tenants'],
    queryFn: () => api.admin.listArchivedTenants(),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['archived-tenants'] });
    qc.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });
  };

  const restoreMut = useMutation({
    mutationFn: (id: string) => api.admin.restoreTenant(id),
    onSuccess: () => {
      toast.success('Klinika qaytarildi');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const purgeMut = useMutation({
    mutationFn: (id: string) => api.admin.hardDeleteClinicByCode(id, ARCHIVE_PIN),
    onSuccess: (r) => {
      toast.success(`"${r?.deleted_name ?? 'Klinika'}" butunlay o'chirildi`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <ArchiveIcon className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Arxiv</h1>
        <Badge variant="secondary">{rows.length}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Arxivga o'tkazilgan klinikalar. Ma'lumotlari saqlanadi —{' '}
        <b>Qaytarish</b> bilan tiklash yoki <b>Butunlay o'chirish</b> bilan yo'q qilish mumkin.
      </p>

      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Yuklanmoqda…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
          Arxiv bo'sh — arxivga o'tkazilgan klinika yo'q.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <Badge variant="outline">{c.current_plan ?? 'demo'}</Badge>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Arxivlangan: {fmtDate(c.deleted_at)} · {fmt(c.patients)} bemor ·{' '}
                  {fmt(c.transactions)} tranzaksiya
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  disabled={restoreMut.isPending}
                  onClick={() => {
                    if (window.confirm(`"${c.name}" klinikasini qaytarmoqchimisiz?`)) {
                      restoreMut.mutate(c.id);
                    }
                  }}
                >
                  <RotateCcw className="mr-1.5 h-4 w-4" /> Qaytarish
                </Button>
                <Button
                  className="bg-rose-600 text-white hover:bg-rose-700"
                  disabled={purgeMut.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `"${c.name}" klinikasini BUTUNLAY o'chirmoqchimisiz?\nBu amalni ortga QAYTARIB BO'LMAYDI — barcha ma'lumot yo'qoladi!`,
                      )
                    ) {
                      purgeMut.mutate(c.id);
                    }
                  }}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" /> Butunlay o'chirish
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-500">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          "Butunlay o'chirish" klinika va uning barcha ma'lumotlarini (bemorlar, moliya, xodimlar,
          fayllar) qaytarib bo'lmas darajada o'chiradi.
        </span>
      </div>
    </div>
  );
}
