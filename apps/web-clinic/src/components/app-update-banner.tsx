import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@clary/ui-web';

import {
  APP_BUILD,
  CHECK_UPDATES_EVENT,
  checkDesktopUpdate,
  fetchServerBuild,
  webUpdateWatchEnabled,
  type DesktopUpdate,
} from '@/lib/desktop-update';
import { isTauri } from '@/lib/platform';

const WEB_POLL_MS = 5 * 60_000;
const DESKTOP_POLL_MS = 30 * 60_000;
const SNOOZE_MS = 30 * 60_000;

/**
 * "Yangi versiya" banneri — web deploy'dan keyin (sahifani qayta yuklash) va
 * desktop qobig'i yangilanganda (yuklab o'rnatish + qayta ishga tushirish).
 * Bitta tugma. "Keyinroq" — 30 daqiqaga yashiradi.
 */
export function AppUpdateBanner() {
  const [webNew, setWebNew] = useState(false);
  const [desktop, setDesktop] = useState<DesktopUpdate | null>(null);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [, force] = useState(0);
  const manual = useRef(false);

  const checkWeb = useCallback(async () => {
    if (!webUpdateWatchEnabled()) return false;
    const server = await fetchServerBuild();
    const fresh = !!server && server !== APP_BUILD;
    setWebNew(fresh);
    return fresh;
  }, []);

  const checkShell = useCallback(async () => {
    if (!isTauri()) return false;
    try {
      const u = await checkDesktopUpdate();
      setDesktop(u);
      return !!u;
    } catch (e) {
      console.warn('[update] desktop check failed', e);
      return false;
    }
  }, []);

  useEffect(() => {
    void checkWeb();
    void checkShell();
    const w = window.setInterval(() => void checkWeb(), WEB_POLL_MS);
    const d = window.setInterval(() => void checkShell(), DESKTOP_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkWeb();
    };
    const onManual = () => {
      manual.current = true;
      setSnoozedUntil(0);
      void Promise.all([checkWeb(), checkShell()]).then(([a, b]) => {
        if (manual.current && !a && !b) toast.success("Eng so'nggi versiya o'rnatilgan");
        manual.current = false;
      });
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener(CHECK_UPDATES_EVENT, onManual);
    return () => {
      window.clearInterval(w);
      window.clearInterval(d);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener(CHECK_UPDATES_EVENT, onManual);
    };
  }, [checkWeb, checkShell]);

  // "Keyinroq" muddati tugaganda qayta ko'rsatish
  useEffect(() => {
    if (!snoozedUntil) return;
    const t = window.setTimeout(() => force((n) => n + 1), snoozedUntil - Date.now() + 50);
    return () => window.clearTimeout(t);
  }, [snoozedUntil]);

  const kind: 'desktop' | 'web' | null = desktop ? 'desktop' : webNew ? 'web' : null;
  if (!kind || (!installing && Date.now() < snoozedUntil)) return null;

  const apply = async () => {
    if (kind === 'web') {
      window.location.reload();
      return;
    }
    setInstalling(true);
    setProgress(null);
    try {
      await desktop!.install(setProgress);
    } catch (e) {
      console.warn('[update] install failed', e);
      toast.error("Yangilashda xato. Internetni tekshirib, qayta urinib ko'ring.");
      setInstalling(false);
    }
  };

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex justify-center px-3 md:bottom-5"
    >
      <div className="bg-background pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-xl border-2 border-blue-500/70 p-3 shadow-2xl shadow-blue-500/20">
        <div className="mt-0.5 rounded-full bg-blue-100 p-2 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
          {kind === 'desktop' ? (
            <Download className="h-4 w-4" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {kind === 'desktop'
              ? `Clary desktop ${desktop!.version} tayyor`
              : 'Yangi versiya joylandi'}
          </div>
          <div className="text-muted-foreground text-xs">
            {installing
              ? progress == null
                ? 'Yuklanmoqda…'
                : progress >= 100
                  ? "O'rnatilmoqda — ilova qayta ishga tushadi…"
                  : `Yuklanmoqda… ${progress}%`
              : kind === 'desktop'
                ? (desktop!.notes ?? 'Yangilash bir daqiqa oladi, ilova qayta ishga tushadi.')
                : 'Ochiq formalarni saqlab, «Yangilash»ni bosing — sahifa yangilanadi.'}
          </div>
          {installing && (
            <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
              <div
                className={
                  'h-full bg-blue-600 transition-all ' +
                  (progress == null ? 'w-1/3 animate-pulse' : '')
                }
                style={progress == null ? undefined : { width: `${progress}%` }}
              />
            </div>
          )}
        </div>
        {!installing && (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" className="h-8 bg-blue-600 hover:bg-blue-700" onClick={apply}>
              Yangilash
            </Button>
            <button
              type="button"
              title="Keyinroq (30 daqiqa)"
              onClick={() => setSnoozedUntil(Date.now() + SNOOZE_MS)}
              className="text-muted-foreground hover:bg-accent rounded-md p-1.5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
