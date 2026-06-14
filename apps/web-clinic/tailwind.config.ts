import type { Config } from 'tailwindcss';
import preset from '@clary/tailwind-config/preset';

// Dynamic ranglar — jurnal layout va boshqa joylarda runtime'da quriladi
// (masalan, bg-{color}-50). Bularni safelist'ga qo'shamiz, aks holda
// Tailwind purge tomonidan o'chiriladi.
const JOURNAL_PALETTE = [
  'emerald', 'violet', 'sky', 'indigo', 'amber', 'rose', 'cyan',
  'slate', 'blue', 'green', 'orange', 'pink', 'teal', 'red', 'lime',
];
const SAFE = JOURNAL_PALETTE.flatMap((c) => [
  `bg-${c}-50`, `text-${c}-700`, `border-${c}-200`,
  `bg-${c}-100`, `text-${c}-800`, `border-${c}-300`,
  `dark:bg-${c}-900/40`,
]);

export default {
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui-web/src/**/*.{ts,tsx}',
  ],
  safelist: SAFE,
  theme: {
    extend: {
      // `font-sans` runtime'да --font-app orqali almashtiriladi (Appearance
      // sozlamasi). --font-app aniqlanmasa default 'Geist Sans' (styles.css).
      fontFamily: {
        sans: ['var(--font-app)', 'Geist Sans', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
} satisfies Config;
