import { useState } from 'react';
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
  email: string;
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

export function LeadsPage() {
  const [status, setStatus] = useState<string>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Lead | null>(null);

  const { data } = useQuery({
    queryKey: ['admin', 'leads', { status, q }],
    queryFn: () =>
      api.admin.listLeads({
        status: status === 'all' ? undefined : status,
        q: q || undefined,
        limit: 100,
      }),
  });
  const items = (data?.items ?? []) as Lead[];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sales Lead’lar</h1>
          <p className="text-sm text-muted-foreground">
            Veb-sayt kontakt va demo formalaridan kelgan so‘rovlar
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          Jami: <span className="font-semibold text-foreground">{total}</span>
        </div>
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
                  className="cursor-pointer border-b last:border-0 hover:bg-accent/50"
                  onClick={() => setSelected(l)}
                >
                  <td className="p-3 font-medium">{l.full_name}</td>
                  <td className="p-3">
                    <div className="flex flex-col gap-0.5 text-xs">
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {l.email}
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
              {items.length === 0 && (
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
            {lead.email}
            {lead.phone ? ` · ${lead.phone}` : ''}
            {lead.clinic_name ? ` · ${lead.clinic_name}` : ''}
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
          <a
            href={`mailto:${lead.email}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent"
          >
            <Mail className="h-4 w-4" />
            Email yozish
          </a>
          <Button disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
