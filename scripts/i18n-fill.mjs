#!/usr/bin/env node
// Sprint 2I: 14 ta yo'q nav/auth kalitiga uch asosiy lokalda matn qo'yamiz
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('.', import.meta.url).pathname.replace(/^\/([a-zA-Z]):/, '$1:'), '..');
const LOC = (l) => `${ROOT}/packages/i18n/locales/${l}.json`;

const fills = {
  'uz-Latn': {
    nav: {
      group: {
        main: 'Asosiy',
        clinical: 'Klinika',
        finance: 'Moliya',
        insights: 'Tahlil',
        system: 'Tizim',
      },
      doctor: 'Shifokor oynasi',
      nurse: 'Hamshira posti',
      nurseRequests: 'Hamshira so‘rovlari',
      payroll: 'Maosh',
      reviews: 'Sharhlar',
    },
    auth: {
      subtitle: 'Klinikangizga kiring',
      tryDemo: 'Demo sinab ko‘ring',
      signup: 'Ro‘yxatdan o‘tish',
    },
    common: { or: 'yoki' },
  },
  ru: {
    nav: {
      group: {
        main: 'Основное',
        clinical: 'Клиника',
        finance: 'Финансы',
        insights: 'Аналитика',
        system: 'Система',
      },
      doctor: 'Кабинет врача',
      nurse: 'Сестринский пост',
      nurseRequests: 'Запросы медсестёр',
      payroll: 'Зарплата',
      reviews: 'Отзывы',
    },
    auth: {
      subtitle: 'Войти в клинику',
      tryDemo: 'Попробовать демо',
      signup: 'Регистрация',
    },
    common: { or: 'или' },
  },
  en: {
    nav: {
      group: {
        main: 'Main',
        clinical: 'Clinical',
        finance: 'Finance',
        insights: 'Insights',
        system: 'System',
      },
      doctor: 'Doctor Console',
      nurse: 'Nurse Station',
      nurseRequests: 'Nurse Requests',
      payroll: 'Payroll',
      reviews: 'Reviews',
    },
    auth: {
      subtitle: 'Sign in to your clinic',
      tryDemo: 'Try demo',
      signup: 'Sign up',
    },
    common: { or: 'or' },
  },
};

function deepMerge(target, source) {
  for (const k of Object.keys(source)) {
    if (typeof source[k] === 'object' && source[k] !== null && !Array.isArray(source[k])) {
      target[k] = target[k] && typeof target[k] === 'object' ? target[k] : {};
      deepMerge(target[k], source[k]);
    } else {
      target[k] = source[k];
    }
  }
  return target;
}

for (const [loc, data] of Object.entries(fills)) {
  const path = LOC(loc);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  deepMerge(json, data);
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
  console.log(`  → ${loc}.json updated`);
}

// Boshqa lokallarga uz-Latn'dan default fallback (CIS bozori uchun)
const fallback = fills['uz-Latn'];
for (const loc of ['kk', 'ky', 'tg', 'uz-Cyrl']) {
  const path = LOC(loc);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  deepMerge(json, fallback);
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
  console.log(`  → ${loc}.json filled with uz-Latn fallback`);
}
console.log('Done.');
