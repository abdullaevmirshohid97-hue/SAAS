import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';

import { cn, ClaryLogo } from '@clary/ui-web';

import { useAuth } from '@/providers/auth-provider';
import { useAppearance } from '@/providers/appearance-provider';
import { useNavGroups, orderNavGroups } from '@/hooks/use-nav-groups';

interface Props {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

const COLLAPSE_KEY = 'clary.sidebar.collapsed';

export function Sidebar({ mobileOpen, onMobileClose }: Props) {
  const { role, user } = useAuth();
  const { settings } = useAppearance();
  const navGroups = useNavGroups();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  });

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Appearance sozlamasidagi tartib bo'yicha bo'lim va qatorlarni saralash.
  const groups = useMemo(
    () => orderNavGroups(navGroups, settings.sidebarGroupOrder, settings.sidebarItemOrder),
    [navGroups, settings.sidebarGroupOrder, settings.sidebarItemOrder],
  );

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
            <div key={g.key} className="mb-3">
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
        {/* Footer — joriy xodim, rol, online status */}
        {collapsed ? (
          <div className="flex items-center justify-center border-t py-3" title="Onlayn">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
          </div>
        ) : (
          <div className="border-t p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                {(user?.email ?? 'U').slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">
                  {user?.email ?? 'Foydalanuvchi'}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Onlayn · {ROLE_LABEL[role] ?? role}
                </div>
              </div>
            </div>
            <div className="mt-2 text-[10px] text-muted-foreground">
              Clary v2.0 · © 2026 Clary LLC
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

// Rol kodi -> o'zbekcha yorliq (footer'da ko'rsatish uchun)
const ROLE_LABEL: Record<string, string> = {
  clinic_owner: 'Klinika egasi',
  clinic_admin: 'Administrator',
  doctor: 'Shifokor',
  nurse: 'Hamshira',
  reception: 'Qabulxona',
  cashier: 'Kassir',
  lab: 'Laborant',
  pharmacist: 'Farmatsevt',
  staff: 'Xodim',
  super_admin: 'Super admin',
};
