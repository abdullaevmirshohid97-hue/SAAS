import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Filter,
  Megaphone,
  MessageSquare,
  Plus,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  StatCard,
  Textarea,
} from '@clary/ui-web';

import { api } from '@/lib/api';

type SegmentFilter = {
  gender?: 'male' | 'female' | 'other' | 'unknown';
  age_min?: number;
  age_max?: number;
  referral_sources?: string[];
  lifecycle?: Array<'new' | 'active' | 'warming' | 'cooling' | 'passive'>;
  min_total_spent_uzs?: number;
  min_visits?: number;
  days_since_activity_min?: number;
  phone_required?: boolean;
  has_inpatient?: boolean;
};

const LIFECYCLE_LABELS: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'default' }> = {
  new: { label: 'Yangi', tone: 'info' },
  active: { label: 'Faol', tone: 'success' },
  warming: { label: 'Isiyotgan', tone: 'default' },
  cooling: { label: 'Sovuyotgan', tone: 'warning' },
  passive: { label: 'Passiv', tone: 'danger' },
};

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

export function MarketingPage() {
  const [tab, setTab] = useState<'overview' | 'segments' | 'campaigns' | 'adhoc'>('overview');
  const qc = useQueryClient();

  const ltv = useQuery({ queryKey: ['mkt', 'ltv'], queryFn: () => api.marketing.ltv() });
  const segments = useQuery({ queryKey: ['mkt', 'segments'], queryFn: () => api.marketing.listSegments() });
  const campaigns = useQuery({ queryKey: ['mkt', 'campaigns'], queryFn: () => api.marketing.listCampaigns() });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Marketing</h1>
          <p className="text-sm text-muted-foreground">Bemorlarni segmentlang va xabarnomalar jo‘nating</p>
        </div>
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
          {[
            { id: 'overview', label: 'Umumiy', icon: Sparkles },
            { id: 'segments', label: 'Segmentlar', icon: Target },
            { id: 'campaigns', label: 'Kampaniyalar', icon: Megaphone },
            { id: 'adhoc', label: 'Tezkor SMS', icon: MessageSquare },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id as typeof tab)}
              className={
                'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition ' +
                (tab === id ? 'bg-background shadow-elevation-1' : 'text-muted-foreground')
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && <OverviewTab data={ltv.data} />}
      {tab === 'segments' && (
        <SegmentsTab
          items={segments.data ?? []}
          onCreated={() => qc.invalidateQueries({ queryKey: ['mkt', 'segments'] })}
        />
      )}
      {tab === 'campaigns' && (
        <CampaignsTab
          items={campaigns.data ?? []}
          segments={segments.data ?? []}
          onRefresh={() => qc.invalidateQueries({ queryKey: ['mkt', 'campaigns'] })}
        />
      )}
      {tab === 'adhoc' && <AdhocTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
function OverviewTab({
  data,
}: {
  data:
    | {
        totals: { patients: number; revenue_uzs: number; avg_ltv_uzs: number };
        lifecycle: Record<string, { count: number; revenue: number }>;
      }
    | undefined;
}) {
  const totals = data?.totals;
  const lifecycle = data?.lifecycle ?? {};
  const maxCount = Math.max(1, ...Object.values(lifecycle).map((v) => v.count));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <StatCard label="Jami bemorlar" value={String(totals?.patients ?? 0)} icon={<Users className="h-4 w-4" />} />
        <StatCard
          label="Umumiy LTV"
          value={fmt(totals?.revenue_uzs ?? 0)}
          hint="UZS"
          tone="success"
        />
        <StatCard
          label="O‘rtacha LTV"
          value={fmt(totals?.avg_ltv_uzs ?? 0)}
          hint="UZS / bemor"
          tone="info"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bemorlar hayotiy davriyligi</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(LIFECYCLE_LABELS).map(([key, meta]) => {
              const v = lifecycle[key] ?? { count: 0, revenue: 0 };
              return (
                <div key={key} className="grid grid-cols-[140px_1fr_auto] items-center gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant={meta.tone === 'default' ? 'secondary' : (meta.tone as never)}>{meta.label}</Badge>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{ width: `${(v.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <div className="text-right text-muted-foreground">
                    <span className="font-semibold text-foreground">{v.count}</span> · {fmt(v.revenue)} UZS
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
function SegmentsTab({
  items,
  onCreated,
}: {
  items: Array<{ id: string; name: string; description: string | null; patient_count_cached: number | null; filter_query: Record<string, unknown>; created_at: string }>;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{items.length} ta segment</div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Yangi segment
        </Button>
      </div>
      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-sm text-muted-foreground">
            <Target className="mb-3 h-10 w-10 opacity-40" />
            Segmentlar yo‘q. Filtr yordamida bemorlar guruhini yarating.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((s) => (
            <Card key={s.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{s.name}</div>
                  <Badge variant="secondary">{s.patient_count_cached ?? 0} bemor</Badge>
                </div>
                {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                <div className="flex flex-wrap gap-1 pt-1">
                  {Object.entries(s.filter_query).map(([k, v]) => (
                    <Badge key={k} variant="outline" className="text-[10px]">
                      {k}: {Array.isArray(v) ? v.join(',') : String(v)}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {open && <SegmentDialog onClose={() => setOpen(false)} onCreated={onCreated} />}
    </div>
  );
}

function SegmentDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [filter, setFilter] = useState<SegmentFilter>({ phone_required: true });

  const preview = useQuery({
    queryKey: ['mkt', 'preview', filter],
    queryFn: () =>
      api.marketing.previewSegment({ filter_query: filter as Record<string, unknown> }, 10),
  });

  const create = useMutation({
    mutationFn: () =>
      api.marketing.createSegment({
        name,
        description: description || undefined,
        filter_query: filter as Record<string, unknown>,
      }),
    onSuccess: () => {
      toast.success('Segment yaratildi');
      onCreated();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Filter className="h-4 w-4" /> Yangi segment
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <Field label="Nomi">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Aktiv bemorlar" />
            </Field>
            <Field label="Izoh">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <SegmentFilterEditor value={filter} onChange={setFilter} />
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Ko‘rib chiqish</span>
              <Badge variant="secondary">{preview.data?.count ?? 0} bemor</Badge>
            </div>
            <div className="max-h-64 space-y-1 overflow-auto text-xs">
              {(preview.data?.sample ?? []).map((p) => (
                <div key={p.patient_id} className="flex items-center justify-between rounded border bg-background px-2 py-1">
                  <div>
                    <div className="font-medium">{p.full_name}</div>
                    <div className="text-muted-foreground">{p.phone ?? 'telefon yo‘q'}</div>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {p.lifecycle_stage}
                  </Badge>
                </div>
              ))}
              {(preview.data?.sample ?? []).length === 0 && (
                <div className="py-6 text-center text-muted-foreground">Mos bemor yo‘q</div>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <Button variant="ghost" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            Saqlash
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SegmentFilterEditor({
  value,
  onChange,
}: {
  value: SegmentFilter;
  onChange: (v: SegmentFilter) => void;
}) {
  const toggleLifecycle = (l: NonNullable<SegmentFilter['lifecycle']>[number]) => {
    const next = new Set(value.lifecycle ?? []);
    if (next.has(l)) next.delete(l);
    else next.add(l);
    onChange({ ...value, lifecycle: Array.from(next) });
  };
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
      <Field label="Hayotiy davr">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(LIFECYCLE_LABELS).map(([k, meta]) => {
            const active = value.lifecycle?.includes(k as never);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleLifecycle(k as never)}
                className={
                  'rounded-md border px-2.5 py-1 text-xs transition ' +
                  (active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')
                }
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Jinsi">
          <select
            value={value.gender ?? ''}
            onChange={(e) => onChange({ ...value, gender: (e.target.value || undefined) as SegmentFilter['gender'] })}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">Hammasi</option>
            <option value="male">Erkak</option>
            <option value="female">Ayol</option>
          </select>
        </Field>
        <Field label="Min. tashriflar">
          <Input
            type="number"
            min={0}
            value={value.min_visits ?? ''}
            onChange={(e) => onChange({ ...value, min_visits: e.target.value ? Number(e.target.value) : undefined })}
          />
        </Field>
        <Field label="Min. LTV (UZS)">
          <Input
            type="number"
            min={0}
            value={value.min_total_spent_uzs ?? ''}
            onChange={(e) =>
              onChange({ ...value, min_total_spent_uzs: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </Field>
        <Field label="Oxirgi faollikdan (kun)">
          <Input
            type="number"
            min={0}
            value={value.days_since_activity_min ?? ''}
            onChange={(e) =>
              onChange({ ...value, days_since_activity_min: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={value.phone_required ?? false}
          onChange={(e) => onChange({ ...value, phone_required: e.target.checked })}
        />
        Faqat telefon raqami bo‘lganlar
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={value.has_inpatient ?? false}
          onChange={(e) => onChange({ ...value, has_inpatient: e.target.checked || undefined })}
        />
        Statsionarda yotganlar
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
function CampaignsTab({
  items,
  segments,
  onRefresh,
}: {
  items: Array<{
    id: string;
    name: string;
    status: string;
    channel: string;
    stats: Record<string, number> | null;
    variants: { default?: { body: string } } | null;
    segment: { id: string; name: string; patient_count_cached: number | null } | null;
  }>;
  segments: Array<{ id: string; name: string; patient_count_cached: number | null }>;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{items.length} ta kampaniya</div>
        <Button size="sm" onClick={() => setOpen(true)} disabled={segments.length === 0}>
          <Plus className="mr-1 h-4 w-4" /> Yangi kampaniya
        </Button>
      </div>
      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-sm text-muted-foreground">
            <Megaphone className="mb-3 h-10 w-10 opacity-40" />
            Kampaniyalar yo‘q
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((c) => (
            <CampaignCard key={c.id} c={c} onRefresh={onRefresh} />
          ))}
        </div>
      )}
      {open && <CampaignDialog segments={segments} onClose={() => setOpen(false)} onCreated={onRefresh} />}
    </div>
  );
}

function CampaignCard({
  c,
  onRefresh,
}: {
  c: {
    id: string;
    name: string;
    status: string;
    channel: string;
    stats: Record<string, number> | null;
    variants: { default?: { body: string } } | null;
    segment: { id: string; name: string; patient_count_cached: number | null } | null;
  };
  onRefresh: () => void;
}) {
  const [body, setBody] = useState(c.variants?.default?.body ?? '');
  const send = useMutation({
    mutationFn: () => api.marketing.sendCampaign(c.id, body),
    onSuccess: (r) => {
      toast.success(`Jo‘natildi: ${r.enqueued}/${r.total_candidates}`);
      onRefresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-semibold">{c.name}</div>
            <div className="text-xs text-muted-foreground">
              {c.segment?.name ?? 'Segmentsiz'} · {c.segment?.patient_count_cached ?? 0} bemor
            </div>
          </div>
          <Badge variant={c.status === 'running' ? 'success' : c.status === 'draft' ? 'secondary' : 'outline'}>
            {c.status}
          </Badge>
        </div>
        <Textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Xabar matni. {{name}} — bemor ismi"
        />
        <div className="grid grid-cols-4 gap-2 text-xs">
          <Stat v={c.stats?.sent ?? 0} l="Jo‘natildi" />
          <Stat v={c.stats?.delivered ?? 0} l="Yetdi" />
          <Stat v={c.stats?.opened ?? 0} l="Ochildi" />
          <Stat v={c.stats?.converted ?? 0} l="Konv." />
        </div>
        <div className="flex justify-end">
          <Button size="sm" disabled={!body.trim() || send.isPending} onClick={() => send.mutate()}>
            Jo‘natish
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ v, l }: { v: number; l: string }) {
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="text-muted-foreground">{l}</div>
      <div className="font-semibold">{v}</div>
    </div>
  );
}

function CampaignDialog({
  segments,
  onClose,
  onCreated,
}: {
  segments: Array<{ id: string; name: string; patient_count_cached: number | null }>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [segmentId, setSegmentId] = useState(segments[0]?.id ?? '');
  const [body, setBody] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.marketing.createCampaign({
        name,
        channel: 'sms',
        target_segment_id: segmentId,
        message_body: body,
      }),
    onSuccess: () => {
      toast.success('Kampaniya yaratildi');
      onCreated();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yangi kampaniya</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Nomi">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Segment">
            <select
              value={segmentId}
              onChange={(e) => setSegmentId(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.patient_count_cached ?? 0})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Xabar">
            <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Bekor
          </Button>
          <Button disabled={!name.trim() || !segmentId || create.isPending} onClick={() => create.mutate()}>
            Yaratish
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function AdhocTab() {
  const [filter, setFilter] = useState<SegmentFilter>({ phone_required: true, lifecycle: ['active', 'warming'] });
  const [body, setBody] = useState('');
  const preview = useQuery({
    queryKey: ['mkt', 'adhoc-preview', filter],
    queryFn: () =>
      api.marketing.previewSegment({ filter_query: filter as Record<string, unknown> }, 10),
  });
  const send = useMutation({
    mutationFn: () =>
      api.marketing.sendAdhoc({
        filter_query: filter as Record<string, unknown>,
        message_body: body,
      }),
    onSuccess: (r) => toast.success(`Navbatga qo‘yildi: ${r.enqueued ?? 0}`),
    onError: (e: Error) => toast.error(e.message),
  });
  const totalCount = preview.data?.count ?? 0;
  const expensiveText = useMemo(
    () => (totalCount > 200 ? 'Katta jo‘natish — tekshirib jo‘nating' : 'Nisbatan kichik yuborish'),
    [totalCount],
  );

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" /> Bemor filtri
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SegmentFilterEditor value={filter} onChange={setFilter} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" /> SMS matni
            <Badge variant="secondary" className="ml-auto">
              {totalCount} qabul qiladi
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Hurmatli {{name}}, klinikamizdan salom! ..."
          />
          <div className="text-xs text-muted-foreground">
            {body.length} belgi · {expensiveText}
          </div>
          <div className="max-h-40 space-y-1 overflow-auto rounded-md border bg-muted/30 p-2 text-xs">
            {(preview.data?.sample ?? []).map((p) => (
              <div key={p.patient_id} className="flex justify-between">
                <span>{p.full_name}</span>
                <span className="text-muted-foreground">{p.phone ?? '—'}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button disabled={!body.trim() || totalCount === 0 || send.isPending} onClick={() => send.mutate()}>
              {totalCount} ta bemorga jo‘natish
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
