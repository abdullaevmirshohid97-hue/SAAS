import * as React from 'react';

import { cn } from '../utils';

export const Kbd = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, children, ...rest }, ref) => (
    <kbd
      ref={ref}
      className={cn(
        'inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground shadow-elevation-1',
        className,
      )}
      {...rest}
    >
      {children}
    </kbd>
  ),
);
Kbd.displayName = 'Kbd';
