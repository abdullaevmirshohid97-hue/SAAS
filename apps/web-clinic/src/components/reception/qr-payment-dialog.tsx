import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, QrCode, ScanLine, X } from 'lucide-react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';

interface QrPaymentDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (providerReference: string) => void;
  provider: 'click' | 'payme';
  amountUzs: number;
  patientId?: string | null;
  shiftId?: string | null;
  defaultFlow?: 'merchant_qr' | 'customer_scan';
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('uz-UZ').format(n) + ' so\u2018m';
}

function remainingSeconds(expiresAt: string | null | undefined): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

const PROVIDER_CONFIG = {
  click: { label: 'Click', color: 'hsl(199 89% 48%)', logo: 'Click' },
  payme: { label: 'Payme', color: 'hsl(160 84% 39%)', logo: 'Payme' },
} as const;

export function QrPaymentDialog({
  open,
  onClose,
  onSuccess,
  provider,
  amountUzs,
  patientId,
  shiftId,
  defaultFlow = 'merchant_qr',
}: QrPaymentDialogProps) {
  const qc = useQueryClient();
  const [flow, setFlow] = useState<'merchant_qr' | 'customer_scan'>(defaultFlow);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (!open) {
      setInvoiceId(null);
      setToken('');
      setFlow(defaultFlow);
    }
  }, [open, defaultFlow]);

  const createMut = useMutation({
    mutationFn: () =>
      api.paymentQr.create({
        provider,
        amount_uzs: amountUzs,
        flow,
        patient_id: patientId ?? undefined,
        shift_id: shiftId ?? undefined,
      }),
    onSuccess: (data) => {
      setInvoiceId(data.id);
      setCountdown(remainingSeconds(data.expires_at));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: status } = useQuery({
    queryKey: ['payment-qr-status', invoiceId],
    queryFn: () => api.paymentQr.status(invoiceId!),
    enabled: Boolean(invoiceId) && flow === 'merchant_qr',
    refetchInterval: 2500,
  });

  useEffect(() => {
    if (!invoiceId) return;
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [invoiceId]);

  useEffect(() => {
    if (status?.status === 'succeeded' && invoiceId) {
      qc.invalidateQueries({ queryKey: ['payment-qr-status', invoiceId] });
      onSuccess(invoiceId);
      toast.success(`${PROVIDER_CONFIG[provider].label} to\u2018lovi qabul qilindi`);
    } else if (status?.status === 'expired' || status?.status === 'failed') {
      toast.error(`To\u2018lov ${status.status === 'expired' ? 'muddati tugadi' : 'bajarilmadi'}`);
    }
  }, [status?.status, invoiceId, onSuccess, provider, qc]);

  const verifyMut = useMutation({
    mutationFn: () => api.paymentQr.verifyPass(invoiceId!, token),
    onSuccess: (data) => {
      if (data.status === 'succeeded') {
        toast.success('Customer Pass tasdiqlandi');
        if (invoiceId) onSuccess(invoiceId);
      } else {
        toast.error('Customer Pass kod noto\u2018g\u2018ri');
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: () => api.paymentQr.cancel(invoiceId!),
    onSuccess: () => {
      onClose();
    },
  });

  const cfg = PROVIDER_CONFIG[provider];
  const isPaid = status?.status === 'succeeded';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white"
              style={{ backgroundColor: cfg.color }}
            >
              {cfg.logo.slice(0, 2)}
            </div>
            {cfg.label} orqali to&lsquo;lov
          </DialogTitle>
          <DialogDescription>
            Jami: <span className="font-semibold text-foreground">{formatCurrency(amountUzs)}</span>
          </DialogDescription>
        </DialogHeader>

        {!invoiceId ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFlow('merchant_qr')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition',
                  flow === 'merchant_qr' ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                )}
              >
                <QrCode className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Klinika QR</span>
                <span className="text-[11px] text-muted-foreground">Bemor QR ni skanerlaydi</span>
              </button>
              <button
                type="button"
                onClick={() => setFlow('customer_scan')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition',
                  flow === 'customer_scan' ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                )}
              >
                <ScanLine className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Bemor Pass</span>
                <span className="text-[11px] text-muted-foreground">Qabulxona kodni kiritadi</span>
              </button>
            </div>
            <Button className="w-full gap-1.5" onClick={() => createMut.mutate()} disabled={createMut.isPending}>
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
              To&lsquo;lovni yaratish
            </Button>
          </div>
        ) : flow === 'merchant_qr' ? (
          <div className="space-y-4">
            <div
              className={cn(
                'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-4 transition',
                isPaid ? 'border-success bg-success/5' : 'border-muted',
              )}
            >
              {isPaid ? (
                <div className="flex flex-col items-center gap-2 py-8">
                  <CheckCircle2 className="h-16 w-16 text-success" />
                  <div className="text-lg font-semibold">To&lsquo;lov qabul qilindi</div>
                </div>
              ) : status?.status === 'pending' || !status ? (
                <>
                  <div className="rounded-lg bg-white p-3">
                    <QRCodeSVG value={(status as unknown as { qr_payload?: string })?.qr_payload ?? `${cfg.logo}-pending`} size={200} level="M" />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Bemordan to&lsquo;lovni kutyapmiz…
                  </div>
                  {countdown > 0 && (
                    <Badge variant="outline" className="tabular-nums">
                      {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
                    </Badge>
                  )}
                </>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">Status: {status?.status}</div>
              )}
            </div>
            {!isPaid && (
              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={() => cancelMut.mutate()} className="gap-1.5">
                  <X className="h-4 w-4" /> Bekor qilish
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              Bemorning {cfg.label} ilovasidagi Pass kodini (OTP) kiriting — qabulxona xodimi to&lsquo;g&lsquo;ridan-to&lsquo;g&lsquo;ri summani yechib oladi.
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Customer Pass OTP</label>
              <Input
                inputMode="numeric"
                maxLength={8}
                value={token}
                onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
                className="text-center font-mono text-xl tracking-[0.5em]"
                placeholder="------"
                autoFocus
              />
            </div>
            <Button
              className="w-full gap-1.5"
              onClick={() => verifyMut.mutate()}
              disabled={token.length < 4 || verifyMut.isPending}
            >
              {verifyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Tasdiqlash
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Yopish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
