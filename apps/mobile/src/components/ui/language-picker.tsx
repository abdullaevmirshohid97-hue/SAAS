import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { i18n, LOCALE_LABELS, type SupportedLocale } from '@clary/i18n';

import { changeAppLanguage } from '../../lib/i18n';

// Asosiy 4 til (web login/sozlamalar bilan bir xil).
const LANGS: SupportedLocale[] = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'];

/** C6 — profil ekranlarida til tanlash. Tanlov saqlanadi (AsyncStorage). */
export function LanguagePicker() {
  const [current, setCurrent] = useState(i18n.language);

  return (
    <View className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
      <Text className="mb-2 text-xs font-semibold uppercase text-gray-500">Til / Язык</Text>
      <View className="flex-row flex-wrap gap-2">
        {LANGS.map((code) => {
          const active = current === code;
          return (
            <TouchableOpacity
              key={code}
              onPress={() => {
                void changeAppLanguage(code);
                setCurrent(code);
              }}
              className={
                'rounded-lg border px-3 py-2 ' +
                (active
                  ? 'border-[#2563EB] bg-[#2563EB]/10'
                  : 'border-gray-300 dark:border-gray-700')
              }
            >
              <Text
                className={
                  'text-sm ' + (active ? 'font-semibold text-[#2563EB]' : 'dark:text-white')
                }
              >
                {LOCALE_LABELS[code]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
