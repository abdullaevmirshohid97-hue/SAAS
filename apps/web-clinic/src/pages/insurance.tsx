import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck, FileDown, Check, X, Banknote, Receipt, Clock } from 'lucide-react';

import {
  PageHeader, Card, CardContent, Badge, Button, Input,
  Tabs, TabsList, TabsTrigger, TabsContent, EmptyState,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { downloadA4Pdf, escapeHtml } from '@/lib/report-export';

// =============================================================================
// Sug'urta (Faza B) — Claims + Settlements. /insurance (admin/owner/cashier).
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const ST: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Qoralama', cls: 'bg-slate-500/15 text-slate-600' },
  submitted: { label: 'Yuborilgan', cls: 'bg-blue-500/15 text-blue-600' },
  approved: { label: 'Tasdiqlangan', cls: 'bg-blue-500/15 text-blue-600' },
  partial: { label: 'Qisman', cls: 'bg-amber-500/15 text-amber-700' },
  paid: { label: 'To‘langan', cls: 'bg-emerald-500/15 text-emerald-600' },
  denied: { label: 'Rad etilgan', cls: 'bg-rose-500/15 text-rose-600' },
};
const StBadge = ({ s }: { s: string }) => {
  const v = ST[s] ?? { label: s, cls: '' };
  return <Badge variant="secondary" className={`text-[10px] ${v.cls}`}>{v.label}</Badge>;
};

type Claim = Awaited<ReturnType<typeof api.insurance.claims>>[number];

async function downloadClaimPdf(id: string) {
  const c = await api.insurance.getClaim(id);
  const rows = c.items
    .map((it, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(it.name_snapshot ?? '—')}</td>` +
      `<td class="r">${fmt(it.covered_amount_uzs)}</td><td class="r">${fmt(it.copay_amount_uzs)}</td></tr>`)
    .join('');
  const html =
    `<div class="doc-title">Sug'urta da'vosi — ${escapeHtml(c.claim_no)}</div>` +
    `<div class="doc-meta">Sana: ${c.created_at?.slice(0, 10) ?? ''} · Holat: ${escapeHtml(c.status)}</div>` +
    `<div style="font-size:12px;margin-bottom:12px">` +
    `<b>Sug'urta:</b> ${escapeHtml(c.insurer?.name ?? '—')}${c.insurer?.contract_no ? ' · Shartnoma №' + escapeHtml(c.insurer.contract_no) : ''}<br/>` +
    `<b>Bemor:</b> ${escapeHtml(c.patient?.full_name ?? '—')}${c.patient?.insurance_policy_no ? ' · Polis №' + escapeHtml(c.patient.insurance_policy_no) : ''}</div>` +
    `<table><thead><tr><th>#</th><th>Xizmat</th><th class="r">Qoplangan</th><th class="r">Copay</th></tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `<tfoot><tr><td colspan="2" class="r">Jami</td><td class="r">${fmt(c.claim_amount_uzs)}</td><td class="r">${fmt(c.copay_amount_uzs)}</td></tr></tfoot></table>` +
    `<div class="doc-footer">Clary Healthcare ERP · Sug'urta da'vosi</div>`;
  await downloadA4Pdf(html, `${c.claim_no}.pdf`);
}

export function InsurancePage() {
  const qc = useQueryClient();
  const { data: claims } = useQuery({ queryKey: ['ins-claims'], queryFn: () => api.insurance.claims() });
  const { data: settlements } = useQuery({ queryKey: ['ins-settlements'], queryFn: () => api.insurance.settlements() });
  const { data: aging } = useQuery({ queryKey: ['ins-aging'], queryFn: () => api.insurance.aging() });
  const [payClaim, setPayClaim] = useState<Claim | null>(null);
  const [denyClaim, setDenyClaim] = useState<Claim | null>(null);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ins-claims'] });
    qc.invalidateQueries({ queryKey: ['ins-settlements'] });
  };

  const submitMut = useMutation({ mutationFn: (id: string) => api.insurance.submitClaim(id), onSuccess: () => { toast.success('Yuborildi'); invalidate(); }, onError: (e: Error) => toast.error(e.message) });

  return (
    <div className="space-y-5">
      <PageHeader title="Sug'urta (claims)" description="Sug'urta da'volari (insurer-AR) va to'lovlar (settlement)." />

      <Tabs defaultValue="claims">
        <TabsList>
          <TabsTrigger value="claims"><ShieldCheck className="mr-1 h-3.5 w-3.5" /> Da'volar</TabsTrigger>
          <TabsTrigger value="settlements"><Receipt className="mr-1 h-3.5 w-3.5" /> To'lovlar</TabsTrigger>
          <TabsTrigger value="aging"><Clock className="mr-1 h-3.5 w-3.5" /> Qarzdorlik</TabsTrigger>
        </TabsList>

        {/* ── Da'volar ── */}
        <TabsContent value="claims">
          {(claims ?? []).length === 0 ? (
            <EmptyState title="Da'vo yo'q" description="Sug'urtali bemor checkout'da «Sug'urtaga yozish» belgilanganda paydo bo'ladi." />
          ) : (
            <div className="space-y-2">
              {claims?.map((c) => (
                <Card key={c.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{c.claim_no}</span>
                        <StBadge s={c.status} />
                        <span className="text-sm text-muted-foreground">{c.insurer?.name ?? '—'}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {c.patient?.full_name ?? '—'} · Qoplangan: <b>{fmt(c.claim_amount_uzs)}</b> · To'langan: {fmt(c.paid_amount_uzs)} · Copay: {fmt(c.copay_amount_uzs)}
                        {c.denial_reason ? ` · Rad: ${c.denial_reason}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="ghost" title="PDF" onClick={() => downloadClaimPdf(c.id).catch((e) => toast.error(String(e)))}><FileDown className="h-3.5 w-3.5" /></Button>
                      {c.status === 'draft' && <Button size="sm" variant="outline" onClick={() => submitMut.mutate(c.id)}><Check className="mr-1 h-3.5 w-3.5" /> Yuborish</Button>}
                      {['submitted', 'approved', 'partial'].includes(c.status) && (
                        <>
                          <Button size="sm" onClick={() => setPayClaim(c)}><Banknote className="mr-1 h-3.5 w-3.5" /> To'lov</Button>
                          <Button size="sm" variant="ghost" onClick={() => setDenyClaim(c)}><X className="h-3.5 w-3.5" /></Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── To'lovlar (settlement tarixi) ── */}
        <TabsContent value="settlements">
          {(settlements ?? []).length === 0 ? (
            <EmptyState title="To'lov yo'q" description="Insurer to'lovlari shu yerda ko'rinadi." />
          ) : (
            <div className="space-y-2">
              {settlements?.map((s) => (
                <Card key={s.id}>
                  <CardContent className="flex items-center justify-between p-3 text-sm">
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">{s.method}</Badge>
                      <span className="text-muted-foreground">{s.insurer?.name ?? '—'} · {s.settled_at}</span>
                      {s.notes ? <span className="text-xs text-muted-foreground">· {s.notes}</span> : null}
                    </span>
                    <span className="font-semibold">{fmt(s.amount_uzs)} so'm</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Qarzdorlik (insurer aging) ── */}
        <TabsContent value="aging">
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600" /><span className="font-semibold">Sug‘urta qarzdorligi (insurer aging)</span>
                <Badge variant="secondary" className="text-[10px]">Jami: {fmt(aging?.totals.total_owed ?? 0)} so'm</Badge>
              </div>
              {(aging?.rows ?? []).length === 0 ? (
                <EmptyState title="Ochiq qarz yo'q" description="To'lanmagan da'vo topilmadi." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-1.5">Sug‘urta</th>
                        <th className="text-right">0–30 kun</th><th className="text-right">31–60</th>
                        <th className="text-right">61–90</th><th className="text-right">90+</th><th className="text-right">Jami</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aging?.rows.map((r, i) => (
                        <tr key={i} className="border-b">
                          <td className="py-1.5">{r.insurer_name}</td>
                          <td className="text-right">{r.b0_30 ? fmt(r.b0_30) : '—'}</td>
                          <td className="text-right">{r.b31_60 ? fmt(r.b31_60) : '—'}</td>
                          <td className="text-right">{r.b61_90 ? fmt(r.b61_90) : '—'}</td>
                          <td className={`text-right ${r.b90_plus ? 'font-semibold text-rose-600' : ''}`}>{r.b90_plus ? fmt(r.b90_plus) : '—'}</td>
                          <td className="text-right font-semibold">{fmt(r.total_owed)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-bold">
                        <td className="py-2">JAMI</td>
                        <td className="text-right">{fmt(aging?.totals.b0_30 ?? 0)}</td>
                        <td className="text-right">{fmt(aging?.totals.b31_60 ?? 0)}</td>
                        <td className="text-right">{fmt(aging?.totals.b61_90 ?? 0)}</td>
                        <td className="text-right">{fmt(aging?.totals.b90_plus ?? 0)}</td>
                        <td className="text-right">{fmt(aging?.totals.total_owed ?? 0)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {payClaim && <PayDialog claim={payClaim} onClose={() => setPayClaim(null)} onDone={() => { setPayClaim(null); invalidate(); }} />}
      {denyClaim && <DenyDialog claim={denyClaim} onClose={() => setDenyClaim(null)} onDone={() => { setDenyClaim(null); invalidate(); }} />}
    </div>
  );
}

function PayDialog({ claim, onClose, onDone }: { claim: Claim; onClose: () => void; onDone: () => void }) {
  const remaining = claim.claim_amount_uzs - claim.paid_amount_uzs;
  const [amount, setAmount] = useState(String(remaining));
  const [method, setMethod] = useState('transfer');
  const mut = useMutation({
    mutationFn: () => api.insurance.payClaim(claim.id, { amount_uzs: Number(amount || 0), method }),
    onSuccess: () => { toast.success('To\'lov yozildi'); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Insurer to'lovi — {claim.claim_no}</DialogTitle>
          <DialogDescription>Qoldiq: {fmt(remaining)} so'm. GL: Dr kassa / Cr 1210 (Insurer AR).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-xs">Summa (so'm)
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">Usul
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="transfer">O'tkazma</option><option value="bank">Bank</option><option value="card">Plastik</option><option value="cash">Naqd</option>
            </select>
          </label>
          <Button className="w-full" disabled={!(Number(amount) > 0) || mut.isPending} onClick={() => mut.mutate()}>To'lovni yozish</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DenyDialog({ claim, onClose, onDone }: { claim: Claim; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const mut = useMutation({
    mutationFn: () => api.insurance.denyClaim(claim.id, reason.trim()),
    onSuccess: () => { toast.success('Rad etildi'); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Da'voni rad etish — {claim.claim_no}</DialogTitle>
          <DialogDescription>Qolgan summa 5200 (komissiya/chegirma) ga write-off qilinadi.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-xs">Sabab
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: polis muddati tugagan" />
          </label>
          <Button className="w-full" variant="destructive" disabled={!reason.trim() || mut.isPending} onClick={() => mut.mutate()}>Rad etish</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
