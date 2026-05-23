import type { Config } from 'tailwindcss';
import preset from '@clary/tailwind-config/preset';

const JOURNAL_PALETTE = [
  'emerald', 'violet', 'sky', 'indigo', 'amber', 'rose', 'cyan',
  'slate', 'blue', 'green', 'orange', 'pink', 'teal', 'red',
];
const SAFE = JOURNAL_PALETTE.flatMap((c) => [
  `bg-${c}-50`, `text-${c}-700`, `border-${c}-200`,
  `bg-${c}-100`, `text-${c}-800`, `border-${c}-300`,
  `dark:bg-${c}-900/40`,
]);

export default {
  presets: [preset],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui-web/src/**/*.{ts,tsx}'],
  safelist: SAFE,
} satisfies Config;
