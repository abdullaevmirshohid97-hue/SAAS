import * as React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

import { cn } from '../utils';

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  trend?: { value: number; label?: string; direction?: 'up' | 'down' | 'flat' };
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  loading?: boolean;
}

const toneClasses: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'bg-card',
  success: 'bg-success/5 ring-1 ring-inset ring-success/20',
  warning: 'bg-warning/5 ring-1 ring-inset ring-warning/20',
  danger: 'bg-destructive/5 ring-1 ring-inset ring-destructive/20',
  info: 'bg-info/5 ring-1 ring-inset ring-info/20',
};

export const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ label, value, hint, icon, trend, tone = 'default', loading, className, ...rest }, ref) => {
    const direction = trend?.direction ?? (trend ? (trend.value > 0 ? 'up' : trend.value < 0 ? 'down' : 'flat') : undefined);
    return (
      <div
        ref={ref}
        className={cn(
          'relative flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-elevation-1 transition hover:shadow-elevation-2',
          toneClasses[tone],
          className,
        )}
        {...rest}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          {icon && <span className="text-muted-foreground">{icon}</span>}
        </div>
        {loading ? (
          <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
        ) : (
          <div className="text-3xl font-semibold leading-none tracking-tight">{value}</div>
        )}
        {(trend || hint) && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            {trend && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  direction === 'up' && 'bg-success/10 text-success',
                  direction === 'down' && 'bg-destructive/10 text-destructive',
                  direction === 'flat' && 'bg-muted text-muted-foreground',
                )}
              >
                {direction === 'up' && <ArrowUpRight className="h-3 w-3" />}
                {direction === 'down' && <ArrowDownRight className="h-3 w-3" />}
                {direction === 'flat' && <Minus className="h-3 w-3" />}
                {Math.abs(trend.value).toFixed(1)}%
                {trend.label && <span className="text-muted-foreground">· {trend.label}</span>}
              </span>
            )}
            {hint && <span>{hint}</span>}
          </div>
        )}
      </div>
    );
  },
);
StatCard.displayName = 'StatCard';
