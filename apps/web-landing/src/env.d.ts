/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly ASTRO_PUBLIC_SITE_URL: string;
  readonly ASTRO_PUBLIC_API_URL: string;
  readonly ASTRO_PUBLIC_APP_URL: string;
  readonly ASTRO_PUBLIC_CAL_LINK?: string;
  readonly ASTRO_PUBLIC_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
