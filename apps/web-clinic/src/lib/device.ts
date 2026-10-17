// =============================================================================
// Qurilma identifikatori — klinika qurilmalari ro'yxati (super-admin /
// klinika egasi ko'radi, bloklaydi). Brauzerda tasodifiy barqaror ID
// localStorage'da saqlanadi; desktop (Tauri) ham shu veb-kod bilan ishlaydi,
// faqat X-Clary-Client 'desktop' bo'ladi.
// =============================================================================

import { APP_BUILD } from './desktop-update';
import { isTauri } from './platform';

const KEY = 'clary.device_id';
let cached: string | null = null;

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* eski brauzer */
  }
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function deviceId(): string {
  if (cached) return cached;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && /^[A-Za-z0-9_-]{8,100}$/.test(saved)) {
      cached = saved;
      return saved;
    }
    const id = randomId();
    localStorage.setItem(KEY, id);
    cached = id;
    return id;
  } catch {
    // localStorage yopiq (maxfiy rejim) — sessiya davomida bitta ID
    cached = cached ?? randomId();
    return cached;
  }
}

export function deviceHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'X-Clary-Device': deviceId(),
    'X-Clary-Client': isTauri() ? 'desktop' : 'web',
  };
  if (APP_BUILD && APP_BUILD !== 'dev') h['X-Clary-App-Version'] = APP_BUILD.slice(0, 40);
  return h;
}
