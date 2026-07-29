import * as React from 'react';

import { cn } from '../utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'border-input flex min-h-[72px] w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm',
        'placeholder:text-muted-foreground focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
