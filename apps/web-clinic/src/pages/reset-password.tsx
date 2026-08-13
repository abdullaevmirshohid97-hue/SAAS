import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, Lock, ShieldCheck } from 'lucide-react';

import { Button, Input, Card, CardContent, ClaryLogo } from '@clary/ui-web';

import { supabase } from '@/lib/supabase';

// =============================================================================
// /reset-password — parolni tiklash havolasining qo'nish sahifasi
// =============================================================================
// Oqim: login sahifasi resetPasswordForEmail(...) yuboradi → Supabase emaildagi
// havolada `type=recovery` bilan shu yerga qaytaradi → supabase-js URL'dagi
// tokendan sessiya o'rnatadi (detectSessionInUrl) → updateUser({ password }).
//
// Havolasiz to'g'ridan-to'g'ri kirilsa sessiya bo'lmaydi — shuni tekshiramiz,
// aks holda foydalanuvchi formani to'ldirib, oxirida tushunarsiz xato olardi.

// Server bilan bir xil chegara (api: staff.module.ts MIN_PASSWORD_LENGTH).
const MIN_PASSWORD_LENGTH = 8;

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    // supabase-js URL fragmentini asinxron qayta ishlaydi — PASSWORD_RECOVERY
    // hodisasini ham, allaqachon o'rnatilgan sessiyani ham hisobga olamiz.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setReady((prev) => prev ?? Boolean(data.session));
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit =
    password.length >= MIN_PASSWORD_LENGTH && password === confirm && !loading;

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('auth.passwordUpdated', 'Parol yangilandi'));
    navigate('/dashboard');
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <ClaryLogo variant="full" size="md" className="text-foreground" />
            <h1 className="text-lg font-semibold">
              {t('auth.setNewPassword', 'Yangi parol o‘rnatish')}
            </h1>
          </div>

          {ready === null && (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('common.loading', 'Yuklanmoqda…')}
            </div>
          )}

          {ready === false && (
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm">
                {t(
                  'auth.resetLinkInvalid',
                  'Tiklash havolasi yaroqsiz yoki muddati tugagan. Login sahifasidan qaytadan so‘rang.',
                )}
              </p>
              <Button className="w-full" onClick={() => navigate('/login')}>
                {t('auth.backToLogin', 'Login sahifasiga qaytish')}
              </Button>
            </div>
          )}

          {ready === true && (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-muted-foreground text-xs font-medium" htmlFor="new-password">
                  {t('auth.newPassword', 'Yangi parol')}
                </label>
                <div className="relative">
                  <Lock className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                  <Input
                    id="new-password"
                    type="password"
                    className="pl-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    aria-invalid={tooShort}
                    required
                  />
                </div>
                {tooShort && (
                  <p className="text-xs text-red-600">
                    {t('auth.passwordTooShort', 'Kamida {{n}} belgi kerak', {
                      n: MIN_PASSWORD_LENGTH,
                    })}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  className="text-muted-foreground text-xs font-medium"
                  htmlFor="confirm-password"
                >
                  {t('auth.confirmPassword', 'Parolni takrorlang')}
                </label>
                <div className="relative">
                  <Lock className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                  <Input
                    id="confirm-password"
                    type="password"
                    className="pl-9"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    aria-invalid={mismatch}
                    required
                  />
                </div>
                {mismatch && (
                  <p className="text-xs text-red-600">
                    {t('auth.passwordMismatch', 'Parollar mos kelmadi')}
                  </p>
                )}
              </div>

              <Button type="submit" className="h-10 w-full" disabled={!canSubmit}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t('auth.savePassword', 'Parolni saqlash')
                )}
              </Button>
            </form>
          )}

          <div className="text-muted-foreground flex items-center justify-center gap-1.5 text-[11px]">
            <ShieldCheck className="h-3 w-3" />
            TLS 1.3 &middot; RLS &middot; SHA-256 audit chain
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
