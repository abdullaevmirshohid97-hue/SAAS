// =============================================================================
// SEO util — canonical va hreflang URL'larini sahifa yo'lidan to'g'ri hisoblaydi
// =============================================================================
// Asosiy SEO xatosi: Base.astro hamma sahifaga bir xil canonical va hardcoded
// hreflang berardi (156 hreflang konflikt). Bu util har sahifa uchun o'zining
// to'g'ri canonical va locale variantlarini quradi.
//
// Marshrutlanish (astro.config i18n, prefixDefaultLocale: false):
//   uz-Latn (default) → /path           (prefiks yo'q)
//   ru, en, kk, ...   → /ru/path        (locale prefiksi bilan)

const SITE = 'https://clary.uz';
const DEFAULT_LOCALE = 'uz-Latn';

// Astro locale kodi → Google hreflang ISO kodi.
// uz-Latn — O'zbekiston standart, hreflang'da oddiy 'uz'.
export const LOCALES: Array<{ astro: string; hreflang: string }> = [
  { astro: 'uz-Latn', hreflang: 'uz' },
  { astro: 'uz-Cyrl', hreflang: 'uz-Cyrl' },
  { astro: 'ru', hreflang: 'ru' },
  { astro: 'kk', hreflang: 'kk' },
  { astro: 'ky', hreflang: 'ky' },
  { astro: 'tg', hreflang: 'tg' },
  { astro: 'en', hreflang: 'en' },
];

/**
 * Joriy yo'ldan locale prefiksini olib tashlab, "toza" yo'lni qaytaradi.
 * '/ru/features' → '/features',  '/features' → '/features',  '/ru/' → '/'
 */
export function stripLocale(pathname: string): string {
  for (const { astro } of LOCALES) {
    if (astro === DEFAULT_LOCALE) continue;
    if (pathname === `/${astro}` || pathname === `/${astro}/`) return '/';
    if (pathname.startsWith(`/${astro}/`)) return pathname.slice(astro.length + 1);
  }
  return pathname || '/';
}

/** Toza yo'l + locale → to'liq URL. */
function urlFor(cleanPath: string, astroLocale: string): string {
  const path = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
  if (astroLocale === DEFAULT_LOCALE) return `${SITE}${path}`;
  // /  → /ru/ ,  /features → /ru/features
  return `${SITE}/${astroLocale}${path === '/' ? '/' : path}`;
}

/**
 * Sahifaning o'zi-ga-o'zi to'g'ri canonical URL'i.
 * pathname — Astro.url.pathname.
 */
export function canonicalFor(pathname: string): string {
  // Hozirgi locale'ni aniqlaymiz
  let current = DEFAULT_LOCALE;
  for (const { astro } of LOCALES) {
    if (astro === DEFAULT_LOCALE) continue;
    if (pathname === `/${astro}` || pathname.startsWith(`/${astro}/`)) {
      current = astro;
      break;
    }
  }
  return urlFor(stripLocale(pathname), current);
}

export interface HreflangLink {
  hreflang: string;
  href: string;
}

/**
 * Sahifaning barcha locale variantlari uchun hreflang linklar + x-default.
 * Har sahifa O'ZINING tarjimalariga ishora qiladi (/features → /ru/features).
 */
export function buildHreflang(pathname: string): HreflangLink[] {
  const clean = stripLocale(pathname);
  const links: HreflangLink[] = LOCALES.map(({ astro, hreflang }) => ({
    hreflang,
    href: urlFor(clean, astro),
  }));
  // x-default — standart (uz-Latn) variant
  links.push({ hreflang: 'x-default', href: urlFor(clean, DEFAULT_LOCALE) });
  return links;
}
