import { useEffect, useState } from 'react';
import { CalendarClock, LogOut, PauseCircle, ShieldCheck, Wallet } from 'lucide-react';
import { Button } from '@clary/ui-web';

import { supabase } from '@/lib/supabase';

/**
 * B5 — Obuna/blok holati uchun to'liq ekranli tushunarli gate.
 *
 * Ilgari obuna tugaganda har bir API so'rov jimgina 403 bo'lib, ekranlar
 * bo'sh ko'rinardi — klinika "ma'lumotlar yo'qoldi" deb vahima qilardi
 * (2026-07-06 hodisasi). Endi SubscriptionGuard mashina-kod qaytaradi,
 * QueryCache uni ushlab shu oynani ochadi: ma'lumotlar XAVFSIZ ekani va
 * nima qilish kerakligi aniq aytiladi.
 */
export const SUB_BLOCK_EVENT = 'clary:subscription-blocked';

type BlockCode = 'SUBSCRIPTION_INACTIVE' | 'TRIAL_EXPIRED' | 'CLINIC_SUSPENDED' | 'CLINIC_DELETED';

export const SUB_BLOCK_CODES: readonly string[] = [
  'SUBSCRIPTION_INACTIVE',
  'TRIAL_EXPIRED',
  'CLINIC_SUSPENDED',
  'CLINIC_DELETED',
];

const CONTENT: Record<BlockCode, { icon: typeof Wallet; title: string; desc: string }> = {
  SUBSCRIPTION_INACTIVE: {
    icon: Wallet,
    title: 'Obuna muddati tugagan',
    desc: "Klinikangiz obunasi to'lanmagan yoki bekor qilingan. To'lov amalga oshirilgach, tizim shu holicha qayta ochiladi.",
  },
  TRIAL_EXPIRED: {
    icon: CalendarClock,
    title: 'Sinov muddati tugadi',
    desc: "Bepul sinov davri yakunlandi. Obunani rasmiylashtirsangiz, kiritilgan barcha ma'lumotlaringiz bilan davom etasiz.",
  },
  CLINIC_SUSPENDED: {
    icon: PauseCircle,
    title: "Klinika vaqtincha to'xtatilgan",
    desc: "Hisobingiz administrator tomonidan vaqtincha to'xtatilgan. Iltimos, Clary qo'llab-quvvatlash xizmatiga murojaat qiling.",
  },
  CLINIC_DELETED: {
    icon: PauseCircle,
    title: 'Klinika arxivlangan',
    desc: "Bu klinika arxivga o'tkazilgan. Savollar bo'lsa Clary qo'llab-quvvatlash xizmatiga murojaat qiling.",
  },
};

export function SubscriptionGate() {
  const [code, setCode] = useState<BlockCode | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string;
      if ((SUB_BLOCK_CODES as string[]).includes(detail)) setCode(detail as BlockCode);
    };
    window.addEventListener(SUB_BLOCK_EVENT, handler);
    return () => window.removeEventListener(SUB_BLOCK_EVENT, handler);
  }, []);

  if (!code) return null;
  const info = CONTENT[code];
  const Icon = info.icon;
  const canPay = code === 'SUBSCRIPTION_INACTIVE' || code === 'TRIAL_EXPIRED';

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
          <Icon className="h-7 w-7 text-amber-600" />
        </div>
        <h1 className="text-xl font-semibold">{info.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{info.desc}</p>

        {/* Eng muhim xabar — ma'lumot yo'qolmagan */}
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-left text-sm text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <b>Barcha ma'lumotlaringiz xavfsiz saqlanmoqda</b> — bemorlar, jurnal, kassa tarixi,
            hech narsa o'chirilmagan. Kirish tiklangach hammasi shu holicha ochiladi.
          </span>
        </div>

        <div className="mt-6 space-y-2">
          {canPay && (
            <Button
              className="w-full"
              onClick={() => {
                setCode(null);
                window.location.href = '/settings/subscription';
              }}
            >
              <Wallet className="mr-2 h-4 w-4" /> Obuna va to'lov sahifasi
            </Button>
          )}
          <a
            href="https://clary.uz/contact"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 w-full items-center justify-center rounded-md border bg-background text-sm font-medium hover:bg-accent"
          >
            Qo'llab-quvvatlash bilan bog'lanish
          </a>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = '/login';
            }}
          >
            <LogOut className="mr-2 h-4 w-4" /> Chiqish
          </Button>
        </div>
      </div>
    </div>
  );
}
