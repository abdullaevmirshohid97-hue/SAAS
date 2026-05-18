import * as React from 'react';
import { Bell } from 'lucide-react';

import { cn } from '../utils';

// =============================================================================
// NotificationCenter — global in-app bildirishnoma markazi (header qo'ng'irog'i).
// Presentational: ma'lumot va callback'lar props orqali keladi — app-shell
// TanStack Query bilan ulaydi.
// =============================================================================

export interface NotificationItem {
  id: string;
  kind: string;
  severity: 'info' | 'warning' | 'urgent' | string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationCenterProps {
  notifications: NotificationItem[];
  unreadCount: number;
  /** Dropdown ochilganda — feed'ni yuklash uchun. */
  onOpenChange?: (open: boolean) => void;
  onMarkRead: (id: string) => void;
  onMarkAll: () => void;
}

const SEVERITY_TONE: Record<string, string> = {
  info: 'border-l-sky-400',
  warning: 'border-l-amber-400',
  urgent: 'border-l-red-500',
};

export function NotificationCenter({
  notifications,
  unreadCount,
  onOpenChange,
  onMarkRead,
  onMarkAll,
}: NotificationCenterProps) {
  const [open, setOpen] = React.useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    onOpenChange?.(next);
  };
  const close = () => {
    setOpen(false);
    onOpenChange?.(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Xabarlar"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background hover:bg-accent"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={close} aria-hidden />
          <div className="absolute right-0 z-40 mt-1 max-h-96 w-80 overflow-auto rounded-lg border bg-popover shadow-lg">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-semibold">Xabarlar</span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAll}
                  className="text-xs text-primary hover:underline"
                >
                  Hammasini o&apos;qildim
                </button>
              )}
            </div>
            <div>
              {notifications.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Xabar yo&apos;q
                </div>
              )}
              {notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => !n.is_read && onMarkRead(n.id)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 border-b border-l-4 px-3 py-2 text-left last:border-b-0 hover:bg-accent',
                    SEVERITY_TONE[n.severity] ?? 'border-l-zinc-300',
                    !n.is_read && 'bg-primary/5',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{n.title}</span>
                    {!n.is_read && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                  </div>
                  {n.body && (
                    <span className="text-[11px] text-muted-foreground">{n.body}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(n.created_at).toLocaleString('uz-UZ', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
