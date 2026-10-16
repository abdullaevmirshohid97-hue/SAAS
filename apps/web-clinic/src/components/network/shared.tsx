import { useQuery } from '@tanstack/react-query';

import type { NetworkBranch } from '@clary/api-client';

import { api } from '@/lib/api';
import { branchColor } from '@/components/branch-switcher';
import type { Preset } from '@/components/analytics/preset-bar';

export const fmt = (n: number | null | undefined) =>
  Math.round(Number(n ?? 0)).toLocaleString('uz-UZ');

export function todayTashkent(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
}

/** Analitika preset'idan aniq sanalar (Toshkent vaqti) */
export function presetRange(
  preset: Preset,
  customFrom: string,
  customTo: string,
): { from: string; to: string } {
  const to = todayTashkent();
  if (preset === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo };
  const d = new Date(`${to}T00:00:00`);
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  if (preset === 'today') return { from: to, to };
  if (preset === 'week') {
    const w = new Date(d);
    w.setDate(w.getDate() - 6);
    return { from: iso(w), to };
  }
  if (preset === 'year') return { from: `${d.getFullYear()}-01-01`, to };
  return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to };
}

export function useNetworkMy() {
  return useQuery({ queryKey: ['company-my'], queryFn: () => api.company.my(), staleTime: 60_000 });
}

export function BranchDot({ id, color }: { id: string; color?: string | null }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: branchColor(id, color) }}
    />
  );
}

export function BranchName({
  branch,
}: {
  branch: Pick<NetworkBranch, 'id' | 'name' | 'is_hq' | 'branch_color'>;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <BranchDot id={branch.id} color={branch.branch_color} />
      <span className="truncate">{branch.name}</span>
      {branch.is_hq && (
        <span className="bg-primary/10 text-primary rounded px-1 text-[10px] font-semibold">
          HQ
        </span>
      )}
    </span>
  );
}

/** Filiallarni belgilash (checkbox) — katalog/sozlama tarqatish va a'zo ruxsatlari uchun */
export function BranchChecklist({
  branches,
  value,
  onChange,
  exclude,
}: {
  branches: NetworkBranch[];
  value: string[];
  onChange: (ids: string[]) => void;
  exclude?: string[];
}) {
  const list = branches.filter((b) => !exclude?.includes(b.id));
  const all = list.length > 0 && list.every((b) => value.includes(b.id));
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-xs font-medium">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => onChange(e.target.checked ? list.map((b) => b.id) : [])}
        />
        Hammasi
      </label>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {list.map((b) => (
          <label
            key={b.id}
            className="hover:bg-muted/50 flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
          >
            <input
              type="checkbox"
              checked={value.includes(b.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, b.id] : value.filter((x) => x !== b.id))
              }
            />
            <BranchName branch={b} />
          </label>
        ))}
      </div>
    </div>
  );
}

export function nameOf(i18n: Record<string, string> | null | undefined): string {
  if (!i18n) return '—';
  return i18n['uz-Latn'] ?? i18n.uz ?? i18n.ru ?? Object.values(i18n)[0] ?? '—';
}

export const STATUS_LABEL: Record<string, string> = {
  in_transit: "Yo'lda",
  received: 'Qabul qilindi',
  canceled: 'Bekor qilindi',
};
