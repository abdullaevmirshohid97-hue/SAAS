import { toast } from 'sonner';

import { isTauri } from './platform';

// Desktop auto-update: startup'da yangilanishni tekshiradi. Yangi versiya bo'lsa
// "Yangilash" tugmali banner (toast) ko'rsatadi — foydalanuvchi qulay paytda bosadi
// (klinika POS'da ish vaqtida kutilmagan qayta ishga tushish bo'lmaydi).
export async function checkForUpdates(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) return;

    toast.info(`Yangi versiya mavjud (${update.version})`, {
      description: 'Qulay paytda yangilang — ilova qayta ishga tushadi.',
      duration: Infinity,
      action: {
        label: 'Yangilash',
        onClick: () => {
          void (async () => {
            const id = toast.loading('Yangilanmoqda…');
            try {
              await update.downloadAndInstall();
              const { relaunch } = await import('@tauri-apps/plugin-process');
              toast.success('Yangilandi — qayta ishga tushmoqda…', { id });
              await relaunch();
            } catch (e) {
              console.warn('[update] install failed', e);
              toast.error("Yangilashda xato. Keyinroq urinib ko'ring.", { id });
            }
          })();
        },
      },
    });
  } catch (e) {
    console.warn('[update] check failed', e);
  }
}
