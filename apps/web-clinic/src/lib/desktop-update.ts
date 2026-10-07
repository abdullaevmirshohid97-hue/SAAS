import { isTauri } from './platform';

// =============================================================================
// Yangilanishlar
// =============================================================================
// 1) Web versiya — har deploy'da: ilovadagi __APP_BUILD__ ≠ serverdagi
//    /version.json → "Yangi versiya joylandi" → sahifani qayta yuklash.
//    Desktop ilova ham interfeysni serverdan (app.clary.uz) yuklaydi, shuning
//    uchun bu unga ham tegishli.
// 2) Desktop qobig'i (Tauri) — kamdan-kam (printer/native o'zgarishlar):
//    clary.uz/download/latest.json, ed25519 imzo bilan tekshiriladi.
// Banner: components/app-update-banner.tsx.
// =============================================================================

export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

/** Web versiya kuzatuvi yoqilganmi (prod build, http(s) sahifa). */
export function webUpdateWatchEnabled(): boolean {
  return (
    import.meta.env.PROD &&
    typeof window !== 'undefined' &&
    /^https?:$/.test(window.location.protocol) &&
    // tauri.localhost — eski (0.1.x) desktop: interfeys ichiga o'rnatilgan
    !/^(localhost|127\.0\.0\.1|tauri\.localhost)$/.test(window.location.hostname)
  );
}

/** Serverdagi joriy build id (topilmasa/xato bo'lsa null). */
export async function fetchServerBuild(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = (await res.json()) as { id?: unknown };
    return typeof j.id === 'string' ? j.id : null;
  } catch {
    return null;
  }
}

export interface DesktopUpdate {
  version: string;
  currentVersion: string;
  notes: string | null;
  /** Yuklab, o'rnatib, ilovani qayta ishga tushiradi. pct — 0..100, hajm noma'lum bo'lsa null. */
  install: (onProgress: (pct: number | null) => void) => Promise<void>;
}

/** Desktop qobig'ining yangi versiyasi (Tauri emas yoki yo'q bo'lsa null). */
export async function checkDesktopUpdate(): Promise<DesktopUpdate | null> {
  if (!isTauri()) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body?.trim() || null,
    install: async (onProgress) => {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((ev) => {
        if (ev.event === 'Started') {
          total = ev.data.contentLength ?? 0;
          onProgress(total ? 0 : null);
        } else if (ev.event === 'Progress') {
          done += ev.data.chunkLength;
          onProgress(total ? Math.min(100, Math.round((done / total) * 100)) : null);
        } else if (ev.event === 'Finished') {
          onProgress(100);
        }
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}

/** O'rnatilgan desktop versiyasi (brauzerda null). */
export async function getDesktopVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return null;
  }
}

/** Sozlamalardagi "Yangilanishni tekshirish" tugmasi → banner darhol tekshiradi. */
export const CHECK_UPDATES_EVENT = 'clary:check-updates';
export function requestUpdateCheck(): void {
  window.dispatchEvent(new CustomEvent(CHECK_UPDATES_EVENT));
}

/** Windows o'rnatuvchisi — doimiy havola (har relizda shu nom yangilanadi). */
export const DESKTOP_DOWNLOAD_URL = 'https://clary.uz/download/Clary_x64-setup.exe';
export const DESKTOP_DOWNLOAD_PAGE = 'https://clary.uz/download';
