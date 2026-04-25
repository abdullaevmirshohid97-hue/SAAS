import * as React from 'react';

import { cn } from '../utils';

export interface SectionProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  padded?: boolean;
}

export function Section({
  title,
  description,
  actions,
  padded = true,
  className,
  children,
  ...rest
}: SectionProps) {
  return (
    <section
      className={cn(
        'rounded-xl border bg-card shadow-elevation-1',
        padded ? 'p-5' : '',
        className,
      )}
      {...rest}
    >
      {(title || actions) && (
        <header className={cn('flex items-start justify-between gap-3', padded ? '-mx-5 -mt-5 border-b px-5 py-3' : 'mb-3')}>
          <div className="space-y-0.5">
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(padded && (title || actions) ? 'pt-5' : undefined)}>{children}</div>
    </section>
  );
}
