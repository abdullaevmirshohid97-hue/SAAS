// Astro sahifalari (.astro) LINT QILINMAYDI: buning uchun `astro-eslint-parser`
// va `eslint-plugin-astro` kerak, ular o'rnatilmagan. Astro fayllarni
// `astro check` (typecheck skripti) allaqachon tekshiradi.
// Bu yerda faqat React "orolchalari" (.ts/.tsx) tekshiriladi.
module.exports = {
  root: true,
  extends: ['@clary/eslint-config/react.js'],
  ignorePatterns: ['dist', 'node_modules', '.astro', '*.config.js', '*.config.ts', '*.d.ts'],
};
