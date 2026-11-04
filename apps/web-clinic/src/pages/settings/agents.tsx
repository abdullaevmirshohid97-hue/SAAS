import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Pencil, Phone, Plus } from 'lucide-react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  PageHeader,
  cn,
} from '@clary/ui-web';
import type { ReferralPartner, ReferralPartnerType } from '@clary/api-client';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

// =============================================================================
// Sozlamalar → Agentlar: statsionarga bemor yo'llagan (tashqi) shifokorlar va
// agentlar. Foiz — XONA to'lovidan ulush; bemor yotqizilganda shu foiz bemorga
// yoziladi (keyin o'zgartirilsa faqat yangi bemorlarga ta'sir qiladi).
// =============================================================================

const TABS: Array<{ id: ReferralPartnerType; label: string; one: string }> = [
  { id: 'agent', label: 'Agentlar', one: 'agent' },
  { id: 'doctor', label: 'Yo‘llanma bergan shifokorlar', one: 'shifokor' },
];

type FormState = {
  id?: string;
  type: ReferralPartnerType;
  name: string;
  specialty: string;
  workplace: string;
  phone: string;
  phone2: string;
  commission_percent: string;
  notes: string;
};

const emptyForm = (type: ReferralPartnerType): FormState => ({
  type,
  name: '',
  specialty: '',
  workplace: '',
  phone: '',
  phone2: '',
  commission_percent: '',
  notes: '',
});

export function SettingsAgentsPage() {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === 'clinic_owner' || role === 'clinic_admin' || role === 'super_admin';
  const [tab, setTab] = useState<ReferralPartnerType>('agent');
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['referral-partners', 'settings', showArchived],
    queryFn: () => api.referralPartners.list({ include_archived: showArchived }),
  });

  const counts = useMemo(
    () => ({
      agent: data.filter((p) => p.type === 'agent' && !p.is_archived).length,
      doctor: data.filter((p) => p.type === 'doctor' && !p.is_archived).length,
    }),
    [data],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.filter(
      (p) =>
        p.type === tab &&
        (!needle ||
          [p.name, p.specialty, p.workplace, p.phone, p.phone2]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(needle)),
    );
  }, [data, tab, q]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['referral-partners'] });
    qc.invalidateQueries({ queryKey: ['referral-summary'] });
  };

  const saveMut = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        type: f.type,
        name: f.name.trim(),
        specialty: f.specialty.trim() || null,
        workplace: f.workplace.trim() || null,
        phone: f.phone.trim() || null,
        phone2: f.phone2.trim() || null,
        notes: f.notes.trim() || null,
        ...(isAdmin && f.commission_percent.trim() !== ''
          ? { commission_percent: Number(f.commission_percent) }
          : {}),
      };
      return f.id ? api.referralPartners.update(f.id, body) : api.referralPartners.create(body);
    },
    onSuccess: (p) => {
      const applied = (p as { applied_stays?: number }).applied_stays ?? 0;
      toast.success(
        applied > 0
          ? `${p.name} saqlandi. Foiz belgilanmasdan yotqizilgan ${applied} ta bemorga ham qo‘llandi`
          : `${p.name} saqlandi`,
      );
      setForm(null);
      invalidate();
      if (applied > 0) {
        qc.invalidateQueries({ queryKey: ['stay-referral'] });
        qc.invalidateQueries({ queryKey: ['referral-detail'] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archiveMut = useMutation({
    mutationFn: (p: ReferralPartner) =>
      api.referralPartners.update(p.id, { is_archived: !p.is_archived }),
    onSuccess: (p) => {
      toast.success(p.is_archived ? `${p.name} arxivlandi` : `${p.name} tiklandi`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEdit = (p: ReferralPartner) =>
    setForm({
      id: p.id,
      type: p.type,
      name: p.name,
      specialty: p.specialty ?? '',
      workplace: p.workplace ?? '',
      phone: p.phone ?? '',
      phone2: p.phone2 ?? '',
      commission_percent: String(p.commission_percent ?? 0),
      notes: p.notes ?? '',
    });

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sozlamalar"
        title="Agentlar va yo‘llanma shifokorlari"
        description="Statsionarga bemor yo‘llagan shifokorlar va agentlar. Foiz — xona to‘lovidan ulush: bemor yotqizilganda shu foiz bemorga yoziladi, ulush har kuni hisoblanadi (Statsionar → Agentlar hisobi)."
        actions={
          <Button onClick={() => setForm(emptyForm(tab))} className="gap-1.5">
            <Plus className="h-4 w-4" /> {current.one === 'agent' ? 'Agent' : 'Shifokor'} qo‘shish
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-muted/30 inline-flex rounded-lg border p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-medium transition',
                tab === t.id ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t.label} ({counts[t.id]})
            </button>
          ))}
        </div>
        <Input
          className="h-9 w-full sm:w-64"
          placeholder="Ism, mutaxassislik yoki telefon…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Arxivdagilar
        </label>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="text-muted-foreground p-6 text-sm">Yuklanmoqda…</CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          title={q ? 'Topilmadi' : `${current.label} ro‘yxati bo‘sh`}
          description={
            q
              ? 'Qidiruvni o‘zgartiring'
              : 'Qo‘shing va foizini belgilang — bemorni yotqizishda “Shifokor yo‘llanmasi” tanlanganda shu ro‘yxatdan tanlanadi.'
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-muted-foreground border-b text-left text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2.5">F.I.O.</th>
                    <th className="px-3 py-2.5">
                      {tab === 'doctor' ? 'Mutaxassislik / ish joyi' : 'Ish joyi'}
                    </th>
                    <th className="px-3 py-2.5">Telefon</th>
                    <th className="px-3 py-2.5 text-right">Foiz</th>
                    <th className="px-3 py-2.5">Izoh</th>
                    {isAdmin && <th className="px-3 py-2.5" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr
                      key={p.id}
                      className={cn('border-b last:border-b-0', p.is_archived && 'opacity-60')}
                    >
                      <td className="px-3 py-2.5 font-medium">
                        {p.name}
                        {p.is_archived && (
                          <Badge variant="secondary" className="ml-1.5 text-[10px]">
                            arxiv
                          </Badge>
                        )}
                      </td>
                      <td className="text-muted-foreground px-3 py-2.5 text-xs">
                        {[p.specialty, p.workplace].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {[p.phone, p.phone2].filter(Boolean).length > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="text-muted-foreground h-3 w-3" />
                            {[p.phone, p.phone2].filter(Boolean).join(', ')}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2.5 text-right font-semibold',
                          p.commission_percent > 0 ? '' : 'text-amber-700',
                        )}
                        title={p.commission_percent > 0 ? '' : 'Foiz belgilanmagan'}
                      >
                        {p.commission_percent}%
                      </td>
                      <td
                        className="text-muted-foreground max-w-[220px] truncate px-3 py-2.5 text-xs"
                        title={p.notes ?? ''}
                      >
                        {p.notes ?? '—'}
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              title="Tahrirlash"
                              onClick={() => openEdit(p)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              title={p.is_archived ? 'Tiklash' : 'Arxivlash'}
                              disabled={archiveMut.isPending}
                              onClick={() => archiveMut.mutate(p)}
                            >
                              {p.is_archived ? (
                                <ArchiveRestore className="h-4 w-4" />
                              ) : (
                                <Archive className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {form && (
        <PartnerDialog
          form={form}
          isAdmin={isAdmin}
          saving={saveMut.isPending}
          onChange={setForm}
          onClose={() => setForm(null)}
          onSave={() => saveMut.mutate(form)}
        />
      )}
    </div>
  );
}

function PartnerDialog({
  form,
  isAdmin,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  form: FormState;
  isAdmin: boolean;
  saving: boolean;
  onChange: (f: FormState) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const set =
    (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...form, [k]: e.target.value });
  const pct = form.commission_percent.trim() === '' ? 0 : Number(form.commission_percent);
  const pctInvalid = Number.isNaN(pct) || pct < 0 || pct > 100;
  const invalid = form.name.trim().length < 2 || (isAdmin && pctInvalid);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{form.id ? 'Tahrirlash' : 'Yangi qo‘shish'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="bg-muted/30 inline-flex rounded-lg border p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onChange({ ...form, type: t.id })}
                className={cn(
                  'rounded px-3 py-1.5 text-xs font-medium transition',
                  form.type === t.id ? 'bg-background shadow-sm' : 'text-muted-foreground',
                )}
              >
                {t.id === 'agent' ? 'Agent' : 'Yo‘llanma bergan shifokor'}
              </button>
            ))}
          </div>
          <Field label="F.I.O. *">
            <Input autoFocus value={form.name} onChange={set('name')} />
          </Field>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label={form.type === 'doctor' ? 'Mutaxassisligi' : 'Faoliyati (ixtiyoriy)'}>
              <Input
                value={form.specialty}
                onChange={set('specialty')}
                placeholder={form.type === 'doctor' ? 'Masalan: kardiolog' : ''}
              />
            </Field>
            <Field label="Ish joyi">
              <Input
                value={form.workplace}
                onChange={set('workplace')}
                placeholder="Klinika / shifoxona"
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Telefon">
              <Input value={form.phone} onChange={set('phone')} placeholder="+998..." />
            </Field>
            <Field label="Qo‘shimcha telefon">
              <Input value={form.phone2} onChange={set('phone2')} placeholder="+998..." />
            </Field>
          </div>
          <Field label="Xona to‘lovidan ulush (%)">
            <Input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={form.commission_percent}
              onChange={set('commission_percent')}
              placeholder="0"
              disabled={!isAdmin}
            />
            <div className="text-muted-foreground text-[11px]">
              {isAdmin
                ? 'Faqat xona narxidan hisoblanadi (ovqat, qarovchi, xizmatlar kirmaydi). O‘zgartirsangiz — yangi yotqizilgan va foiz belgilanmasdan (0%) yotqizilgan bemorlarga ta’sir qiladi; foizi bor bemorlarniki o‘zgarmaydi.'
                : 'Foizni faqat admin belgilaydi.'}
            </div>
          </Field>
          <Field label="Izoh">
            <textarea
              value={form.notes}
              onChange={set('notes')}
              rows={2}
              className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button disabled={invalid || saving} onClick={onSave}>
            {saving ? 'Saqlanmoqda…' : 'Saqlash'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      {children}
    </label>
  );
}
