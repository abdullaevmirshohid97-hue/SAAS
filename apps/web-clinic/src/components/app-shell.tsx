import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Menu as MenuIcon, Search, LogOut } from 'lucide-react';

import {
  Button,
  CommandPalette,
  NotificationCenter,
  ThemeToggle,
  Kbd,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@clary/ui-web';

import { Sidebar } from './sidebar';
import { MobileBottomNav } from './mobile-bottom-nav';
import { CopilotLauncher } from './copilot/copilot-panel';
import { EmergencyListener } from './emergency-listener';
import { PwaInstallPrompt } from './pwa-install-prompt';
import { DemoBanner } from './demo-banner';
import { useCommandPalette } from '@/hooks/use-command-palette';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';

// Global bildirishnoma markazi — header qo'ng'irog'i. notifications_inapp
// feed'iga TanStack Query bilan ulanadi.
function ShellNotifications() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: count } = useQuery({
    queryKey: ['notif-feed-count'],
    queryFn: () => api.notifications.feedCount(),
    refetchInterval: 60_000,
  });
  const { data: list } = useQuery({
    queryKey: ['notif-feed-list'],
    queryFn: () => api.notifications.feed(false),
    enabled: open,
  });

  const markMut = useMutation({
    mutationFn: (id: string | 'all') => api.notifications.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notif-feed-count'] });
      qc.invalidateQueries({ queryKey: ['notif-feed-list'] });
    },
  });

  return (
    <NotificationCenter
      notifications={list ?? []}
      unreadCount={count?.unread ?? 0}
      onOpenChange={setOpen}
      onMarkRead={(id) => markMut.mutate(id)}
      onMarkAll={() => markMut.mutate('all')}
    />
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { open, setOpen, items } = useCommandPalette();
  const [initials, setInitials] = useState('U');
  const [email, setEmail] = useState('');
  const [platformMac, setPlatformMac] = useState(false);

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  useEffect(() => {
    setPlatformMac(/Mac|iPhone|iPod|iPad/.test(navigator.platform));
    supabase.auth.getUser().then(({ data }) => {
      const userEmail = data.user?.email;
      if (userEmail) {
        setInitials(userEmail.slice(0, 2).toUpperCase());
        setEmail(userEmail);
      }
    });
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <DemoBanner />
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
          <ShellNotifications />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20 hover:bg-primary/25"
                aria-label="Foydalanuvchi menyusi"
              >
                {initials}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[12rem]">
              <DropdownMenuLabel className="truncate normal-case">
                {email || 'Foydalanuvchi'}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={handleSignOut}>
                <LogOut className="h-4 w-4" />
                Chiqish
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 overflow-y-auto p-4 pb-24 sm:p-6 lg:pb-6">
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
      <CommandPalette open={open} onOpenChange={setOpen} items={items} />
      <CopilotLauncher />
      <EmergencyListener />
      <PwaInstallPrompt />
      <AnnouncementModal />
    </div>
  );
}

// Super-admin bloklovchi e'loni — X bosilmaguncha turadi (per-user ack).
// Qabulxona + admin + barcha sahifalarda ko'rinadi (AppShell global).
function AnnouncementModal() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['announcements-active'],
    queryFn: () => api.announcements.active(),
    refetchInterval: 60_000,
  });
  const ackMut = useMutation({
    mutationFn: (id: string) => api.announcements.ack(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements-active'] }),
  });
  const a = (data ?? [])[0];
  if (!a) return null;
  const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-2xl">
        <div className="mb-2 flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold">{a.title}</h2>
          <button
            aria-label="Yopish"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent disabled:opacity-50"
            disabled={ackMut.isPending}
            onClick={() => ackMut.mutate(a.id)}
          >
            ✕
          </button>
        </div>
        {a.body && <p className="whitespace-pre-line text-sm text-muted-foreground">{a.body}</p>}
        <div className="mt-3 space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
          {a.plan_snapshot && <div className="flex justify-between"><span className="text-muted-foreground">Tarif</span><span className="font-medium">{a.plan_snapshot}</span></div>}
          {a.amount_uzs != null && <div className="flex justify-between"><span className="text-muted-foreground">To'lov summasi</span><span className="font-semibold">{fmt(a.amount_uzs)} so'm</span></div>}
          {a.pay_date && <div className="flex justify-between"><span className="text-muted-foreground">To'lov sanasi</span><span className="font-medium">{a.pay_date}</span></div>}
          {a.contact_phone && <div className="flex justify-between"><span className="text-muted-foreground">Aloqa</span><a href={`tel:${a.contact_phone}`} className="font-semibold text-primary">{a.contact_phone}</a></div>}
        </div>
        <Button className="mt-4 w-full" disabled={ackMut.isPending} onClick={() => ackMut.mutate(a.id)}>
          Tushundim
        </Button>
      </div>
    </div>
  );
}
