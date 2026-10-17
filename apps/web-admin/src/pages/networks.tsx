import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Crown,
  Link2,
  Network,
  Plus,
  Search,
  Trash2,
  Unlink,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@clary/ui-web';
import type {
  AdminNetworkBranch,
  AdminNetworkCandidate,
  AdminNetworkDetail,
  NetworkMemberRole,
} from '@clary/api-client';

import { api } from '@/lib/api';

// =============================================================================
// Super-admin — FILIAL TARMOQLARI. Bitta asosiy klinika (HQ) + 10 tagacha
// filial: limit va billing, mavjud klinikani ulash (oldindan ko'rish bilan),
// noldan yangi filial, HQ'ni almashtirish, ajratish, tarmoq rahbariyati.
// =============================================================================
const fmt = (n: number | null | undefined) => Math.round(Number(n ?? 0)).toLocaleString('uz-UZ');

const ROLE_LABEL: Record<NetworkMemberRole, string> = {
  company_owner: 'Tarmoq egasi',
  company_admin: 'Tarmoq admini',
  branch_user: 'Hududiy menejer',
};

const ACTION_LABEL: Record<string, string> = {
  branch_linked: 'Filial ulandi',
  branch_unlinked: 'Filial ajratildi',
  branch_created: 'Yangi filial ochildi',
  hq_changed: 'HQ almashtirildi',
  network_configured: 'Tarmoq sozlandi',
  catalog_push: 'Katalog tarqatildi',
  settings_push: 'Sozlamalar tarqatildi',
  member_upsert: "A'zo qo'shildi/o'zgardi",
  member_update: "A'zo o'zgardi",
  member_remove: "A'zo olib tashlandi",
  settings_update: 'Tarmoq sozlamasi (egasi)',
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
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ʻʼ‘’'`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const BLOCKER_TEXT: Record<string, string> = {
  archived: 'Klinika arxivda',
  already_linked: 'Allaqachon shu tarmoqda',
  has_own_branches: "Bu klinikaning o'z filiallari bor — avval ularni ajrating",
  limit: "Tarmoq limiti to'lgan — avval limitni oshiring",
};

export function NetworksPage() {
  const [q, setQ] = useState('');
  const [onlyNetworks, setOnlyNetworks] = useState(true);
  const navigate = useNavigate();
  const { data = [], isLoading } = useQuery({
    queryKey: ['adm-networks'],
    queryFn: () => api.admin.networks(),
  });
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.filter(
      (n) =>
        (!onlyNetworks || n.is_network) &&
        (!term ||
          n.name.toLowerCase().includes(term) ||
          n.branches.some((b) => b.name.toLowerCase().includes(term))),
    );
  }, [data, q, onlyNetworks]);
  const networks = data.filter((n) => n.is_network);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Network className="h-6 w-6" /> Filial tarmoqlari
        </h1>
        <p className="text-muted-foreground text-sm">
          Bitta asosiy klinika (HQ) va 10 tagacha filial. Tarmoq yaratish: klinikani oching →
          limitni oshiring → boshqa klinikani ulang yoki yangi filial oching.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Tarmoqlar" value={networks.length} />
        <Stat
          label="Tarmoqdagi filiallar"
          value={networks.reduce((s, n) => s + n.branch_count, 0)}
        />
        <Stat label="Mustaqil klinikalar" value={data.length - networks.length} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute left-2 top-2.5 h-4 w-4" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tarmoq yoki filial nomi"
            className="w-72 pl-8"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyNetworks}
            onChange={(e) => setOnlyNetworks(e.target.checked)}
          />
          Faqat tarmoqlar (mustaqil klinikadan tarmoq qilish uchun belgini oling)
        </label>
      </div>

      <div className="bg-card overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left text-xs">
              <th className="px-3 py-2">Tarmoq</th>
              <th>HQ</th>
              <th>Filiallar</th>
              <th>Billing</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-3 py-4">
                  Yuklanmoqda…
                </td>
              </tr>
            )}
            {rows.map((n) => (
              <tr
                key={n.id}
                className="hover:bg-muted/40 cursor-pointer border-b last:border-0"
                onClick={() => navigate(`/networks/${n.id}`)}
              >
                <td className="px-3 py-2 font-medium">{n.name}</td>
                <td>
                  {n.hq ? (
                    <span>
                      {n.hq.name}{' '}
                      <Badge variant="outline" className="text-[10px]">
                        {n.hq.plan}
                      </Badge>
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <Badge variant={n.is_network ? 'success' : 'outline'}>
                    {n.branch_count}/{n.max_branches}
                  </Badge>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {n.branches
                      .filter((b) => !b.is_hq)
                      .map((b) => b.name)
                      .slice(0, 3)
                      .join(', ')}
                    {n.branch_count > 4 ? '…' : ''}
                  </span>
                </td>
                <td className="text-xs">
                  {n.billing_mode === 'company' ? 'Tarmoq (HQ orqali)' : 'Har filial alohida'}
                </td>
                <td className="text-primary pr-3 text-right text-xs">Boshqarish →</td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-3 py-4">
                  Topilmadi.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

// ── Tarmoq tafsiloti ─────────────────────────────────────────────────────────
export function NetworkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['adm-network', id],
    queryFn: () => api.admin.network(id!),
    enabled: !!id,
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['adm-network', id] });
    void qc.invalidateQueries({ queryKey: ['adm-networks'] });
  };

  if (isLoading || !data) {
    return <div className="text-muted-foreground p-6 text-sm">Yuklanmoqda…</div>;
  }
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link
        to="/networks"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-4 w-4" /> Filial tarmoqlari
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{data.company.name}</h1>
        <Badge variant={data.branches.length > 1 ? 'success' : 'outline'}>
          {data.branches.length}/{data.company.max_branches} filial
        </Badge>
      </div>

      <SettingsCard data={data} onSaved={invalidate} />
      <BranchesCard data={data} onChanged={invalidate} />
      <MembersCard data={data} onChanged={invalidate} />
      <AuditCard data={data} />
    </div>
  );
}

function SettingsCard({ data, onSaved }: { data: AdminNetworkDetail; onSaved: () => void }) {
  const c = data.company;
  const [name, setName] = useState(c.name);
  const [max, setMax] = useState(c.max_branches);
  const [billing, setBilling] = useState(c.billing_mode);
  const [fee, setFee] = useState(String(c.branch_fee_uzs ?? 0));
  const [shared, setShared] = useState(c.shared_patients);
  const save = useMutation({
    mutationFn: () =>
      api.admin.configureNetwork(c.id, {
        name: name.trim(),
        max_branches: max,
        billing_mode: billing,
        branch_fee_uzs: Math.max(0, Math.round(Number(fee) || 0)),
        shared_patients: shared,
        package: max > 1 ? 'enterprise' : 'small',
      }),
    onSuccess: () => {
      toast.success('Saqlandi');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const b = data.billing;
  // Tarmoq obunasi: HQ nomiga bitta hisob-faktura — HQ tarifi + filiallar × to'lov
  const invoice = useMutation({
    mutationFn: () => {
      if (b.mode !== 'company') throw new Error('Tarmoq obunasi rejimi emas');
      const hqBranch = data.branches.find((x) => x.is_hq);
      if (!hqBranch) throw new Error('HQ topilmadi');
      const now = new Date();
      const periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const items = [
        {
          title: `Clary Care — «${b.hq_plan ?? hqBranch.current_plan}» tarifi (asosiy filial: ${hqBranch.name})`,
          unit: 'oy',
          quantity: 1,
          unit_price_uzs: b.hq_price_uzs,
        },
      ];
      if (b.branches > 0 && b.branch_fee_uzs > 0) {
        items.push({
          title: `Qo'shimcha filiallar (${data.branches
            .filter((x) => !x.is_hq)
            .map((x) => x.name)
            .join(', ')})`,
          unit: 'filial',
          quantity: b.branches,
          unit_price_uzs: b.branch_fee_uzs,
        });
      }
      return api.admin.createInvoice({
        clinic_id: hqBranch.id,
        period_start: periodStart,
        months: 1,
        items,
        notes: `${c.name} tarmog'i — ${data.branches.length} filial`,
      });
    },
    onSuccess: (inv) =>
      toast.success(
        `Hisob-faktura yaratildi${inv.number ? `: № ${inv.number}` : ''} — "Hujjatlar" bo'limida`,
      ),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="bg-card space-y-4 rounded-xl border p-4">
      <div className="font-semibold">Tarmoq sozlamalari</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Tarmoq nomi</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Filiallar limiti (1–10)</Label>
          <Input
            type="number"
            min={Math.max(1, data.branches.length)}
            max={10}
            value={max}
            onChange={(e) =>
              setMax(Math.min(10, Math.max(1, Math.floor(Number(e.target.value) || 1))))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label>Obuna</Label>
          <select
            value={billing}
            onChange={(e) => setBilling(e.target.value as 'per_branch' | 'company')}
            className="bg-background h-9 w-full rounded-md border px-2 text-sm"
          >
            <option value="per_branch">Har filial alohida</option>
            <option value="company">Tarmoq uchun bitta (HQ orqali)</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Filial uchun to'lov (so'm/oy)</Label>
          <Input
            inputMode="numeric"
            value={fee}
            disabled={billing !== 'company'}
            onChange={(e) => setFee(e.target.value.replace(/\D/g, ''))}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
        Umumiy bemor bazasi (bemor istalgan filialda topiladi)
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-muted-foreground text-sm">
          Oylik hisob: <strong className="text-foreground">{fmt(b.monthly_total_uzs)} so'm</strong>
          {b.mode === 'company'
            ? ` = HQ (${b.hq_plan ?? '—'}) ${fmt(b.hq_price_uzs)} + ${b.branches} × ${fmt(b.branch_fee_uzs)}`
            : ' — har filial o‘z tarifida'}
          {billing === 'company' && (
            <span className="block text-xs">
              Tarmoq obunasida filiallar obuna holatini HQ'dan oladi (HQ to'lamasa — hammasi
              bloklanadi).
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {b.mode === 'company' && c.billing_mode === 'company' && (
            <Button variant="outline" onClick={() => invoice.mutate()} disabled={invoice.isPending}>
              Tarmoq hisob-fakturasi
            </Button>
          )}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Saqlash
          </Button>
        </div>
      </div>
    </section>
  );
}

function BranchesCard({ data, onChanged }: { data: AdminNetworkDetail; onChanged: () => void }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [unlinkBranch, setUnlinkBranch] = useState<AdminNetworkBranch | null>(null);
  const cid = data.company.id;
  const full = data.branches.length >= data.company.max_branches;
  const hq = useMutation({
    mutationFn: (clinicId: string) => api.admin.networkSetHq(cid, clinicId),
    onSuccess: () => {
      toast.success('HQ almashtirildi');
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const unlink = useMutation({
    mutationFn: (clinicId: string) => api.admin.networkUnlink(cid, clinicId),
    onSuccess: () => {
      toast.success('Filial ajratildi — endi mustaqil klinika');
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="bg-card space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">
          <Building2 className="h-4 w-4" /> Filiallar
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={full} onClick={() => setLinkOpen(true)}>
            <Link2 className="mr-1 h-4 w-4" /> Mavjud klinikani ulash
          </Button>
          <Button size="sm" disabled={full} onClick={() => setNewOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Yangi filial
          </Button>
        </div>
      </div>
      {full && (
        <p className="text-xs text-amber-600">
          Limit to'lgan ({data.branches.length}/{data.company.max_branches}) — yuqorida limitni
          oshiring.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left text-xs">
              <th className="py-1.5">Filial</th>
              <th>Tarif / holat</th>
              <th className="text-right">Bemor</th>
              <th className="text-right">Xodim</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.branches.map((b) => (
              <tr key={b.id} className="border-b last:border-0">
                <td className="py-2">
                  <Link to={`/tenants/${b.id}/manage`} className="font-medium hover:underline">
                    {b.name}
                  </Link>
                  {b.is_hq && (
                    <Badge className="ml-2 text-[10px]">
                      <Crown className="mr-0.5 h-3 w-3" /> HQ
                    </Badge>
                  )}
                  <div className="text-muted-foreground text-xs">
                    {b.slug}
                    {b.city ? ` · ${b.city}` : ''}
                    {b.branch_code ? ` · kod ${b.branch_code}` : ''}
                  </div>
                </td>
                <td className="text-xs">
                  {b.current_plan} · {b.subscription_status}
                </td>
                <td className="text-right">{fmt(b.patients)}</td>
                <td className="text-right">{b.staff}</td>
                <td className="space-x-1 text-right">
                  {!b.is_hq && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={hq.isPending}
                        onClick={() => hq.mutate(b.id)}
                      >
                        HQ qilish
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setUnlinkBranch(b)}>
                        <Unlink className="mr-1 h-3.5 w-3.5" /> Ajratish
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {linkOpen && (
        <LinkDialog companyId={cid} onClose={() => setLinkOpen(false)} onLinked={onChanged} />
      )}
      {newOpen && (
        <NewBranchDialog companyId={cid} onClose={() => setNewOpen(false)} onCreated={onChanged} />
      )}
      <ConfirmDialog
        open={!!unlinkBranch}
        onOpenChange={(o) => !o && setUnlinkBranch(null)}
        title="Filialni ajratish"
        description={`"${unlinkBranch?.name}" tarmoqdan ajratiladi va mustaqil klinika bo'ladi (o'z kompaniyasi bilan). Ma'lumotlari unda qoladi; tarmoq rahbariyati unga kira olmaydi.`}
        confirmLabel="Ajratish"
        destructive
        onConfirm={() => {
          if (unlinkBranch) unlink.mutate(unlinkBranch.id);
          setUnlinkBranch(null);
        }}
      />
    </section>
  );
}

function LinkDialog({
  companyId,
  onClose,
  onLinked,
}: {
  companyId: string;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<AdminNetworkCandidate | null>(null);
  const { data: candidates = [] } = useQuery({
    queryKey: ['adm-network-candidates', companyId, q],
    queryFn: () => api.admin.networkCandidates(companyId, q || undefined),
  });
  const { data: preview, isFetching } = useQuery({
    queryKey: ['adm-network-preview', companyId, pick?.id],
    queryFn: () => api.admin.networkPreview(companyId, pick!.id),
    enabled: !!pick,
  });
  const link = useMutation({
    mutationFn: () => api.admin.networkLink(companyId, pick!.id),
    onSuccess: (r) => {
      toast.success(`Ulandi — ${fmt(r.patients_moved)} bemor tarmoqqa qo'shildi`);
      onLinked();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const blockers = preview?.blockers ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Mavjud klinikani filial qilib ulash</DialogTitle>
        </DialogHeader>
        {!pick ? (
          <div className="space-y-2">
            <Input
              placeholder="Klinika nomi yoki slug"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setPick(c)}
                  className="hover:bg-muted flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                >
                  <span>
                    {c.name}
                    <span className="text-muted-foreground"> · {c.slug}</span>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {c.current_plan}
                    {c.own_network_size > 1 ? ` · o'z tarmog'i (${c.own_network_size})` : ''}
                  </span>
                </button>
              ))}
              {candidates.length === 0 && (
                <div className="text-muted-foreground px-3 py-2 text-sm">Topilmadi</div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="font-medium">{pick.name}</div>
            {isFetching || !preview ? (
              <div className="text-muted-foreground">Tekshirilmoqda…</div>
            ) : (
              <>
                <ul className="list-inside list-disc space-y-1">
                  <li>{fmt(preview.patients)} bemor tarmoq bazasiga qo'shiladi</li>
                  <li>{preview.staff} xodim — o'z filialida qoladi</li>
                  <li>
                    Tarmoqda: {preview.company.branches}/{preview.company.max_branches} filial →
                    ulangach {preview.company.branches + 1}
                  </li>
                  {preview.open_shifts > 0 && (
                    <li className="text-amber-600">
                      {preview.open_shifts} ta ochiq kassa smenasi bor
                    </li>
                  )}
                  {preview.possible_duplicates > 0 && (
                    <li className="text-amber-600">
                      {preview.possible_duplicates} bemor tarmoqning boshqa filialida ham bo'lishi
                      mumkin — ulangach "Tarmoq markazi → Dublikatlar"da birlashtiriladi
                    </li>
                  )}
                  <li>
                    Klinika egasi o'z filialini boshqarishda davom etadi, lekin tarmoqning boshqa
                    filiallarini ko'rmaydi (kerak bo'lsa "Rahbariyat"ga qo'shing).
                  </li>
                </ul>
                {blockers.length > 0 && (
                  <div className="rounded-md bg-rose-500/10 p-2 text-rose-700">
                    {blockers.map((b) => (
                      <div key={b} className="flex items-center gap-1">
                        <AlertTriangle className="h-4 w-4" /> {BLOCKER_TEXT[b] ?? b}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <button type="button" className="text-xs underline" onClick={() => setPick(null)}>
              ← boshqa klinika
            </button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Yopish
          </Button>
          <Button
            disabled={!pick || !preview || blockers.length > 0 || link.isPending}
            onClick={() => link.mutate()}
          >
            Filial qilib ulash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewBranchDialog({
  companyId,
  onClose,
  onCreated,
}: {
  companyId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [city, setCity] = useState('');
  const [code, setCode] = useState('');
  const [copyCatalog, setCopyCatalog] = useState(true);
  const [copySettings, setCopySettings] = useState(true);
  const [email, setEmail] = useState('');
  const [managerName, setManagerName] = useState('');
  const [magic, setMagic] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.admin.networkCreateBranch(companyId, {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        city: city.trim() || undefined,
        branch_code: code.trim() || undefined,
        copy_catalog: copyCatalog,
        copy_settings: copySettings,
        manager_email: email.trim() || undefined,
        manager_full_name: managerName.trim() || undefined,
      }),
    onSuccess: (r) => {
      toast.success(`"${r.clinic.name}" filiali ochildi`);
      onCreated();
      if (r.magic_link) setMagic(r.magic_link);
      else onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Yangi filial ochish</DialogTitle>
        </DialogHeader>
        {magic ? (
          <div className="space-y-2 text-sm">
            <p>Filial menejeri uchun kirish havolasi (bir martalik):</p>
            <Input readOnly value={magic} onFocus={(e) => e.currentTarget.select()} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(magic);
                toast.success('Nusxa olindi');
              }}
            >
              Nusxa olish
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Filial nomi</Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  // Slug qo'lda yozilmagan bo'lsa — nomdan taklif
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                placeholder="Shifo Plus — Chilonzor"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Slug (manzil)</Label>
              <Input
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                placeholder="shifo-chilonzor"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Shahar</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Filial kodi</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={copyCatalog}
                  onChange={(e) => setCopyCatalog(e.target.checked)}
                />
                HQ katalogini nusxalash (xizmatlar, laboratoriya, diagnostika — narxlari bilan)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={copySettings}
                  onChange={(e) => setCopySettings(e.target.checked)}
                />
                HQ chek, blanka va logotipini nusxalash
              </label>
            </div>
            <div className="space-y-1.5">
              <Label>Menejer email (ixtiyoriy)</Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="menejer@..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Menejer F.I.Sh.</Label>
              <Input value={managerName} onChange={(e) => setManagerName(e.target.value)} />
            </div>
            <p className="text-muted-foreground text-xs sm:col-span-2">
              Tarif va obuna holati HQ'dan olinadi. Menejer berilmasa, filialni tarmoq egasi "filial
              almashtirgich" orqali o'zi sozlaydi.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {magic ? 'Yopish' : 'Bekor'}
          </Button>
          {!magic && (
            <Button
              disabled={name.trim().length < 2 || slug.trim().length < 3 || create.isPending}
              onClick={() => create.mutate()}
            >
              Filial ochish
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MembersCard({ data, onChanged }: { data: AdminNetworkDetail; onChanged: () => void }) {
  const cid = data.company.id;
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<NetworkMemberRole>('company_owner');
  const [ids, setIds] = useState<string[]>([]);
  const add = useMutation({
    mutationFn: () =>
      api.admin.networkAddMember(cid, {
        email: email.trim(),
        role,
        accessible_clinic_ids: role === 'branch_user' ? ids : [],
      }),
    onSuccess: () => {
      toast.success("A'zo saqlandi");
      setEmail('');
      setIds([]);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (memberId: string) => api.admin.networkRemoveMember(cid, memberId),
    onSuccess: () => {
      toast.success('Olib tashlandi');
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const branchName = (bid: string) => data.branches.find((b) => b.id === bid)?.name ?? bid;

  return (
    <section className="bg-card space-y-3 rounded-xl border p-4">
      <div className="font-semibold">Tarmoq rahbariyati</div>
      <p className="text-muted-foreground text-xs">
        Tarmoq egasi/admini istalgan filialga bir bosishda o'tadi va "Tarmoq markazi"da hammasini
        ko'radi. Hududiy menejer — faqat tanlangan filiallar. Filial xodimlari (a'zo bo'lmaganlar)
        faqat o'z filialida ishlaydi.
      </p>
      <div className="divide-y rounded-md border">
        {data.members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-2 p-2.5 text-sm">
            <span className="font-medium">{m.user?.full_name ?? '—'}</span>
            <span className="text-muted-foreground text-xs">{m.user?.email}</span>
            <Badge variant={m.role === 'company_owner' ? 'default' : 'secondary'}>
              {ROLE_LABEL[m.role]}
            </Badge>
            {m.role === 'branch_user' && (
              <span className="text-muted-foreground text-xs">
                {m.accessible_clinic_ids.length
                  ? m.accessible_clinic_ids.map(branchName).join(', ')
                  : 'barcha filiallar'}
              </span>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="ml-auto"
              disabled={remove.isPending}
              onClick={() => remove.mutate(m.id)}
              aria-label="Olib tashlash"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {data.members.length === 0 && (
          <div className="text-muted-foreground p-2.5 text-sm">A'zo yo'q</div>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} className="w-64" />
        </div>
        <div className="space-y-1.5">
          <Label>Rol</Label>
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
        </div>
        <Button disabled={!email.includes('@') || add.isPending} onClick={() => add.mutate()}>
          <UserPlus className="mr-1 h-4 w-4" /> Qo'shish / o'zgartirish
        </Button>
      </div>
      {role === 'branch_user' && (
        <div className="flex flex-wrap gap-2">
          {data.branches.map((b) => (
            <label
              key={b.id}
              className="flex items-center gap-1.5 rounded border px-2 py-1 text-sm"
            >
              <input
                type="checkbox"
                checked={ids.includes(b.id)}
                onChange={(e) =>
                  setIds(e.target.checked ? [...ids, b.id] : ids.filter((x) => x !== b.id))
                }
              />
              {b.name}
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

function AuditCard({ data }: { data: AdminNetworkDetail }) {
  const branchName = (bid: string | null) => data.branches.find((b) => b.id === bid)?.name ?? '';
  return (
    <section className="bg-card space-y-2 rounded-xl border p-4">
      <div className="font-semibold">Oxirgi amallar</div>
      {data.audit.length === 0 ? (
        <p className="text-muted-foreground text-sm">Hozircha yo'q.</p>
      ) : (
        <div className="max-h-80 divide-y overflow-y-auto text-sm">
          {data.audit.map((a) => (
            <div key={a.id} className="flex flex-wrap gap-2 py-1.5">
              <span className="text-muted-foreground w-36 shrink-0 text-xs">
                {new Date(a.created_at).toLocaleString('uz-UZ')}
              </span>
              <span>{ACTION_LABEL[a.action] ?? a.action}</span>
              {a.clinic_id && (
                <span className="text-muted-foreground text-xs">· {branchName(a.clinic_id)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
