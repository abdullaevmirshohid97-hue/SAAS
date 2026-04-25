import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import uzLatn from '../locales/uz-Latn.json';
import uzCyrl from '../locales/uz-Cyrl.json';
import ru from '../locales/ru.json';
import kk from '../locales/kk.json';
import ky from '../locales/ky.json';
import tg from '../locales/tg.json';
import en from '../locales/en.json';

export const SUPPORTED_LOCALES = ['uz-Latn', 'uz-Cyrl', 'ru', 'kk', 'ky', 'tg', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  'uz-Latn': "O'zbekcha",
  'uz-Cyrl': 'Ўзбекча',
  ru: 'Русский',
  kk: 'Қазақша',
  ky: 'Кыргызча',
  tg: 'Тоҷикӣ',
  en: 'English',
};

export async function initI18n(defaultLocale: SupportedLocale = 'uz-Latn') {
  await i18n.use(initReactI18next).init({
    resources: {
      'uz-Latn': { translation: uzLatn },
      'uz-Cyrl': { translation: uzCyrl },
      ru: { translation: ru },
      kk: { translation: kk },
      ky: { translation: ky },
      tg: { translation: tg },
      en: { translation: en },
    },
    lng: defaultLocale,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return i18n;
}

export { i18n };
