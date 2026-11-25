import { createClient } from '@clary/api-client';
import { supabase } from '@/main';

export const api = createClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
});

/**
 * CLARY Sklad API — ALOHIDA jarayon (pm2: clary-sklad-api), Clinic API emas.
 * Prod: https://sklad.clary.uz. Lokal: http://localhost:4100.
 */
const clinicApiUrl: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
export const skladApi = createClient({
  baseUrl:
    import.meta.env.VITE_SKLAD_API_URL ??
    (clinicApiUrl.includes('localhost') ? 'http://localhost:4100' : 'https://sklad.clary.uz'),
  getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
});
