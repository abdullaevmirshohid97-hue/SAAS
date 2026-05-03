import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu as MenuIcon, Bell, Search } from 'lucide-react';

import { Button, CommandPalette, ThemeToggle, Kbd } from '@clary/ui-web';

import { Sidebar } from './sidebar';
import { MobileBottomNav } from './mobile-bottom-nav';
import { EmergencyListener } from './emergency-listener';
import { PwaInstallPrompt } from './pwa-install-prompt';
import { useCommandPalette } from '@/hooks/use-command-palette';
import { supabase } from '@/lib/supabase';

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { open, setOpen, items } = useCommandPalette();
  const [initials, setInitials] = useState('U');
  const [platformMac, setPlatformMac] = useState(false);

  useEffect(() => {
    setPlatformMac(/Mac|iPhone|iPod|iPad/.test(navigator.platform));
    supabase.auth.getUser().then(({ data }) => {
      const email = data.user?.email;
      if (email) setInitials(email.slice(0, 2).toUpperCase());
    });
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)}>
            <MenuIcon className="h-5 w-5" />
          </Button>
          <Button
            variant="outline"
            className="flex max-w-md flex-1 items-center justify-between gap-2 text-muted-foreground"
            onClick={() => setOpen(true)}
          >
            <span className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              Qidirish yoki buyruq…
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              <Kbd>{platformMac ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </Button>
          <div className="flex-1" />
          <ThemeToggle compact />
          <Button variant="ghost" size="icon" aria-label="Notifications">
            <Bell className="h-5 w-5" />
          </Button>
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20"
            title="Profile"
          >
            {initials}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 pb-24 sm:p-6 lg:pb-6">
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
      <CommandPalette open={open} onOpenChange={setOpen} items={items} />
      <EmergencyListener />
      <PwaInstallPrompt />
    </div>
  );
}
