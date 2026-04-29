import { Monitor, Moon, Snowflake, Sun } from 'lucide-react';

import { cn } from '../utils';
import { useTheme, type Theme } from './theme-provider';

type Option = { value: Theme; icon: typeof Sun; label: string };

const OPTIONS: Option[] = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'ice', icon: Snowflake, label: 'Ice' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
];

export interface ThemeToggleProps {
  className?: string;
  compact?: boolean;
}

export function ThemeToggle({ className, compact = false }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border bg-background p-0.5 shadow-elevation-1',
        className,
      )}
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => setTheme(opt.value)}
            className={cn(
              'inline-flex h-7 items-center justify-center rounded-full px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-primary text-primary-foreground shadow-elevation-1'
                : 'text-muted-foreground hover:text-foreground',
              compact ? 'w-7 px-0' : 'gap-1.5',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {!compact && <span>{opt.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
