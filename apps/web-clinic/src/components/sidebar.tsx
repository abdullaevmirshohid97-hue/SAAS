import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, Users, ListOrdered, Stethoscope, FlaskConical,
  Pill, Bed, Wallet, FileText, BarChart3, Megaphone, Settings as SettingsIcon,
  UserSquare2, Coins, HeartPulse,
} from 'lucide-react';

import { cn, ClaryLogo } from '@clary/ui-web';

interface Props {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: Props) {
  const { t } = useTranslation();

  const items = [
    { to: '/dashboard',   icon: LayoutDashboard, label: t('nav.dashboard') },
    { to: '/reception',   icon: Users,           label: t('nav.reception') },
    { to: '/queue',       icon: ListOrdered,     label: t('nav.queue') },
    { to: '/doctor',      icon: UserSquare2,     label: t('nav.doctor', 'Shifokor') },
    { to: '/diagnostics', icon: Stethoscope,     label: t('nav.diagnostics') },
    { to: '/lab',         icon: FlaskConical,    label: t('nav.lab') },
    { to: '/pharmacy',    icon: Pill,            label: t('nav.pharmacy') },
    { to: '/inpatient',   icon: Bed,             label: t('nav.inpatient') },
    { to: '/nurse',       icon: HeartPulse,      label: t('nav.nurse', 'Hamshira') },
    { to: '/cashier',     icon: Wallet,          label: t('nav.cashier') },
    { to: '/journal',     icon: FileText,        label: t('nav.journal') },
    { to: '/analytics',   icon: BarChart3,       label: t('nav.analytics') },
    { to: '/marketing',   icon: Megaphone,       label: t('nav.marketing') },
    { to: '/payroll',     icon: Coins,           label: t('nav.payroll', 'Hisob-kitob') },
    { to: '/settings',    icon: SettingsIcon,    label: t('nav.settings') },
  ];

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onMobileClose} />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r bg-background transition-transform lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b px-6">
          <ClaryLogo variant="full" size="md" className="text-foreground" />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              onClick={onMobileClose}
              className={({ isActive }) => cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <it.icon className="h-4 w-4" />
              <span>{it.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3 text-xs text-muted-foreground">
          <div>Clary v2.0</div>
          <div>© 2026 Clary LLC</div>
        </div>
      </aside>
    </>
  );
}
