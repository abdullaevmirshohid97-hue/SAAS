import type { HTMLAttributes } from 'react';

import { cn } from '../utils';

export interface ClaryLogoProps extends HTMLAttributes<HTMLSpanElement> {
  /** "full"/"wordmark" — CLARY wordmark; "mark" — kvadrat "C" monogramma. */
  variant?: 'mark' | 'full' | 'wordmark';
  /** Preset balandlik. Custom uchun `className`. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Urg'u chizig'i rangi (wordmark oldidagi). `none` — chiziqsiz. */
  accentColor?: string;
}

// =============================================================================
// CLARY LOGOTIP — TIPOGRAFIK (v2, 2026-08-08)
// =============================================================================
// Ilgari bu komponent PNG rasm (`/clary-wordmark.png`) ko'rsatardi. Endi u sof
// MATN. Sabablari:
//   - har ekran zichligida (retina, 4K) mutlaqo aniq — raster emas;
//   - och/to'q temaga o'zi moslashadi (`currentColor`), ikkita fayl kerak emas;
//   - tarmoqdan hech narsa yuklanmaydi (sidebar bir zumda chiziladi);
//   - brend nomini qidiruv/skrinrider matn sifatida o'qiydi.
//
// Hi-tech ohang uchtа detaldan yig'iladi: (1) texnik grotesk shrift,
// (2) keng harf oralig'i, (3) oldidagi ingichka urg'u chizig'i (LED effekti).
// =============================================================================

/** Texnik grotesk zinapoyasi — DIN oilasi birinchi, keyin tizim shriftlari. */
const TECH_FONT =
  "Bahnschrift, 'DIN Next', 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif";

const WORDMARK_SIZE: Record<NonNullable<ClaryLogoProps['size']>, string> = {
  sm: 'text-sm',
  md: 'text-lg',
  lg: 'text-2xl',
  xl: 'text-3xl',
};

const MARK_SIZE: Record<NonNullable<ClaryLogoProps['size']>, string> = {
  sm: 'h-6 w-6 text-[13px] rounded-md',
  md: 'h-8 w-8 text-[17px] rounded-lg',
  lg: 'h-10 w-10 text-[21px] rounded-lg',
  xl: 'h-14 w-14 text-[30px] rounded-xl',
};

const BAR_SIZE: Record<NonNullable<ClaryLogoProps['size']>, string> = {
  sm: 'h-3.5 w-[3px]',
  md: 'h-5 w-[3px]',
  lg: 'h-6 w-1',
  xl: 'h-8 w-1',
};

export function ClaryLogo({
  variant = 'full',
  size = 'md',
  accentColor = '#2563EB',
  className,
  ...rest
}: ClaryLogoProps) {
  // Kvadrat monogramma — collapsed sidebar va kichik UI joylari uchun.
  // Ikonlardagi (favicon/app icon) "C" bilan bir xil ohangda.
  if (variant === 'mark') {
    return (
      <span
        aria-label="Clary"
        className={cn(
          'inline-flex select-none items-center justify-center bg-[#0A0A0A] font-bold leading-none text-white',
          MARK_SIZE[size],
          className,
        )}
        style={{ fontFamily: TECH_FONT }}
        {...rest}
      >
        C
      </span>
    );
  }

  return (
    <span
      aria-label="Clary"
      className={cn('inline-flex select-none items-center gap-2 leading-none', className)}
      {...rest}
    >
      {accentColor !== 'none' && (
        <span
          aria-hidden="true"
          className={cn('shrink-0 rounded-full', BAR_SIZE[size])}
          style={{ background: accentColor }}
        />
      )}
      <span
        className={cn('font-semibold', WORDMARK_SIZE[size])}
        // Harf oralig'i — hi-tech ohangning asosiy tashuvchisi.
        style={{ fontFamily: TECH_FONT, letterSpacing: '0.22em' }}
      >
        CLARY
      </span>
    </span>
  );
}
