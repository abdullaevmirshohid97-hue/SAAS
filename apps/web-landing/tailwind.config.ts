import type { Config } from 'tailwindcss';
import preset from '@clary/tailwind-config/preset';

export default {
  presets: [preset],
  content: [
    './src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}',
    '../../packages/ui-web/src/**/*.{ts,tsx}',
  ],
} satisfies Config;
