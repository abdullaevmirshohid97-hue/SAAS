import * as React from 'react';
import * as RTooltip from '@radix-ui/react-tooltip';

import { cn } from '../utils';

// =============================================================================
// Tooltip — Radix asosida. Qisqartmalar (CITO, STAT) va ikonkalar uchun.
// =============================================================================

export const TooltipProvider = RTooltip.Provider;
export const Tooltip = RTooltip.Root;
export const TooltipTrigger = RTooltip.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof RTooltip.Content>,
  React.ComponentPropsWithoutRef<typeof RTooltip.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <RTooltip.Portal>
    <RTooltip.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-xs rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md',
        'animate-in fade-in-0 zoom-in-95',
        className,
      )}
      {...props}
    />
  </RTooltip.Portal>
));
TooltipContent.displayName = 'TooltipContent';

/**
 * Oddiy hol — bitta element + matn. Murakkabroq holatda Tooltip/Trigger/Content
 * to'g'ridan-to'g'ri ishlatiladi.
 */
export function SimpleTooltip({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
