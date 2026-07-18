import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { initI18n, i18n, SUPPORTED_LOCALES, type SupportedLocale } from '@clary/i18n';

// C6 — mobil i18n: tanlov AsyncStorage'da saqlanadi (web bilan bir xil kalit
// nomi emas — platformalar mustaqil), birinchi ochilishda qurilma tilidan taxmin.
const LANG_KEY = 'clary.mobile.lang';

function deviceDefault(): SupportedLocale {
  const tag = Localization.getLocales()[0]?.languageTag ?? '';
  if (tag.startsWith('ru')) return 'ru';
  if (tag.startsWith('en')) return 'en';
  if (tag.includes('Cyrl')) return 'uz-Cyrl';
  return 'uz-Latn';
}

export async function initMobileI18n(): Promise<void> {
  let saved: string | null = null;
  try {
    saved = await AsyncStorage.getItem(LANG_KEY);
  } catch {
    /* storage o'qilmasa qurilma tili */
  }
  const lang: SupportedLocale =
    saved && (SUPPORTED_LOCALES as readonly string[]).includes(saved)
      ? (saved as SupportedLocale)
      : deviceDefault();
  await initI18n(lang);
}

export async function changeAppLanguage(code: SupportedLocale): Promise<void> {
  await i18n.changeLanguage(code);
  try {
    await AsyncStorage.setItem(LANG_KEY, code);
  } catch {
    /* saqlanmasa keyingi ochilishda qurilma tili */
  }
}
