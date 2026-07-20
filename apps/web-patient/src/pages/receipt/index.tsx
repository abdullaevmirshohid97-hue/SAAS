import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ReceiptText, RefreshCw } from 'lucide-react';

import { receiptPublicApi, type PublicReceiptItem } from '@/lib/api';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Naqd',
  card: 'Plastik karta',
  transfer: "O'tkazma",
  insurance: "Sug'urta",
  mixed: 'Aralash',
  click: 'Click',
  payme: 'Payme',
  uzum: 'Uzum',
  kaspi: 'Kaspi',
  humo: 'Humo',
  uzcard: 'Uzcard',
  stripe: 'Stripe',
};

const STATUS_UI = {
  paid: { label: "TO'LIQ TO'LANGAN", bg: '#dcfce7', fg: '#166534' },
  partial: { label: "QISMAN TO'LANGAN", bg: '#fef9c3', fg: '#854d0e' },
  debt: { label: 'QARZ', bg: '#fee2e2', fg: '#991b1b' },
} as const;

function fmtDateTime(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('uz-UZ', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

function ItemRows({ items }: { items: PublicReceiptItem[] }) {
  return (
    <>
      {items.map((it, i) => (
        <tr key={i} className="border-b border-[#eee] align-top">
          <td className="py-2 pr-2">
            {it.name}
            {it.quantity > 1 ? ` ×${it.quantity}` : ''}
            {it.discount_uzs > 0 && (
              <span className="ml-1 text-[11px] text-[#999]">(chegirma −{fmt(it.discount_uzs)})</span>
            )}
          </td>
          <td className="py-2 pl-2 text-right font-semibold tabular-nums">
            {fmt(it.final_amount_uzs)}
          </td>
        </tr>
      ))}
    </>
  );
}

export function PublicReceiptPage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['public-receipt', token],
    queryFn: () => receiptPublicApi.get(token as string),
    enabled: !!token,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Yuklanmoqda…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center bg-white px-6 text-center text-[#111]">
        <ReceiptText className="mb-3 h-10 w-10 text-gray-400" />
        <h1 className="text-lg font-bold">Chek topilmadi</h1>
        <p className="mt-2 text-sm text-gray-500">
          Havola noto‘g‘ri yoki chek bekor qilingan bo‘lishi mumkin. Klinikaga murojaat qiling.
        </p>
      </div>
    );
  }

  const clinic = data.clinic;
  const brand = clinic?.primary_color ?? '#2563EB';
  const clinicAddress = [clinic?.address, clinic?.city, clinic?.region].filter(Boolean).join(', ');
  const status = STATUS_UI[data.status as keyof typeof STATUS_UI] ?? STATUS_UI.debt;
  const medItems = data.med_items ?? [];

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-white px-4 py-6 text-[#111]">
      {/* Klinika header */}
      <header className="flex items-start justify-between gap-3 border-b-2 pb-3" style={{ borderColor: brand }}>
        <div className="flex items-center gap-3">
          {clinic?.logo_url ? (
            <img src={clinic.logo_url} alt={clinic.name} className="h-12 w-auto object-contain" />
          ) : (
            <div
              className="flex h-12 w-12 items-center justify-center rounded-lg text-xl font-bold text-white"
              style={{ background: brand }}
            >
              {(clinic?.name ?? 'C').charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="text-base font-bold" style={{ color: brand }}>
              {clinic?.name ?? 'Klinika'}
            </div>
            {clinicAddress && <div className="text-[11px] text-[#555]">{clinicAddress}</div>}
            {clinic?.phone && <div className="text-[11px] text-[#555]">Tel: {clinic.phone}</div>}
          </div>
        </div>
        <div className="text-right text-[11px] text-[#555]">
          <div className="text-xs font-bold text-black">TO‘LOV CHEKI</div>
          <div>№ {data.id.slice(0, 8).toUpperCase()}</div>
          <div>{fmtDateTime(data.occurred_at)}</div>
        </div>
      </header>

      {/* Holat banneri — bemor keyin ham kirib tekshiraveradi (jonli holat) */}
      <div
        className="mt-4 flex items-center justify-between rounded-md px-3 py-2 text-sm font-bold"
        style={{ background: status.bg, color: status.fg }}
      >
        <span>{status.label}</span>
        <button
          type="button"
          onClick={() => void refetch()}
          className="flex items-center gap-1 rounded border border-current px-2 py-0.5 text-[11px] font-semibold"
        >
          <RefreshCw className={`h-3 w-3 ${isRefetching ? 'animate-spin' : ''}`} /> Yangilash
        </button>
      </div>

      {/* Bemor / shifokor */}
      <section className="mt-4 rounded-md border bg-[#f7f7f7] p-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] text-[#999]">Bemor</div>
            <div className="font-semibold">{data.patient_name ?? '—'}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#999]">Shifokor</div>
            <div className="font-semibold">{data.doctor_name ?? '—'}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#999]">To‘lov usuli</div>
            <div className="font-semibold">
              {data.payment_method ? METHOD_LABEL[data.payment_method] ?? data.payment_method : '—'}
            </div>
          </div>
        </div>
      </section>

      {/* Xizmatlar */}
      <section className="mt-4">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-[#777]">
          Xizmatlar ({data.items.length + medItems.length} ta)
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left" style={{ borderTop: `2px solid ${brand}`, borderBottom: `2px solid ${brand}` }}>
              <th className="py-2 pr-2">Nomi</th>
              <th className="py-2 pl-2 text-right">Summa (so‘m)</th>
            </tr>
          </thead>
          <tbody>
            <ItemRows items={data.items} />
            <ItemRows items={medItems} />
          </tbody>
        </table>
      </section>

      {/* Jami */}
      <section className="mt-4 ml-auto max-w-xs text-sm">
        <div className="flex justify-between py-1">
          <span className="text-[#555]">Jami:</span>
          <span className="font-bold tabular-nums">{fmt(data.total_uzs)} so‘m</span>
        </div>
        <div className="flex justify-between py-1">
          <span className="text-[#555]">To‘langan:</span>
          <span className="font-semibold tabular-nums" style={{ color: '#166534' }}>
            {fmt(data.paid_uzs)} so‘m
          </span>
        </div>
        {data.debt_uzs > 0 && (
          <div className="flex justify-between border-t pt-1">
            <span className="font-bold" style={{ color: '#991b1b' }}>Qarz:</span>
            <span className="font-bold tabular-nums" style={{ color: '#991b1b' }}>
              {fmt(data.debt_uzs)} so‘m
            </span>
          </div>
        )}
      </section>

      <footer className="mt-6 border-t pt-3 text-center text-[11px] text-[#888]">
        <p>Bu sahifa chekning elektron nusxasi — holat har ochilganda yangilanadi.</p>
        <p className="mt-1">{clinic?.name ?? 'Clary'} · Clary Care</p>
      </footer>
    </div>
  );
}
