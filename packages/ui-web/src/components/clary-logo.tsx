import type { SVGProps } from 'react';

import { cn } from '../utils';

export interface ClaryLogoProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox'> {
  /** Logo variant. Default "full" shows the "C" mark + wordmark. */
  variant?: 'mark' | 'full' | 'wordmark';
  /** Preset size. Use `className` for custom sizing. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Force the mark color (defaults to currentColor — theme-aware). */
  accentColor?: string;
}

const SIZE_CLASS: Record<NonNullable<ClaryLogoProps['size']>, string> = {
  sm: 'h-6',
  md: 'h-8',
  lg: 'h-10',
  xl: 'h-14',
};

// Clary crescent "C" — brend belgisi (viewBox 0 0 32 32). Monoxrom, currentColor
// bilan ishlaydi → och/to'q temaga moslashadi. To'liq metall logo app ikonlarida.
const CRESCENT = 'M18.73 4.97 A12 12 0 1 0 18.73 27.03 A11.5 11.5 0 0 1 18.73 4.97 Z';

/**
 * Clary logosi — crescent "C" belgi.
 * `mark`     — faqat "C" (favicon, kichik UI). currentColor/accentColor.
 * `wordmark` — faqat "Clary" so'zi (currentColor).
 * `full`     — "C" belgi + "Clary" so'zi.
 */
export function ClaryLogo({
  variant = 'full',
  size = 'md',
  accentColor,
  className,
  ...rest
}: ClaryLogoProps) {
  const markFill = accentColor ?? 'currentColor';

  // ── mark — faqat crescent "C" ──────────────────────────────────────────
  if (variant === 'mark') {
    return (
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Clary"
        className={cn(SIZE_CLASS[size], 'w-auto', className)}
        {...rest}
      >
        <path d={CRESCENT} fill={markFill} />
      </svg>
    );
  }

  // ── wordmark — faqat "Clary" so'zi ──────────────────────────────────────
  if (variant === 'wordmark') {
    return (
      <svg
        viewBox="0 0 120 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Clary"
        className={cn(SIZE_CLASS[size], 'w-auto', className)}
        {...rest}
      >
        <text
          x="0"
          y="24"
          fontFamily="ui-sans-serif, system-ui, -apple-system, 'Inter', sans-serif"
          fontWeight="700"
          fontSize="26"
          letterSpacing="-0.5"
          fill="currentColor"
        >
          Clary
        </text>
      </svg>
    );
  }

  // ── full — "C" belgi + "Clary" so'zi ────────────────────────────────────
  return (
    <svg
      viewBox="0 0 150 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Clary"
      className={cn(SIZE_CLASS[size], 'w-auto', className)}
      {...rest}
    >
      <g transform="translate(2 2)">
        <path d={CRESCENT} fill={markFill} />
      </g>
      <text
        x="42"
        y="26"
        fontFamily="ui-sans-serif, system-ui, -apple-system, 'Inter', sans-serif"
        fontWeight="700"
        fontSize="24"
        letterSpacing="-0.5"
        fill="currentColor"
      >
        Clary
      </text>
    </svg>
  );
}
