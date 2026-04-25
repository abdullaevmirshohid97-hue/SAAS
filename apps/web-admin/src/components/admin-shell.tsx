import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Building2,
  BarChart3,
  ShieldCheck,
  Flag,
  MessageCircle,
  LayoutDashboard,
  LogOut,
  Stethoscope,
  Pill,
  Wallet,
  CreditCard,
  Globe,
  ChevronsLeft,
  ChevronsRight,
  Users,
  Activity,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn, Button, ClaryLogo, ThemeToggle } from '@clary/ui-web';

import { supabase } from '@/main';
import { PwaInstallPrompt } from './pwa-install-prompt';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  group: 'overview' | 'network' | 'finance' | 'platform';
}

const NAV: NavItem[] = [
  { to: '/dashboard',     label: 'Dashboard',      icon: LayoutDashboard, group: 'overview' },
  { to: '/tenants',       label: 'Klinikalar',     icon: Building2,       group: 'network'  },
  { to: '/doctors',       label: 'Shifokorlar',    icon: Stethoscope,     group: 'network'  },
  { to: '/patients',      label: 'Bemorlar',       icon: Users,           group: 'network'  },
  { to: '/pharmacies',    label: 'Dorixonalar',    icon: Pill,            group: 'network'  },
  { to: '/medications',   label: 'Dorilar',        icon: Pill,            group: 'network'  },
  { to: '/diagnostics',   label: 'Diagnostika',    icon: Activity,        group: 'network'  },
  { to: '/analytics',     label: 'Analitika',      icon: BarChart3,       group: 'finance'  },
  { to: '/revenue',       label: 'Tushum',         icon: Wallet,          group: 'finance'  },
  { to: '/payments',      label: 'To\u2018lovlar', icon: CreditCard,      group: 'finance'  },
  { to: '/debts',         label: 'Qarzdorlar',     icon: Wallet,          group: 'finance'  },
  { to: '/support',       label: 'Support',        icon: MessageCircle,   group: 'platform' },
  { to: '/audit',         label: 'Audit',          icon: ShieldCheck,     group: 'platform' },
  { to: '/feature-flags', label: 'Feature flags',  icon: Flag,            group: 'platform' },
  { to: '/website',       label: 'Websayt',        icon: Globe,           group: 'platform' },
];

const GROUP_LABELS: Record<NavItem['group'], string> = {
  overview: 'Overview',
  network:  'Tarmoq',
  finance:  'Moliya',
  platform: 'Platforma',
};

export function AdminShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('clary-admin-sidebar') === 'collapsed';
  });
  const [email, setEmail] = useState<string>('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const role = (data.session?.user.app_metadata as { role?: string } | undefined)?.role;
      if (!data.session || role !== 'super_admin') navigate('/login');
      else setEmail(data.session.user.email ?? '');
    });
  }, [navigate]);

  useEffect(() => {
    window.localStorage.setItem('clary-admin-sidebar', collapsed ? 'collapsed' : 'expanded');
  }, [collapsed]);

  const grouped = (['overview', 'network', 'finance', 'platform'] as const).map((g) => ({
    key: g,
    label: GROUP_LABELS[g],
    items: NAV.filter((n) => n.group === g),
  }));

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside
        className={cn(
          'flex flex-col border-r bg-card/60 transition-[width] duration-200 ease-out',
          collapsed ? 'w-[68px]' : 'w-64',
        )}
        aria-label="Sidebar"
      >
        <div className="flex h-14 items-center gap-2 border-b px-4">
          {collapsed ? (
            <ClaryLogo variant="mark" size="md" />
          ) : (
            <>
              <ClaryLogo variant="full" size="md" className="text-foreground" />
              <span className="ml-1 rounded border border-border/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Super</span>
            </>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto scrollbar-thin p-2">
          {grouped.map((group) => (
            <div key={group.key} className="mt-4 first:mt-2">
              {!collapsed && (
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((n) => {
                  const Icon = n.icon;
                  const active = location.pathname.startsWith(n.to);
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          (isActive || active)
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                          collapsed && 'justify-center px-0',
                        )
                      }
                      title={collapsed ? n.label : undefined}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="truncate">{n.label}</span>}
                      {(active || location.pathname.startsWith(n.to)) && (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary" />
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
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {email ? email.slice(0, 2).toUpperCase() : 'SA'}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 text-xs">
                <div className="truncate font-medium">{email || 'Super Admin'}</div>
                <div className="text-[10px] text-muted-foreground">super_admin</div>
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
                title="Sign out"
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
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            {!collapsed && <span className="text-xs">{'Yig\u2018ish'}</span>}
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1600px] p-6">
          <Outlet />
        </div>
      </main>
      <PwaInstallPrompt />
    </div>
  );
}
