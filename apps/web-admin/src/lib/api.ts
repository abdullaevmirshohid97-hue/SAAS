import { createClient } from '@clary/api-client';
import { supabase } from '@/main';

export const api = createClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
});
