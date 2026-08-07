/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: [
    './index.js',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
  ],
  plugins: ['react', 'react-hooks', 'jsx-a11y'],
  settings: { react: { version: 'detect' } },
  rules: {
    'react/prop-types': 'off',
    'react/react-in-jsx-scope': 'off',
    'react-hooks/exhaustive-deps': 'warn',
    // react-hooks/rules-of-hooks — ERROR bo'lib qoladi (default). Bu haqiqiy
    // xato sinfi: hook'lar shartli chaqirilsa React "Rendered more hooks..."
    // bilan yiqiladi va OQ EKRAN chiqadi. Aynan shu qoida data-admin.tsx dagi
    // jonli bagni topdi (2026-08-08).

    // O'CHIRILDI: interfeys butunlay o'zbekcha va matnlar apostrofga to'la
    // ("ko'p", "bo'yicha", "to'lov"). Bu qoida faqat web-clinic'da 640 ta
    // SOXTA xato bergan. Apostrof JSX'da xavfsiz.
    'react/no-unescaped-entities': 'off',

    // A11y — muhim, lekin hozir 186+ joyni to'satdan bloklash mumkin emas.
    // Ogohlantirish sifatida qoladi: yangi kodda ko'rinadi, eski qarz esa
    // CI'ni to'xtatmaydi.
    'jsx-a11y/label-has-associated-control': 'warn',
    'jsx-a11y/click-events-have-key-events': 'warn',
    'jsx-a11y/no-static-element-interactions': 'warn',
    'jsx-a11y/no-noninteractive-element-interactions': 'warn',
    // autofocus qabulxona/kassa oqimlarida ATAYLAB ishlatiladi (barkod, qidiruv).
    'jsx-a11y/no-autofocus': 'off',
  },
};
