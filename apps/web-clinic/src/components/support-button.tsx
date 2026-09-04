import { useState } from 'react';
import { Copy, LifeBuoy, Phone, Send } from 'lucide-react';
import { toast } from 'sonner';

import {
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@clary/ui-web';

import { useAuth } from '@/providers/auth-provider';

// =============================================================================
// Qo'llab-quvvatlash tugmasi — sidebar'da brand ostida.
//
// Maqsad: klinika administratori va qabulxona xodimi muammo yuzaga kelganda
// uzoq izlanmasdan, bir bosishda biz bilan bog'lana olsin. Shifokor/hamshira
// ko'rmaydi — ular odatda klinika ichidagi adminga murojaat qiladi.
// =============================================================================

// Bitta joyda — raqam yoki Telegram o'zgarsa faqat shu yer tahrirlanadi.
// (Loyihaning boshqa joylarida ham shu raqam bor: admin-clinic.module.ts,
// landing sahifalari — ular alohida kontekst, bu yerdan bog'lanmagan.)
const SUPPORT_PHONE = '+998770414020';
const SUPPORT_PHONE_DISPLAY = '+998 77 041 40 20';
const SUPPORT_TELEGRAM = 'https://t.me/Clary_uz';

// Faqat shu rollar ko'radi. Kengaytirish kerak bo'lsa — shu ro'yxatga qo'shish.
const SUPPORT_ROLES = new Set(['clinic_owner', 'clinic_admin', 'reception']);

export function SupportButton({ collapsed }: { collapsed: boolean }) {
  const { role } = useAuth();
  const [open, setOpen] = useState(false);

  if (!SUPPORT_ROLES.has(role)) return null;

  const copyPhone = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_PHONE);
      toast.success('Raqam nusxalandi');
    } catch {
      // Clipboard API HTTPS'siz kontekstda yoki eski brauzerda ishlamaydi —
      // xodim raqamni baribir ekranda ko'rib turibdi, shuning uchun jimgina
      // emas, aniq xabar beramiz.
      toast.error('Nusxalab bo‘lmadi — raqamni qo‘lda ko‘chiring');
    }
  };

  return (
    <>
      <div className={cn('border-b', collapsed ? 'px-2 py-2' : 'px-2 py-2')}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={collapsed ? 'Yordam — qo‘llab-quvvatlash' : undefined}
          className={cn(
            'flex w-full items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors',
            'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            collapsed ? 'justify-center px-2' : 'px-3',
          )}
        >
          <LifeBuoy className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="truncate">Yordam</span>
              <span className="ml-auto rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                24/7
              </span>
            </>
          )}
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Qo&lsquo;llab-quvvatlash xizmati</DialogTitle>
            <DialogDescription>
              Muammo yuzaga keldimi? Biz 24/7 aloqadamiz — qo&lsquo;ng&lsquo;iroq qiling yoki
              Telegramda yozing.
            </DialogDescription>
          </DialogHeader>

          {/* Raqam birinchi va eng ko'zga tashlanadigan element bo'lishi kerak. */}
          <div className="bg-muted/50 rounded-lg border p-4 text-center">
            <div className="text-muted-foreground mb-1 text-[11px] font-medium uppercase tracking-wide">
              Ishonch telefoni
            </div>
            <div className="select-all font-mono text-2xl font-bold tracking-tight">
              {SUPPORT_PHONE_DISPLAY}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <a
              href={`tel:${SUPPORT_PHONE}`}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors"
            >
              <Phone className="h-4 w-4" />
              Qo&lsquo;ng&lsquo;iroq
            </a>
            <button
              type="button"
              onClick={copyPhone}
              className="hover:bg-accent flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors"
            >
              <Copy className="h-4 w-4" />
              Nusxa olish
            </button>
          </div>

          <a
            href={SUPPORT_TELEGRAM}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-md bg-[#229ED9] px-3 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Send className="h-4 w-4" />
            Telegramda yozish
          </a>
        </DialogContent>
      </Dialog>
    </>
  );
}
