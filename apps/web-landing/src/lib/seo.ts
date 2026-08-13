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
//
// `translated` — sahifada HAQIQATAN shu tildagi matn bormi. Bu muhim:
// hreflang e'lon qilingan, lekin kontenti boshqa tilda bo'lgan variantni Google
// klaster sifatida qabul qilmaydi va ishlaydigan bog'lanishlarni ham
// qiymatsizlantiradi. Tekshirilgan holat (2026-08): uz-Cyrl/kk/ky/tg sahifalari
// o'zbekcha (lotin) matnni takrorlaydi — ular hreflang'ga KIRMAYDI va
// noindex bo'ladi. Tarjima qo'shilganda shu yerda `translated: true` qilinadi.
export const LOCALES: Array<{ astro: string; hreflang: string; translated: boolean }> = [
  { astro: 'uz-Latn', hreflang: 'uz', translated: true },
  { astro: 'ru', hreflang: 'ru', translated: true },
  { astro: 'en', hreflang: 'en', translated: true },
  { astro: 'uz-Cyrl', hreflang: 'uz-Cyrl', translated: false },
  { astro: 'kk', hreflang: 'kk', translated: false },
  { astro: 'ky', hreflang: 'ky', translated: false },
  { astro: 'tg', hreflang: 'tg', translated: false },
];

/** Faqat haqiqatan tarjima qilingan variantlar — hreflang va sitemap uchun. */
export const TRANSLATED_LOCALES = LOCALES.filter((l) => l.translated);

/** Marshrut mavjud, lekin kontenti tarjima qilinmagan (indekslanmaydi). */
export function isUntranslatedLocale(pathname: string): boolean {
  return LOCALES.some(
    (l) =>
      !l.translated &&
      (pathname === `/${l.astro}` || pathname.startsWith(`/${l.astro}/`)),
  );
}

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

// Locale prefiksi bilan HAQIQATAN mavjud bo'lgan marshrutlar
// (src/pages/[locale]/ ichidagi fayllar). Boshqa yo'llar faqat standart tilda
// bor — ular uchun hreflang e'lon qilish mavjud bo'lmagan URL'ga ishora
// qilgan bo'lardi (ilgari SPA fallback tufayli 200 qaytardi, endi haqiqiy 404).
const LOCALIZED_ROUTES = ['/pricing', '/blog', '/solutions/', '/for/', '/vs/'];

export function hasLocalizedVariant(cleanPath: string): boolean {
  if (cleanPath === '/') return true;
  const path = cleanPath.endsWith('/') ? cleanPath.slice(0, -1) : cleanPath;
  return LOCALIZED_ROUTES.some((r) =>
    r.endsWith('/') ? path.startsWith(r) : path === r,
  );
}

/**
 * Nav/Footer uchun xavfsiz ichki havola.
 *
 * Ilgari komponentlar har bir havolaga joriy locale prefiksini qo'shardi
 * (`/ru` + `/features` = `/ru/features`), holbuki bunday marshrut yo'q —
 * SPA fallback tufayli u jimgina bosh sahifani ko'rsatardi. Fallback olib
 * tashlangач bunday havola haqiqiy 404 bo'ladi, shuning uchun tarjimasi yo'q
 * yo'l uchun standart tildagi manzil qaytariladi.
 *
 * Qaytariladigan URL har doim oxirgi slash bilan — canonical shakl, redirectsiz.
 */
export function localizedHref(path: string, locale: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const useLocale = locale !== DEFAULT_LOCALE && hasLocalizedVariant(clean) ? locale : DEFAULT_LOCALE;
  const withSlash = clean === '/' ? '/' : clean.endsWith('/') ? clean : `${clean}/`;
  return useLocale === DEFAULT_LOCALE ? withSlash : `/${useLocale}${withSlash}`;
}

/**
 * Sahifaning tarjima variantlari uchun hreflang linklar + x-default.
 * Tarjimasi yo'q sahifa uchun bo'sh ro'yxat — hreflangsiz bir tilli sahifa
 * to'g'ri, yolg'on hreflang esa butun klasterni buzadi.
 */
export function buildHreflang(pathname: string): HreflangLink[] {
  const clean = stripLocale(pathname);
  if (!hasLocalizedVariant(clean)) return [];

  // Faqat tarjima qilingan variantlar e'lon qilinadi — yolg'on hreflang butun
  // klasterni (ishlaydigan uz↔ru↔en bog'lanishini ham) qiymatsizlantiradi.
  const links: HreflangLink[] = TRANSLATED_LOCALES.map(({ astro, hreflang }) => ({
    hreflang,
    href: urlFor(clean, astro),
  }));
  // x-default — standart (uz-Latn) variant
  links.push({ hreflang: 'x-default', href: urlFor(clean, DEFAULT_LOCALE) });
  return links;
}
