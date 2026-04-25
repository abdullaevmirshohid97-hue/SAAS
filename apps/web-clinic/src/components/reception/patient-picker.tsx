import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, User2, X } from 'lucide-react';
import { Button, EmptyState, Input } from '@clary/ui-web';

import { api } from '@/lib/api';

type Patient = {
  id: string;
  full_name: string;
  last_name?: string | null;
  phone?: string | null;
  dob?: string | null;
};

export interface PatientPickerProps {
  value: string | null;
  label: string;
  onChange: (id: string | null, label: string) => void;
  placeholder?: string;
}

export function PatientPicker({ value, label, onChange, placeholder }: PatientPickerProps) {
  const [q, setQ] = useState('');
  const { data, isFetching } = useQuery({
    queryKey: ['patients', q],
    queryFn: () => api.patients.list({ q, page: 1, pageSize: 20 }),
    enabled: q.length > 1 && value === null,
  });
  const items = (data as { items?: Patient[] } | undefined)?.items ?? [];

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border bg-primary/5 p-3">
        <div className="flex items-center gap-2.5">
          <User2 className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{label || 'Mijoz tanlangan'}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onChange(null, '')}
          aria-label="O'zgartirish"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={placeholder ?? 'Mijozni qidiring (ism yoki telefon)'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {q.length >= 2 && (
        <div className="max-h-56 overflow-y-auto rounded border">
          {isFetching ? (
            <div className="p-3 text-xs text-muted-foreground">Qidirilmoqda…</div>
          ) : items.length === 0 ? (
            <div className="p-3">
              <EmptyState title="Topilmadi" description="Boshqa ism/raqam kiriting" />
            </div>
          ) : (
            items.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange(p.id, p.full_name);
                  setQ('');
                }}
                className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/40"
              >
                <span className="truncate font-medium">{p.full_name}</span>
                <span className="text-xs text-muted-foreground">{p.phone ?? ''}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
