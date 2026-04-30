import type { Config } from 'tailwindcss';
import baseConfig from '@clary/tailwind-config';

export default {
  ...baseConfig,
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui-web/src/**/*.{ts,tsx}',
  ],
} satisfies Config;
