import type { SVGProps } from 'react';

import { cn } from '../utils';

export interface ClaryLogoProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox'> {
  /** Logo variant. Default "full" shows the mark + wordmark. */
  variant?: 'mark' | 'full' | 'wordmark';
  /** Preset size. Use `className` for custom sizing. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Force a color (defaults to currentColor so tailwind `text-*` works). */
  accentColor?: string;
}

const SIZE_CLASS: Record<NonNullable<ClaryLogoProps['size']>, string> = {
  sm: 'h-6',
  md: 'h-8',
  lg: 'h-10',
  xl: 'h-14',
};

/**
 * Clary logo. Designed to read well in both light and dark modes by using
 * currentColor for the wordmark and a brand gradient (or provided accent)
 * for the mark. The SVG is purely geometric — no external fonts.
 */
export function ClaryLogo({
  variant = 'full',
  size = 'md',
  accentColor,
  className,
  ...rest
}: ClaryLogoProps) {
  const gradientId = `clary-grad-${variant}-${size}`;

  if (variant === 'mark') {
    return (
      <svg
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Clary"
        className={cn(SIZE_CLASS[size], 'w-auto', className)}
        {...rest}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={accentColor ?? '#3B82F6'} />
            <stop offset="100%" stopColor={accentColor ?? '#2563EB'} />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="40" height="40" rx="10" fill={`url(#${gradientId})`} />
        {/* Stylised "C" + medical cross fusion */}
        <path
          d="M27 13.5C24.5 11.2 21.3 10 18 10.2C12.5 10.5 8 14.8 8 20S12.5 29.5 18 29.8C21.3 30 24.5 28.8 27 26.5"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <rect x="26" y="17.5" width="5" height="5" rx="1" fill="#fff" />
        <rect x="27.75" y="15" width="1.5" height="10" rx="0.75" fill="#fff" />
      </svg>
    );
  }

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

  // full = mark + wordmark
  return (
    <svg
      viewBox="0 0 160 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Clary"
      className={cn(SIZE_CLASS[size], 'w-auto', className)}
      {...rest}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={accentColor ?? '#3B82F6'} />
          <stop offset="100%" stopColor={accentColor ?? '#2563EB'} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="40" height="40" rx="10" fill={`url(#${gradientId})`} />
      <path
        d="M27 13.5C24.5 11.2 21.3 10 18 10.2C12.5 10.5 8 14.8 8 20S12.5 29.5 18 29.8C21.3 30 24.5 28.8 27 26.5"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <rect x="26" y="17.5" width="5" height="5" rx="1" fill="#fff" />
      <rect x="27.75" y="15" width="1.5" height="10" rx="0.75" fill="#fff" />
      <text
        x="50"
        y="28"
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
