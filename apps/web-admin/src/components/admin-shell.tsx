import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  BookOpenCheck,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  Globe,
  Heart,
  LayoutDashboard,
  LogOut,
  Radio,
  Search,
  Send,
  Server,
  Tag,
  Wallet,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { cn, Button, ClaryLogo, CommandPalette, ThemeToggle } from '@clary/ui-web';

import { api } from '@/lib/api';
import { supabase } from '@/main';
import { PwaInstallPrompt } from './pwa-install-prompt';

// =============================================================================
// Super-admin qobig'i. Yon menyuda faqat BO'LIMLAR (11 ta); bo'lim ichidagi
// sahifalar kontent tepasida tab bo'lib chiqadi. Ctrl+K — klinika yoki
// sahifani tez topish.
// =============================================================================

interface SectionTab {
  to: string;
  label: string;
}

interface Section {
  key: string;
  label: string;
  icon: typeof LayoutDashboard;
  group: 'main' | 'clients' | 'business' | 'platform';
  tabs: SectionTab[];
}

export const SECTIONS: Section[] = [
  {
    key: 'dashboard',
    label: 'Bosh sahifa',
    icon: LayoutDashboard,
    group: 'main',
    tabs: [{ to: '/dashboard', label: 'Bosh sahifa' }],
  },
  {
    key: 'clinics',
    label: 'Klinikalar',
    icon: Building2,
    group: 'clients',
    tabs: [
      { to: '/tenants', label: 'Klinikalar' },
      { to: '/networks', label: 'Filial tarmoqlari' },
      { to: '/pharmacies', label: 'Dorixonalar' },
      { to: '/doctors', label: 'Shifokorlar' },
      { to: '/archive', label: 'Arxiv' },
    ],
  },
  {
    key: 'leads',
    label: 'Lidlar',
    icon: Send,
    group: 'clients',
    tabs: [{ to: '/leads', label: 'Lidlar' }],
  },
  {
    key: 'plans',
    label: 'Tariflar va modullar',
    icon: Tag,
    group: 'business',
    tabs: [{ to: '/plans', label: 'Tariflar' }],
  },
  {
    key: 'finance',
    label: 'Moliya',
    icon: Wallet,
    group: 'business',
    tabs: [
      { to: '/subscriptions', label: 'Obunalar' },
      { to: '/billing-docs', label: 'Hisob-faktura va shartnomalar' },
      { to: '/revenue', label: 'Klinikalar tushumi' },
    ],
  },
  {
    key: 'analytics',
    label: 'Analitika',
    icon: BarChart3,
    group: 'business',
    tabs: [
      { to: '/analytics', label: 'Klinikalar dinamikasi' },
      { to: '/medications', label: 'Dorilar reytingi' },
      { to: '/diagnostics', label: 'Diagnostika' },
    ],
  },
  {
    key: 'messaging',
    label: 'Aloqa',
    icon: Radio,
    group: 'platform',
    tabs: [
      { to: '/broadcast', label: 'Xabar tarqatish' },
      { to: '/telegram-bots', label: 'Telegram botlar' },
      { to: '/notifications', label: 'Xabarnomalar jurnali' },
    ],
  },
  {
    key: 'references',
    label: 'Ma’lumotnomalar',
    icon: BookOpenCheck,
    group: 'platform',
    tabs: [
      { to: '/drug-reference', label: 'Dori katalogi (MXIK)' },
      { to: '/insurance-providers', label: 'Sug‘urta kompaniyalari' },
      { to: '/journal-layout', label: 'Jurnal shabloni' },
    ],
  },
  {
    key: 'portal',
    label: 'Axoli portali',
    icon: Heart,
    group: 'platform',
    tabs: [
      { to: '/portal-users', label: 'Foydalanuvchilar' },
      { to: '/moderation', label: 'Moderatsiya' },
    ],
  },
  {
    key: 'website',
    label: 'Websayt',
    icon: Globe,
    group: 'platform',
    tabs: [{ to: '/website', label: 'Websayt' }],
  },
  {
    key: 'system',
    label: 'Tizim',
    icon: Server,
    group: 'platform',
    tabs: [
      { to: '/system-health', label: 'Tizim holati' },
      { to: '/audit', label: 'Audit' },
    ],
  },
];

const GROUP_LABELS: Record<Section['group'], string> = {
  main: '',
  clients: 'Mijozlar',
  business: 'Biznes',
  platform: 'Platforma',
};

const matches = (path: string, to: string) => path === to || path.startsWith(`${to}/`);

function sectionOf(path: string): Section | undefined {
  return SECTIONS.find((s) => s.tabs.some((t) => matches(path, t.to)));
}

export function AdminShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('clary-admin-sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const [email, setEmail] = useState<string>('');
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const role = (data.session?.user.app_metadata as { role?: string } | undefined)?.role;
      if (!data.session || role !== 'super_admin') navigate('/login');
      else setEmail(data.session.user.email ?? '');
    });
  }, [navigate]);

  useEffect(() => {
    try {
      window.localStorage.setItem('clary-admin-sidebar', collapsed ? 'collapsed' : 'expanded');
    } catch {
      /* e'tiborsiz */
    }
  }, [collapsed]);

  const section = sectionOf(location.pathname);
  // Bo'lim tablari faqat ro'yxat sahifalarida (klinika kartasi kabi ichki
  // sahifada o'zining tablari bor — ikki qator tab chalg'itadi).
  const showTabs =
    !!section && section.tabs.length > 1 && section.tabs.some((t) => t.to === location.pathname);

  // Ctrl+K: sahifalar + klinikalar (palitra ochilganda yuklanadi)
  const clinicsQ = useQuery({
    queryKey: ['tenants', { q: '', includeDeleted: false }],
    queryFn: () => api.admin.listTenants({}),
    enabled: paletteOpen,
    staleTime: 60_000,
  });
  const paletteItems = useMemo(() => {
    const pages = SECTIONS.flatMap((s) =>
      s.tabs.map((t) => ({
        id: `page:${t.to}`,
        label: s.tabs.length > 1 ? `${s.label} → ${t.label}` : s.label,
        group: 'Sahifalar',
        onSelect: () => navigate(t.to),
      })),
    );
    const clinics = (clinicsQ.data ?? []).map((c) => ({
      id: `clinic:${c.id}`,
      label: c.name,
      description: `${c.slug} · ${c.current_plan}`,
      group: 'Klinikalar',
      onSelect: () => navigate(`/tenants/${c.id}`),
    }));
    return [...pages, ...clinics];
  }, [clinicsQ.data, navigate]);

  const groups = (['main', 'clients', 'business', 'platform'] as const).map((g) => ({
    key: g,
    label: GROUP_LABELS[g],
    items: SECTIONS.filter((s) => s.group === g),
  }));

  return (
    <div className="bg-background text-foreground flex h-screen overflow-hidden">
      <aside
        className={cn(
          'bg-card/60 flex flex-col border-r transition-[width] duration-200 ease-out',
          collapsed ? 'w-[68px]' : 'w-60',
        )}
        aria-label="Sidebar"
      >
        <div className="flex h-14 items-center gap-2 border-b px-4">
          {collapsed ? (
            <ClaryLogo variant="mark" size="md" />
          ) : (
            <>
              <ClaryLogo variant="full" size="md" className="text-foreground" />
              <span className="border-border/60 text-muted-foreground ml-1 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                Super
              </span>
            </>
          )}
        </div>

        <div className="p-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className={cn(
              'text-muted-foreground hover:bg-accent hover:text-foreground flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
              collapsed && 'justify-center px-0',
            )}
            title="Qidirish (Ctrl+K)"
          >
            <Search className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Qidirish…</span>
                <kbd className="bg-muted rounded px-1.5 text-[10px]">Ctrl K</kbd>
              </>
            )}
          </button>
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-2">
          {groups.map((group) => (
            <div key={group.key} className="mt-3 first:mt-0">
              {!collapsed && group.label && (
                <div className="text-muted-foreground px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider">
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((s) => {
                  const Icon = s.icon;
                  const active = section?.key === s.key;
                  return (
                    <NavLink
                      key={s.key}
                      to={s.tabs[0]!.to}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        collapsed && 'justify-center px-0',
                      )}
                      title={collapsed ? s.label : undefined}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="truncate">{s.label}</span>}
                      {active && (
                        <span className="bg-primary absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r" />
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className={cn('border-t p-3', collapsed ? 'space-y-2' : 'space-y-3')}>
          {!collapsed && <ThemeToggle className="w-full justify-between" />}
          {collapsed && <ThemeToggle compact className="mx-auto" />}
          <div className={cn('flex items-center gap-2', collapsed && 'justify-center')}>
            <div className="bg-primary/15 text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
              {email ? email.slice(0, 2).toUpperCase() : 'SA'}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 text-xs">
                <div className="truncate font-medium">{email || 'Super Admin'}</div>
                <div className="text-muted-foreground text-[10px]">super_admin</div>
              </div>
            )}
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={async () => {
                  await supabase.auth.signOut();
                  navigate('/login');
                }}
                title="Chiqish"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className={cn('w-full justify-center gap-2', collapsed && 'px-0')}
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Menyuni ochish' : 'Menyuni yig‘ish'}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <ChevronsLeft className="h-4 w-4" />
            )}
            {!collapsed && <span className="text-xs">{'Yig‘ish'}</span>}
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        {showTabs && section && (
          <div className="bg-background/95 sticky top-0 z-20 border-b backdrop-blur">
            <div className="mx-auto flex max-w-[1600px] items-end gap-1 overflow-x-auto px-6 pt-3">
              <span className="text-muted-foreground mr-3 pb-2.5 text-xs font-semibold uppercase tracking-wider">
                {section.label}
              </span>
              {section.tabs.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  className={({ isActive }) =>
                    cn(
                      '-mb-px whitespace-nowrap border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'border-primary text-foreground'
                        : 'text-muted-foreground hover:text-foreground border-transparent',
                    )
                  }
                >
                  {t.label}
                </NavLink>
              ))}
            </div>
          </div>
        )}
        <div className="mx-auto max-w-[1600px] p-6">
          <Outlet />
        </div>
      </main>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={paletteItems}
        placeholder="Klinika yoki sahifa nomi…"
      />
      <PwaInstallPrompt />
    </div>
  );
}
