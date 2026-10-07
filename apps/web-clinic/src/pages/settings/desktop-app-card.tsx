import { useEffect, useState } from 'react';
import { Download, Monitor, RefreshCw } from 'lucide-react';

import { Button, Card, CardContent, CardHeader, CardTitle } from '@clary/ui-web';

import {
  DESKTOP_DOWNLOAD_PAGE,
  DESKTOP_DOWNLOAD_URL,
  getDesktopVersion,
  requestUpdateCheck,
} from '@/lib/desktop-update';
import { isTauri } from '@/lib/platform';

// Windows desktop ilovasi: brauzerda — yuklab olish, desktop'da — versiya va
// "Yangilanishni tekshirish".
export function DesktopAppCard() {
  const desktop = isTauri();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (desktop) void getDesktopVersion().then(setVersion);
  }, [desktop]);

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Monitor className="h-4 w-4" />
          Clary desktop (Windows)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {desktop ? (
          <>
            <p className="text-muted-foreground text-sm">
              O&lsquo;rnatilgan versiya: <b className="text-foreground">{version ?? '…'}</b>.
              Serverga yangi versiya joylansa, pastda «Yangilash» xabari chiqadi — bitta tugma.
            </p>
            <Button size="sm" variant="outline" className="gap-1" onClick={requestUpdateCheck}>
              <RefreshCw className="h-4 w-4" /> Yangilanishni tekshirish
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Klinika va dorixona kompyuterlari uchun: termal printerga dialogsiz chop etish,
              avtomatik yangilanish, ish stolidan tez ochish. Windows 10/11.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" className="gap-1" asChild>
                <a href={DESKTOP_DOWNLOAD_URL} download>
                  <Download className="h-4 w-4" /> Yuklab olish
                </a>
              </Button>
              <a
                href={DESKTOP_DOWNLOAD_PAGE}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground text-xs underline"
              >
                Batafsil
              </a>
            </div>
            <p className="text-muted-foreground text-[11px]">
              O&lsquo;rnatishda «Noma&lsquo;lum nashriyot» chiqsa → «Batafsil» → «Baribir ishga
              tushirish». Kirish — shu login/parol bilan.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
