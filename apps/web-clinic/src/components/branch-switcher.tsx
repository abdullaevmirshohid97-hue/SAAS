import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, Check, ChevronDown, Home, Loader2, MapPin } from 'lucide-react';
import { toast } from 'sonner';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { expectBranch } from '@/lib/branch-header';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';

// Filial nuqtasi rangi: belgilanmagan bo'lsa nomdan barqaror rang
const FALLBACK = ['#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777'];
export function branchColor(id: string, color?: string | null): string {
  if (color) return color;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length]!;
}

/**
 * Faol filialni almashtiradi: server JWT'dagi clinic_id ni o'zgartiradi →
 * sessiya yangilanadi → ilova yangi filial bilan to'liq qayta yuklanadi
 * (kesh, Realtime, softfon toza boshlanadi). Xato bo'lsa — throw.
 */
export async function switchToBranch(id: string, path = '/dashboard'): Promise<void> {
  await api.company.switchBranch(id);
  expectBranch(id);
  await supabase.auth.refreshSession();
  window.location.assign(path);
}

/**
 * Header'dagi filial almashtirgich — tarmoq rahbariyati bir joydan 10 tagacha
 * filialga o'tadi. Faqat 2+ filialga kira oladigan foydalanuvchida ko'rinadi.
 */
export function BranchSwitcher() {
  const { clinicId, workspace } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['company-access'],
    queryFn: () => api.company.access(),
    enabled: workspace === 'clinic' && !!clinicId,
    staleTime: 5 * 60_000,
  });
  const branches = data?.branches ?? [];
  if (branches.length < 2) return null;

  const active = branches.find((b) => b.clinic_id === clinicId) ?? null;
  const canSeeNetwork = branches.some((b) => b.member_role !== null);

  async function go(id: string) {
    if (id === clinicId || busy) return;
    setBusy(id);
    try {
      await switchToBranch(id);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="hover:bg-muted flex max-w-[44vw] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm font-medium sm:max-w-[16rem]"
            aria-label="Filialni almashtirish"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: branchColor(active?.clinic_id ?? '', active?.branch_color) }}
            />
            <span className="truncate">{active?.name ?? 'Filial'}</span>
            {active?.is_hq && (
              <span className="bg-primary/10 text-primary rounded px-1 text-[10px] font-semibold">
                HQ
              </span>
            )}
            <ChevronDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[16rem]">
          <DropdownMenuLabel className="normal-case">Filialni tanlang</DropdownMenuLabel>
          {branches.map((b) => (
            <DropdownMenuItem key={b.clinic_id} onSelect={() => void go(b.clinic_id)}>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: branchColor(b.clinic_id, b.branch_color) }}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5 truncate">
                  {b.name}
                  {b.is_hq && (
                    <span className="bg-primary/10 text-primary rounded px-1 text-[10px] font-semibold">
                      HQ
                    </span>
                  )}
                </span>
                {(b.city || b.is_home) && (
                  <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
                    {b.is_home ? <Home className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                    {b.is_home ? 'Uy filialingiz' : b.city}
                  </span>
                )}
              </span>
              {busy === b.clinic_id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : b.clinic_id === clinicId ? (
                <Check className="text-primary h-4 w-4" />
              ) : null}
            </DropdownMenuItem>
          ))}
          {canSeeNetwork && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate('/company')}>
                <Building2 className="h-4 w-4" />
                Tarmoq markazi
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {busy && (
        <div className="bg-background/70 fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-sm">
          <div className="bg-card flex items-center gap-3 rounded-xl border px-5 py-4 text-sm font-medium shadow-lg">
            <Loader2 className="h-5 w-5 animate-spin" />
            {branches.find((b) => b.clinic_id === busy)?.name ?? 'Filial'}ga o‘tilmoqda…
          </div>
        </div>
      )}
    </>
  );
}
