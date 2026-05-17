import type { SVGProps } from 'react';

import { cn } from '../utils';

export interface ClaryLogoProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox'> {
  /** Logo variant. Default "full" shows the owl mark + wordmark. */
  variant?: 'mark' | 'full' | 'wordmark';
  /** Preset size. Use `className` for custom sizing. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Force the body color (defaults to the brand blue). */
  accentColor?: string;
}

const SIZE_CLASS: Record<NonNullable<ClaryLogoProps['size']>, string> = {
  sm: 'h-6',
  md: 'h-8',
  lg: 'h-10',
  xl: 'h-14',
};

// Brend ranglari — boyqush tanasi ko'k gradient, detallar sariq.
const BRAND_FROM = '#3B82F6';
const BRAND_TO = '#2563EB';
const FEET_FROM = '#FBBF24';
const FEET_TO = '#D97706';

/**
 * Clary "professor boyqush" logosi — ko'zoynak taqqan dono boyqush.
 * `mark`  — soddalashtirilgan: boyqush boshi + ko'zoynak (favicon, kichik UI).
 * `full`  — to'liq boyqush (quloq, tana, oyoq) + "Clary" so'zi.
 * Wordmark currentColor ishlatadi — tailwind `text-*` bilan moslashadi.
 */
export function ClaryLogo({
  variant = 'full',
  size = 'md',
  accentColor,
  className,
  ...rest
}: ClaryLogoProps) {
  const uid = `clary-${variant}-${size}`;
  const bodyFrom = accentColor ?? BRAND_FROM;
  const bodyTo = accentColor ?? BRAND_TO;

  // ── mark — soddalashtirilgan boyqush boshi + ko'zoynak ──────────────────
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
          <linearGradient id={`${uid}-b`} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={bodyFrom} />
            <stop offset="100%" stopColor={bodyTo} />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="40" height="40" rx="10" fill={`url(#${uid}-b)`} />
        {/* Quloq uchlari */}
        <path d="M11 11 L9.5 4 L15 9 Z" fill="#fff" />
        <path d="M29 11 L30.5 4 L25 9 Z" fill="#fff" />
        {/* Yuz disk */}
        <ellipse cx="20" cy="22" rx="13" ry="13.5" fill="#fff" />
        {/* Ko'zlar */}
        <circle cx="15" cy="20" r="4.2" fill="#0f172a" />
        <circle cx="25" cy="20" r="4.2" fill="#0f172a" />
        <circle cx="13.8" cy="18.8" r="1.3" fill="#fff" />
        <circle cx="23.8" cy="18.8" r="1.3" fill="#fff" />
        {/* Ko'zoynak gardishlari */}
        <circle cx="15" cy="20" r="5.6" fill="none" stroke="#0f172a" strokeWidth="1.5" />
        <circle cx="25" cy="20" r="5.6" fill="none" stroke="#0f172a" strokeWidth="1.5" />
        <line x1="20.6" y1="20" x2="19.4" y2="20" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" />
        {/* Tumshuq */}
        <path d="M20 25 L17 30 L20 32.5 L23 30 Z" fill="#F59E0B" />
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

  // ── full — to'liq boyqush (quloq + tana + oyoq) + so'z ───────────────────
  return (
    <svg
      viewBox="0 0 170 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Clary"
      className={cn(SIZE_CLASS[size], 'w-auto', className)}
      {...rest}
    >
      <defs>
        <linearGradient id={`${uid}-b`} x1="0" y1="0" x2="0" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={bodyFrom} />
          <stop offset="100%" stopColor={bodyTo} />
        </linearGradient>
        <linearGradient id={`${uid}-f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={FEET_FROM} />
          <stop offset="100%" stopColor={FEET_TO} />
        </linearGradient>
      </defs>

      {/* ── Boyqush belgisi (0..44 kvadrat) ── */}
      {/* Quloq uchlari */}
      <path d="M11 12 L9 2 L17 9 Z" fill={`url(#${uid}-b)`} />
      <path d="M33 12 L35 2 L27 9 Z" fill={`url(#${uid}-b)`} />
      {/* Oyoqlar (tana ortida) */}
      <g>
        <ellipse cx="16" cy="40" rx="2.4" ry="4" fill={`url(#${uid}-f)`} />
        <ellipse cx="22" cy="40.5" rx="2.4" ry="4.2" fill={`url(#${uid}-f)`} />
        <ellipse cx="28" cy="40" rx="2.4" ry="4" fill={`url(#${uid}-f)`} />
      </g>
      {/* Tana */}
      <ellipse cx="22" cy="24" rx="17" ry="17.5" fill={`url(#${uid}-b)`} />
      {/* Yuz disklari */}
      <ellipse cx="22" cy="22" rx="14" ry="14" fill="#fff" />
      {/* Ko'zlar */}
      <circle cx="16" cy="20" r="4.6" fill="#0f172a" />
      <circle cx="28" cy="20" r="4.6" fill="#0f172a" />
      <circle cx="14.6" cy="18.6" r="1.5" fill="#fff" />
      <circle cx="26.6" cy="18.6" r="1.5" fill="#fff" />
      {/* Ko'zoynak */}
      <circle cx="16" cy="20" r="6.2" fill="none" stroke="#0f172a" strokeWidth="1.7" />
      <circle cx="28" cy="20" r="6.2" fill="none" stroke="#0f172a" strokeWidth="1.7" />
      <line x1="22.2" y1="20" x2="21.8" y2="20" stroke="#0f172a" strokeWidth="1.7" strokeLinecap="round" />
      {/* Tumshuq */}
      <path d="M22 25 L18.5 31 L22 34 L25.5 31 Z" fill="#F59E0B" />

      {/* ── Wordmark ── */}
      <text
        x="54"
        y="30"
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
