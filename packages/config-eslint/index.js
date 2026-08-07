/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'import', 'unicorn'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  settings: {
    'import/resolver': {
      typescript: { alwaysTryTypes: true },
      node: true,
    },
  },
  rules: {
    // import/no-unresolved O'CHIRILGAN: modul yo'llarini TypeScript'ning o'zi
    // (tsc --noEmit) ancha aniqroq tekshiradi. Bu qoida ishlashi uchun
    // `eslint-import-resolver-typescript` kerak — u o'rnatilmagan edi va
    // natijada HAR BIR tashqi import "topilmadi" deb belgilanardi (API'da
    // 1505 muammoning katta qismi shundan). Qo'shimcha bog'liqlik olib
    // kelishdan ko'ra qoidani o'chirish to'g'ri: qamrov yo'qolmaydi.
    'import/no-unresolved': 'off',
    // Quyidagi uchtasi ham AYNI sababdan o'chirilgan (resolver yo'q → shovqin).
    // TypeScript nomlar/eksportlarni o'zi tekshiradi.
    'import/namespace': 'off',
    'import/default': 'off',
    'import/no-named-as-default': 'off',
    'import/no-named-as-default-member': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    // Uslub qoidasi — CI'ni bloklamaydi. Avtomatik tuzatish importlarni qayta
    // tartiblaydi, bu esa YON TA'SIRLI importlarda (telemetry) xavfli.
    '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'import/order': [
      'warn',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc' },
      },
    ],
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    'prefer-const': 'error',
    'no-var': 'error',
    // `x == null` — ataylab: null va undefined'ni birga ushlaydi. Kodda 33 ta
    // shunday joy bor va hammasi to'g'ri; qolgan hollarda === majburiy.
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    // `while (true) { ... break }` — sahifalash sikllarida normal shakl.
    'no-constant-condition': ['error', { checkLoops: false }],
    // `try { ... } catch { /* e'tiborsiz */ }` — kodda ataylab ishlatiladi
    // (chop etish, localStorage). Bo'sh catch ruxsat etiladi, qolgan bo'sh
    // bloklar xato bo'lib qoladi.
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
  ignorePatterns: [
    'node_modules',
    'dist',
    'build',
    '.next',
    '.astro',
    '.turbo',
    'coverage',
    '*.config.js',
    '*.config.ts',
    '**/generated/**',
  ],
};
