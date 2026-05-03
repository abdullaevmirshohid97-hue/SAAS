import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, Users, ListOrdered, Stethoscope, FlaskConical,
  Pill, Bed, Wallet, FileText, BarChart3, Megaphone, Settings as SettingsIcon,
  UserSquare2, Coins, HeartPulse, ChevronsLeft, ChevronsRight, Star,
} from 'lucide-react';

import { cn, ClaryLogo } from '@clary/ui-web';

interface Props {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

interface NavItem { to: string; icon: typeof Users; label: string; }
interface NavGroup { title: string; items: NavItem[]; }

const COLLAPSE_KEY = 'clary.sidebar.collapsed';

export function Sidebar({ mobileOpen, onMobileClose }: Props) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  });

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  const groups: NavGroup[] = [
    {
      title: t('nav.group.main', 'Asosiy'),
      items: [
        { to: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard') },
        { to: '/reception', icon: Users,           label: t('nav.reception') },
        { to: '/queue',     icon: ListOrdered,     label: t('nav.queue') },
      ],
    },
    {
      title: t('nav.group.clinical', 'Klinik'),
      items: [
        { to: '/doctor',      icon: UserSquare2,  label: t('nav.doctor', 'Shifokor') },
        { to: '/diagnostics', icon: Stethoscope,  label: t('nav.diagnostics') },
        { to: '/lab',         icon: FlaskConical, label: t('nav.lab') },
        { to: '/pharmacy',    icon: Pill,         label: t('nav.pharmacy') },
        { to: '/inpatient',   icon: Bed,          label: t('nav.inpatient') },
        { to: '/nurse',       icon: HeartPulse,   label: t('nav.nurse', 'Hamshira') },
      ],
    },
    {
      title: t('nav.group.finance', 'Moliya'),
      items: [
        { to: '/cashier', icon: Wallet,   label: t('nav.cashier') },
        { to: '/journal', icon: FileText, label: t('nav.journal') },
        { to: '/payroll', icon: Coins,    label: t('nav.payroll', 'Hisob-kitob') },
      ],
    },
    {
      title: t('nav.group.insights', 'Tahlil'),
      items: [
        { to: '/analytics', icon: BarChart3, label: t('nav.analytics') },
        { to: '/marketing', icon: Megaphone, label: t('nav.marketing') },
        { to: '/reviews',   icon: Star,      label: t('nav.reviews', 'Sharhlar') },
      ],
    },
    {
      title: t('nav.group.system', 'Tizim'),
      items: [
        { to: '/settings', icon: SettingsIcon, label: t('nav.settings') },
      ],
    },
  ];

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onMobileClose} />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r bg-background transition-[width,transform] lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          collapsed ? 'w-[68px]' : 'w-60',
        )}
      >
        <div className={cn('flex h-14 items-center gap-2 border-b', collapsed ? 'justify-center px-2' : 'px-6')}>
          {collapsed
            ? <ClaryLogo variant="mark" size="md" className="text-foreground" />
            : <ClaryLogo variant="full" size="md" className="text-foreground" />}
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {groups.map((g) => (
            <div key={g.title} className="mb-3">
              {!collapsed && (
                <div className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {g.title}
                </div>
              )}
              <div className="space-y-0.5">
                {g.items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    onClick={onMobileClose}
                    title={collapsed ? it.label : undefined}
                    className={({ isActive }) => cn(
                      'group relative flex items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors',
                      collapsed ? 'justify-center px-2' : 'px-3',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-primary" />
                        )}
                        <it.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span className="truncate">{it.label}</span>}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="hidden border-t px-3 py-2 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground lg:flex lg:items-center lg:gap-2"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed && <span>Yig'ish</span>}
        </button>
        {!collapsed && (
          <div className="border-t p-3 text-xs text-muted-foreground">
            <div>Clary v2.0</div>
            <div>© 2026 Clary LLC</div>
          </div>
        )}
      </aside>
    </>
  );
}
