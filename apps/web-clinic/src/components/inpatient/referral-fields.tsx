import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, cn } from '@clary/ui-web';
import type { ReferralPartner, ReferralPartnerType } from '@clary/api-client';
import { Phone, Plus, UserRoundSearch, X } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

// =============================================================================
// Statsionarga qabul: "Kelish turi" — o'zi keldi / shifokor yo'llanmasi.
// Yo'llanmada yo'llagan shifokor va agent ma'lumotnomadan (Sozlamalar →
// Agentlar) tanlanadi. Foiz sherik kartasidan olinadi — bu yerda o'zgartirilmaydi.
// =============================================================================

export type ReferralValue = {
  channel: 'self' | 'referral';
  doctorId: string | null;
  agentId: string | null;
};

export const EMPTY_REFERRAL: ReferralValue = { channel: 'self', doctorId: null, agentId: null };

/** Qabul formasi uchun: tanlangan, lekin hech kim belgilanmagan holat xatosi. */
export function referralError(v: ReferralValue): string | null {
  if (v.channel === 'referral' && !v.doctorId && !v.agentId) {
    return "Yo'llanma tanlangan — yo'llagan shifokor yoki agentni tanlang";
  }
  return null;
}

export const partnersKey = (type: ReferralPartnerType) => ['referral-partners', type] as const;

export function ReferralFields({
  value,
  onChange,
  hint = true,
}: {
  value: ReferralValue;
  onChange: (v: ReferralValue) => void;
  hint?: boolean;
}) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-muted-foreground text-xs font-semibold">Kelish turi</div>
        <div className="bg-muted/30 inline-flex rounded-lg border p-1">
          {(
            [
              { id: 'self', label: "O'zi keldi" },
              { id: 'referral', label: 'Shifokor yo‘llanmasi' },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() =>
                onChange(
                  o.id === 'self' ? EMPTY_REFERRAL : { ...value, channel: 'referral' as const },
                )
              }
              className={cn(
                'rounded px-3 py-1.5 text-xs font-medium transition',
                value.channel === o.id ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {value.channel === 'referral' && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PartnerPicker
              type="doctor"
              label="Yo‘llagan shifokor"
              value={value.doctorId}
              onChange={(id) => onChange({ ...value, doctorId: id })}
            />
            <PartnerPicker
              type="agent"
              label="Agent (ixtiyoriy)"
              value={value.agentId}
              onChange={(id) => onChange({ ...value, agentId: id })}
            />
          </div>
          {hint && (
            <div className="text-muted-foreground text-[11px]">
              Ulush xona to‘lovidan har kuni hisoblanadi. Foiz sherik kartasidan olinadi (Sozlamalar
              → Agentlar) — uni faqat admin o‘zgartiradi.
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function PartnerPicker({
  type,
  label,
  value,
  onChange,
}: {
  type: ReferralPartnerType;
  label: string;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', specialty: '', phone: '' });

  const { data: partners = [], isLoading } = useQuery({
    queryKey: partnersKey(type),
    queryFn: () => api.referralPartners.list({ type }),
    staleTime: 60_000,
  });
  const selected = partners.find((p) => p.id === value) ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    return partners
      .filter((p) => {
        if (!q) return true;
        const hay = [p.name, p.specialty, p.workplace].filter(Boolean).join(' ').toLowerCase();
        const tel = `${p.phone ?? ''} ${p.phone2 ?? ''}`.replace(/\D/g, '');
        return hay.includes(q) || (qDigits.length >= 3 && tel.includes(qDigits));
      })
      .slice(0, 8);
  }, [partners, query]);

  const createMut = useMutation({
    mutationFn: () =>
      api.referralPartners.create({
        type,
        name: form.name.trim(),
        specialty: form.specialty.trim() || null,
        phone: form.phone.trim() || null,
      }),
    onSuccess: (p) => {
      qc.setQueryData<ReferralPartner[]>(partnersKey(type), (old) => [...(old ?? []), p]);
      qc.invalidateQueries({ queryKey: ['referral-partners'] });
      onChange(p.id);
      setAdding(false);
      setForm({ name: '', specialty: '', phone: '' });
      setQuery('');
      toast.success(`${p.name} qo‘shildi`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-1 text-sm">
      <div className="text-muted-foreground text-xs font-medium">{label}</div>

      {selected ? (
        <div className="bg-muted/20 flex items-start justify-between gap-2 rounded-md border px-2.5 py-2">
          <div className="min-w-0">
            <div className="truncate font-medium">{selected.name}</div>
            <div className="text-muted-foreground truncate text-xs">
              {[selected.specialty, selected.workplace].filter(Boolean).join(' · ') || '—'}
            </div>
            {selected.phone && (
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <Phone className="h-3 w-3" />
                {selected.phone}
              </div>
            )}
            <div
              className={cn(
                'mt-0.5 text-xs font-medium',
                selected.commission_percent > 0 ? 'text-emerald-700' : 'text-amber-700',
              )}
            >
              {selected.commission_percent > 0
                ? `Xona to‘lovidan ${selected.commission_percent}%`
                : 'Foiz belgilanmagan (admin belgilaydi)'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-muted-foreground hover:text-foreground mt-0.5"
            title="Olib tashlash"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : adding ? (
        <div className="space-y-2 rounded-md border border-dashed p-2">
          <Input
            autoFocus
            placeholder="F.I.O. *"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            placeholder={type === 'doctor' ? 'Mutaxassisligi' : 'Ish joyi / izoh'}
            value={form.specialty}
            onChange={(e) => setForm({ ...form, specialty: e.target.value })}
          />
          <Input
            placeholder="Telefon (+998...)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>
              Bekor
            </Button>
            <Button
              size="sm"
              type="button"
              disabled={form.name.trim().length < 2 || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? 'Saqlanmoqda…' : 'Qo‘shish'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="relative">
            <UserRoundSearch className="text-muted-foreground absolute left-2.5 top-2.5 h-4 w-4" />
            <Input
              className="pl-8"
              placeholder={isLoading ? 'Yuklanmoqda…' : 'Ism, mutaxassislik yoki telefon…'}
              value={query}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
            />
          </div>
          {open && (
            <div className="max-h-48 overflow-auto rounded-md border">
              {matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="hover:bg-accent flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{p.name}</span>
                    {(p.specialty || p.phone) && (
                      <span className="text-muted-foreground block truncate text-xs">
                        {[p.specialty, p.phone].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {p.commission_percent}%
                  </span>
                </button>
              ))}
              {matches.length === 0 && !isLoading && (
                <div className="text-muted-foreground px-3 py-2 text-xs">
                  {partners.length === 0 ? 'Ro‘yxat bo‘sh' : 'Topilmadi'}
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setAdding(true);
                  setOpen(false);
                  setForm({ name: query.trim(), specialty: '', phone: '' });
                }}
                className="text-primary hover:bg-accent flex w-full items-center gap-1.5 border-t px-3 py-1.5 text-left text-xs font-medium"
              >
                <Plus className="h-3.5 w-3.5" />
                Yangi {type === 'doctor' ? 'shifokor' : 'agent'} qo‘shish
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
