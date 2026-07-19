import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// C1 — env himoyasi. MUHIM SABOQ (birinchi APK'da o'rganildi): bu yerda throw
// qilinsa release ilova OCHILISH ZAHOTI crash bo'ladi va foydalanuvchi sababni
// ko'rmaydi. Shuning uchun: modul darajasida yiqilmaymiz — kalit yo'qligini
// eksport qilamiz, root layout buni tekshirib EKRANDA ko'rsatadi.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const SUPABASE_CONFIG_ERROR: string | null =
  !url || !anonKey
    ? 'EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY topilmadi. ' +
      'Lokal: apps/mobile/.env.local; EAS build: eas.json env bo‘limi.'
    : null;

// Kalit yo'q bo'lsa placeholder bilan yaratamiz — chaqiruvlar ishlamaydi, lekin
// ilova ochiladi va SUPABASE_CONFIG_ERROR ekranda ko'rsatiladi.
export const supabase = createClient(
  url ?? 'https://config-missing.invalid',
  anonKey ?? 'config-missing',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
