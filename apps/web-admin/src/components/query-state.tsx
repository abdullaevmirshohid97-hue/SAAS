import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@clary/ui-web';

/**
 * A2 — sahifalarda yagona yuklanish/xato holati. "Ma'lumot yo'q" EmptyState
 * faqat haqiqatan bo'sh bo'lganda ko'rinishi kerak; yuklanish paytida bu
 * komponentlar ishlatiladi.
 */
export function LoadingState({ label = 'Yuklanmoqda…' }: { label?: string }) {
  return (
    <div className="text-muted-foreground flex items-center justify-center gap-2 p-8 text-sm">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-sm">
      <div className="text-destructive flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        Yuklashda xatolik: {message ?? 'server xatosi'}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Qayta urinish
        </Button>
      )}
    </div>
  );
}
