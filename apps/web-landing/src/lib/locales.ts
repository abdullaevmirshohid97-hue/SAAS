export const SUPPORTED_LOCALES = [
  'uz-Latn',
  'uz-Cyrl',
  'ru',
  'kk',
  'ky',
  'tg',
  'en',
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'uz-Latn';

export const NON_DEFAULT_LOCALES = SUPPORTED_LOCALES.filter((l) => l !== DEFAULT_LOCALE);

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  'uz-Latn': "O'zbekcha",
  'uz-Cyrl': 'Ўзбекча',
  ru: 'Русский',
  kk: 'Қазақша',
  ky: 'Кыргызча',
  tg: 'Тоҷикӣ',
  en: 'English',
};

export const LOCALE_FLAGS: Record<SupportedLocale, string> = {
  'uz-Latn': '🇺🇿',
  'uz-Cyrl': '🇺🇿',
  ru: '🇷🇺',
  kk: '🇰🇿',
  ky: '🇰🇬',
  tg: '🇹🇯',
  en: '🇬🇧',
};

export function isSupportedLocale(value: string | undefined | null): value is SupportedLocale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function localeFromParams(params: Record<string, string | undefined>): SupportedLocale {
  const raw = params.locale;
  return isSupportedLocale(raw) ? raw : DEFAULT_LOCALE;
}

export function localePrefix(locale: SupportedLocale): string {
  return locale === DEFAULT_LOCALE ? '' : `/${locale}`;
}
