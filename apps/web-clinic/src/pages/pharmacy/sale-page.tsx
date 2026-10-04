import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Printer, Receipt, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { MED_LABEL_SIZE, medicationLabelHtml, printLabel } from '@/lib/labels';
import { PAY_LABEL, groupSaleItems, printSale } from '@/lib/pharmacy/print';
import { usePharmacy } from './context';
import { ReturnDialog } from './sales-history';
import { InfoRow, fmt } from './shared';

// =============================================================================
// Savdo tafsiloti — vaqt, mijoz, kassir/kassa, sotilgan dorilar (birlik bilan),
// to'lov qismlari, fiskal chek holati, repchek, qaytarish, bekor qilish.
// =============================================================================
export function PharmacySalePage() {
  const { saleId } = useParams<{ saleId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ph = usePharmacy();
  const [returnOpen, setReturnOpen] = useState(false);

  const { data: sale, isLoading } = useQuery({
    queryKey: ['pharmacy', 'sale', saleId],
    queryFn: () => api.pharmacy.getSale(saleId as string),
    enabled: !!saleId,
  });

  const voidMut = useMutation({
    mutationFn: (reason: string) => api.pharmacy.voidSale(saleId as string, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      toast.success('Sotuv bekor qilindi (stok qaytarildi)');
      navigate(-1);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (reason: string) => api.pharmacy.deleteSale(saleId as string, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      qc.invalidateQueries({ queryKey: ['trash'] });
      toast.success("Savdo Savatchaga o'chirildi");
      navigate(-1);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const fiscalMut = useMutation({
    mutationFn: async () => {
      const failed = sale?.fiscal_receipts?.find((r) => r.kind === 'sale' && r.status !== 'sent');
      return failed
        ? api.pharmacy.fiscal.retry(failed.id)
        : api.pharmacy.fiscal.sendSale(saleId as string);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['pharmacy', 'sale', saleId] });
      if (r?.status === 'sent') toast.success('Fiskal chek yuborildi');
      else toast.error(r?.last_error ?? 'Fiskal chek yuborilmadi');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="text-muted-foreground p-10 text-center text-sm">Yuklanmoqda…</div>;
  }
  if (!sale) {
    return (
      <div className="text-muted-foreground p-10 text-center text-sm">
        Savdo topilmadi.{' '}
        <button
          type="button"
          className="text-primary underline"
          onClick={() => navigate(ph.path('sales'))}
        >
          Sotuvlarga qaytish
        </button>
      </div>
    );
  }

  const groups = groupSaleItems(sale);
  const totalReturnedBase = sale.items.reduce((a, it) => a + it.returned_qty, 0);
  const totalBase = sale.items.reduce((a, it) => a + it.quantity, 0);
  const dateStr = new Date(sale.created_at).toLocaleString('uz-UZ');
  const customerName = sale.patient?.full_name ?? sale.clinic_name ?? 'Oddiy xaridor';
  const saleFiscal = sale.fiscal_receipts?.find((r) => r.kind === 'sale') ?? null;

  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit gap-1.5"
        onClick={() => navigate(-1)}
      >
        <ArrowLeft className="h-4 w-4" /> Orqaga
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Receipt className="text-primary h-5 w-5" /> Dorixona savdosi
            {sale.is_void && <Badge variant="destructive">Bekor qilingan</Badge>}
          </h1>
          <p className="text-muted-foreground text-sm">{dateStr}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold">{fmt(sale.total_uzs)} so'm</div>
          {sale.debt_uzs > 0 && (
            <div className="text-sm text-amber-600">Qarz: {fmt(sale.debt_uzs)} so'm</div>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm md:grid-cols-4">
          <InfoRow label="Mijoz" value={customerName} />
          <InfoRow label="Shifokor" value={sale.doctor_name ?? '—'} />
          <InfoRow label="Kassir" value={sale.cashier_name ?? '—'} />
          <InfoRow label="Kassa" value={sale.register_no ? `Kassa ${sale.register_no}` : '—'} />
          <InfoRow
            label="To'lov"
            value={
              (sale.payments ?? []).length > 1
                ? sale.payments
                    .map((p) => `${PAY_LABEL[p.method] ?? p.method} ${fmt(p.amount_uzs)}`)
                    .join(' + ')
                : (PAY_LABEL[sale.payment_method] ?? sale.payment_method)
            }
          />
          <InfoRow label="To'langan" value={`${fmt(sale.paid_uzs)} so'm`} />
          {sale.discount_uzs > 0 && (
            <InfoRow label="Chegirma" value={`${fmt(sale.discount_uzs)} so'm`} />
          )}
          {sale.received_cash_uzs ? (
            <InfoRow
              label="Berildi / qaytim"
              value={`${fmt(sale.received_cash_uzs)} / ${fmt(sale.change_uzs ?? 0)}`}
            />
          ) : null}
          {sale.patient?.phone && <InfoRow label="Telefon" value={sale.patient.phone} />}
          {sale.notes && <InfoRow label="Izoh" value={sale.notes} />}
        </CardContent>
      </Card>

      {saleFiscal && (
        <Card className={saleFiscal.status === 'sent' ? 'border-emerald-300' : 'border-amber-300'}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div className="flex items-center gap-2">
              <ShieldCheck
                className={
                  saleFiscal.status === 'sent'
                    ? 'h-5 w-5 text-emerald-600'
                    : 'h-5 w-5 text-amber-600'
                }
              />
              <div>
                <div className="font-medium">
                  {saleFiscal.status === 'sent'
                    ? saleFiscal.is_test
                      ? 'Fiskal chek (TEST rejim)'
                      : 'Fiskal chek yuborilgan'
                    : saleFiscal.status === 'failed'
                      ? 'Fiskal chek yuborilmadi'
                      : 'Fiskal chek navbatda'}
                </div>
                <div className="text-muted-foreground text-xs">
                  {saleFiscal.status === 'sent'
                    ? `Chek № ${saleFiscal.fiscal_number ?? '—'} · belgi ${saleFiscal.fiscal_sign ?? '—'}`
                    : (saleFiscal.last_error ?? 'Avtomatik qayta urinish davom etmoqda')}
                </div>
              </div>
            </div>
            {saleFiscal.status !== 'sent' && (
              <Button
                size="sm"
                variant="outline"
                disabled={fiscalMut.isPending}
                onClick={() => fiscalMut.mutate()}
              >
                Qayta yuborish
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sotilgan dorilar ({groups.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">Dori</th>
                  <th className="px-3 py-2 text-right">Narx</th>
                  <th className="px-3 py-2 text-right">Soni</th>
                  <th className="px-3 py-2 text-right">Qaytarilgan</th>
                  <th className="px-3 py-2 text-right">Summa</th>
                  <th className="px-3 py-2 text-center">Yorliq</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {groups.map((g, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-medium">{g.name}</td>
                    <td className="px-3 py-2 text-right">{fmt(g.unitPrice)}</td>
                    <td className="px-3 py-2 text-right">
                      {g.qty} {g.label}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {g.returned > 0 ? <span className="text-indigo-600">{g.returned}</span> : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{fmt(g.amount)}</td>
                    <td className="px-3 py-2 text-center">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 text-[11px]"
                        title="Dori yorlig'ini chop etish"
                        onClick={() =>
                          void printLabel(
                            medicationLabelHtml({
                              medName: g.name,
                              patientName: customerName,
                              date: new Date(sale.created_at).toLocaleDateString('uz-UZ'),
                              barcodeValue: sale.id.replace(/-/g, '').slice(0, 16),
                              clinicName: ph.clinicName,
                            }),
                            MED_LABEL_SIZE,
                          )
                        }
                      >
                        <Printer className="h-3 w-3" /> Yorliq
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/20 border-t font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={4}>
                    Jami
                  </td>
                  <td className="px-3 py-2 text-right">{fmt(sale.total_uzs)} so'm</td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            void printSale(sale, 'thermal', ph.clinicName, { copy: true });
            toast.success('Chek qayta chiqarildi');
          }}
        >
          <Printer className="mr-1.5 h-4 w-4" /> Repchek (termal)
        </Button>
        <Button variant="outline" onClick={() => void printSale(sale, 'a4', ph.clinicName)}>
          <Receipt className="mr-1.5 h-4 w-4" /> Repchek (A4)
        </Button>
        {!sale.is_void && ph.canReturn && (
          <Button
            variant="outline"
            className="text-indigo-600 hover:text-indigo-700"
            onClick={() => setReturnOpen(true)}
            disabled={totalReturnedBase >= totalBase}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" /> Tovar qaytarish
          </Button>
        )}
        {!sale.is_void && ph.isAdmin && (
          <Button
            variant="outline"
            className="text-rose-600 hover:text-rose-700"
            disabled={voidMut.isPending}
            onClick={() => {
              const reason = window.prompt('Bekor qilish sababi:') ?? undefined;
              if (reason === undefined) return;
              voidMut.mutate(reason);
            }}
          >
            Bekor qilish
          </Button>
        )}
        {ph.isAdmin && (
          <Button
            variant="outline"
            className="text-rose-600 hover:text-rose-700"
            disabled={deleteMut.isPending}
            onClick={() => {
              const reason = window.prompt("O'chirish sababi (majburiy):")?.trim();
              if (!reason || reason.length < 3) {
                if (reason !== undefined) toast.error("Sabab kamida 3 belgidan iborat bo'lsin");
                return;
              }
              deleteMut.mutate(reason);
            }}
          >
            <Trash2 className="mr-1.5 h-4 w-4" /> O'chirish
          </Button>
        )}
      </div>

      {returnOpen && (
        <ReturnDialog
          saleId={sale.id}
          onClose={() => setReturnOpen(false)}
          onDone={() => {
            setReturnOpen(false);
            qc.invalidateQueries({ queryKey: ['pharmacy'] });
          }}
        />
      )}
    </div>
  );
}
