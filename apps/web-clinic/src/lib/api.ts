import { createClient } from '@clary/api-client';

import { branchHeaders } from './branch-header';
import { pharmacyHeaders } from './pharmacy/session';
import { supabase } from './supabase';

export const api = createClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  // Alohida "Dorixona" kirishi: qurilma kaliti va PIN sessiyasi (faqat dorixona akkauntida).
  // Filial tarmog'i: sahifadagi faol filial (X-Clary-Branch) — token boshqa
  // filialga o'tib qolsa server 409 qaytaradi.
  getExtraHeaders: () => ({ ...(pharmacyHeaders() ?? {}), ...branchHeaders() }),
});
