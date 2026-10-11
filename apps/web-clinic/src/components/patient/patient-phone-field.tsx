import { AlertCircle } from 'lucide-react';

import { patientPhoneError } from '@clary/utils';
import { Input, cn } from '@clary/ui-web';

// Yangi bemor telefoni — MAJBURIY. Kiritilmaguncha ostida qizil yozuv turadi.
// ("Qayta keldi" familiya + ism + telefon bo'yicha aniqlanadi — telefonsiz ishlamaydi.)

export const PHONE_ERROR_TEXT = {
  empty: 'Telefon raqamini kiriting',
  short: 'Telefon raqami to‘liq emas — 9 ta raqam (masalan 90 123 45 67)',
} as const;

/** Xato matni yoki null (yaroqli). */
export function patientPhoneMessage(phone: string): string | null {
  const err = patientPhoneError(phone);
  return err ? PHONE_ERROR_TEXT[err] : null;
}

export function PatientPhoneField({
  value,
  onChange,
  label = 'Telefon',
  className,
  inputClassName,
}: {
  value: string;
  onChange: (v: string) => void;
  /** null — yorliqsiz (placeholder bilan). */
  label?: string | null;
  className?: string;
  inputClassName?: string;
}) {
  const message = patientPhoneMessage(value);
  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <label className="text-muted-foreground text-xs font-medium">
          {label} <span className="text-destructive">*</span>
        </label>
      )}
      <Input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder={label ? '+998 90 123 45 67' : 'Telefon * (+998 90 123 45 67)'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!message}
        className={cn(
          message && 'border-destructive focus-visible:ring-destructive',
          inputClassName,
        )}
      />
      {message && (
        <div role="alert" className="text-destructive flex items-center gap-1 text-xs font-medium">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {message}
        </div>
      )}
    </div>
  );
}
