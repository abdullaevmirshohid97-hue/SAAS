import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, Trash2, RotateCcw, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

type Section = 'journal' | 'cashier' | 'inpatient' | 'payroll';

const SECTIONS: Array<{ id: Section; label: string; desc: string }> = [
  { id: 'journal', label: 'Jurnal', desc: 'To\'lovlar, dorixona savdolari, rasxotlar' },
  { id: 'cashier', label: 'Kassa', desc: 'To\'lovlar, rasxotlar, seyf depozitlari' },
  { id: 'inpatient', label: 'Statsionar', desc: 'Yotqizishlar, hisob, bog\'liq to\'lovlar' },
  { id: 'payroll', label: 'Maosh', desc: 'Komissiyalar, hisob, to\'lovlar' },
];

const SECTION_LABEL: Record<string, string> = {
  journal: 'Jurnal', cashier: 'Kassa', inpatient: 'Statsionar', payroll: 'Maosh',
};

const todayStr = () => new Date().toISOString().slice(0, 10);

export function DataAdminPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const [section, setSection] = useState<Section>('journal');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(todayStr());
  const [counts, setCounts] = useState<{ total: number; tables: Array<{ table: string; count: number }> } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);

  // Faqat klinika egasi/admini
  if (role !== 'clinic_owner' && role !== 'clinic_admin' && role !== 'super_admin') {
    return <Navigate to="/settings/clinic" replace />;
  }

  const batches = useQuery({
    queryKey: ['data-admin', 'batches'],
    queryFn: () => api.dataAdmin.batches(),
  });

  const countsMut = useMutation({
    mutationFn: () => api.dataAdmin.counts(section, from, to),
    onSuccess: (d) => setCounts({ total: d.total, tables: d.tables }),
    onError: (e: Error) => toast.error(e.message),
  });

  const canCount = Boolean(from && to);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-rose-600" />
          <h1 className="text-2xl font-semibold tracking-tight">Xavfli zona — ma'lumotlarni o'chirish</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Tanlangan bo'lim va davrning barcha kirim-chiqim yozuvlarini o'chiradi. O'chirilgan
          ma'lumotlar arxivga ko'chiriladi va keyin <strong>ortga qaytarilishi</strong> mumkin.
        </p>
      </div>

      <Card className="border-rose-200">
        <CardHeader>
          <CardTitle className="text-base">1. Bo'limni tanlang</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { setSection(s.id); setCounts(null); }}
                className={
                  'rounded-lg border p-3 text-left transition ' +
                  (section === s.id ? 'border-rose-400 bg-rose-50' : 'hover:bg-accent/50')
                }
              >
                <div className="font-medium">{s.label}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{s.desc}</div>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <div className="mb-1 text-xs font-medium">Sanadan</div>
              <Input type="date" className="h-9 w-[160px]" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setCounts(null); }} />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium">Sanagacha</div>
              <Input type="date" className="h-9 w-[160px]" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setCounts(null); }} />
            </div>
            <Button variant="outline" disabled={!canCount || countsMut.isPending} onClick={() => countsMut.mutate()} className="gap-1">
              <Calculator className="h-4 w-4" /> {countsMut.isPending ? 'Hisoblanmoqda…' : 'Hisoblash'}
            </Button>
          </div>

          {counts && (
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="mb-2 text-sm font-medium">
                O'chiriladigan yozuvlar — jami <span className="text-rose-600">{counts.total}</span>:
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {counts.tables.map((t) => (
                  <span key={t.table} className="rounded border bg-card px-2 py-1">
                    {t.table}: <b>{t.count}</b>
                  </span>
                ))}
              </div>
              <Button
                variant="destructive"
                className="mt-3 gap-1"
                disabled={counts.total === 0}
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="h-4 w-4" /> O'chirish ({counts.total})
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* O'chirilgan partiyalar — qaytarish */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">O'chirilgan partiyalar (qaytarish mumkin)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {batches.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Yuklanmoqda…</div>
          ) : (batches.data ?? []).length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Hali o'chirilgan ma'lumot yo'q</div>
          ) : (
            <div className="divide-y">
              {(batches.data ?? []).map((b) => (
                <div key={b.batch_id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {SECTION_LABEL[b.section] ?? b.section}
                      <span className="ml-2 text-xs text-muted-foreground">{b.record_count} yozuv</span>
                      {b.restored_at && (
                        <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                          Qaytarilgan
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(b.deleted_at).toLocaleString('uz-UZ')}
                      {b.deleted_by_name ? ` · ${b.deleted_by_name}` : ''}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!b.restored_at}
                    onClick={() => setRestoreTarget(b.batch_id)}
                    className="gap-1"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Qaytarish
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {confirmOpen && (
        <PurgeConfirmDialog
          section={section}
          from={from}
          to={to}
          total={counts?.total ?? 0}
          onClose={() => setConfirmOpen(false)}
          onDone={() => {
            setConfirmOpen(false);
            setCounts(null);
            qc.invalidateQueries({ queryKey: ['data-admin', 'batches'] });
          }}
        />
      )}

      {restoreTarget && (
        <RestoreDialog
          batchId={restoreTarget}
          onClose={() => setRestoreTarget(null)}
          onDone={() => {
            setRestoreTarget(null);
            qc.invalidateQueries({ queryKey: ['data-admin', 'batches'] });
          }}
        />
      )}
    </div>
  );
}

function PurgeConfirmDialog({
  section,
  from,
  to,
  total,
  onClose,
  onDone,
}: {
  section: Section;
  from: string;
  to: string;
  total: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [confirm, setConfirm] = useState('');
  const [pin, setPin] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      api.dataAdmin.purge({ section, from, to, pin, confirm: 'DELETE' }),
    onSuccess: (r) => {
      toast.success(`${r.deleted_count} ta yozuv o'chirildi (arxivga ko'chirildi)`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message || 'Xatolik'),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-600">
            <AlertTriangle className="h-5 w-5" /> Tasdiqlash — {SECTION_LABEL[section]}
          </DialogTitle>
          <DialogDescription>
            <strong className="text-rose-600">{total}</strong> ta yozuv ({from} — {to}) o'chiriladi.
            Ular arxivga ko'chiriladi va keyin qaytarilishi mumkin. Davom etish uchun
            tasdiqlang.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <div className="mb-1 text-xs font-medium">Tasdiqlash uchun <code>DELETE</code> yozing</div>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium">Jurnal PIN</div>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="••••"
              className="text-center font-mono tracking-[0.3em]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button
            variant="destructive"
            disabled={confirm !== 'DELETE' || pin.length < 4 || mut.isPending}
            onClick={() => mut.mutate()}
            className="gap-1"
          >
            <Trash2 className="h-4 w-4" />
            {mut.isPending ? 'O\'chirilmoqda…' : 'Ha, o\'chirish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RestoreDialog({
  batchId,
  onClose,
  onDone,
}: {
  batchId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pin, setPin] = useState('');
  const mut = useMutation({
    mutationFn: () => api.dataAdmin.restore({ batch_id: batchId, pin }),
    onSuccess: (r) => {
      toast.success(`${r.restored_count} ta yozuv qaytarildi`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message || 'Xatolik'),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-emerald-600" /> Ma'lumotni qaytarish
          </DialogTitle>
          <DialogDescription>
            Arxivdagi yozuvlar asosiy bazaga tiklanadi. Tasdiqlash uchun PIN kiriting.
          </DialogDescription>
        </DialogHeader>
        <div className="py-1">
          <div className="mb-1 text-xs font-medium">Jurnal PIN</div>
          <Input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder="••••"
            className="text-center font-mono tracking-[0.3em]"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button
            disabled={pin.length < 4 || mut.isPending}
            onClick={() => mut.mutate()}
            className="gap-1"
          >
            <RotateCcw className="h-4 w-4" />
            {mut.isPending ? 'Qaytarilmoqda…' : 'Qaytarish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
