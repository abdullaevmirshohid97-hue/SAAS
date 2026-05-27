import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@clary/ui-web';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

import { api } from '@/lib/api';

// =============================================================================
// /patient-login?token=...
//
// Telegram bot'dan kelgan magic link. Token tekshiriladi (5 min TTL, one-time).
// Hozircha: muvaffaqiyatli bo'lsa bemor ma'lumotlari ko'rsatiladi (placeholder).
// Kelajakda: bemor cabinet (web-patient) ilovasi ochiladi.
// =============================================================================

type Result =
  | { kind: 'loading' }
  | { kind: 'ok'; clinic_id: string; patient_id: string; patient_login_id: string }
  | { kind: 'error'; message: string };

export function PatientLoginPage() {
  const [params] = useSearchParams();
  const [result, setResult] = useState<Result>({ kind: 'loading' });
  const token = params.get('token') ?? '';

  useEffect(() => {
    if (!token) {
      setResult({ kind: 'error', message: 'Token topilmadi' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.post<{ patient_id: string; clinic_id: string; patient_login_id: string }>(
          '/api/v1/public-bot/magic-token/consume',
          { token },
        );
        if (!cancelled) {
          setResult({
            kind: 'ok',
            clinic_id: res.clinic_id,
            patient_id: res.patient_id,
            patient_login_id: res.patient_login_id,
          });
          // Bemor session uchun localStorage (placeholder)
          try {
            localStorage.setItem(
              'clary_patient_session',
              JSON.stringify({
                patient_id: res.patient_id,
                clinic_id: res.clinic_id,
                logged_in_at: new Date().toISOString(),
              }),
            );
          } catch {
            // private mode — ignore
          }
        }
      } catch (e) {
        if (!cancelled) {
          setResult({ kind: 'error', message: (e as Error).message || 'Token noto\'g\'ri' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          {result.kind === 'loading' && (
            <>
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
              <div className="text-lg font-semibold">Tekshirilmoqda…</div>
              <div className="text-sm text-muted-foreground">
                Telegram bot tokeni tasdiqlanmoqda
              </div>
            </>
          )}
          {result.kind === 'ok' && (
            <>
              <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
              <div className="text-lg font-semibold">Muvaffaqiyatli kirildi</div>
              <div className="text-sm text-muted-foreground">
                Klinikangiz ma'lumotlari yuklanmoqda. Iltimos kuting…
              </div>
              <div className="mt-3 rounded-md bg-muted px-3 py-2 text-left text-xs">
                <div>
                  <span className="text-muted-foreground">Bemor ID:</span>{' '}
                  <code className="font-mono">{result.patient_id.slice(0, 8)}…</code>
                </div>
                <div>
                  <span className="text-muted-foreground">Klinika ID:</span>{' '}
                  <code className="font-mono">{result.clinic_id.slice(0, 8)}…</code>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Bemor kabineti tez orada qo'shiladi. Hozircha tashriflar/tahlillar uchun klinikaga
                murojaat qiling yoki Telegram'dan bildirishnomalarni kuting.
              </p>
            </>
          )}
          {result.kind === 'error' && (
            <>
              <XCircle className="mx-auto h-10 w-10 text-rose-600" />
              <div className="text-lg font-semibold">Kirish amalga oshmadi</div>
              <div className="text-sm text-rose-700">{result.message}</div>
              <p className="text-[11px] text-muted-foreground">
                Telegram bot'ga qaytib, qayta urinib ko'ring. Tokenlar 5 daqiqa amal qiladi.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
