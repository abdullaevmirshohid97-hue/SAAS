import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, Receipt } from 'lucide-react';
import {
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

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));

const METHOD_LABEL: Record<string, string> = {
  cash: 'Naqd', card: 'Karta', humo: 'Humo', uzcard: 'Uzcard',
  click: 'Click', payme: 'Payme', uzum: 'Uzum', kaspi: 'Kaspi',
  transfer: 'O‘tkazma', bank_transfer: 'Bank', debt: 'Qarz',
};
const ml = (m: string) => METHOD_LABEL[m] ?? m;

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });

// =============================================================================
// Kunlik Z-hisobot — kun yakunida BARCHA smenalar bo'yicha yagona yopilish:
// to'lov usuli kesimi, kassa reconciliation (kutilgan vs haqiqiy), rasxot,
// maosh, dorixona. Egasi ko'radi/chop etadi (fiskal printersiz).
// =============================================================================
export function DayZReportDialog({ onClose }: { onClose: () => void }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
  const [date, setDate] = useState(today);

  const { data, isLoading } = useQuery({
    queryKey: ['cashier', 'day-report', date],
    queryFn: () => api.shifts.dayReport(date),
  });

  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ clinic?: { name?: string } }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
  const clinicName = me.data?.clinic?.name ?? 'Klinika';

  const diff = data?.cash.difference_uzs ?? 0;

  const handlePrint = () => {
    if (!data) return;
    const rows = data.by_method
      .map((m) => `<tr><td>${esc(ml(m.method))}</td><td class="r">${fmt(m.revenue_uzs)}</td><td class="r">${m.refund_uzs ? '−' + fmt(m.refund_uzs) : '—'}</td><td class="r b">${fmt(m.net_uzs)}</td></tr>`)
      .join('');
    const shiftRows = data.shifts
      .map((s) => {
        const d = s.difference_uzs ?? 0;
        return `<tr><td>${esc(s.operator_name ?? '—')}</td><td>${fmtTime(s.opened_at)}–${s.closed_at ? fmtTime(s.closed_at) : '...'}</td><td class="r">${fmt(s.expected_cash_uzs)}</td><td class="r">${s.actual_cash_uzs == null ? '—' : fmt(s.actual_cash_uzs)}</td><td class="r">${s.closed_at ? (d === 0 ? '0' : (d > 0 ? '+' : '') + fmt(d)) : 'ochiq'}</td></tr>`;
      })
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Z-hisobot ${data.date}</title>
      <style>
        body{font-family:system-ui,sans-serif;padding:24px;color:#111;max-width:760px;margin:0 auto}
        h1{font-size:18px;margin:0}.muted{color:#666;font-size:12px}
        table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px}
        th,td{border-bottom:1px solid #e5e5e5;padding:6px 8px;text-align:left}
        th{background:#f6f6f6;font-size:11px;text-transform:uppercase;color:#666}
        .r{text-align:right;font-variant-numeric:tabular-nums}.b{font-weight:700}
        .tot{display:flex;justify-content:space-between;padding:4px 0;font-size:14px}
        .tot.big{font-size:16px;font-weight:700;border-top:2px solid #111;margin-top:6px;padding-top:8px}
        h3{font-size:13px;margin:16px 0 4px}
      </style></head><body>
      <h1>${esc(clinicName)} — Kunlik Z-hisobot</h1>
      <div class="muted">${data.date} · chop etildi: ${new Date().toLocaleString('uz-UZ')}</div>
      <h3>To‘lov usuli bo‘yicha</h3>
      <table><thead><tr><th>Usul</th><th class="r">Tushum</th><th class="r">Vozvrat</th><th class="r">Sof</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Yo‘q</td></tr>'}</tbody></table>
      <h3>Yakun</h3>
      <div class="tot"><span>Tushum (jami)</span><span>${fmt(data.totals.revenue_uzs)} so‘m</span></div>
      <div class="tot"><span>Vozvrat</span><span>−${fmt(data.totals.refund_uzs)} so‘m</span></div>
      <div class="tot"><span>Rasxot</span><span>−${fmt(data.totals.expenses_uzs)} so‘m</span></div>
      <div class="tot"><span>Maosh to‘lovi</span><span>−${fmt(data.totals.payroll_uzs)} so‘m</span></div>
      ${data.totals.pharmacy_paid_uzs ? `<div class="tot"><span>Dorixona (to‘langan)</span><span>${fmt(data.totals.pharmacy_paid_uzs)} so‘m</span></div>` : ''}
      ${data.transfers_uzs ? `<div class="tot"><span>Inkassatsiya (seyfga)</span><span>${fmt(data.transfers_uzs)} so‘m</span></div>` : ''}
      <div class="tot big"><span>SOF NATIJA</span><span>${fmt(data.totals.net_uzs)} so‘m</span></div>
      <h3>Kassa reconciliation</h3>
      <div class="tot"><span>Boshlang‘ich (jami)</span><span>${fmt(data.cash.opening_uzs)} so‘m</span></div>
      <div class="tot"><span>Kutilgan naqd</span><span>${fmt(data.cash.expected_uzs)} so‘m</span></div>
      <div class="tot"><span>Haqiqiy sanaldi</span><span>${fmt(data.cash.actual_uzs)} so‘m</span></div>
      <div class="tot b"><span>Farq</span><span>${diff === 0 ? '0' : (diff > 0 ? '+' : '') + fmt(diff)} so‘m</span></div>
      <h3>Smenalar (${data.shifts.length})</h3>
      <table><thead><tr><th>Operator</th><th>Vaqt</th><th class="r">Kutilgan</th><th class="r">Haqiqiy</th><th class="r">Farq</th></tr></thead><tbody>${shiftRows || '<tr><td colspan="5">Smena yo‘q</td></tr>'}</tbody></table>
      </body></html>`;
    const w = window.open('', '_blank', 'width=820,height=900');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" /> Kunlik Z-hisobot
          </DialogTitle>
          <DialogDescription>
            Kun bo‘yicha barcha smenalar: to‘lov usuli kesimi, kassa farqi, rasxot.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="w-44" />
          {data && (
            <span className="text-sm text-muted-foreground">
              {data.shifts.length} smena{data.cash.open_shifts_count > 0 ? ` (${data.cash.open_shifts_count} ochiq)` : ''}
            </span>
          )}
        </div>

        {isLoading || !data ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : (
          <div className="space-y-4">
            {/* To'lov usuli kesimi */}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Usul</th>
                    <th className="px-3 py-2 text-right">Tushum</th>
                    <th className="px-3 py-2 text-right">Vozvrat</th>
                    <th className="px-3 py-2 text-right">Sof</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.by_method.length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-3 text-center text-muted-foreground">Tushum yo‘q</td></tr>
                  ) : (
                    data.by_method.map((m) => (
                      <tr key={m.method}>
                        <td className="px-3 py-2 font-medium">{ml(m.method)}</td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-700">{fmt(m.revenue_uzs)}</td>
                        <td className="px-3 py-2 text-right font-mono text-rose-600">{m.refund_uzs ? `−${fmt(m.refund_uzs)}` : '—'}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">{fmt(m.net_uzs)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Yakun */}
            <div className="rounded-lg border p-3 text-sm">
              <Row label="Tushum (jami)" value={`${fmt(data.totals.revenue_uzs)} so'm`} />
              <Row label="Vozvrat" value={`−${fmt(data.totals.refund_uzs)} so'm`} tone="rose" />
              <Row label="Rasxot" value={`−${fmt(data.totals.expenses_uzs)} so'm`} tone="rose" />
              <Row label="Maosh to'lovi" value={`−${fmt(data.totals.payroll_uzs)} so'm`} tone="rose" />
              {data.totals.pharmacy_paid_uzs > 0 && <Row label="Dorixona (to'langan)" value={`${fmt(data.totals.pharmacy_paid_uzs)} so'm`} />}
              {data.transfers_uzs > 0 && <Row label="Inkassatsiya (seyfga)" value={`${fmt(data.transfers_uzs)} so'm`} tone="sky" />}
              <div className="mt-1.5 flex items-center justify-between border-t pt-2 text-base font-bold">
                <span>SOF NATIJA</span>
                <span className={data.totals.net_uzs >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{fmt(data.totals.net_uzs)} so'm</span>
              </div>
            </div>

            {/* Kassa reconciliation */}
            <div className="rounded-lg border p-3 text-sm">
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Kassa reconciliation</div>
              <Row label="Boshlang'ich (jami)" value={`${fmt(data.cash.opening_uzs)} so'm`} />
              <Row label="Kutilgan naqd" value={`${fmt(data.cash.expected_uzs)} so'm`} />
              <Row label="Haqiqiy sanaldi" value={`${fmt(data.cash.actual_uzs)} so'm`} />
              <div className="mt-1 flex items-center justify-between font-semibold">
                <span>Farq</span>
                <span className={cn(diff === 0 ? 'text-emerald-700' : 'text-rose-700')}>
                  {diff === 0 ? 'mos' : `${diff > 0 ? '+' : ''}${fmt(diff)} so'm`}
                </span>
              </div>
            </div>

            {/* Smenalar */}
            {data.shifts.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Operator</th>
                      <th className="px-3 py-2 text-left">Vaqt</th>
                      <th className="px-3 py-2 text-right">Kutilgan</th>
                      <th className="px-3 py-2 text-right">Haqiqiy</th>
                      <th className="px-3 py-2 text-right">Farq</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.shifts.map((s, i) => {
                      const d = s.difference_uzs ?? 0;
                      return (
                        <tr key={i}>
                          <td className="px-3 py-2">{s.operator_name ?? '—'}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {fmtTime(s.opened_at)}–{s.closed_at ? fmtTime(s.closed_at) : 'ochiq'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(s.expected_cash_uzs)}</td>
                          <td className="px-3 py-2 text-right font-mono">{s.actual_cash_uzs == null ? '—' : fmt(s.actual_cash_uzs)}</td>
                          <td className={cn('px-3 py-2 text-right font-mono', !s.closed_at ? 'text-muted-foreground' : d === 0 ? 'text-emerald-700' : 'text-rose-600')}>
                            {!s.closed_at ? 'ochiq' : d === 0 ? '0' : `${d > 0 ? '+' : ''}${fmt(d)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Yopish</Button>
          <Button onClick={handlePrint} disabled={!data} className="gap-1.5">
            <Printer className="h-4 w-4" /> Chop etish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'rose' | 'sky' }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-mono', tone === 'rose' && 'text-rose-600', tone === 'sky' && 'text-sky-700')}>{value}</span>
    </div>
  );
}
