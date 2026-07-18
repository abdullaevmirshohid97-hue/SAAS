import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@clary/ui-web';
import { Mail, Phone, Search } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

type Lead = {
  id: string;
  full_name: string;
  email: string | null; // instant_demo lidlarida email yo'q
  phone: string | null;
  clinic_name: string | null;
  message: string | null;
  source: string | null;
  status: string;
  notes: string | null;
  assigned_to: string | null;
  created_at: string;
};

const STATUSES = [
  { value: 'all', label: 'Barchasi' },
  { value: 'new', label: 'Yangi', tone: 'info' },
  { value: 'contacted', label: 'Qayta aloqada', tone: 'warning' },
  { value: 'qualified', label: 'Tasdiqlangan', tone: 'success' },
  { value: 'converted', label: 'Mijoz bo‘ldi', tone: 'success' },
  { value: 'lost', label: 'Yo‘qotilgan', tone: 'destructive' },
] as const;

const STATUS_TONE: Record<string, 'info' | 'warning' | 'success' | 'destructive' | 'default'> = {
  new: 'info',
  contacted: 'warning',
  qualified: 'success',
  converted: 'success',
  lost: 'destructive',
};

type LeadsTab = 'sales' | 'site' | 'newsletter';

// ── A1: real-time kuzatuv ────────────────────────────────────────────────────
// Har 30 soniyada avto-yangilanish + "oxirgi ko'rilgan" vaqt localStorage'da.
// Badge = shu vaqtdan keyin kelgan lidlar soni; ko'rilgan tab avtomatik nolga
// tushadi, jadvalda esa yangi qatorlar sessiya davomida belgilanib turadi.
const LEADS_REFETCH_MS = 30_000;
const SEEN_KEYS = {
  sales: 'clary.admin.leads.seen.sales',
  site: 'clary.admin.leads.seen.site',
} as const;

function getSeen(key: string): number {
  try {
    const v = localStorage.getItem(key);
    return v ? Number(v) : 0;
  } catch {
    return 0;
  }
}

function markSeen(key: string) {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    /* localStorage yo'q bo'lsa e'tiborsiz */
  }
}

function countNew(rows: Array<{ created_at: string }>, seen: number): number {
  // Birinchi ochilishда (seen yo'q) hammasini "yangi" deb bosmaymiz.
  if (!seen) return 0;
  return rows.filter((r) => new Date(r.created_at).getTime() > seen).length;
}

export function LeadsPage() {
  const [tab, setTab] = useState<LeadsTab>('sales');
  // Bolalar markSeen qilganda badge'lar qayta hisoblansin.
  const [seenVersion, setSeenVersion] = useState(0);
  const bumpSeen = () => setSeenVersion((v) => v + 1);

  // Badge uchun feed'lar — bolalarning default querylari bilan bir xil kalit,
  // shuning uchun cache ulashiladi (qo'shimcha so'rov ketmaydi).
  const salesFeed = useQuery({
    queryKey: ['admin', 'leads', { status: 'all', q: '' }],
    queryFn: () => api.admin.listLeads({ limit: 100 }),
    refetchInterval: LEADS_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
  const siteFeed = useQuery({
    queryKey: ['admin', 'site-leads', { q: '' }],
    queryFn: () => api.admin.listSiteLeads({ limit: 200 }),
    refetchInterval: LEADS_REFETCH_MS,
    refetchOnWindowFocus: true,
  });

  void seenVersion; // getSeen o'qishlari shu state orqali yangilanadi
  const newCounts: Record<LeadsTab, number> = {
    sales: countNew(((salesFeed.data?.items ?? []) as Lead[]), getSeen(SEEN_KEYS.sales)),
    site: countNew(((siteFeed.data?.data ?? []) as SiteLead[]), getSeen(SEEN_KEYS.site)),
    newsletter: 0,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sotuv lidlari</h1>
          <p className="text-sm text-muted-foreground">
            Saytdan kelgan barcha so‘rovlar — har 30 soniyada avtomatik yangilanadi
          </p>
        </div>
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
          {([
            { id: 'sales', label: 'Murojaatlar' },
            { id: 'site', label: 'Sayt lidlari' },
            { id: 'newsletter', label: 'Obunachilar' },
          ] as const).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={
                'rounded-sm px-3 py-1.5 text-sm transition-colors ' +
                (tab === id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              {label}
              {newCounts[id] > 0 && (
                <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold leading-4 text-white">
                  +{newCounts[id]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {tab === 'sales' && <SalesLeadsTab onSeen={bumpSeen} />}
      {tab === 'site' && <SiteLeadsTab onSeen={bumpSeen} />}
      {tab === 'newsletter' && <NewsletterTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Murojaatlar — sales_leads (kontakt + demo formalar)
// ---------------------------------------------------------------------------
function SalesLeadsTab({ onSeen }: { onSeen: () => void }) {
  const [status, setStatus] = useState<string>('all');
  const [source, setSource] = useState<string>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Lead | null>(null);

  // Tab ochilгандаги "oxirgi ko'rilgan" — sessiya davomida yangi qatorlarni
  // belgilash uchun muzlatib olamiz; keyin seen'ni yangilaymiz (badge nolga tushadi).
  const prevSeenRef = useRef(getSeen(SEEN_KEYS.sales));

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'leads', { status, q }],
    queryFn: () =>
      api.admin.listLeads({
        status: status === 'all' ? undefined : status,
        q: q || undefined,
        limit: 100,
      }),
    refetchInterval: LEADS_REFETCH_MS,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (data) {
      markSeen(SEEN_KEYS.sales);
      onSeen();
    }
  }, [data, onSeen]);

  const isNewRow = (l: Lead) =>
    prevSeenRef.current > 0 && new Date(l.created_at).getTime() > prevSeenRef.current;

  // Manba filtri (contact_form/demo_form) client tomonida — ro'yxat 100 tagacha.
  const items = ((data?.items ?? []) as Lead[]).filter(
    (l) => source === 'all' || l.source === source,
  );
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="text-right text-sm text-muted-foreground">
        Jami: <span className="font-semibold text-foreground">{total}</span>
      </div>

      {/* Filtrlar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Ism, email, telefon yoki klinika..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">Barcha manbalar</option>
            <option value="contact_form">Kontakt forma</option>
            <option value="demo_form">Demo so‘rov</option>
            <option value="instant_demo">Instant demo (1-klik)</option>
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3">Ism</th>
                <th className="p-3">Aloqa</th>
                <th className="p-3">Klinika</th>
                <th className="p-3">Manba</th>
                <th className="p-3">Holat</th>
                <th className="p-3">Sana</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr
                  key={l.id}
                  className={
                    'cursor-pointer border-b last:border-0 hover:bg-accent/50 ' +
                    (isNewRow(l) ? 'bg-emerald-500/5' : '')
                  }
                  onClick={() => setSelected(l)}
                >
                  <td className="p-3 font-medium">
                    {l.full_name}
                    {isNewRow(l) && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                        Yangi
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-col gap-0.5 text-xs">
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {l.email ?? '—'}
                      </span>
                      {l.phone && (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Phone className="h-3 w-3" />
                          {l.phone}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3">{l.clinic_name ?? '—'}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {l.source ?? '—'}
                  </td>
                  <td className="p-3">
                    <Badge variant={STATUS_TONE[l.status] ?? 'default'}>
                      {STATUSES.find((s) => s.value === l.status)?.label ?? l.status}
                    </Badge>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {new Date(l.created_at).toLocaleString('uz-UZ', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
              {isLoading && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                    Yuklanmoqda…
                  </td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-sm">
                    <span className="text-destructive">
                      Yuklashda xatolik: {(error as Error)?.message ?? 'server xatosi'}
                    </span>
                    <Button variant="outline" size="sm" className="ml-3" onClick={() => refetch()}>
                      Qayta urinish
                    </Button>
                  </td>
                </tr>
              )}
              {!isLoading && !isError && items.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                    Lead topilmadi
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {selected && (
        <LeadDetailDialog lead={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function LeadDetailDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(lead.status);
  const [notes, setNotes] = useState(lead.notes ?? '');

  const saveMut = useMutation({
    mutationFn: () => api.admin.updateLead(lead.id, { status, notes }),
    onSuccess: () => {
      toast.success('Saqlandi');
      qc.invalidateQueries({ queryKey: ['admin', 'leads'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lead.full_name}</DialogTitle>
          <DialogDescription>
            {[lead.email, lead.phone, lead.clinic_name].filter(Boolean).join(' · ') || '—'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {lead.message && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
              {lead.message}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Holat</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              {STATUSES.filter((s) => s.value !== 'all').map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Izoh (ichki)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Mijoz bilan suhbat haqida eslatma..."
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Manba: <span className="font-medium">{lead.source ?? '—'}</span> ·{' '}
            Kelgan: {new Date(lead.created_at).toLocaleString('uz-UZ')}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Yopish
          </Button>
          {lead.email && (
            <a
              href={`mailto:${lead.email}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent"
            >
              <Mail className="h-4 w-4" />
              Email yozish
            </a>
          )}
          <Button disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sayt lidlari — `leads` jadvali (footer obuna, exit-intent modal).
// Ilgari admin UI'da umuman ko'rinmas edi.
// ---------------------------------------------------------------------------
type SiteLead = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  clinic_name: string | null;
  message: string | null;
  source: string;
  status: string;
  notes: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  created_at: string;
};

const SITE_SOURCES: Record<string, string> = {
  newsletter: 'Obuna (footer)',
  'exit-intent': 'Exit-intent',
  exit_intent: 'Exit-intent',
};

function SiteLeadsTab({ onSeen }: { onSeen: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<SiteLead | null>(null);

  const prevSeenRef = useRef(getSeen(SEEN_KEYS.site));

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'site-leads', { q }],
    queryFn: () => api.admin.listSiteLeads({ q: q || undefined, limit: 200 }),
    refetchInterval: LEADS_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
  const items = data?.data ?? [];

  useEffect(() => {
    if (data) {
      markSeen(SEEN_KEYS.site);
      onSeen();
    }
  }, [data, onSeen]);

  const isNewRow = (l: { created_at: string }) =>
    prevSeenRef.current > 0 && new Date(l.created_at).getTime() > prevSeenRef.current;

  const saveMut = useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: string; notes: string }) =>
      api.admin.updateSiteLead(id, { status, notes }),
    onSuccess: () => {
      toast.success('Saqlandi');
      qc.invalidateQueries({ queryKey: ['admin', 'site-leads'] });
      setSelected(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Ism, email, telefon yoki klinika..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="text-sm text-muted-foreground">
            Jami: <span className="font-semibold text-foreground">{data?.total ?? 0}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3">Aloqa</th>
                <th className="p-3">Manba</th>
                <th className="p-3">UTM</th>
                <th className="p-3">Holat</th>
                <th className="p-3">Sana</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr
                  key={l.id}
                  className={
                    'cursor-pointer border-b last:border-0 hover:bg-accent/50 ' +
                    (isNewRow(l) ? 'bg-emerald-500/5' : '')
                  }
                  onClick={() => setSelected(l as SiteLead)}
                >
                  <td className="p-3">
                    <div className="font-medium">
                      {l.name ?? l.email ?? l.phone ?? '—'}
                      {isNewRow(l) && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                          Yangi
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[l.email, l.phone, l.clinic_name].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className="p-3">
                    <Badge variant="outline">{SITE_SOURCES[l.source] ?? l.source}</Badge>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {[l.utm_source, l.utm_campaign].filter(Boolean).join(' / ') || '—'}
                  </td>
                  <td className="p-3">
                    <Badge variant={STATUS_TONE[l.status] ?? 'default'}>
                      {STATUSES.find((s) => s.value === l.status)?.label ?? l.status}
                    </Badge>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {new Date(l.created_at).toLocaleString('uz-UZ', {
                      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
              {isLoading && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">
                    Yuklanmoqda…
                  </td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-sm">
                    <span className="text-destructive">
                      Yuklashda xatolik: {(error as Error)?.message ?? 'server xatosi'}
                    </span>
                    <Button variant="outline" size="sm" className="ml-3" onClick={() => refetch()}>
                      Qayta urinish
                    </Button>
                  </td>
                </tr>
              )}
              {!isLoading && !isError && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">
                    Sayt lidlari topilmadi
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {selected && (
        <SiteLeadDialog
          lead={selected}
          saving={saveMut.isPending}
          onSave={(status, notes) => saveMut.mutate({ id: selected.id, status, notes })}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function SiteLeadDialog({
  lead,
  saving,
  onSave,
  onClose,
}: {
  lead: SiteLead;
  saving: boolean;
  onSave: (status: string, notes: string) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState(lead.status);
  const [notes, setNotes] = useState(lead.notes ?? '');

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lead.name ?? lead.email ?? lead.phone ?? 'Sayt lidi'}</DialogTitle>
          <DialogDescription>
            {[lead.email, lead.phone, lead.clinic_name].filter(Boolean).join(' · ') || '—'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {lead.message && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">{lead.message}</div>
          )}
          <div className="space-y-1.5">
            <Label>Holat</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              {STATUSES.filter((s) => s.value !== 'all').map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Izoh (ichki)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          <div className="text-xs text-muted-foreground">
            Manba: <span className="font-medium">{SITE_SOURCES[lead.source] ?? lead.source}</span> ·{' '}
            Kelgan: {new Date(lead.created_at).toLocaleString('uz-UZ')}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Yopish</Button>
          {lead.email && (
            <a
              href={`mailto:${lead.email}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent"
            >
              <Mail className="h-4 w-4" /> Email yozish
            </a>
          )}
          <Button disabled={saving} onClick={() => onSave(status, notes)}>Saqlash</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Obunachilar — newsletter_subscriptions (ro'yxat + CSV eksport)
// ---------------------------------------------------------------------------
function NewsletterTab() {
  const { data } = useQuery({
    queryKey: ['admin', 'newsletter'],
    queryFn: () => api.admin.listNewsletter(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const items = data ?? [];

  const exportCsv = async () => {
    try {
      const { csv } = await api.admin.newsletterCsv();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `newsletter-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Jami obunachilar: <span className="font-semibold text-foreground">{items.length}</span>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv}>
          CSV yuklab olish
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3">Email</th>
                <th className="p-3">Til</th>
                <th className="p-3">Manba</th>
                <th className="p-3">Obuna sanasi</th>
                <th className="p-3">Holat</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">{s.email}</td>
                  <td className="p-3 text-xs text-muted-foreground">{s.locale ?? '—'}</td>
                  <td className="p-3 text-xs text-muted-foreground">{s.source ?? '—'}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {new Date(s.subscribed_at).toLocaleDateString('uz-UZ')}
                  </td>
                  <td className="p-3">
                    {s.unsubscribed_at ? (
                      <Badge variant="destructive">Chiqib ketgan</Badge>
                    ) : (
                      <Badge variant="success">Faol</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">
                    Obunachilar yo‘q
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
