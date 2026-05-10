import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, Users, ListOrdered, Stethoscope, FlaskConical,
  Pill, Bed, Wallet, FileText, BarChart3, Megaphone, Settings as SettingsIcon,
  UserSquare2, Coins, HeartPulse, ChevronsLeft, ChevronsRight, Star,
} from 'lucide-react';

import { cn, ClaryLogo } from '@clary/ui-web';
import type { PermissionKey } from '@clary/schemas';

import { useAuth } from '@/providers/auth-provider';

interface Props {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

interface NavItem {
  to: string;
  icon: typeof Users;
  label: string;
  // The route is shown when the user holds at least one of these
  // permissions. Empty/undefined = always visible.
  requires?: PermissionKey[];
}
interface NavGroup { title: string; items: NavItem[]; }

const COLLAPSE_KEY = 'clary.sidebar.collapsed';

export function Sidebar({ mobileOpen, onMobileClose }: Props) {
  const { t } = useTranslation();
  const { can, role } = useAuth();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  });

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  const isOwner = role === 'clinic_owner' || role === 'clinic_admin';

  const allGroups: NavGroup[] = [
    {
      title: t('nav.group.main', 'Asosiy'),
      items: [
        { to: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard') },
        { to: '/reception', icon: Users, label: t('nav.reception'), requires: ['appointments.create', 'patients.create', 'queue.view'] },
        { to: '/queue', icon: ListOrdered, label: t('nav.queue'), requires: ['queue.view'] },
      ],
    },
    {
      title: t('nav.group.clinical', 'Klinik'),
      items: [
        { to: '/doctor', icon: UserSquare2, label: t('nav.doctor', 'Shifokor'), requires: ['doctor_view.view'] },
        { to: '/diagnostics', icon: Stethoscope, label: t('nav.diagnostics'), requires: ['diagnostics.view'] },
        { to: '/lab', icon: FlaskConical, label: t('nav.lab'), requires: ['lab.view'] },
        { to: '/pharmacy', icon: Pill, label: t('nav.pharmacy'), requires: ['pharmacy.view'] },
        { to: '/inpatient', icon: Bed, label: t('nav.inpatient'), requires: ['inpatient.view'] },
        { to: '/nurse', icon: HeartPulse, label: t('nav.nurse', 'Hamshira'), requires: ['nurse.view_tasks'] },
        { to: '/nurse-requests', icon: HeartPulse, label: t('nav.nurseRequests', 'Uyga so‘rovlar'), requires: ['home_nurse.view'] },
      ],
    },
    {
      title: t('nav.group.finance', 'Moliya'),
      items: [
        { to: '/cashier', icon: Wallet, label: t('nav.cashier'), requires: ['cashier.view'] },
        { to: '/journal', icon: FileText, label: t('nav.journal'), requires: ['audit.view'] },
        { to: '/payroll', icon: Coins, label: t('nav.payroll', 'Hisob-kitob'), requires: ['payroll.view_own'] },
      ],
    },
    {
      title: t('nav.group.insights', 'Tahlil'),
      items: [
        { to: '/analytics', icon: BarChart3, label: t('nav.analytics'), requires: ['analytics.view_self', 'analytics.view_clinic'] },
        { to: '/marketing', icon: Megaphone, label: t('nav.marketing'), requires: ['marketing.view'] },
        { to: '/reviews', icon: Star, label: t('nav.reviews', 'Sharhlar'), requires: ['marketing.view'] },
      ],
    },
    {
      title: t('nav.group.system', 'Tizim'),
      items: [
        // Settings is owner/admin only — both roles already get ALL_PERMISSIONS
        { to: '/settings', icon: SettingsIcon, label: t('nav.settings'), requires: ['settings.view'] },
      ],
    },
  ];

  const groups = useMemo(() => {
    return allGroups
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => {
          if (isOwner) return true;
          if (!it.requires || it.requires.length === 0) return true;
          return can(...it.requires);
        }),
      }))
      .filter((g) => g.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, can, isOwner]);

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
