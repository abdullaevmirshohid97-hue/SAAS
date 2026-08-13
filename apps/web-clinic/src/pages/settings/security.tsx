import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

// =============================================================================
// Sozlamalar > Xavfsizlik (shaxsiy) — foydalanuvchi O'Z parolini o'rnatadi
// =============================================================================
// Ilgari bu imkoniyat umuman yo'q edi: parolni faqat admin, faqat boshqa
// odamga bera olardi. Google bilan kirgan foydalanuvchida esa parol hech
// qachon o'rnatilmagani uchun email+parol login ishlamasdi.
//
// Server orqali boramiz (supabase.auth.updateUser emas): Google akkauntga
// `email` identity ham qo'shilishi kerak, u service_role RPC talab qiladi.

// Server bilan bir xil chegara (api: staff.module.ts MIN_PASSWORD_LENGTH).
const MIN_PASSWORD_LENGTH = 8;

export function SettingsSecurityPage() {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= MIN_PASSWORD_LENGTH && password === confirm;

  const mut = useMutation({
    mutationFn: () => api.staff.setMyPassword(password),
    onSuccess: () => {
      toast.success('Parol yangilandi — endi shu email va parol bilan kira olasiz');
      setPassword('');
      setConfirm('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Parol
          </CardTitle>
          <CardDescription>
            Email va parol bilan kirish uchun. Google bilan kirishda davom etaverasiz — bu parol
            uni almashtirmaydi, yoniga qo‘shiladi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/30 rounded-md border p-3 text-sm">
            <div className="text-muted-foreground text-xs">Login (email)</div>
            <div className="mt-0.5 font-mono text-xs">{user?.email ?? '—'}</div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-password">Yangi parol</Label>
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={`Kamida ${MIN_PASSWORD_LENGTH} belgi`}
              aria-invalid={tooShort}
            />
            {tooShort && (
              <p className="text-xs text-red-600">
                Kamida {MIN_PASSWORD_LENGTH} belgi kerak — hozir {password.length} ta.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Parolni takrorlang</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              aria-invalid={mismatch}
            />
            {mismatch && <p className="text-xs text-red-600">Parollar mos kelmadi</p>}
          </div>

          <div className="flex justify-end">
            <Button disabled={!canSubmit || mut.isPending} onClick={() => mut.mutate()}>
              {mut.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Saqlanmoqda…
                </>
              ) : (
                'Parolni saqlash'
              )}
            </Button>
          </div>

          <p className="text-muted-foreground flex items-start gap-1.5 text-[11px]">
            <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
            Parolni o‘zingiz o‘rnatgach, administrator paneldagi eski parol nusxasi o‘chiriladi —
            faqat siz bilasiz.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
