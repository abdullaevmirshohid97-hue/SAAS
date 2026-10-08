import { useSyncExternalStore } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import {
  APP_BUILD,
  CHECK_UPDATES_EVENT,
  checkDesktopUpdate,
  fetchServerBuild,
  webUpdateWatchEnabled,
  type DesktopUpdate,
} from '@/lib/desktop-update';
import { isTauri } from '@/lib/platform';

// =============================================================================
// "Yangilanish" — qizil chiziq (qabulxona va boshqa sahifalar tepasida)
// =============================================================================
// Serverga yangi versiya joylansa: sahifa tepasida butun eni bo'ylab qizil
// chiziq + "Yangilash" tugmasi. Bitta bosish: web — sahifa qayta yuklanadi
// (desktop ham interfeysni serverdan oladi), desktop qobig'i — yuklab,
// o'rnatib, qayta ishga tushadi. Yopib bo'lmaydi — yangilanmaguncha turadi.
//
// Holat bitta (modul darajasida): chiziq bir nechta joyda chizilsa ham
// tekshiruv bitta.
// =============================================================================

const WEB_POLL_MS = 60_000;
const DESKTOP_POLL_MS = 30 * 60_000;
const FOCUS_MIN_GAP_MS = 15_000;

interface UpdateState {
  webNew: boolean;
  desktop: DesktopUpdate | null;
  installing: boolean;
  progress: number | null;
}

let state: UpdateState = { webNew: false, desktop: null, installing: false, progress: null };
const listeners = new Set<() => void>();
let started = false;
let lastWebCheck = 0;

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

async function checkWeb(): Promise<boolean> {
  if (!webUpdateWatchEnabled()) return false;
  lastWebCheck = Date.now();
  const server = await fetchServerBuild();
  // Tarmoq xatosi / deploy paytida fayl vaqtincha yo'q — holat o'zgarmaydi
  if (!server) return state.webNew;
  const fresh = server !== APP_BUILD;
  if (fresh !== state.webNew) set({ webNew: fresh });
  // Navbat TV (kiosk) — odamsiz ekran: o'zi yangilanadi (har server build'i
  // uchun bir marta — eski kesh tufayli cheksiz qayta yuklanmasin)
  if (fresh && window.location.pathname.startsWith('/kiosk')) {
    try {
      if (sessionStorage.getItem('clary.kiosk-reload') !== server) {
        sessionStorage.setItem('clary.kiosk-reload', server);
        window.location.reload();
      }
    } catch {
      /* sessionStorage yo'q — qo'lda yangilanadi */
    }
  }
  return fresh;
}

async function checkShell(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const u = await checkDesktopUpdate();
    if ((u?.version ?? null) !== (state.desktop?.version ?? null)) set({ desktop: u });
    return !!u;
  } catch (e) {
    console.warn('[update] desktop check failed', e);
    return false;
  }
}

/** Kuzatuvni boshlash (main.tsx) — chiziq chizilmagan sahifalarda ham (kiosk). */
export function startUpdateWatch() {
  if (started || typeof window === 'undefined') return;
  started = true;
  void checkWeb();
  void checkShell();
  window.setInterval(() => void checkWeb(), WEB_POLL_MS);
  window.setInterval(() => void checkShell(), DESKTOP_POLL_MS);
  // Oynaga qaytilganda (desktop'da boshqa dasturdan qaytish ham) — darhol
  const onReturn = () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastWebCheck > FOCUS_MIN_GAP_MS) void checkWeb();
  };
  window.addEventListener('focus', onReturn);
  document.addEventListener('visibilitychange', onReturn);
  window.addEventListener('online', onReturn);
  // Sozlamalardagi "Yangilanishni tekshirish"
  window.addEventListener(CHECK_UPDATES_EVENT, () => {
    void Promise.all([checkWeb(), checkShell()]).then(([a, b]) => {
      if (!a && !b) toast.success("Eng so'nggi versiya o'rnatilgan");
    });
  });
}

function subscribe(l: () => void) {
  startUpdateWatch();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useAppUpdate() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

async function applyUpdate() {
  if (state.installing) return;
  if (state.desktop) {
    set({ installing: true, progress: null });
    try {
      await state.desktop.install((p) => set({ progress: p }));
    } catch (e) {
      console.warn('[update] install failed', e);
      toast.error("Yangilashda xato. Internetni tekshirib, qayta urinib ko'ring.");
      set({ installing: false, progress: null });
    }
    return;
  }
  set({ installing: true });
  window.location.reload();
}

/** Qizil "Yangilanish" chizig'i — sahifa tepasida, oqim ichida (kontentni yopmaydi). */
export function AppUpdateBar() {
  const s = useAppUpdate();
  const kind: 'desktop' | 'web' | null = s.desktop ? 'desktop' : s.webNew ? 'web' : null;
  if (!kind) return null;

  const text = s.installing
    ? kind === 'web'
      ? 'Yangilanmoqda…'
      : s.progress == null
        ? 'Yangi versiya yuklanmoqda…'
        : s.progress >= 100
          ? "O'rnatilmoqda — ilova qayta ishga tushadi…"
          : `Yangi versiya yuklanmoqda… ${s.progress}%`
    : kind === 'desktop'
      ? `Clary desktop ${s.desktop!.version} tayyor — yangilash uchun tugmani bosing`
      : 'Yangi versiya chiqdi — yangilash uchun tugmani bosing';

  return (
    <div
      role="alert"
      className="relative z-40 flex shrink-0 items-center justify-center gap-3 bg-red-600 px-4 py-2 text-white shadow-sm"
    >
      {kind === 'desktop' ? (
        <Download className="h-4 w-4 shrink-0" />
      ) : (
        <RefreshCw className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 truncate text-sm font-semibold">{text}</span>
      <button
        type="button"
        onClick={() => void applyUpdate()}
        disabled={s.installing}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-white px-4 text-sm font-bold text-red-700 shadow transition hover:bg-red-50 disabled:opacity-80"
      >
        {s.installing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        Yangilash
      </button>
      {s.installing && kind === 'desktop' && s.progress != null && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-red-800/50">
          <div className="h-full bg-white transition-all" style={{ width: `${s.progress}%` }} />
        </div>
      )}
    </div>
  );
}
