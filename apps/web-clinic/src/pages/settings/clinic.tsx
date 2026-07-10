import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Eye, EyeOff, FlaskConical, KeyRound, Lock, Pill, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from '@clary/ui-web';

import { api } from '@/lib/api';

export function SettingsClinicPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Klinika ma'lumotlari</h2>

      <Card>
        <CardHeader>
          <CardTitle>Umumiy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 max-w-md">
          <label className="text-sm font-medium">Klinika nomi</label>
          <Input />
          <label className="text-sm font-medium">Manzil</label>
          <Input />
          <label className="text-sm font-medium">Telefon</label>
          <Input />
          <Button className="mt-2">Saqlash</Button>
        </CardContent>
      </Card>

      <ReceptionPharmacyCard />
      <LabModeCard />
      <JournalPinCard />
    </div>
  );
}

// Qabulxonada "Dori bilan" tugmasini yoqish/o'chirish (clinics.settings).
function ReceptionPharmacyCard() {
  const qc = useQueryClient();
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () =>
      api.get<{ clinic?: { settings?: { reception_pharmacy_enabled?: boolean } } }>(
        '/api/v1/auth/me',
      ),
  });
  const enabled = Boolean(me?.clinic?.settings?.reception_pharmacy_enabled);

  const mut = useMutation({
    mutationFn: (next: boolean) =>
      api.patch('/api/v1/auth/clinic/settings', { reception_pharmacy_enabled: next }),
    onSuccess: () => {
      toast.success('Saqlandi');
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Pill className="h-4 w-4" />
          Qabulxonada dori bilan xizmat
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Yoqilsa, qabulxonada <b>"Dori bilan"</b> tugmasi paydo bo'ladi — qabulxonachi
          bemorga xizmat bilan birga dorixonadan dori qo'shib, bitta chek qila oladi.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={mut.isPending}
          onClick={() => mut.mutate(!enabled)}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
            enabled ? 'bg-primary' : 'bg-muted'
          } disabled:opacity-50`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
        <div className="text-xs text-muted-foreground">
          Holat: <b className={enabled ? 'text-emerald-600' : ''}>{enabled ? 'Yoqilgan' : "O'chiq"}</b>
        </div>
      </CardContent>
    </Card>
  );
}

function LabModeCard() {
  const qc = useQueryClient();
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () =>
      api.get<{ clinic?: { settings?: { lab_mode?: string } } }>('/api/v1/auth/me'),
  });
  const integrated = (me?.clinic?.settings?.lab_mode ?? 'integrated') === 'integrated';

  const mut = useMutation({
    mutationFn: (next: boolean) =>
      api.patch('/api/v1/auth/clinic/settings', { lab_mode: next ? 'integrated' : 'standalone' }),
    onSuccess: () => {
      toast.success('Saqlandi');
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4" />
          Laboratoriya rejimi
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          <b>Yoqilgan (Integratsiya):</b> lab sotuvlari umumiy klinika <b>jurnali va kassasiga</b> yoziladi.{' '}
          <b>O&apos;chiq (Mustaqil):</b> laboratoriya o&apos;zini o&apos;zi boshqaradi — o&apos;z Jurnal va Kassa tablari bilan.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={integrated}
          disabled={mut.isPending}
          onClick={() => mut.mutate(!integrated)}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
            integrated ? 'bg-primary' : 'bg-muted'
          } disabled:opacity-50`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              integrated ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
        <div className="text-xs text-muted-foreground">
          Rejim:{' '}
          <b className={integrated ? 'text-emerald-600' : ''}>
            {integrated ? 'Integratsiya (umumiy jurnal)' : 'Mustaqil'}
          </b>
        </div>
      </CardContent>
    </Card>
  );
}

// PIN input — ko'rinish toggle (ko'z ikonkasi) bilan.
function PinInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        inputMode="numeric"
        placeholder="••••"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 8))}
        className="pr-10 text-center font-mono tracking-[0.4em]"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'PINni yashirish' : 'PINni ko\'rsatish'}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function JournalPinCard() {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const changeMut = useMutation({
    mutationFn: () => api.journal.changePin(currentPin, newPin),
    onSuccess: () => {
      toast.success('PIN yangilandi');
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    },
    onError: (e: Error) => toast.error(e.message || 'PIN o\'zgartirilmadi'),
  });

  const canSubmit =
    currentPin.length >= 4 &&
    newPin.length >= 4 &&
    newPin.length <= 8 &&
    newPin === confirmPin &&
    !changeMut.isPending;

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          Jurnal PIN-kodi
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Default PIN ogohlantirishi — yangi klinikalar uchun. Foydalanuvchi
            o'zgartirgandan keyin ham bu ogohlantirish qoladi (statik xabar). */}
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertCircle className="mr-1 inline h-3.5 w-3.5" />
          Sizning kompaniya o‘rnatgan PIN kodi: <strong className="font-mono text-base">0000</strong>.
          Xavfsizlik uchun buni o‘zgartirish tavsiya etiladi.
        </div>

        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
          <ShieldCheck className="mr-1 inline h-3 w-3" />
          Jurnal oynasida yozuvlarni tahrirlash va o'chirish uchun ishlatiladi. 4-8 raqam.
        </div>

        <Field label="Joriy PIN">
          <PinInput value={currentPin} onChange={setCurrentPin} />
        </Field>

        <Field label="Yangi PIN (4-8 raqam)">
          <PinInput value={newPin} onChange={setNewPin} />
        </Field>

        <Field label="Yangi PINni tasdiqlang">
          <PinInput value={confirmPin} onChange={setConfirmPin} />
          {confirmPin && newPin !== confirmPin && (
            <div className="text-xs text-rose-600">PINlar mos kelmaydi</div>
          )}
        </Field>

        <Button
          onClick={() => changeMut.mutate()}
          disabled={!canSubmit}
          className="w-full gap-1"
        >
          <Lock className="h-4 w-4" />
          {changeMut.isPending ? 'Saqlanmoqda...' : 'PINni yangilash'}
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}
