import type { ImgHTMLAttributes } from 'react';

import { cn } from '../utils';

export interface ClaryLogoProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  /** Logo variant. "full"/"wordmark" — metall wordmark chip; "mark" — kvadrat ikon. */
  variant?: 'mark' | 'full' | 'wordmark';
  /** Preset balandlik. Custom uchun `className`. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** @deprecated raster logoda e'tiborga olinmaydi (eski API moslik). */
  accentColor?: string;
}

const SIZE_CLASS: Record<NonNullable<ClaryLogoProps['size']>, string> = {
  sm: 'h-6',
  md: 'h-8',
  lg: 'h-10',
  xl: 'h-14',
};

/**
 * Clary logosi — metall "Clary" wordmark, qora yumaloq chipda (brend rasm).
 * Manba: har app `public/clary-wordmark.png` (wordmark) + `public/icon-192.png` (kvadrat).
 * `mark`            — kvadrat brend ikon (collapsed sidebar, kichik UI).
 * `full`/`wordmark` — to'liq metall "Clary" wordmark chip (matnni o'zida saqlaydi).
 *
 * Tier-1 metall brend. Och/to'q temada ham bir xil — qora chip har ikkisida ishlaydi.
 */
export function ClaryLogo({
  variant = 'full',
  size = 'md',
  accentColor,
  className,
  ...rest
}: ClaryLogoProps) {
  void accentColor; // eski API moslik — raster logoda ishlatilmaydi
  const isMark = variant === 'mark';
  const src = isMark ? '/icon-192.png' : '/clary-wordmark.png';
  return (
    <img
      src={src}
      alt="Clary"
      draggable={false}
      className={cn(SIZE_CLASS[size], 'w-auto select-none', isMark && 'rounded-lg', className)}
      {...rest}
    />
  );
}
