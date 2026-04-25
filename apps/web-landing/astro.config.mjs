import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: process.env.ASTRO_PUBLIC_SITE_URL ?? 'https://clary.uz',
  output: 'static',
  i18n: {
    defaultLocale: 'uz-Latn',
    locales: ['uz-Latn', 'uz-Cyrl', 'ru', 'kk', 'ky', 'tg', 'en'],
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: false,
    },
  },
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
    mdx(),
  ],
  vite: {
    ssr: { noExternal: ['@clary/ui-web'] },
  },
});
