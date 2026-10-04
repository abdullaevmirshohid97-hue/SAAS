import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Loader2, PackagePlus, ScanLine, Tag } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  cn,
} from '@clary/ui-web';
import { packQty, unitPrice } from '@clary/utils';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { printPriceTags } from '@/lib/pharmacy/print';
import { usePharmacy } from './context';
import { InfoRow, errText, fmt } from './shared';

// =============================================================================
// Prixod tarixi — kirim hujjatlari, tafsilot, narx yorliqlari va bekor qilish
// =============================================================================
// Bekor qilish shartini SERVER hal qiladi: prixoddan biror dona sotilgan bo'lsa
// RPC rad etadi. Bekor qilinganda sotuv narxi ham prixoddan oldingi holatiga
// qaytadi (pharmacy_void_receipt, 2026-10 dan).
// =============================================================================

const SOURCE_LABEL: Record<string, string> = {
  manual: "Qo'lda",
  excel: 'Excel',
  scan: 'Skaner',
  po: 'Buyurtma',
  opening: 'Boshlang‘ich qoldiq',
};

export function ReceiptHistoryTab() {
  const qc = useQueryClient();
  const ph = usePharmacy();
  const [openId, setOpenId] = useState<string | null>(null);
  const [voidFor, setVoidFor] = useState<{ id: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy', 'receipts'],
    queryFn: () => api.pharmacy.listReceipts(300),
  });

  const voidMut = useMutation({
    mutationFn: (id: string) =>
      api.pharmacy.voidReceipt(id, { reason: reason.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      toast.success('Prixod bekor qilindi — ombor, narx va firma balansi qaytarildi');
      setVoidFor(null);
      setReason('');
      setOpenId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const needle = q.trim().toLowerCase();
  const rows = (data ?? []).filter(
    (r) =>
      !needle ||
      (r.receipt_no ?? '').toLowerCase().includes(needle) ||
      (r.supplier?.name ?? '').toLowerCase().includes(needle) ||
      (r.file_name ?? '').toLowerCase().includes(needle),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Prixod tarixi</h2>
          <p className="text-muted-foreground text-sm">
            Kirim hujjatlari — bosib tafsilotini ko'ring
          </p>
        </div>
        <Input
          className="max-w-xs"
          placeholder="Faktura №, firma, fayl…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-4">
            <div className="bg-muted/40 h-24 animate-pulse rounded" />
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<PackagePlus className="h-10 w-10" />}
          title="Prixod yo'q"
          description="Kirim qilingan hujjatlar shu yerda ko'rinadi"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="max-h-[calc(100vh-240px)] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-muted-foreground sticky top-0 border-b text-xs uppercase backdrop-blur">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Sana</th>
                  <th className="px-3 py-2.5 text-left font-medium">Hujjat</th>
                  <th className="px-3 py-2.5 text-left font-medium">Firma</th>
                  <th className="px-3 py-2.5 text-left font-medium">Manba</th>
                  <th className="px-3 py-2.5 text-right font-medium">Summa</th>
                  <th className="px-3 py-2.5 text-right font-medium">To'langan</th>
                  <th className="px-3 py-2.5 text-right font-medium">Pozitsiya</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={cn('hover:bg-muted/30 cursor-pointer', r.is_void && 'opacity-55')}
                    onClick={() => setOpenId(r.id)}
                  >
                    <td className="px-3 py-2.5 align-top font-mono text-[11px]">
                      {new Date(r.received_at ?? r.created_at).toLocaleDateString('uz-UZ')}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-medium">{r.receipt_no || '—'}</div>
                      {r.invoice_date && (
                        <div className="text-muted-foreground text-[11px]">
                          Faktura: {r.invoice_date}
                        </div>
                      )}
                      {r.is_void && (
                        <div className="text-[11px] text-red-600">
                          Bekor qilingan{r.voided_reason ? ` · ${r.voided_reason}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top">{r.supplier?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 align-top text-xs">
                      <span className="inline-flex items-center gap-1">
                        {r.source === 'excel' ? (
                          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                        ) : r.source === 'scan' ? (
                          <ScanLine className="h-3.5 w-3.5 text-sky-600" />
                        ) : null}
                        {SOURCE_LABEL[r.source ?? 'manual'] ?? r.source}
                      </span>
                      {r.file_name && (
                        <div className="text-muted-foreground max-w-[180px] truncate text-[11px]">
                          {r.file_name}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">
                      {fmt(r.total_cost_uzs)}
                    </td>
                    <td className="text-muted-foreground px-3 py-2.5 text-right align-top tabular-nums">
                      {fmt(r.paid_uzs ?? 0)}
                    </td>
                    <td className="text-muted-foreground px-3 py-2.5 text-right align-top">
                      {r.items_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {openId && (
        <ReceiptDetailDialog
          id={openId}
          canVoid={ph.isAdmin}
          clinicName={ph.clinicName}
          onClose={() => setOpenId(null)}
          onVoid={(label) => setVoidFor({ id: openId, label })}
        />
      )}

      {voidFor && (
        <Dialog open onOpenChange={(o) => !o && setVoidFor(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Prixodni bekor qilish</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <b>{voidFor.label}</b> bekor qilinadi: ombor qoldig'i kamayadi, firma balansi
                qaytariladi, dorilar narxi prixoddan oldingi holatiga tiklanadi va teskari
                harakatlar yoziladi.
                <div className="mt-1.5">
                  Prixoddan biror dona sotilgan bo'lsa — server rad etadi.
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Sabab (ixtiyoriy)</label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Masalan: miqdor xato kiritilgan"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setVoidFor(null)}>
                Yopish
              </Button>
              <Button
                className="bg-red-600 text-white hover:bg-red-700"
                disabled={voidMut.isPending}
                onClick={() => voidMut.mutate(voidFor.id)}
              >
                {voidMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Bekor qilish
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ReceiptDetailDialog({
  id,
  canVoid,
  clinicName,
  onClose,
  onVoid,
}: {
  id: string;
  canVoid: boolean;
  clinicName: string;
  onClose: () => void;
  onVoid: (label: string) => void;
}) {
  const ph = usePharmacy();
  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy', 'receipt', id],
    queryFn: () => api.pharmacy.getReceipt(id),
  });
  const items = data?.items ?? [];
  const isVoid = Boolean((data as { is_void?: boolean } | undefined)?.is_void);

  const tags = async () => {
    try {
      await printPriceTags(
        items
          .filter((it) => it.medication)
          .map((it) => {
            const m = it.medication!;
            const kind = packQty(m) > 1 ? 'pack' : 'unit';
            return {
              name: m.name,
              strength: m.strength,
              price: unitPrice(m, kind),
              unitText: kind === 'pack' ? 'qadoq' : (m.unit_name ?? 'dona'),
              barcode: m.barcode,
            };
          }),
        clinicName,
      );
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prixod {data?.receipt_no ? `№ ${data.receipt_no}` : ''}</DialogTitle>
          <DialogDescription>
            {data?.received_at ? new Date(data.received_at).toLocaleString('uz-UZ') : ''}
            {isVoid ? ' · BEKOR QILINGAN' : ''}
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="text-muted-foreground p-4 text-sm">Yuklanmoqda…</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 rounded-md border p-3 text-sm sm:grid-cols-4">
              <InfoRow label="Firma" value={data.supplier?.name ?? '—'} />
              <InfoRow label="Jami tannarx" value={`${fmt(data.total_cost_uzs)} so'm`} />
              <InfoRow
                label="To'langan"
                value={`${fmt(Number((data as { paid_uzs?: number }).paid_uzs ?? 0))} so'm`}
              />
              <InfoRow label="Pozitsiya" value={String(items.length)} />
            </div>
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-muted-foreground text-xs">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Dori</th>
                    <th className="px-2 py-1.5 text-right">Soni</th>
                    {ph.canSeeCost && <th className="px-2 py-1.5 text-right">Tannarx</th>}
                    {ph.canSeeCost && <th className="px-2 py-1.5 text-right">Summa</th>}
                    <th className="px-2 py-1.5 text-right">Sotuv narxi</th>
                    <th className="px-2 py-1.5 text-left">Seriya</th>
                    <th className="px-2 py-1.5 text-left">Muddat</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((it) => {
                    const m = it.medication;
                    const itemPack = it.pack_qty ?? m?.pack_qty ?? 1;
                    const isPack = it.unit_kind === 'pack' && itemPack > 1;
                    const enteredQty = it.entered_qty ?? it.quantity;
                    const enteredCost =
                      it.entered_cost_uzs ??
                      (isPack ? it.unit_cost_uzs * itemPack : it.unit_cost_uzs);
                    return (
                      <tr key={it.id}>
                        <td className="px-2 py-1.5">
                          <div className="font-medium">{m?.name ?? '—'}</div>
                          <div className="text-muted-foreground text-[11px]">
                            {[m?.strength, m?.form].filter(Boolean).join(' · ')}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right">
                          {fmt(enteredQty)} {isPack ? 'qadoq' : (m?.unit_name ?? 'dona')}
                          {isPack && (
                            <div className="text-muted-foreground text-[11px]">
                              = {fmt(it.quantity)} dona
                            </div>
                          )}
                        </td>
                        {ph.canSeeCost && (
                          <td className="px-2 py-1.5 text-right">{fmt(Math.round(enteredCost))}</td>
                        )}
                        {ph.canSeeCost && (
                          <td className="px-2 py-1.5 text-right">{fmt(it.total_cost_uzs)}</td>
                        )}
                        <td className="whitespace-nowrap px-2 py-1.5 text-right">
                          {it.old_price_uzs != null && it.old_price_uzs !== it.sale_price_uzs && (
                            <span className="text-muted-foreground mr-1 text-[11px] line-through">
                              {fmt(it.old_price_uzs)}
                            </span>
                          )}
                          {fmt(it.sale_price_uzs ?? m?.price_uzs ?? 0)}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-xs">{it.batch_no ?? '—'}</td>
                        <td className="px-2 py-1.5 text-xs">{it.expiry_date ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            {canVoid && data && !isVoid && (
              <Button
                variant="ghost"
                className="text-red-600"
                onClick={() => onVoid(data.receipt_no || 'raqamsiz prixod')}
              >
                Bekor qilish
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={items.length === 0} onClick={() => void tags()}>
              <Tag className="mr-1 h-4 w-4" /> Narx yorliqlari
            </Button>
            <Button variant="outline" onClick={onClose}>
              Yopish
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
