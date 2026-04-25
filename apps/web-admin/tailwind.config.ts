import type { Config } from 'tailwindcss';
import preset from '@clary/tailwind-config/preset';

export default {
  presets: [preset],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui-web/src/**/*.{ts,tsx}'],
} satisfies Config;
