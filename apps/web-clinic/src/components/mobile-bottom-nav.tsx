import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ListOrdered, Users, Wallet, MoreHorizontal } from 'lucide-react';

import { cn } from '@clary/ui-web';

const ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Asosiy' },
  { to: '/queue',     icon: ListOrdered,     label: 'Navbat' },
  { to: '/reception', icon: Users,           label: 'Qabul' },
  { to: '/cashier',   icon: Wallet,          label: 'Kassa' },
  { to: '/settings',  icon: MoreHorizontal,  label: 'Boshqa' },
];

export function MobileBottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {ITEMS.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          className={({ isActive }) => cn(
            'flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] transition-colors',
            isActive ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <it.icon className="h-5 w-5" />
          <span>{it.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
