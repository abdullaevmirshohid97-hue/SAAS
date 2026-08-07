// Ikki o'zgarish (2026-08-08):
//  1. `nest` → `nest.js`: kengaytma nomisiz yo'l ba'zi hollarda topilmasdi.
//  2. `parserOptions.project` OLIB TASHLANDI: tur-asosidagi (type-aware)
//     qoidalar ishlatilmaydi, lekin `project` yoqilganda tsconfig'ga
//     kirmagan har bir fayl (spec, skript) parser xatosi berardi va lint
//     butunlay yiqilardi. Endi tezroq ham ishlaydi.
module.exports = {
  root: true,
  extends: ['@clary/eslint-config/nest.js'],
  ignorePatterns: ['dist', 'node_modules', '*.mjs', 'vitest.config.ts', 'vitest.*.config.ts'],
};
