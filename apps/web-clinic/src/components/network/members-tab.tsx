import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Settings2, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import { Badge, Button, Card, CardContent, ConfirmDialog, Input } from '@clary/ui-web';
import type { NetworkBranch, NetworkCompany, NetworkMemberRole } from '@clary/api-client';

import { api } from '@/lib/api';
import { BranchChecklist } from './shared';

const ROLE_LABEL: Record<NetworkMemberRole, string> = {
  company_owner: 'Tarmoq egasi',
  company_admin: 'Tarmoq admini',
  branch_user: 'Hududiy menejer',
};
const ROLE_HINT: Record<NetworkMemberRole, string> = {
  company_owner: "Hamma filial + a'zolar va sozlamalar",
  company_admin: 'Hamma filial, katalog, transferlar',
  branch_user: "Tanlangan filiallar (faqat ko'rish va o'tish)",
};

const ACTION_LABEL: Record<string, string> = {
  branch_linked: 'Filial ulandi',
  branch_unlinked: 'Filial ajratildi',
  branch_created: 'Yangi filial ochildi',
  hq_changed: 'HQ almashtirildi',
  catalog_push: 'Katalog tarqatildi',
  settings_push: 'Sozlamalar tarqatildi',
  member_upsert: "A'zo qo'shildi/o'zgardi",
  member_update: "A'zo o'zgardi",
  member_remove: "A'zo olib tashlandi",
  settings_update: 'Tarmoq sozlamasi',
  branch_update: 'Filial belgisi',
  stock_transfer_sent: "Dori jo'natildi",
  stock_transfer_received: 'Dori qabul qilindi',
  stock_transfer_canceled: 'Dori transferi bekor',
  cash_transfer_sent: "Pul jo'natildi",
  cash_transfer_received: 'Pul qabul qilindi',
  cash_transfer_canceled: "Pul o'tkazmasi bekor",
  referral_sent: "Yo'llanma yuborildi",
  patient_merge: 'Bemorlar birlashtirildi',
  staff_moved: "Xodim boshqa filialga ko'chirildi",
  network_configured: 'Super-admin: tarmoq sozlandi',
};

/** Tarmoq rahbariyati (a'zolar), tarmoq sozlamalari va amallar tarixi */
export function MembersTab({
  branches,
  company,
  isOwner,
}: {
  branches: NetworkBranch[];
  company: NetworkCompany | null;
  isOwner: boolean;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<NetworkMemberRole>('company_admin');
  const [ids, setIds] = useState<string[]>([]);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const { data: members = [] } = useQuery({
    queryKey: ['company-members'],
    queryFn: () => api.company.members(),
  });
  const { data: audit = [] } = useQuery({
    queryKey: ['company-audit'],
    queryFn: () => api.company.audit(100),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['company-members'] });
  const add = useMutation({
    mutationFn: () =>
      api.company.addMember({
        email: email.trim(),
        role,
        accessible_clinic_ids: role === 'branch_user' ? ids : [],
      }),
    onSuccess: (r) => {
      toast.success(`${r.full_name} qo'shildi`);
      setEmail('');
      setIds([]);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.company.removeMember(id),
    onSuccess: () => {
      toast.success('Olib tashlandi');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const settings = useMutation({
    mutationFn: (shared: boolean) => api.company.updateSettings({ shared_patients: shared }),
    onSuccess: () => {
      toast.success('Saqlandi');
      void qc.invalidateQueries({ queryKey: ['company-my'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? '';

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="font-semibold">Tarmoq rahbariyati</div>
          <div className="divide-y rounded-md border">
            {members.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <span className="font-medium">{m.user?.full_name ?? '—'}</span>
                <span className="text-muted-foreground text-xs">{m.user?.email}</span>
                <Badge variant={m.role === 'company_owner' ? 'default' : 'secondary'}>
                  {ROLE_LABEL[m.role]}
                </Badge>
                {m.role === 'branch_user' && (
                  <span className="text-muted-foreground text-xs">
                    {m.accessible_clinic_ids.length === 0
                      ? 'barcha filiallar'
                      : m.accessible_clinic_ids.map(branchName).filter(Boolean).join(', ')}
                  </span>
                )}
                {isOwner && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => setRemoveId(m.id)}
                    aria-label="Olib tashlash"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {isOwner && (
            <div className="space-y-3 rounded-md border border-dashed p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <UserPlus className="h-4 w-4" /> A'zo qo'shish
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  placeholder="Email (tizimda xodim sifatida bo'lishi kerak)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-9 w-72"
                />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as NetworkMemberRole)}
                  className="bg-background h-9 rounded-md border px-2 text-sm"
                >
                  {(Object.keys(ROLE_LABEL) as NetworkMemberRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <Button
                  disabled={!email.includes('@') || add.isPending}
                  onClick={() => add.mutate()}
                >
                  Qo'shish
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">{ROLE_HINT[role]}</p>
              {role === 'branch_user' && (
                <BranchChecklist branches={branches} value={ids} onChange={setIds} />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {isOwner && company && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2 font-semibold">
              <Settings2 className="h-4 w-4" /> Tarmoq sozlamalari
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={company.shared_patients}
                disabled={settings.isPending}
                onChange={(e) => settings.mutate(e.target.checked)}
              />
              <span>
                Umumiy bemor bazasi
                <span className="text-muted-foreground block text-xs">
                  Yoqilgan: bemor istalgan filialda topiladi, tarixi (tashrif, tahlil, qarz) hamma
                  filialda ko'rinadi. O'chirilsa — har filial faqat o'z bemorlarini ko'radi.
                </span>
              </span>
            </label>
            <div className="text-muted-foreground text-xs">
              Limit: {branches.length}/{company.max_branches} filial · Obuna:{' '}
              {company.billing_mode === 'company'
                ? 'tarmoq uchun bitta (HQ orqali)'
                : 'har filial alohida'}
              . Limit va obuna turini Clary qo'llab-quvvatlash o'zgartiradi.
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center gap-2 font-semibold">
            <History className="h-4 w-4" /> Amallar tarixi
          </div>
          {audit.length === 0 ? (
            <p className="text-muted-foreground text-sm">Hozircha yo'q.</p>
          ) : (
            <div className="max-h-96 divide-y overflow-y-auto text-sm">
              {audit
                .filter((a) => a.action !== 'branch_switch')
                .map((a) => (
                  <div key={a.id} className="flex flex-wrap gap-2 py-1.5">
                    <span className="text-muted-foreground w-36 shrink-0 text-xs">
                      {new Date(a.created_at).toLocaleString('uz-UZ')}
                    </span>
                    <span>{ACTION_LABEL[a.action] ?? a.action}</span>
                    {a.clinic_id && (
                      <span className="text-muted-foreground text-xs">
                        · {branchName(a.clinic_id)}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!removeId}
        onOpenChange={(o) => !o && setRemoveId(null)}
        title="A'zoni olib tashlash"
        description="U boshqa filiallarga kira olmaydi (o'z uy filiali qoladi)."
        confirmLabel="Olib tashlash"
        destructive
        onConfirm={() => {
          if (removeId) remove.mutate(removeId);
          setRemoveId(null);
        }}
      />
    </div>
  );
}
