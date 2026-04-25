import * as React from 'react';
import { Command } from 'cmdk';

import { cn } from '../utils';

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  group?: string;
  shortcut?: string;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  items: CommandItem[];
  placeholder?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ items, placeholder = 'Type a command or search\u2026', open, onOpenChange }: CommandPaletteProps) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;
  const grouped = groupBy(items, (i) => i.group ?? 'Commands');

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh] bg-black/50 backdrop-blur-sm" onClick={() => onOpenChange(false)}>
      <div className="w-full max-w-xl rounded-xl border bg-popover shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <Command label="Command Palette" className="rounded-xl">
          <Command.Input
            placeholder={placeholder}
            className="w-full border-b bg-transparent px-4 py-4 text-base outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-96 overflow-y-auto p-2">
            <Command.Empty className="p-4 text-sm text-muted-foreground">No results.</Command.Empty>
            {Object.entries(grouped).map(([group, list]) => (
              <Command.Group key={group} heading={group} className="px-2 pb-2 text-xs font-medium text-muted-foreground">
                {list.map((it) => (
                  <Command.Item
                    key={it.id}
                    onSelect={() => { it.onSelect(); onOpenChange(false); }}
                    className={cn('flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent aria-selected:bg-accent')}
                  >
                    <div>
                      <div>{it.label}</div>
                      {it.description && <div className="text-xs text-muted-foreground">{it.description}</div>}
                    </div>
                    {it.shortcut && (
                      <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{it.shortcut}</kbd>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function groupBy<T>(arr: T[], key: (x: T) => string): Record<string, T[]> {
  return arr.reduce((acc: Record<string, T[]>, item) => {
    const k = key(item);
    (acc[k] ||= []).push(item);
    return acc;
  }, {});
}
