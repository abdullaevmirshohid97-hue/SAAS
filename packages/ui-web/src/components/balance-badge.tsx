import * as React from 'react';

import { cn } from '../utils';

export interface BalanceBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  value: number;
  currency?: string;
  zeroLabel?: string;
  compact?: boolean;
}

function formatMoney(value: number, currency = 'UZS'): string {
  if (currency === 'UZS') {
    return new Intl.NumberFormat('uz-UZ').format(Math.abs(value)) + ' so\u2018m';
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Math.abs(value));
}

export function BalanceBadge({
  value,
  currency = 'UZS',
  zeroLabel = '0',
  compact,
  className,
  ...rest
}: BalanceBadgeProps) {
  const tone = value > 0 ? 'success' : value < 0 ? 'danger' : 'muted';
  const sign = value > 0 ? '+' : value < 0 ? '\u2212' : '';
  const toneCls =
    tone === 'success'
      ? 'bg-success/10 text-success'
      : tone === 'danger'
      ? 'bg-destructive/10 text-destructive'
      : 'bg-muted text-muted-foreground';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        toneCls,
        compact ? 'px-1.5 text-[11px]' : '',
        className,
      )}
      {...rest}
    >
      {value === 0 ? zeroLabel : `${sign}${formatMoney(value, currency)}`}
    </span>
  );
}
