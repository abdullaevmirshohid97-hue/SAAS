import { supabase } from './supabase';
import { isTauri } from './platform';

// Google OAuth deep-link oqimi (desktop):
// login → tizim brauzerida Google consent → Supabase
// `clary://auth-callback#access_token=...&refresh_token=...` ga qaytaradi →
// OS ilovani ochadi → deep-link plugin URL'ni beradi → fragment'dan tokenlarni
// olib setSession qilamiz. (Fragment parse [main.tsx] demo oqimi bilan bir xil.)
function parseTokensFromUrl(url: string): { access_token: string; refresh_token: string } | null {
  const hashIdx = url.indexOf('#');
  if (hashIdx === -1) return null;
  const params = new URLSearchParams(url.slice(hashIdx + 1));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return null;
  return { access_token, refresh_token };
}

/**
 * Desktop deep-link auth listener'ini o'rnatadi. Cold-start (ilova deep-link bilan
 * ochilgan) va ishlab turgan holatdagi deep-linklarni qayta ishlaydi.
 * @param onAuthed — sessiya muvaffaqiyatli o'rnatilgach chaqiriladi (masalan dashboard'ga o'tish).
 */
export async function setupDeepLinkAuth(onAuthed: () => void): Promise<void> {
  if (!isTauri()) return;

  const handleUrl = async (url: string) => {
    const tokens = parseTokensFromUrl(url);
    if (!tokens) return;
    try {
      await supabase.auth.setSession(tokens);
      onAuthed();
    } catch (e) {
      console.warn('[deep-link auth] setSession failed', e);
    }
  };

  try {
    const { onOpenUrl, getCurrent } = await import('@tauri-apps/plugin-deep-link');
    // Cold-start: ilova deep-link bilan ochilgan bo'lsa.
    const current = await getCurrent();
    const first = current?.[0];
    if (first) await handleUrl(first);
    // Ishlab turganda kelgan deep-linklar (single-instance orqali yo'naltiriladi).
    await onOpenUrl((urls) => {
      for (const u of urls) void handleUrl(u);
    });
  } catch (e) {
    console.warn('[deep-link auth] setup failed', e);
  }
}
