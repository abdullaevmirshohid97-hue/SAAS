import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const STORAGE_KEY = 'clary-pwa-dismissed-v1';

export function PwaInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (localStorage.getItem(STORAGE_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    const installedHandler = () => setVisible(false);
    window.addEventListener('appinstalled', installedHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  if (!visible || !deferred) return null;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    setVisible(false);
  };

  const install = async () => {
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } finally {
      setVisible(false);
      setDeferred(null);
    }
  };

  return (
    <div className="bg-card fixed bottom-4 right-4 z-50 w-80 rounded-lg border p-4 shadow-xl">
      <div className="flex items-start gap-3">
        <div className="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
          <Download className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="font-semibold">Clary’ni o‘rnatish</div>
          <p className="text-muted-foreground mt-1 text-xs">
            Ilovani qurilmangizga o‘rnating — tezroq ishga tushishi, offline kirish va mahalliy
            bildirishnomalar uchun.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={install}
              className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-semibold hover:opacity-90"
            >
              O‘rnatish
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="hover:bg-accent rounded-md border px-3 py-1.5 text-xs"
            >
              Keyinroq
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
