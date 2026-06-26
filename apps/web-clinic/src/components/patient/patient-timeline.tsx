import { useMemo, useState } from 'react';
import {
  Activity, Bed, CalendarDays, FileText, FlaskConical, Paperclip, Pill,
  Receipt, ScanLine, Search, Send, ShoppingBag, Stethoscope,
} from 'lucide-react';
import { Badge, Input, EmptyState } from '@clary/ui-web';

// 360° Patient Timeline — bemorning butun tibbiy tarixi bitta xronologik oynada.
// patients.timeline endpoint'idagi events[] (read-time aggregation) ni ko'rsatadi.

export interface TimelineEvent {
  id: string;
  type:
    | 'visit' | 'note' | 'lab' | 'diagnostic' | 'prescription'
    | 'pharmacy' | 'payment' | 'inpatient' | 'vital' | 'referral' | 'file';
  date: string;
  title: string;
  subtitle?: string | null;
  status?: string;
  ref_id: string;
  module: string;
  abnormal?: boolean;
  amount_uzs?: number;
  icd?: { code: string; name: string };
  attachments?: Array<{ name: string; url: string }>;
  details?: Record<string, unknown>;
}

type Meta = { label: string; icon: typeof CalendarDays; cls: string };
const TYPE_META: Record<TimelineEvent['type'], Meta> = {
  visit: { label: 'Tashrif', icon: CalendarDays, cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  note: { label: 'Qayd', icon: Stethoscope, cls: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' },
  lab: { label: 'Laboratoriya', icon: FlaskConical, cls: 'bg-teal-500/15 text-teal-600 dark:text-teal-400' },
  diagnostic: { label: 'Diagnostika', icon: ScanLine, cls: 'bg-purple-500/15 text-purple-600 dark:text-purple-400' },
  prescription: { label: 'Retsept', icon: Pill, cls: 'bg-green-500/15 text-green-600 dark:text-green-400' },
  pharmacy: { label: 'Dorixona', icon: ShoppingBag, cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  payment: { label: "To'lov", icon: Receipt, cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  inpatient: { label: 'Statsionar', icon: Bed, cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
  vital: { label: 'Vital', icon: Activity, cls: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  referral: { label: "Yo'naltirish", icon: Send, cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
  file: { label: 'Hujjat', icon: FileText, cls: 'bg-slate-500/15 text-slate-600 dark:text-slate-400' },
};

const FILTERS: Array<{ id: 'all' | TimelineEvent['type']; label: string }> = [
  { id: 'all', label: 'Hammasi' },
  { id: 'visit', label: 'Tashrif' }, { id: 'note', label: 'Qayd' },
  { id: 'lab', label: 'Tahlil' }, { id: 'diagnostic', label: 'Diagnostika' },
  { id: 'prescription', label: 'Retsept' }, { id: 'pharmacy', label: 'Dorixona' },
  { id: 'payment', label: "To'lov" }, { id: 'inpatient', label: 'Statsionar' },
  { id: 'vital', label: 'Vital' },
];

const fmtMoney = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
function fmtDateTime(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
const yearOf = (v: string) => (Number.isNaN(new Date(v).getTime()) ? '—' : new Date(v).getFullYear().toString());

function EventDetails({ e }: { e: TimelineEvent }) {
  const d = e.details ?? {};
  const rows: React.ReactNode[] = [];

  if (e.icd?.code) rows.push(<span key="icd"><Badge variant="secondary" className="font-mono text-[10px]">{e.icd.code}</Badge> {e.icd.name}</span>);
  if (e.type === 'lab') {
    const items = (d.items as Array<{ name?: string; status?: string }>) ?? [];
    rows.push(<span key="labs">{items.map((it) => it.name).filter(Boolean).join(', ') || 'Tahlillar'}</span>);
    if (e.abnormal) rows.push(<span key="ab" className="font-semibold text-red-600 dark:text-red-400">⚠ Normadan chetlagan natija</span>);
  }
  if (e.type === 'diagnostic' && d.impression) rows.push(<span key="imp">{String(d.impression)}</span>);
  if (e.type === 'prescription') {
    const items = (d.items as Array<{ medication_name_snapshot?: string; quantity?: number }>) ?? [];
    rows.push(<span key="rx">{items.map((it) => `${it.medication_name_snapshot ?? ''}${it.quantity ? ` ×${it.quantity}` : ''}`).filter(Boolean).join(', ')}</span>);
  }
  if (e.type === 'pharmacy') {
    const items = (d.items as Array<{ name_snapshot?: string; quantity?: number }>) ?? [];
    rows.push(<span key="ph">{items.map((it) => `${it.name_snapshot ?? ''}${it.quantity ? ` ×${it.quantity}` : ''}`).filter(Boolean).join(', ')}</span>);
  }
  if (e.type === 'vital') {
    const parts: string[] = [];
    if (d.bp) parts.push(`BP ${d.bp}`);
    if (d.pulse) parts.push(`Puls ${d.pulse}`);
    if (d.temp) parts.push(`${d.temp}°C`);
    if (d.spo2) parts.push(`SpO₂ ${d.spo2}%`);
    if (d.weight) parts.push(`${d.weight} kg`);
    rows.push(<span key="v">{parts.join(' · ') || 'Vital belgilar'}</span>);
  }
  if (e.type === 'inpatient' && d.epicrisis) rows.push(<span key="ep">{String(d.epicrisis)}</span>);
  if (e.type === 'note') {
    const sp = d.soap_assessment || d.soap_plan;
    if (sp) rows.push(<span key="soap">{String(sp)}</span>);
  }
  if (typeof e.amount_uzs === 'number' && e.amount_uzs !== 0)
    rows.push(<span key="amt" className="font-semibold">{fmtMoney(e.amount_uzs)} so'm</span>);
  if (e.attachments && e.attachments.length > 0)
    rows.push(
      <span key="att" className="flex flex-wrap gap-2">
        {e.attachments.map((a, i) => (
          <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            <Paperclip className="h-3 w-3" /> {a.name}
          </a>
        ))}
      </span>,
    );

  if (rows.length === 0) return null;
  return <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">{rows.map((r, i) => <div key={i}>{r}</div>)}</div>;
}

export function PatientTimeline({ events }: { events: TimelineEvent[] }) {
  const [filter, setFilter] = useState<'all' | TimelineEvent['type']>('all');
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (filter !== 'all' && e.type !== filter) return false;
      if (!needle) return true;
      const hay = `${e.title} ${e.subtitle ?? ''} ${e.icd?.code ?? ''} ${e.icd?.name ?? ''} ${JSON.stringify(e.details ?? {})}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [events, filter, q]);

  // Yil bo'yicha guruhlash (tartib saqlanadi — events allaqachon desc)
  const groups = useMemo(() => {
    const m = new Map<string, TimelineEvent[]>();
    for (const e of filtered) {
      const y = yearOf(e.date);
      if (!m.has(y)) m.set(y, []);
      m.get(y)!.push(e);
    }
    return Array.from(m.entries());
  }, [filtered]);

  return (
    <div className="space-y-4">
      {/* Qidiruv */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qidirish: Diabetes, MRT, retsept…" className="pl-9" />
      </div>

      {/* Filtr chiplari */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.id ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:border-primary/40 hover:text-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Hech narsa topilmadi" description="Filtr yoki qidiruvni o'zgartiring." />
      ) : (
        <div className="space-y-6">
          {groups.map(([year, items]) => (
            <div key={year}>
              <div className="sticky top-0 z-10 mb-2 bg-background/95 py-1 text-sm font-bold text-muted-foreground backdrop-blur">{year}</div>
              <ol className="relative space-y-3 border-l border-border pl-6">
                {items.map((e) => {
                  const meta = TYPE_META[e.type];
                  const Icon = meta.icon;
                  return (
                    <li key={e.id} className="relative">
                      <span className={`absolute -left-[34px] flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-background ${meta.cls}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="rounded-lg border bg-card p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{e.title}</span>
                              <Badge variant="outline" className="text-[10px]">{meta.label}</Badge>
                              {e.abnormal && <Badge className="bg-red-600 text-[10px] text-white hover:bg-red-600">chetlagan</Badge>}
                              {e.status && <Badge variant="secondary" className="text-[10px]">{e.status}</Badge>}
                            </div>
                            {e.subtitle && <div className="text-xs text-muted-foreground">{e.subtitle}</div>}
                          </div>
                          <div className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(e.date)}</div>
                        </div>
                        <EventDetails e={e} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
