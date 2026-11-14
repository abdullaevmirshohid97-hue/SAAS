import { supabase } from './supabase';
import { isTauri } from './platform';

// Google OAuth deep-link oqimi (desktop):
// login → tizim brauzerida Google consent → Supabase
// https://app.clary.uz/desktop-auth.html#access_token=... ga qaytaradi (bu manzil
// Supabase redirect ro'yxatida bor; `clary://` esa YO'Q edi — Supabase uni rad
// etib Site URL'ga qaytarar, foydalanuvchi brauzerda kirib qolib, ilova kirmasdi).
// Ko'prik sahifa tokenlarni `clary://auth-callback#...` ga uzatadi → OS ilovani
// ochadi → deep-link plugin URL'ni beradi → fragment'dan tokenlarni olib setSession.

/** Supabase Google'dan keyin qaytaradigan ko'prik sahifa (public/desktop-auth.html). */
export const DESKTOP_OAUTH_REDIRECT = 'https://app.clary.uz/desktop-auth.html';

/** Login sahifasi Google tugmasining "kutilmoqda" holatini shu hodisa bilan tushiradi. */
export const DESKTOP_AUTH_DONE_EVENT = 'clary:desktop-auth-done';

// getCurrent() jarayon davomida OXIRGI deep-link'ni qaytaraveradi — sahifa qayta
// yuklansa ("Yangilash") eski tokenlar qayta o'rnatilib, aylantirilgan refresh
// token sessiyani buzardi. Qayta ishlangan havolani eslab qolamiz.
const HANDLED_KEY = 'clary.desktop.deeplink.handled';

function fingerprint(token: string): string {
  return token.slice(-24);
}

function alreadyHandled(fp: string): boolean {
  try {
    return localStorage.getItem(HANDLED_KEY) === fp;
  } catch {
    return false;
  }
}

function markHandled(fp: string): void {
  try {
    localStorage.setItem(HANDLED_KEY, fp);
  } catch {
    /* ignore */
  }
}

function parseCallback(
  url: string,
): { access_token: string; refresh_token: string } | { error: string } | null {
  if (!url.startsWith('clary://auth-callback')) return null;
  const hashIdx = url.indexOf('#');
  const params = new URLSearchParams(hashIdx === -1 ? '' : url.slice(hashIdx + 1));
  const error = params.get('error_description') ?? params.get('error');
  if (error) return { error: error.replace(/\+/g, ' ') };
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return null;
  return { access_token, refresh_token };
}

function done(ok: boolean): void {
  window.dispatchEvent(new CustomEvent(DESKTOP_AUTH_DONE_EVENT, { detail: { ok } }));
}

/**
 * Desktop deep-link auth listener'ini o'rnatadi. Cold-start (ilova deep-link bilan
 * ochilgan) va ishlab turgan holatdagi deep-linklarni qayta ishlaydi.
 * @param onAuthed — sessiya muvaffaqiyatli o'rnatilgach chaqiriladi (masalan dashboard'ga o'tish).
 */
export async function setupDeepLinkAuth(onAuthed: () => void): Promise<void> {
  if (!isTauri()) return;

  const handleUrl = async (url: string) => {
    const parsed = parseCallback(url);
    if (!parsed) return;
    const { toast } = await import('sonner');
    if ('error' in parsed) {
      done(false);
      toast.error('Google orqali kirish bekor qilindi', { description: parsed.error });
      return;
    }
    const fp = fingerprint(parsed.refresh_token);
    if (alreadyHandled(fp)) return;
    markHandled(fp);
    // setSession xatoni QAYTARADI (throw qilmaydi) — tekshirmasak muvaffaqiyatsiz
    // kirishda ham dashboard'ga o'tib, yana login'ga qaytib qolardi.
    const { error } = await supabase.auth.setSession(parsed);
    if (error) {
      console.warn('[deep-link auth] setSession failed', error);
      done(false);
      toast.error('Kirish yakunlanmadi', { description: error.message });
      return;
    }
    done(true);
    onAuthed();
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
